// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.6.12;

library Bits {
  uint256 internal constant ONE = uint256(1);

  // Sets the bit at the given 'index' in 'self' to '1'.
  // Returns the modified value.
  function setBit(uint256 self, uint8 index) internal pure returns (uint256) {
    return self | (ONE << index);
  }
}
