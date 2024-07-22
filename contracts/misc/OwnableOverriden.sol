// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import '../dependencies/openzeppelin/contracts/Ownable.sol';

/**
 * @dev Contract module which provides an enhanced access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 *
 * This version implements a two-step ownership transfer process and prevents
 * renouncing ownership to avoid leaving the contract without an owner.
 */
contract OwnableOverriden is Ownable {
  address private _pendingOwner;

  event OwnershipTransferInitiated(address indexed currentOwner, address indexed pendingOwner);

  /**
   * @dev Initiates the ownership transfer of the contract to a new account.
   * Can only be called by the current owner.
   */
  function transferOwnership(address newOwner) public virtual override onlyOwner {
    require(newOwner != address(0), 'OwnableOverriden: new owner is the zero address');
    require(newOwner != owner(), 'OwnableOverriden: new owner is the current owner');
    _pendingOwner = newOwner;
    emit OwnershipTransferInitiated(owner(), newOwner);
  }

  /**
   * @dev Accepts the ownership transfer. This function needs to be called by the previously
   * set pending owner.
   */
  function acceptOwnership() public virtual {
    require(msg.sender == _pendingOwner, 'OwnableOverriden: caller is not the pending owner');
    address previousOwner = owner();
    super.transferOwnership(_pendingOwner);
    _pendingOwner = address(0);
  }

  /**
   * @dev Returns the address of the pending owner.
   */
  function pendingOwner() public view returns (address) {
    return _pendingOwner;
  }

  /**
   * @dev Prevents renouncing ownership of the contract
   */
  function renounceOwnership() public virtual override onlyOwner {
    revert('OwnableOverriden: renouncing ownership is not allowed');
  }
}
