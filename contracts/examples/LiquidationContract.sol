// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import {FlashLoanReceiverBase} from '../flashloan/base/FlashLoanReceiverBase.sol';
import {ILendingPool} from '../interfaces/ILendingPool.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IERC20} from '../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeMath} from '../dependencies/openzeppelin/contracts/SafeMath.sol';
import {IHederaTokenService} from '../interfaces/IHederaTokenService.sol';

interface IUniswapV2Router01 {
  function swapTokensForExactTokens(
    uint256 amountOut,
    uint256 amountInMax,
    address[] calldata path,
    address to,
    uint256 deadline
  ) external returns (uint256[] memory amounts);
}

// Notice - The contract is for demonstration purposes only and has NOT been audited. It is provided on an as-is basis.
contract Liquidator is FlashLoanReceiverBase {
  using SafeMath for uint256;

  IUniswapV2Router01 public saucerswapRouter;
  address constant hts = address(0x167); // The well-known address of the HTS precompile.
  int64 constant HAPI_SUCCESS = 22; // HTS success code.
  address WHBAR = address(0x0000000000000000000000000000000000003aD2);
  address contractCreator;

  constructor(
    ILendingPoolAddressesProvider _addressProvider,
    IUniswapV2Router01 _saucerswapRouter
  ) public FlashLoanReceiverBase(_addressProvider) {
    saucerswapRouter = _saucerswapRouter;
    _associateToken(0x00000000000000000000000000000000004e891f); // BSAUCE
    _associateToken(0x0000000000000000000000000000000000003aD2);
    _associateToken(0x00000000000000000000000000000000004d50Fe); // BSTEAM
    _associateToken(0x0000000000000000000000000000000000001549); // USDC
    _associateToken(0x0000000000000000000000000000000000120f46); // SAUCE

    contractCreator = msg.sender;
  }

  /**
   * This function is called after your contract has received the flash loaned amount.
   */
  function executeOperation(
    address[] calldata assets,
    uint256[] calldata amounts,
    uint256[] calldata premiums,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    (address collateralAsset, address user) = abi.decode(params, (address, address));

    // assets[0] => debtAsset
    // amounts[0] => debtToCover
    require(
      IERC20(assets[0]).approve(address(LENDING_POOL), amounts[0]),
      'Approval to Lending Pool failed'
    );

    // Liquidate the user's position
    LENDING_POOL.liquidationCall(collateralAsset, assets[0], user, amounts[0], false);

    uint256 amountInContract = IERC20(collateralAsset).balanceOf(address(this));
    require(amountInContract > 0, 'No collateral received');

    IERC20(collateralAsset).approve(address(saucerswapRouter), amountInContract);

    address[] memory path;
    path[0] = collateralAsset;
    path[1] = WHBAR;
    path[2] = assets[0];

    uint256 amountOwed = amounts[0].add(premiums[0]);

    saucerswapRouter.swapTokensForExactTokens(
      amountInContract,
      amountOwed,
      path,
      address(this),
      block.timestamp + 1000
    );

    // Repay the flash loan
    IERC20(assets[0]).approve(address(LENDING_POOL), amountOwed);

    return true;
  }

  // Ensure that the tokens are associated with the contract before calling this function
  function liquidateWithoutFlashloan(
    address user,
    address debtAsset,
    address collateralAsset,
    uint256 debtToCover
  ) external {
    // Send the debtAsset from msg.sender to this contract
    require(
      IERC20(debtAsset).transferFrom(msg.sender, address(this), debtToCover),
      'Transfer failed'
    );
    require(IERC20(debtAsset).approve(address(LENDING_POOL), debtToCover), 'Approval failed');

    // Liquidate the user's position
    LENDING_POOL.liquidationCall(collateralAsset, debtAsset, user, debtToCover, false);
  }

  /**
   * Helper function to associate a token with this contract on Hedera.
   */
  function _associateToken(address token) internal {
    (bool success, bytes memory result) = hts.call(
      abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), token)
    );
    int64 responseCode = success ? abi.decode(result, (int64)) : int64(0);
    require(responseCode == HAPI_SUCCESS, 'Token association failed');
  }

  function liquidate(
    address user,
    address debtAsset,
    address collateralAsset,
    uint256 debtToCover
  ) external {
    address receiverAddress = address(this);

    address[] memory assets = new address[](1);
    assets[0] = address(debtAsset);

    uint256[] memory amounts = new uint256[](1);
    amounts[0] = debtToCover;

    // 0 = no debt, 1 = stable, 2 = variable
    uint256[] memory modes = new uint256[](1);
    modes[0] = 0;

    address onBehalfOf = address(this);
    bytes memory params = abi.encode(collateralAsset, user);
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

  // Ensure that the tokens are associated with the contract before calling this function
  function testSwapFunction(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOutDesired
  ) external {
    require(tokenIn != address(0) && tokenOut != address(0), 'Invalid token addresses');
    require(amountIn > 0 && amountOutDesired > 0, 'Invalid amounts');
    require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), 'Transfer failed');
    require(IERC20(tokenIn).approve(address(saucerswapRouter), amountIn), 'Approval failed');

    // Create dynamic path
    address[] memory path = new address[](3);
    path[0] = tokenIn;
    path[1] = WHBAR;
    path[2] = tokenOut;

    // Perform swap
    uint256[] memory amounts = saucerswapRouter.swapTokensForExactTokens(
      amountOutDesired,
      amountIn,
      path,
      msg.sender, // Send output tokens directly to caller
      block.timestamp + 1000
    );

    // Return unused tokenIn to caller
    uint256 unusedAmount = amountIn - amounts[0];
    if (unusedAmount > 0) {
      require(IERC20(tokenIn).transfer(msg.sender, unusedAmount), 'Refund failed');
    }
  }

  function associateToken(address token) external {
    _associateToken(token);
  }

  function setSaucerswapRouter(IUniswapV2Router01 _saucerswapRouter) external {
    saucerswapRouter = _saucerswapRouter;
  }

  function getSaucerswapRouter() external view returns (IUniswapV2Router01) {
    return saucerswapRouter;
  }

  function setWHBAR(address _whbar) external {
    require(_whbar != address(0), 'Invalid WHBAR address');
    WHBAR = _whbar;
  }

  function getWHBAR() external view returns (address) {
    return WHBAR;
  }

  function withdrawTokens(address token, uint256 amount) external {
    require(IERC20(token).transfer(msg.sender, amount), 'Transfer failed');
  }
}
