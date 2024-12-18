// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.6.12;
pragma experimental ABIEncoderV2;

import './SafeHederaTokenService.sol';
import './Bits.sol';

/// @dev - this contract and it's dependencies are the same as those on Saucerswap - https://github.com/saucerswaplabs/saucerswaplabs-core/blob/master/contracts/WHBAR.sol
///   We are using the Saucerswap codebase to interact with their existing WHBAR token.
contract WHBARContract is SafeHederaTokenService {
  using Bits for uint256;

  address public token;

  event Deposit(address indexed src, address indexed dst, uint256 wad);
  event Withdrawal(address indexed src, address indexed dst, uint256 wad);

  constructor() public payable {
    uint256 supplyKeyType;
    IHederaTokenService.KeyValue memory supplyKeyValue;

    supplyKeyType = supplyKeyType.setBit(4);
    supplyKeyValue.contractId = address(this);

    IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
    keys[0] = IHederaTokenService.TokenKey(supplyKeyType, supplyKeyValue);

    IHederaTokenService.Expiry memory expiry;
    expiry.autoRenewAccount = address(this);
    expiry.autoRenewPeriod = 8000000;

    IHederaTokenService.HederaToken memory myToken;
    myToken.name = 'Wrapped Hbar';
    myToken.symbol = 'WHBAR';
    myToken.treasury = address(this);
    myToken.expiry = expiry;
    myToken.tokenKeys = keys;

    (int256 responseCode, address _token) = HederaTokenService.createFungibleToken(myToken, 0, 8);

    if (responseCode != HederaResponseCodes.SUCCESS) {
      revert();
    }

    token = _token;
  }

  receive() external payable {
    deposit();
  }

  function deposit() public payable {
    require(msg.value > 0, 'Sent zero hbar to this contract');

    safeMintToken(token, msg.sender, msg.value, new bytes[](0));
    safeTransferToken(token, address(this), msg.sender, msg.value);
    emit Deposit(msg.sender, msg.sender, msg.value);
  }

  function deposit(address src, address dst) public payable {
    require(msg.value > 0, 'Sent zero hbar to this contract');

    safeMintToken(token, src, msg.value, new bytes[](0));
    safeTransferToken(token, address(this), dst, msg.value);
    emit Deposit(src, dst, msg.value);
  }

  function withdraw(address src, address dst, uint256 wad) public {
    require(wad > 0, 'Attempted to withdraw zero hbar');

    safeTransferToken(token, src, address(this), wad);
    safeBurnToken(token, src, wad, new int64[](0));

    (bool sent, ) = payable(dst).call{value: wad}('');
    require(sent, 'hbar could not be sent');
    emit Withdrawal(src, dst, wad);
  }

  function withdraw(uint256 wad) public {
    require(wad > 0, 'Attempted to withdraw zero hbar');

    safeTransferToken(token, msg.sender, address(this), wad);
    safeBurnToken(token, msg.sender, wad, new int64[](0));

    (bool sent, ) = payable(msg.sender).call{value: wad}('');
    require(sent, 'hbar could not be sent');
    emit Withdrawal(msg.sender, msg.sender, wad);
  }
}
