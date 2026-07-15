// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {IERC20} from '../../contracts/dependencies/openzeppelin/contracts/IERC20.sol';
import {ILendingPool} from '../../contracts/interfaces/ILendingPool.sol';
import {ILendingPoolAddressesProvider} from '../../contracts/interfaces/ILendingPoolAddressesProvider.sol';
import {IFlashLoanReceiver} from '../../contracts/flashloan/interfaces/IFlashLoanReceiver.sol';
import {IHederaTokenService} from '../../contracts/interfaces/IHederaTokenService.sol';
import {ReserveConfiguration} from '../../contracts/protocol/libraries/configuration/ReserveConfiguration.sol';
import {DataTypes} from '../../contracts/protocol/libraries/types/DataTypes.sol';

interface IPoolPauseConfigurator {
  function setPoolPause(bool paused) external;
}

interface IAtomicRateStrategy {
  function baseVariableBorrowRate() external view returns (uint256);

  function variableRateSlope1() external view returns (uint256);

  function variableRateSlope2() external view returns (uint256);

  function getMaxVariableBorrowRate() external view returns (uint256);
}

/**
 * @notice Batched executor for refreshing every configured reserve's stored
 * interest rates without exposing an inter-transaction unpause window.
 *
 * The AddressesProvider owner temporarily assigns this contract as emergency
 * admin, the controller calls executeAtomicRefreshBatch() for each predefined
 * batch, and the owner restores the original emergency admin after the final
 * batch or any failure. This contract cannot restore the role itself and never
 * receives pool-admin or provider ownership.
 */
contract AtomicRatePokeExecutor is IFlashLoanReceiver {
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  address private constant HTS = address(0x167);
  int64 private constant HAPI_SUCCESS = 22;
  uint256 private constant EXPECTED_BASE_VARIABLE_RATE = 0;
  uint256 private constant EXPECTED_VARIABLE_RATE_SLOPE = 5e22; // 0.005% in ray
  uint256 private constant EXPECTED_MAX_VARIABLE_RATE = 1e23; // 0.01% in ray
  uint256 private constant RESERVE_COUNT = 14;
  uint8 private constant BATCH_COUNT = 4;
  uint8 private constant ALL_BATCHES_BITMAP = 15;
  uint8 private constant NO_ACTIVE_BATCH = 255;

  ILendingPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
  ILendingPool public immutable override LENDING_POOL;
  IPoolPauseConfigurator public immutable CONFIGURATOR;
  address public immutable CONTROLLER;
  address[14] public ASSETS;
  address[14] public STRATEGIES;

  uint8 public completedBatches;
  uint8 public activeBatch = NO_ACTIVE_BATCH;

  event AtomicRateRefreshBatchExecuted(
    address indexed controller,
    uint8 indexed batchId,
    uint8 completedBatches
  );
  event PauseOnlyRescueExecuted(address indexed controller);

  modifier onlyController() {
    require(msg.sender == CONTROLLER, 'EXECUTOR: caller not controller');
    _;
  }

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    address controller,
    address[14] memory assets,
    address[14] memory strategies
  ) public {
    require(address(addressesProvider) != address(0), 'EXECUTOR: zero provider');
    require(controller != address(0), 'EXECUTOR: zero controller');
    for (uint256 i = 0; i < RESERVE_COUNT; i++) {
      require(assets[i] != address(0), 'EXECUTOR: zero asset');
      require(strategies[i] != address(0), 'EXECUTOR: zero strategy');
      for (uint256 j = i + 1; j < RESERVE_COUNT; j++) {
        require(assets[i] != assets[j], 'EXECUTOR: duplicate asset');
      }
    }

    address pool = addressesProvider.getLendingPool();
    address configurator = addressesProvider.getLendingPoolConfigurator();
    require(pool != address(0) && configurator != address(0), 'EXECUTOR: incomplete provider');

    ADDRESSES_PROVIDER = addressesProvider;
    LENDING_POOL = ILendingPool(pool);
    CONFIGURATOR = IPoolPauseConfigurator(configurator);
    CONTROLLER = controller;

    for (uint256 i = 0; i < RESERVE_COUNT; i++) {
      ASSETS[i] = assets[i];
      STRATEGIES[i] = strategies[i];
      _associateIfHts(assets[i]);
    }
  }

  /**
   * @notice Atomically unpauses, refreshes one predefined reserve batch through
   * a mode-zero flash loan, and pauses again. Any failure reverts the complete
   * batch transaction, including the initial unpause and progress state.
   */
  function executeAtomicRefreshBatch(uint8 batchId) external onlyController {
    require(batchId < BATCH_COUNT, 'EXECUTOR: invalid batch');
    require(!_isBatchCompleted(batchId), 'EXECUTOR: batch already completed');
    require(activeBatch == NO_ACTIVE_BATCH, 'EXECUTOR: execution active');
    require(
      ADDRESSES_PROVIDER.getEmergencyAdmin() == address(this),
      'EXECUTOR: not emergency admin'
    );
    require(ADDRESSES_PROVIDER.getLendingPool() == address(LENDING_POOL), 'EXECUTOR: pool changed');
    require(
      ADDRESSES_PROVIDER.getLendingPoolConfigurator() == address(CONFIGURATOR),
      'EXECUTOR: configurator changed'
    );
    require(LENDING_POOL.paused(), 'EXECUTOR: pool not paused');
    (uint256 start, uint256 count) = _batchBounds(batchId);
    for (uint256 i = start; i < start + count; i++) {
      _validateReserve(ASSETS[i], STRATEGIES[i]);
    }

    // Set before the external calls to identify the only callback payload that
    // may be accepted. A failure anywhere below reverts this write together
    // with the unpause and all flash-loan effects.
    activeBatch = batchId;
    CONFIGURATOR.setPoolPause(false);
    require(!LENDING_POOL.paused(), 'EXECUTOR: unpause failed');

    address[] memory assets = new address[](count);
    uint256[] memory amounts = new uint256[](count);
    uint256[] memory modes = new uint256[](count); // mode 0: repay, never open debt
    for (uint256 i = 0; i < count; i++) {
      assets[i] = ASSETS[start + i];
      amounts[i] = 1;
    }

    LENDING_POOL.flashLoan(address(this), assets, amounts, modes, address(this), bytes(''), 0);

    CONFIGURATOR.setPoolPause(true);
    require(LENDING_POOL.paused(), 'EXECUTOR: final pause failed');
    activeBatch = NO_ACTIVE_BATCH;
    completedBatches |= uint8(uint256(1) << uint256(batchId));
    emit AtomicRateRefreshBatchExecuted(msg.sender, batchId, completedBatches);
  }

  function used() external view returns (bool) {
    return completedBatches == ALL_BATCHES_BITMAP;
  }

  function isBatchCompleted(uint8 batchId) external view returns (bool) {
    require(batchId < BATCH_COUNT, 'EXECUTOR: invalid batch');
    return _isBatchCompleted(batchId);
  }

  /**
   * @notice Pause-only recovery path while this contract holds emergency admin.
   * It deliberately cannot unpause and remains available after any or all
   * refresh batches have been used.
   */
  function pauseOnly() external onlyController {
    require(
      ADDRESSES_PROVIDER.getEmergencyAdmin() == address(this),
      'EXECUTOR: not emergency admin'
    );
    if (!LENDING_POOL.paused()) {
      CONFIGURATOR.setPoolPause(true);
    }
    require(LENDING_POOL.paused(), 'EXECUTOR: pause rescue failed');
    emit PauseOnlyRescueExecuted(msg.sender);
  }

  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata
  ) external override returns (bool) {
    require(msg.sender == address(LENDING_POOL), 'EXECUTOR: callback not pool');
    require(initiator == address(this), 'EXECUTOR: wrong initiator');
    require(activeBatch < BATCH_COUNT, 'EXECUTOR: execution not active');
    (uint256 start, uint256 count) = _batchBounds(activeBatch);
    require(
      assets.length == count && amounts.length == count && premiums.length == count,
      'EXECUTOR: wrong arrays'
    );

    for (uint256 i = 0; i < count; i++) {
      require(assets[i] == ASSETS[start + i], 'EXECUTOR: wrong assets');
      require(amounts[i] == 1, 'EXECUTOR: wrong amount');
      require(premiums[i] == 0, 'EXECUTOR: non-zero premium');
      require(IERC20(assets[i]).approve(address(LENDING_POOL), 1), 'EXECUTOR: approval failed');
    }
    return true;
  }

  function _batchBounds(uint8 batchId) private pure returns (uint256 start, uint256 count) {
    if (batchId == 0) return (0, 3);
    if (batchId == 1) return (3, 4);
    if (batchId == 2) return (7, 4);
    if (batchId == 3) return (11, 3);
    revert('EXECUTOR: invalid batch');
  }

  function _isBatchCompleted(uint8 batchId) private view returns (bool) {
    return (completedBatches & uint8(uint256(1) << uint256(batchId))) != 0;
  }

  function _associateIfHts(address token) private {
    (bool probeSucceeded, bytes memory probeResult) = HTS.call(
      abi.encodeWithSelector(IHederaTokenService.isToken.selector, token)
    );
    require(probeSucceeded && probeResult.length >= 64, 'EXECUTOR: HTS token probe failed');
    (int64 probeCode, bool isHtsToken) = abi.decode(probeResult, (int64, bool));
    require(probeCode == HAPI_SUCCESS, 'EXECUTOR: HTS token probe rejected');
    if (!isHtsToken) return;

    (bool associated, bytes memory associationResult) = HTS.call(
      abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), token)
    );
    require(associated && associationResult.length >= 32, 'EXECUTOR: HTS association call failed');
    require(
      abi.decode(associationResult, (int64)) == HAPI_SUCCESS,
      'EXECUTOR: HTS association rejected'
    );
  }

  function _validateReserve(address asset, address expectedStrategy) private view {
    DataTypes.ReserveConfigurationMap memory configuration = LENDING_POOL.getConfiguration(asset);
    (bool active, bool frozen, , bool stableBorrowingEnabled) = configuration.getFlagsMemory();
    require(active, 'EXECUTOR: reserve inactive');
    require(frozen, 'EXECUTOR: reserve not frozen');
    require(!stableBorrowingEnabled, 'EXECUTOR: stable borrowing enabled');

    DataTypes.ReserveData memory reserve = LENDING_POOL.getReserveData(asset);
    require(reserve.interestRateStrategyAddress == expectedStrategy, 'EXECUTOR: strategy changed');
    IAtomicRateStrategy strategy = IAtomicRateStrategy(expectedStrategy);
    require(
      strategy.baseVariableBorrowRate() == EXPECTED_BASE_VARIABLE_RATE,
      'EXECUTOR: wrong base rate'
    );
    require(
      strategy.variableRateSlope1() == EXPECTED_VARIABLE_RATE_SLOPE,
      'EXECUTOR: wrong slope1'
    );
    require(
      strategy.variableRateSlope2() == EXPECTED_VARIABLE_RATE_SLOPE,
      'EXECUTOR: wrong slope2'
    );
    require(
      strategy.getMaxVariableBorrowRate() == EXPECTED_MAX_VARIABLE_RATE,
      'EXECUTOR: wrong max rate'
    );
    require(reserve.aTokenAddress != address(0), 'EXECUTOR: reserve not initialized');
    require(IERC20(reserve.aTokenAddress).totalSupply() > 0, 'EXECUTOR: zero aToken supply');
    require(IERC20(asset).balanceOf(reserve.aTokenAddress) >= 1, 'EXECUTOR: no liquidity');
  }
}
