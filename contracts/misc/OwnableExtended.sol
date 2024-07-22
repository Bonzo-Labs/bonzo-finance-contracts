// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from '../dependencies/openzeppelin/contracts/UpdatedOwnable.sol';

abstract contract OwnableExtended is Ownable {
  address private _pendingOwner;

  event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

  /**
   * @dev Throws if called by any account other than the pending owner.
   */
  modifier onlyPendingOwner() {
    require(_pendingOwner == _msgSender(), 'Ownable: caller is not the pending owner');
    _;
  }

  /**
   * @dev Starts the ownership transfer process to a new account (`newOwner`).
   * Can only be called by the current owner.
   */
  function transferOwnership(address newOwner) public override onlyOwner {
    require(newOwner != address(0), 'Ownable: new owner is the zero address');
    _pendingOwner = newOwner;
    emit OwnershipTransferStarted(owner(), newOwner);
  }

  /**
   * @dev Completes the ownership transfer process to the pending owner.
   * Can only be called by the pending owner.
   */
  function acceptOwnership() public onlyPendingOwner {
    _transferOwnership(_pendingOwner);
    _pendingOwner = address(0);
  }

  /**
   * @dev Overridden function to prevent renouncing ownership.
   */
  function renounceOwnership() public view override onlyOwner {
    revert('Ownable: renounceOwnership function is disabled');
  }
}
