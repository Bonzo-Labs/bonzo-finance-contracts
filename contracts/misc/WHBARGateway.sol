// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {Ownable} from '../dependencies/openzeppelin/contracts/Ownable.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {ILendingPool} from '../interfaces/ILendingPool.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IAToken} from '../interfaces/IAToken.sol';
import {Helpers} from '../protocol/libraries/helpers/Helpers.sol';
import {DataTypes} from '../protocol/libraries/types/DataTypes.sol';
import {IWhbarHelper} from '../interfaces/IWhbarHelper.sol';
import {ReentrancyGuard} from '../dependencies/openzeppelin/contracts/ReentrancyGuard.sol';
import {SafeHederaTokenService} from './WHBAR/SafeHederaTokenService.sol';

/**
 * @title WHBARGateway
 * @dev Hedera-native HBAR wrapper gateway using an ERC20-compatible WHBAR contract.
 * Mirrors WETHGateway behavior but targets WHBAR instead of WETH.
 */
contract WHBARGateway is Ownable, ReentrancyGuard, SafeHederaTokenService {
  using SafeERC20 for IERC20;
  ILendingPoolAddressesProvider internal immutable addressesProvider;
  IWhbarHelper internal whbarHelper;
  IERC20 internal whbarToken;
  address internal whbarContract;
  bool internal whbarAssociated;
  uint256 internal constant MAX_APPROVAL = uint256(type(int64).max);
  address public lendingPool;

  // Events for audit compliance (TOB-BONZO-4)
  event WhbarAssociated(address indexed caller);
  event LendingPoolAuthorized(
    address indexed lendingPool,
    address indexed authorizedBy,
    uint256 timestamp
  );
  event DepositHBAR(
    address indexed caller,
    address indexed onBehalfOf,
    uint256 amount,
    uint16 referralCode
  );
  event WithdrawHBAR(address indexed caller, address indexed to, uint256 amount);
  event RepayHBAR(
    address indexed caller,
    address indexed onBehalfOf,
    uint256 amount,
    uint256 rateMode,
    uint256 refundAmount
  );
  event BorrowHBAR(
    address indexed caller,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode
  );
  event TokenAssociated(address indexed token, address indexed gateway, int32 responseCode);
  event ERC20Recovered(
    address indexed token,
    address indexed recipient,
    uint256 amount,
    address indexed recoveredBy
  );
  event NativeRecovered(address indexed recipient, uint256 amount, address indexed recoveredBy);

  constructor(address helper, address _addressesProvider) public {
    require(helper != address(0), 'Invalid helper address');
    require(_addressesProvider != address(0), 'Invalid addresses provider');
    whbarHelper = IWhbarHelper(helper);
    address tokenAddress = whbarHelper.whbarToken();
    whbarToken = IERC20(tokenAddress);
    whbarContract = whbarHelper.whbarContract();
    addressesProvider = ILendingPoolAddressesProvider(_addressesProvider);
  }

  function _ensureWhbarAssociation() internal {
    if (whbarAssociated) {
      return;
    }
    int32 response = associateToken(address(this), whbarHelper.whbarToken());
    require(
      response == SUCCESS || response == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT,
      'WHBAR association failed'
    );
    whbarAssociated = true;
    emit TokenAssociated(whbarHelper.whbarToken(), address(this), response);
  }

  function associateWhbarToken() public onlyOwner {
    _ensureWhbarAssociation();
    emit WhbarAssociated(msg.sender);
  }

  /**
   * @notice Authorizes a lending pool address for use with this gateway
   * @dev Only the canonical lending pool from addressesProvider can be authorized (TOB-BONZO-6)
   * @param lendingPoolAddress The lending pool address to authorize
   */
  function authorizeLendingPool(address lendingPoolAddress) external onlyOwner {
    require(lendingPoolAddress != address(0), 'Invalid lending pool');
    // Ensure the provided address matches the canonical lending pool (TOB-BONZO-6)
    require(lendingPoolAddress == addressesProvider.getLendingPool(), 'LENDING_POOL_MISMATCH');
    _ensureWhbarAssociation();
    // Restore legacy allowance pattern: reset to 0 then set max
    whbarToken.safeApprove(address(whbarHelper), 0);
    whbarToken.safeApprove(address(whbarHelper), MAX_APPROVAL);
    if (lendingPool != address(0) && lendingPool != lendingPoolAddress) {
      whbarToken.safeApprove(lendingPool, 0);
    }
    whbarToken.safeApprove(lendingPoolAddress, 0);
    whbarToken.safeApprove(lendingPoolAddress, MAX_APPROVAL);
    lendingPool = lendingPoolAddress;
    emit LendingPoolAuthorized(lendingPoolAddress, msg.sender, block.timestamp);
  }

  /**
   * @notice Deposits HBAR into the lending pool
   * @param lendingPoolAddress The lending pool address (must match authorized pool)
   * @param onBehalfOf The address to receive the aTokens
   * @param referralCode Referral code for tracking
   */
  function depositHBAR(
    address lendingPoolAddress,
    address onBehalfOf,
    uint16 referralCode
  ) external payable nonReentrant {
    require(msg.value > 0, 'Invalid HBAR amount');
    address pool = _validatedLendingPool(lendingPoolAddress);
    _deposit(pool, msg.value, onBehalfOf, referralCode);
    emit DepositHBAR(msg.sender, onBehalfOf, msg.value, referralCode);
  }

  /**
   * @notice Withdraws HBAR from the lending pool
   * @param lendingPoolAddress The lending pool address (must match authorized pool)
   * @param amount The amount to withdraw (use type(uint256).max for full balance)
   * @param to The address to receive the HBAR
   */
  function withdrawHBAR(
    address lendingPoolAddress,
    uint256 amount,
    address to
  ) external nonReentrant {
    address pool = _validatedLendingPool(lendingPoolAddress);
    uint256 withdrawn = _withdraw(pool, amount, to);
    emit WithdrawHBAR(msg.sender, to, withdrawn);
  }

  /**
   * @notice Repays HBAR debt in the lending pool
   * @param lendingPoolAddress The lending pool address (must match authorized pool)
   * @param amount The amount to repay
   * @param rateMode The interest rate mode (ignored, always uses variable)
   * @param onBehalfOf The address whose debt to repay
   */
  function repayHBAR(
    address lendingPoolAddress,
    uint256 amount,
    uint256 rateMode,
    address onBehalfOf
  ) external payable nonReentrant {
    address pool = _validatedLendingPool(lendingPoolAddress);
    (uint256 repaid, uint256 refund) = _repay(pool, amount, rateMode, onBehalfOf);
    emit RepayHBAR(msg.sender, onBehalfOf, repaid, rateMode, refund);
  }

  /**
   * @notice Borrows HBAR from the lending pool
   * @param lendingPoolAddress The lending pool address (must match authorized pool)
   * @param amount The amount to borrow
   * @param interestRateMode The interest rate mode
   * @param referralCode Referral code for tracking
   */
  function borrowHBAR(
    address lendingPoolAddress,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode
  ) external nonReentrant {
    address pool = _validatedLendingPool(lendingPoolAddress);
    _borrow(pool, amount, interestRateMode, referralCode);
    emit BorrowHBAR(msg.sender, amount, interestRateMode, referralCode);
  }

  /**
   * @dev Validates that the lending pool address matches the authorized pool (TOB-BONZO-6)
   * @param lendingPoolAddress The lending pool address to validate
   * @return The validated lending pool address
   */
  function _validatedLendingPool(address lendingPoolAddress) internal view returns (address) {
    require(lendingPool != address(0), 'LENDING_POOL_NOT_SET');
    require(lendingPoolAddress == lendingPool, 'INVALID_LENDING_POOL');
    return lendingPool;
  }

  function _deposit(
    address lendingPoolAddr,
    uint256 amount,
    address onBehalfOf,
    uint16 referralCode
  ) internal {
    require(amount > 0, 'INVALID_AMOUNT');
    _ensureWhbarAssociation();
    whbarHelper.deposit{value: amount}();
    _approveLendingPool(lendingPoolAddr, amount);
    ILendingPool(lendingPoolAddr).deposit(address(whbarToken), amount, onBehalfOf, referralCode);
  }

  function _withdraw(
    address lendingPoolAddr,
    uint256 amount,
    address to
  ) internal returns (uint256) {
    require(to != address(0), 'INVALID_RECIPIENT');
    _ensureWhbarAssociation();

    IAToken aToken = IAToken(
      ILendingPool(lendingPoolAddr).getReserveData(address(whbarToken)).aTokenAddress
    );
    uint256 userBalance = aToken.balanceOf(msg.sender);
    uint256 amountToWithdraw = amount;

    if (amount == type(uint256).max) {
      amountToWithdraw = userBalance;
    }

    require(amountToWithdraw > 0, 'INVALID_AMOUNT');
    require(amountToWithdraw <= userBalance, 'INSUFFICIENT_BALANCE');

    aToken.transferFrom(msg.sender, address(this), amountToWithdraw);
    ILendingPool(lendingPoolAddr).withdraw(address(whbarToken), amountToWithdraw, address(this));

    _approveHelper(amountToWithdraw);
    whbarHelper.unwrapWhbar(amountToWithdraw);
    _safeTransferHBAR(to, amountToWithdraw);

    return amountToWithdraw;
  }

  function _repay(
    address lendingPoolAddr,
    uint256 amount,
    uint256 rateMode,
    address onBehalfOf
  ) internal returns (uint256, uint256) {
    (uint256 stableDebt, uint256 variableDebt) = Helpers.getUserCurrentDebtMemory(
      onBehalfOf,
      ILendingPool(lendingPoolAddr).getReserveData(address(whbarToken))
    );
    // Default to variable debt; stable debt is disabled
    uint256 paybackAmount = variableDebt;

    if (amount < paybackAmount) {
      paybackAmount = amount;
    }

    require(paybackAmount > 0, 'NO_DEBT_TO_REPAY');

    require(msg.value >= paybackAmount, 'INSUFFICIENT_HBAR_SENT');
    _ensureWhbarAssociation();
    whbarHelper.deposit{value: paybackAmount}();
    _approveLendingPool(lendingPoolAddr, paybackAmount);
    // Always repay variable debt (rateMode = 2)
    ILendingPool(lendingPoolAddr).repay(address(whbarToken), paybackAmount, 2, onBehalfOf);

    // Compute refund safely without underflow
    uint256 refund = msg.value > paybackAmount ? (msg.value - paybackAmount) : 0;
    if (refund > 0) {
      _safeTransferHBAR(msg.sender, refund);
    }

    return (paybackAmount, refund);
  }

  function _borrow(
    address lendingPoolAddr,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode
  ) internal {
    require(amount > 0, 'INVALID_AMOUNT');
    _ensureWhbarAssociation();

    ILendingPool(lendingPoolAddr).borrow(
      address(whbarToken),
      amount,
      interestRateMode,
      referralCode,
      msg.sender
    );

    _approveHelper(amount);
    whbarHelper.unwrapWhbar(amount);
    _safeTransferHBAR(msg.sender, amount);
  }

  function _approveLendingPool(address lendingPool, uint256 amount) internal {
    whbarToken.safeApprove(lendingPool, 0);
    whbarToken.safeApprove(lendingPool, amount);
  }

  function _approveHelper(uint256 amount) internal {
    whbarToken.safeApprove(address(whbarHelper), 0);
    whbarToken.safeApprove(address(whbarHelper), amount);
  }

  // Native-only gateway; no asset predicates required

  function getWHBARAddress() external view returns (address) {
    return address(whbarToken);
  }

  function getLendingPool() external view returns (address) {
    return addressesProvider.getLendingPool();
  }

  function recoverERC20(address token, uint256 amount, address recipient) external onlyOwner {
    require(recipient != address(0), 'INVALID_RECIPIENT');
    IERC20(token).safeTransfer(recipient, amount);
    emit ERC20Recovered(token, recipient, amount, msg.sender);
  }

  function recoverNative(address recipient, uint256 amount) external onlyOwner {
    require(recipient != address(0), 'INVALID_RECIPIENT');
    _safeTransferHBAR(recipient, amount);
    emit NativeRecovered(recipient, amount, msg.sender);
  }

  function _safeTransferHBAR(address to, uint256 value) internal {
    (bool success, ) = to.call{value: value}(new bytes(0));
    require(success, 'HBAR_TRANSFER_FAILED');
  }

  receive() external payable {
    require(msg.sender == whbarContract || msg.sender == owner(), 'Receive not allowed');
  }

  fallback() external payable {
    revert('Fallback not allowed');
  }
}
