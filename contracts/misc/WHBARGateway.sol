// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {Ownable} from '../dependencies/openzeppelin/contracts/Ownable.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {IWETH} from './interfaces/IWETH.sol';
import {ILendingPool} from '../interfaces/ILendingPool.sol';
import {IAToken} from '../interfaces/IAToken.sol';
import {Helpers} from '../protocol/libraries/helpers/Helpers.sol';
import {DataTypes} from '../protocol/libraries/types/DataTypes.sol';

/**
 * @title WHBARGateway
 * @dev Hedera-native HBAR wrapper gateway using an ERC20-compatible WHBAR contract.
 * Mirrors WETHGateway behavior but targets WHBAR instead of WETH.
 */
contract WHBARGateway is Ownable {
  IWETH internal immutable WHBAR;

  constructor(address whbar) public {
    WHBAR = IWETH(whbar);
  }

  function authorizeLendingPool(address lendingPool) external onlyOwner {
    WHBAR.approve(lendingPool, uint256(-1));
  }

  function depositHBAR(
    address lendingPool,
    address onBehalfOf,
    uint16 referralCode
  ) external payable {
    WHBAR.deposit{value: msg.value}();
    ILendingPool(lendingPool).deposit(address(WHBAR), msg.value, onBehalfOf, referralCode);
  }

  function withdrawHBAR(address lendingPool, uint256 amount, address to) external {
    IAToken aWHBAR = IAToken(
      ILendingPool(lendingPool).getReserveData(address(WHBAR)).aTokenAddress
    );
    uint256 userBalance = aWHBAR.balanceOf(msg.sender);
    uint256 amountToWithdraw = amount;

    if (amount == type(uint256).max) {
      amountToWithdraw = userBalance;
    }

    aWHBAR.transferFrom(msg.sender, address(this), amountToWithdraw);
    ILendingPool(lendingPool).withdraw(address(WHBAR), amountToWithdraw, address(this));
    WHBAR.withdraw(amountToWithdraw);
    _safeTransferHBAR(to, amountToWithdraw);
  }

  function repayHBAR(
    address lendingPool,
    uint256 amount,
    uint256 rateMode,
    address onBehalfOf
  ) external payable {
    (uint256 stableDebt, uint256 variableDebt) = Helpers.getUserCurrentDebtMemory(
      onBehalfOf,
      ILendingPool(lendingPool).getReserveData(address(WHBAR))
    );

    uint256 paybackAmount = DataTypes.InterestRateMode(rateMode) ==
      DataTypes.InterestRateMode.STABLE
      ? stableDebt
      : variableDebt;

    if (amount < paybackAmount) {
      paybackAmount = amount;
    }
    require(msg.value >= paybackAmount, 'INSUFFICIENT_HBAR_SENT');

    WHBAR.deposit{value: paybackAmount}();
    ILendingPool(lendingPool).repay(address(WHBAR), msg.value, rateMode, onBehalfOf);

    if (msg.value > paybackAmount) {
      _safeTransferHBAR(msg.sender, msg.value - paybackAmount);
    }
  }

  function borrowHBAR(
    address lendingPool,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode
  ) external {
    ILendingPool(lendingPool).borrow(
      address(WHBAR),
      amount,
      interestRateMode,
      referralCode,
      msg.sender
    );
    WHBAR.withdraw(amount);
    _safeTransferHBAR(msg.sender, amount);
  }

  function getWHBARAddress() external view returns (address) {
    return address(WHBAR);
  }

  function _safeTransferHBAR(address to, uint256 value) internal {
    (bool success, ) = to.call{value: value}(new bytes(0));
    require(success, 'HBAR_TRANSFER_FAILED');
  }

  receive() external payable {
    require(msg.sender == address(WHBAR), 'Receive not allowed');
  }

  fallback() external payable {
    revert('Fallback not allowed');
  }
}
