// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.5.0;

interface IWHBAR {
  function token() external returns (address);
  function deposit() external payable;
  function deposit(address src, address dst) external payable;
  function withdraw(address src, address dst, uint256 wad) external;
  function withdraw(uint256 wad) external;

  event Deposit(address indexed dst, uint256 wad);
  event Withdrawal(address indexed src, uint256 wad);
}
