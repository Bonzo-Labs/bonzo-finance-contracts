// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {IERC20} from '../../contracts/dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../../contracts/dependencies/openzeppelin/contracts/SafeERC20.sol';
import {ReentrancyGuard} from '../../contracts/dependencies/openzeppelin/contracts/ReentrancyGuard.sol';
import {ILendingPool} from '../../contracts/interfaces/ILendingPool.sol';
import {ILendingPoolAddressesProvider} from '../../contracts/interfaces/ILendingPoolAddressesProvider.sol';
import {IHederaTokenService} from '../../contracts/interfaces/IHederaTokenService.sol';
import {ReserveConfiguration} from '../../contracts/protocol/libraries/configuration/ReserveConfiguration.sol';
import {DataTypes} from '../../contracts/protocol/libraries/types/DataTypes.sol';

interface IAtomicRepayPauseConfigurator {
  function setPoolPause(bool paused) external;
}

/**
 * @notice Allows a fixed whitelist of payers to repay selected variable debts
 * for one immutable borrower while the Bonzo LendingPool otherwise stays paused.
 *
 * The AddressesProvider owner temporarily assigns this contract as emergency
 * admin. Each repayment atomically pulls one approved asset from the caller,
 * unpauses, repays the fixed borrower, and pauses again. A failure at any point
 * reverts the complete transaction, including the initial unpause and transfer.
 */
contract AtomicRepayHelper is ReentrancyGuard {
  using SafeERC20 for IERC20;
  using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

  address private constant HTS = address(0x167);
  int64 private constant HAPI_SUCCESS = 22;
  uint256 private constant VARIABLE_RATE_MODE = 2;

  // Wallet B's five selected variable-debt assets are fixed in the reviewed
  // bytecode. Deployment cannot substitute or reorder the repayment assets.
  address public constant BONZO = 0x00000000000000000000000000000000007e545e;
  address public constant HBARX = 0x00000000000000000000000000000000000cbA44;
  address public constant WETH = 0xCa367694CDaC8f152e33683BB36CC9d6A73F1ef2;
  address public constant WHBAR = 0x0000000000000000000000000000000000163B5a;
  address public constant XSAUCE = 0x00000000000000000000000000000000001647e8;

  ILendingPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
  ILendingPool public immutable LENDING_POOL;
  IAtomicRepayPauseConfigurator public immutable CONFIGURATOR;
  address public immutable CONTROLLER;
  address public immutable BORROWER;

  // These arrays and mappings are populated only in the constructor. There are
  // deliberately no functions for changing callers or assets after deployment.
  address[] public AUTHORIZED_CALLERS;
  address[] public ASSETS;
  address[] public HTS_ASSETS;
  mapping(address => bool) public authorizedCaller;
  mapping(address => bool) public allowedAsset;
  mapping(address => uint256) public totalRepaid;

  bool public repaymentsPaused;
  bool public closed;

  event AtomicRepaymentExecuted(
    address indexed asset,
    address indexed payer,
    address indexed borrower,
    uint256 amount,
    uint256 debtBefore,
    uint256 debtAfter,
    uint256 totalRepaidForAsset
  );
  event RepaymentsPauseChanged(bool paused, address indexed controller);
  event PoolPauseRescueExecuted(address indexed controller);
  event HelperClosed(address indexed controller);
  event ClosedHelperBalanceSwept(address indexed token, uint256 amount, address indexed controller);

  modifier onlyController() {
    require(msg.sender == CONTROLLER, 'REPAYMENT: caller not controller');
    _;
  }

  modifier onlyAuthorizedCaller() {
    require(authorizedCaller[msg.sender], 'REPAYMENT: caller not authorized');
    _;
  }

  constructor(
    ILendingPoolAddressesProvider addressesProvider,
    address controller,
    address borrower,
    address[] memory callers
  ) public {
    require(address(addressesProvider) != address(0), 'REPAYMENT: zero provider');
    require(controller != address(0), 'REPAYMENT: zero controller');
    require(borrower != address(0), 'REPAYMENT: zero borrower');
    require(callers.length > 0, 'REPAYMENT: no callers');

    address pool = addressesProvider.getLendingPool();
    address configurator = addressesProvider.getLendingPoolConfigurator();
    require(pool != address(0) && configurator != address(0), 'REPAYMENT: incomplete provider');
    ILendingPool lendingPool = ILendingPool(pool);

    ADDRESSES_PROVIDER = addressesProvider;
    LENDING_POOL = lendingPool;
    CONFIGURATOR = IAtomicRepayPauseConfigurator(configurator);
    CONTROLLER = controller;
    BORROWER = borrower;

    require(lendingPool.paused(), 'REPAYMENT: pool not paused');

    for (uint256 i = 0; i < callers.length; i++) {
      require(callers[i] != address(0), 'REPAYMENT: zero caller');
      require(!authorizedCaller[callers[i]], 'REPAYMENT: duplicate caller');
      authorizedCaller[callers[i]] = true;
      AUTHORIZED_CALLERS.push(callers[i]);
    }

    allowedAsset[BONZO] = true;
    allowedAsset[HBARX] = true;
    allowedAsset[WETH] = true;
    allowedAsset[WHBAR] = true;
    allowedAsset[XSAUCE] = true;

    ASSETS.push(BONZO);
    ASSETS.push(HBARX);
    ASSETS.push(WETH);
    ASSETS.push(WHBAR);
    ASSETS.push(XSAUCE);

    _validateReserveForPool(lendingPool, BONZO);
    _validateReserveForPool(lendingPool, HBARX);
    _validateReserveForPool(lendingPool, WETH);
    _validateReserveForPool(lendingPool, WHBAR);
    _validateReserveForPool(lendingPool, XSAUCE);

    // WETH is an ERC-20 contract. The other four fixed assets are HTS tokens.
    HTS_ASSETS.push(BONZO);
    HTS_ASSETS.push(HBARX);
    HTS_ASSETS.push(WHBAR);
    HTS_ASSETS.push(XSAUCE);

    _associateHtsAsset(BONZO);
    _associateHtsAsset(HBARX);
    _associateHtsAsset(WHBAR);
    _associateHtsAsset(XSAUCE);
  }

  function callerCount() external view returns (uint256) {
    return AUTHORIZED_CALLERS.length;
  }

  function assetCount() external view returns (uint256) {
    return ASSETS.length;
  }

  function htsAssetCount() external view returns (uint256) {
    return HTS_ASSETS.length;
  }

  function currentDebt(address asset) external view returns (uint256) {
    require(allowedAsset[asset], 'REPAYMENT: asset not allowed');
    DataTypes.ReserveData memory reserve = LENDING_POOL.getReserveData(asset);
    return IERC20(reserve.variableDebtTokenAddress).balanceOf(BORROWER);
  }

  /**
   * @notice Repays one approved reserve for the fixed borrower. The caller may
   * request any positive amount. Only min(amount, live debt) is pulled, so an
   * oversized request cannot strand excess tokens in this contract.
   */
  function repayToken(address asset, uint256 amount) external onlyAuthorizedCaller nonReentrant {
    _repayToken(msg.sender, asset, amount);
  }

  /**
   * @notice Lets the controller submit the contract call after an authorised
   * payer has granted this helper a token allowance. This supports Hedera
   * accounts that can sign native allowance transactions but cannot submit a
   * raw ECDSA Ethereum transaction through a JSON-RPC relay.
   */
  function repayTokenFrom(
    address payer,
    address asset,
    uint256 amount
  ) external onlyController nonReentrant {
    require(authorizedCaller[payer], 'REPAYMENT: payer not authorized');
    _repayToken(payer, asset, amount);
  }

  function _repayToken(address payer, address asset, uint256 amount) private {
    require(!closed, 'REPAYMENT: helper closed');
    require(!repaymentsPaused, 'REPAYMENT: repayments paused');
    require(allowedAsset[asset], 'REPAYMENT: asset not allowed');
    require(amount > 0, 'REPAYMENT: zero amount');
    require(
      ADDRESSES_PROVIDER.getEmergencyAdmin() == address(this),
      'REPAYMENT: not emergency admin'
    );
    require(
      ADDRESSES_PROVIDER.getLendingPool() == address(LENDING_POOL),
      'REPAYMENT: pool changed'
    );
    require(
      ADDRESSES_PROVIDER.getLendingPoolConfigurator() == address(CONFIGURATOR),
      'REPAYMENT: configurator changed'
    );
    require(LENDING_POOL.paused(), 'REPAYMENT: pool not paused');

    DataTypes.ReserveData memory reserve = _validateReserve(asset);
    uint256 debtBefore = IERC20(reserve.variableDebtTokenAddress).balanceOf(BORROWER);
    require(debtBefore > 0, 'REPAYMENT: no variable debt');
    uint256 paybackAmount = amount < debtBefore ? amount : debtBefore;

    IERC20 token = IERC20(asset);
    uint256 helperBalanceBefore = token.balanceOf(address(this));
    token.safeTransferFrom(payer, address(this), paybackAmount);
    token.safeApprove(address(LENDING_POOL), 0);
    token.safeApprove(address(LENDING_POOL), paybackAmount);

    CONFIGURATOR.setPoolPause(false);
    require(!LENDING_POOL.paused(), 'REPAYMENT: unpause failed');

    uint256 repaid = LENDING_POOL.repay(asset, paybackAmount, VARIABLE_RATE_MODE, BORROWER);
    require(repaid == paybackAmount, 'REPAYMENT: unexpected repayment');

    CONFIGURATOR.setPoolPause(true);
    require(LENDING_POOL.paused(), 'REPAYMENT: final pause failed');

    token.safeApprove(address(LENDING_POOL), 0);
    require(token.balanceOf(address(this)) == helperBalanceBefore, 'REPAYMENT: token residue');

    _recordRepayment(asset, reserve.variableDebtTokenAddress, payer, repaid, debtBefore);
  }

  /**
   * @notice Reversibly pauses only new helper repayments. It does not alter the
   * LendingPool pause state. A permanently closed helper cannot be resumed.
   */
  function setRepaymentsPaused(bool paused) external onlyController {
    if (!paused) require(!closed, 'REPAYMENT: helper closed');
    repaymentsPaused = paused;
    emit RepaymentsPauseChanged(paused, msg.sender);
  }

  /**
   * @notice Emergency path for restoring the LendingPool pause while this
   * helper is the live emergency admin. It remains callable after closure.
   */
  function pausePoolOnly() external onlyController {
    require(
      ADDRESSES_PROVIDER.getEmergencyAdmin() == address(this),
      'REPAYMENT: not emergency admin'
    );
    if (!LENDING_POOL.paused()) {
      CONFIGURATOR.setPoolPause(true);
    }
    require(LENDING_POOL.paused(), 'REPAYMENT: pool pause rescue failed');
    emit PoolPauseRescueExecuted(msg.sender);
  }

  /**
   * @notice Permanently disables repayments. There is deliberately no reopen
   * function. Emergency-admin authority must still be restored separately.
   */
  function close() external onlyController {
    require(!closed, 'REPAYMENT: already closed');
    require(LENDING_POOL.paused(), 'REPAYMENT: pool not paused');
    repaymentsPaused = true;
    closed = true;
    emit RepaymentsPauseChanged(true, msg.sender);
    emit HelperClosed(msg.sender);
  }

  /**
   * @notice Recovers any ERC-20 or HTS token accidentally sent to the helper,
   * including a token outside the repayment asset list, but only after close.
   */
  function sweepAfterClose(address token) external onlyController nonReentrant {
    require(closed, 'REPAYMENT: helper not closed');
    require(LENDING_POOL.paused(), 'REPAYMENT: pool not paused');
    require(token != address(0), 'REPAYMENT: zero token');
    uint256 balance = IERC20(token).balanceOf(address(this));
    require(balance > 0, 'REPAYMENT: zero balance');
    IERC20(token).safeTransfer(CONTROLLER, balance);
    emit ClosedHelperBalanceSwept(token, balance, CONTROLLER);
  }

  function _recordRepayment(
    address asset,
    address variableDebtToken,
    address payer,
    uint256 repaid,
    uint256 debtBefore
  ) private {
    totalRepaid[asset] = totalRepaid[asset] + repaid;
    uint256 debtAfter = IERC20(variableDebtToken).balanceOf(BORROWER);
    emit AtomicRepaymentExecuted(
      asset,
      payer,
      BORROWER,
      repaid,
      debtBefore,
      debtAfter,
      totalRepaid[asset]
    );
  }

  function _validateReserve(
    address asset
  ) private view returns (DataTypes.ReserveData memory reserve) {
    return _validateReserveForPool(LENDING_POOL, asset);
  }

  function _validateReserveForPool(
    ILendingPool lendingPool,
    address asset
  ) private view returns (DataTypes.ReserveData memory reserve) {
    DataTypes.ReserveConfigurationMap memory configuration = lendingPool.getConfiguration(asset);
    (bool active, bool frozen, , bool stableBorrowingEnabled) = configuration.getFlagsMemory();
    require(active, 'REPAYMENT: reserve inactive');
    require(frozen, 'REPAYMENT: reserve not frozen');
    require(!stableBorrowingEnabled, 'REPAYMENT: stable borrowing enabled');
    reserve = lendingPool.getReserveData(asset);
    require(reserve.aTokenAddress != address(0), 'REPAYMENT: reserve not initialized');
    require(reserve.variableDebtTokenAddress != address(0), 'REPAYMENT: no variable debt token');
  }

  function _associateHtsAsset(address token) private {
    (bool associated, bytes memory associationResult) = HTS.call(
      abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), token)
    );
    require(associated && associationResult.length >= 32, 'REPAYMENT: HTS association failed');
    require(
      abi.decode(associationResult, (int64)) == HAPI_SUCCESS,
      'REPAYMENT: HTS association rejected'
    );
  }
}
