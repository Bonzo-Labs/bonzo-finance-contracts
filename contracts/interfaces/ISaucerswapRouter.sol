// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

//IUniswapV2Router01.sol
interface IUniswapV2Router01 {
  function swapTokensForExactTokens(
    uint amountOut,
    uint amountInMax,
    address[] calldata path,
    address to,
    uint deadline
  ) external returns (uint[] memory amounts);
}
