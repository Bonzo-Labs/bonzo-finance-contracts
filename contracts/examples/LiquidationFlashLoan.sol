// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {FlashLoanReceiverBase} from '../flashloan/base/FlashLoanReceiverBase.sol';
import {ILendingPool} from '../interfaces/ILendingPool.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeMath} from '../dependencies/openzeppelin/contracts/SafeMath.sol';
import {IHederaTokenService} from '../interfaces/IHederaTokenService.sol';

contract LiquidationFlashLoan is FlashLoanReceiverBase {
  using SafeMath for uint256;

  address constant hts = address(0x167); // The well known address of the native HTS precompiled contract.
  int64 constant HAPI_SUCCESS = 22; // HTS Response code indicating success.
  int64 constant PRECOMPILE_BIND_ERROR = -1; // HTS Precompile (.call) Failed before the HAPI response code could be retrieved.

  constructor(
    ILendingPoolAddressesProvider _addressProvider
  ) public FlashLoanReceiverBase(_addressProvider) {
    _associate(0x0000000000000000000000000000000000120f46);
    _associate(0x00000000000000000000000000000000000014F5);
  }

  /**
   * This function is called after your contract has received the flash loaned amount
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    //
    // This contract now has the funds requested.
    // Your logic goes here.
    //
    (address _collateral, address _reserve, address _user, uint256 _amount) = abi.decode(
      params,
      (address, address, address, uint256)
    );
    _liquidate(_collateral, _reserve, _user, _amount);

    // At the end of your logic above, this contract owes
    // the flashloaned amounts + premiums.
    // Therefore ensure your contract has enough to repay
    // these amounts.

    // Approve the LendingPool contract allowance to *pull* the owed amount
    for (uint256 i = 0; i < assets.length; i++) {
      uint256 amountOwing = amounts[i].add(premiums[i]);
      IERC20(assets[i]).approve(address(LENDING_POOL), amountOwing);
    }

    return true;
  }

  function _liquidate(
    address _collateral,
    address _reserve,
    address _user,
    uint256 _amount
  ) private {
    // Approve the asset to the Lending Pool
    IERC20(_collateral).approve(address(LENDING_POOL), _amount);
    // Call the liquidate function
    LENDING_POOL.liquidationCall(_collateral, _reserve, _user, _amount, false);

    // // Get the balance of the collateral in this contract
    // uint256 balanceAfter = IERC20(_collateral).balanceOf(address(this));
    // // Transfer the collateral to the liquidator
    // IERC20(_collateral).transfer(_liquidator, balanceAfter);
  }

  /**
   * Helper function that calls HTS to associate this contract
   * with the collateral token so that it may receive and hold it.
   */
  function _associate(address _asset) private {
    (bool success, bytes memory result) = hts.call(
      abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), _asset)
    );
    int64 responseCode = success ? abi.decode(result, (int64)) : PRECOMPILE_BIND_ERROR;
    if (responseCode != HAPI_SUCCESS) {
      revert('Failed to associate token with HTS');
    }
  }

  function myFlashLoanCall(
    address _collateral,
    address _reserve,
    address _user,
    uint256 _amount
  ) public {
    address receiverAddress = address(this);

    address[] memory assets = new address[](1);
    assets[0] = address(_reserve);

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = _amount;

    // 0 = no debt, 1 = stable, 2 = variable
    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    address onBehalfOf = address(this);
    bytes memory params = abi.encode(_collateral, _reserve, _user, _amount);
    uint16 referralCode = 0;

    LENDING_POOL.flashLoan(
      receiverAddress,
      assets,
      amounts,
      modes,
      onBehalfOf,
      params,
      referralCode
    );
  }
}
