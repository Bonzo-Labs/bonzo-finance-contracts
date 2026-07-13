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

/**
 * @notice One-shot executor for refreshing the stored WHBAR, USDC, and WETH
 * interest rates without exposing an inter-transaction unpause window.
 *
 * The AddressesProvider owner temporarily assigns this contract as emergency
 * admin, the controller calls executeAtomicRefresh(), and the owner restores
 * the original emergency admin after the transaction. This contract cannot
 * restore the role itself and never receives pool-admin or provider ownership.
 */
contract AtomicRatePokeExecutor is IFlashLoanReceiver {
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  address private constant HTS = address(0x167);
  int64 private constant HAPI_SUCCESS = 22;

  ILendingPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
  ILendingPool public immutable override LENDING_POOL;
  IPoolPauseConfigurator public immutable CONFIGURATOR;
  address public immutable CONTROLLER;
  address public immutable WHBAR;
  address public immutable USDC;
  address public immutable WETH;
  address public immutable WHBAR_STRATEGY;
  address public immutable USDC_STRATEGY;
  address public immutable WETH_STRATEGY;

  bool public used;

  event AtomicRateRefreshExecuted(address indexed controller);
  event PauseOnlyRescueExecuted(address indexed controller);

  modifier onlyController() {
    require(msg.sender == CONTROLLER, 'EXECUTOR: caller not controller');
    _;
  }

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    address controller,
    address whbar,
    address usdc,
    address weth,
    address whbarStrategy,
    address usdcStrategy,
    address wethStrategy
  ) public {
    require(address(addressesProvider) != address(0), 'EXECUTOR: zero provider');
    require(controller != address(0), 'EXECUTOR: zero controller');
    require(
      whbar != address(0) && usdc != address(0) && weth != address(0),
      'EXECUTOR: zero asset'
    );
    require(whbar != usdc && whbar != weth && usdc != weth, 'EXECUTOR: duplicate asset');
    require(
      whbarStrategy != address(0) && usdcStrategy != address(0) && wethStrategy != address(0),
      'EXECUTOR: zero strategy'
    );

    address pool = addressesProvider.getLendingPool();
    address configurator = addressesProvider.getLendingPoolConfigurator();
    require(pool != address(0) && configurator != address(0), 'EXECUTOR: incomplete provider');

    ADDRESSES_PROVIDER = addressesProvider;
    LENDING_POOL = ILendingPool(pool);
    CONFIGURATOR = IPoolPauseConfigurator(configurator);
    CONTROLLER = controller;
    WHBAR = whbar;
    USDC = usdc;
    WETH = weth;
    WHBAR_STRATEGY = whbarStrategy;
    USDC_STRATEGY = usdcStrategy;
    WETH_STRATEGY = wethStrategy;

    _associateIfHts(whbar);
    _associateIfHts(usdc);
    _associateIfHts(weth);
  }

  /**
   * @notice Atomically unpauses, refreshes all three reserves through a
   * mode-zero flash loan, and pauses again. Any failure reverts the complete
   * transaction, including the initial unpause.
   */
  function executeAtomicRefresh() external onlyController {
    require(!used, 'EXECUTOR: already used');
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
    _validateReserve(WHBAR, WHBAR_STRATEGY);
    _validateReserve(USDC, USDC_STRATEGY);
    _validateReserve(WETH, WETH_STRATEGY);

    // Set before the external calls to prevent controller-driven re-entry. A
    // failure anywhere below reverts this write together with the unpause.
    used = true;
    CONFIGURATOR.setPoolPause(false);
    require(!LENDING_POOL.paused(), 'EXECUTOR: unpause failed');

    address[] memory assets = new address[](3);
    assets[0] = WHBAR;
    assets[1] = USDC;
    assets[2] = WETH;

    uint256[] memory amounts = new uint256[](3);
    amounts[0] = 1;
    amounts[1] = 1;
    amounts[2] = 1;

    uint256[] memory modes = new uint256[](3); // all mode 0: repay, never open debt

    LENDING_POOL.flashLoan(address(this), assets, amounts, modes, address(this), bytes(''), 0);

    CONFIGURATOR.setPoolPause(true);
    require(LENDING_POOL.paused(), 'EXECUTOR: final pause failed');
    emit AtomicRateRefreshExecuted(msg.sender);
  }

  /**
   * @notice Pause-only recovery path while this contract holds emergency admin.
   * It deliberately cannot unpause and remains available after the one-shot
   * refresh has been used.
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
    require(used, 'EXECUTOR: execution not active');
    require(
      assets.length == 3 && amounts.length == 3 && premiums.length == 3,
      'EXECUTOR: wrong arrays'
    );
    require(assets[0] == WHBAR && assets[1] == USDC && assets[2] == WETH, 'EXECUTOR: wrong assets');

    for (uint256 i = 0; i < 3; i++) {
      require(amounts[i] == 1, 'EXECUTOR: wrong amount');
      require(premiums[i] == 0, 'EXECUTOR: non-zero premium');
      require(IERC20(assets[i]).approve(address(LENDING_POOL), 1), 'EXECUTOR: approval failed');
    }
    return true;
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
    require(reserve.aTokenAddress != address(0), 'EXECUTOR: reserve not initialized');
    require(IERC20(asset).balanceOf(reserve.aTokenAddress) >= 1, 'EXECUTOR: no liquidity');
  }
}
