// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {ILendingPool} from '../../interfaces/ILendingPool.sol';
import {ILendingPoolAddressesProvider} from '../../interfaces/ILendingPoolAddressesProvider.sol';
import {IAToken} from '../../interfaces/IAToken.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {Address} from '../../dependencies/openzeppelin/contracts/Address.sol';
import {IAaveIncentivesController} from '../../interfaces/IAaveIncentivesController.sol';

contract LendingPoolPeriphery {
  using SafeERC20 for IERC20;
  using Address for address;

  ILendingPoolAddressesProvider public addressesProvider;
  ILendingPool public lendingPool;

  struct InitDepositParams {
    address asset;
    uint256 amount;
    address onBehalfOf;
    uint16 referralCode;
    address aTokenAddress;
    address treasury;
    address incentivesController;
    uint8 aTokenDecimals;
    string aTokenName;
    string aTokenSymbol;
    bytes params;
  }

  constructor(ILendingPoolAddressesProvider provider) public {
    addressesProvider = provider;
    lendingPool = ILendingPool(provider.getLendingPool());
  }

  /**
   * @dev Wrapper function to atomically initialize and deposit
   * @param initParams The struct containing initialization and deposit parameters
   */
  function initializeAndDeposit(InitDepositParams calldata initParams) external payable {
    // Initialize the aToken
    IAToken aToken = IAToken(initParams.aTokenAddress);
    aToken.initialize(
      lendingPool,
      initParams.treasury,
      initParams.asset,
      IAaveIncentivesController(initParams.incentivesController),
      initParams.aTokenDecimals,
      initParams.aTokenName,
      initParams.aTokenSymbol,
      initParams.params
    );

    // Approve the LendingPool contract to spend the underlying asset
    IERC20(initParams.asset).safeApprove(address(lendingPool), initParams.amount);

    // Deposit the underlying asset into the LendingPool
    lendingPool.deposit{value: msg.value}(
      initParams.asset,
      initParams.amount,
      initParams.onBehalfOf,
      initParams.referralCode
    );
  }
}
