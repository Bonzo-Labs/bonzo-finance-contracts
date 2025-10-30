// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {Ownable} from '../dependencies/openzeppelin/contracts/Ownable.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {ILendingPool} from '../interfaces/ILendingPool.sol';
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
  IWhbarHelper internal whbarHelper;
  IERC20 internal whbarToken;
  address internal whbarContract;
  bool internal whbarAssociated;
  uint256 internal constant MAX_APPROVAL = uint256(type(int64).max);

  // Events
  event DepositHBAR(
    address indexed user,
    address indexed lendingPool,
    address indexed onBehalfOf,
    uint256 hbarAmount,
    uint256 whbarAmount,
    uint16 referralCode
  );

  event WithdrawHBAR(
    address indexed user,
    address indexed lendingPool,
    address indexed to,
    uint256 amount,
    uint256 hbarAmount
  );

  event RepayHBAR(
    address indexed user,
    address indexed lendingPool,
    address indexed onBehalfOf,
    uint256 hbarAmount,
    uint256 whbarAmount,
    uint256 rateMode,
    uint256 refundAmount
  );

  event BorrowHBAR(
    address indexed user,
    address indexed lendingPool,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode
  );

  event LendingPoolAuthorized(
    address indexed lendingPool,
    address indexed authorizedBy,
    uint256 timestamp
  );

  event TokenAssociated(address indexed token, address indexed gateway, int32 responseCode);

  event ERC20Recovered(
    address indexed token,
    address indexed recipient,
    uint256 amount,
    address indexed recoveredBy
  );

  event NativeRecovered(address indexed recipient, uint256 amount, address indexed recoveredBy);

  constructor(address helper) public {
    require(helper != address(0), 'Invalid helper address');
    whbarHelper = IWhbarHelper(helper);
    address tokenAddress = whbarHelper.whbarToken();
    whbarToken = IERC20(tokenAddress);
    whbarContract = whbarHelper.whbarContract();
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
  }

  function authorizeLendingPool(address lendingPool) external onlyOwner {
    require(lendingPool != address(0), 'Invalid lending pool');
    _ensureWhbarAssociation();
    // Restore legacy allowance pattern: reset to 0 then set max
    whbarToken.safeApprove(address(whbarHelper), 0);
    whbarToken.safeApprove(address(whbarHelper), MAX_APPROVAL);
    whbarToken.safeApprove(lendingPool, 0);
    whbarToken.safeApprove(lendingPool, MAX_APPROVAL);
    emit LendingPoolAuthorized(lendingPool, msg.sender, block.timestamp);
  }

  function depositHBAR(
    address lendingPool,
    address onBehalfOf,
    uint16 referralCode
  ) external payable nonReentrant {
    require(msg.value > 0, 'Invalid HBAR amount');
    _deposit(lendingPool, msg.value, onBehalfOf, referralCode);
  }

  function withdrawHBAR(address lendingPool, uint256 amount, address to) external nonReentrant {
    _withdraw(lendingPool, amount, to);
  }

  function repayHBAR(
    address lendingPool,
    uint256 amount,
    uint256 rateMode,
    address onBehalfOf
  ) external payable nonReentrant {
    _repay(lendingPool, amount, rateMode, onBehalfOf);
  }

  function borrowHBAR(
    address lendingPool,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode
  ) external nonReentrant {
    _borrow(lendingPool, amount, interestRateMode, referralCode);
  }

  function _deposit(
    address lendingPool,
    uint256 amount,
    address onBehalfOf,
    uint16 referralCode
  ) internal {
    require(lendingPool != address(0), 'INVALID_LENDING_POOL');
    require(amount > 0, 'INVALID_AMOUNT');
    _ensureWhbarAssociation();
    whbarHelper.deposit{value: amount}();
    _approveLendingPool(lendingPool, amount);
    ILendingPool(lendingPool).deposit(address(whbarToken), amount, onBehalfOf, referralCode);
    emit DepositHBAR(msg.sender, lendingPool, onBehalfOf, amount, amount, referralCode);
  }

  function _withdraw(address lendingPool, uint256 amount, address to) internal returns (uint256) {
    require(to != address(0), 'INVALID_RECIPIENT');
    _ensureWhbarAssociation();

    IAToken aToken = IAToken(
      ILendingPool(lendingPool).getReserveData(address(whbarToken)).aTokenAddress
    );
    uint256 userBalance = aToken.balanceOf(msg.sender);
    uint256 amountToWithdraw = amount;

    if (amount == type(uint256).max) {
      amountToWithdraw = userBalance;
    }

    require(amountToWithdraw > 0, 'INVALID_AMOUNT');
    require(amountToWithdraw <= userBalance, 'INSUFFICIENT_BALANCE');

    aToken.transferFrom(msg.sender, address(this), amountToWithdraw);
    ILendingPool(lendingPool).withdraw(address(whbarToken), amountToWithdraw, address(this));

    _approveHelper(amountToWithdraw);
    whbarHelper.unwrapWhbar(amountToWithdraw);
    _safeTransferHBAR(to, amountToWithdraw);

    emit WithdrawHBAR(msg.sender, lendingPool, to, amountToWithdraw, amountToWithdraw);
    return amountToWithdraw;
  }

  function _repay(
    address lendingPool,
    uint256 amount,
    uint256 rateMode,
    address onBehalfOf
  ) internal returns (uint256) {
    (uint256 stableDebt, uint256 variableDebt) = Helpers.getUserCurrentDebtMemory(
      onBehalfOf,
      ILendingPool(lendingPool).getReserveData(address(whbarToken))
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
    _approveLendingPool(lendingPool, paybackAmount);
    // Always repay variable debt (rateMode = 2)
    ILendingPool(lendingPool).repay(address(whbarToken), paybackAmount, 2, onBehalfOf);

    // Compute refund safely without underflow
    uint256 refund = msg.value > paybackAmount ? (msg.value - paybackAmount) : 0;
    if (refund > 0) {
      _safeTransferHBAR(msg.sender, refund);
    }

    emit RepayHBAR(msg.sender, lendingPool, onBehalfOf, msg.value, paybackAmount, 2, refund);

    return paybackAmount;
  }

  function _borrow(
    address lendingPool,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode
  ) internal {
    require(amount > 0, 'INVALID_AMOUNT');
    _ensureWhbarAssociation();

    ILendingPool(lendingPool).borrow(
      address(whbarToken),
      amount,
      interestRateMode,
      referralCode,
      msg.sender
    );

    _approveHelper(amount);
    whbarHelper.unwrapWhbar(amount);
    _safeTransferHBAR(msg.sender, amount);

    emit BorrowHBAR(msg.sender, lendingPool, amount, interestRateMode, referralCode);
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
