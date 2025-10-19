// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.12;

/**
 * @title IWhbarHelper
 * @notice Interface for WhbarHelper contract to interact with WHBAR
 */
interface IWhbarHelper {
  /**
   * @notice Gets the WHBAR contract address
   * @return The address of the WHBAR contract
   */
  function whbarContract() external view returns (address);

  /**
   * @notice Gets the WHBAR HTS token address
   * @return The address of the WHBAR HTS token
   */
  function whbarToken() external view returns (address);

  /**
   * @notice Safely unwrap WHBAR to msg.sender
   * @dev This contract needs an allowance from msg.sender to transfer the WHBAR token
   * @param wad The amount to unwrap
   */
  function unwrapWhbar(uint wad) external;

  /**
   * @notice Deposit WHBAR on behalf of msg.sender
   * @dev This is payable, WHBAR will check msg.value > 0
   */
  function deposit() external payable;
}
