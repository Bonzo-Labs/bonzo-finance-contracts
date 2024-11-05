// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.6.12;
pragma experimental ABIEncoderV2;

import '../WHBAR/SafeHederaTokenService.sol';
import '../WHBAR/Bits.sol';
import '../WHBAR/SafeCast.sol';
import {SafeMath} from '../../dependencies/openzeppelin/contracts/SafeMath.sol';

/**
 * @title WSTEAM
 * @dev Wrapped STEAM token contract for the Hedera network.
 *      This contract allows wrapping of STEAM tokens (2 decimals) into WSTEAM tokens (8 decimals)
 *      and vice versa, maintaining a 1:1 ratio but with different decimal precision.
 * @author Bonzo Finance
 */
contract WSTEAM is SafeHederaTokenService {
  using Bits for uint;
  using SafeCast for uint256;
  using SafeMath for uint256;

  int64 constant HAPI_SUCCESS = 22; // HTS Response code indicating success.

  /// @notice Address of the underlying STEAM token
  address public steamToken;
  /// @notice Address of the WSTEAM token
  address public token;

  /// @notice Conversion factor between STEAM (2 decimals) and WSTEAM (8 decimals)
  uint256 private constant DECIMALS_CONVERSION = 10 ** 6; // 10^(8-2)

  /// @notice Emitted when tokens are deposited
  event Deposit(
    address indexed src,
    address indexed dst,
    uint256 steamAmount,
    uint256 wsteamAmount
  );

  /// @notice Emitted when tokens are withdrawn
  event Withdrawal(
    address indexed src,
    address indexed dst,
    uint256 steamAmount,
    uint256 wsteamAmount
  );

  /**
   * @dev Constructor initializes the contract by associating with STEAM and creating the WSTEAM token.
   * @param _steamToken The address of the underlying STEAM token.
   */
  constructor(address _steamToken) public payable {
    require(_steamToken != address(0), 'Invalid STEAM token address');
    steamToken = _steamToken;

    int32 responseCode = HederaTokenService.associateToken(address(this), steamToken);
    require(responseCode == HederaResponseCodes.SUCCESS, 'Token association failed');

    uint256 supplyKeyType;
    IHederaTokenService.KeyValue memory supplyKeyValue;
    supplyKeyType = supplyKeyType.setBit(4); // SUPPLY key
    supplyKeyValue.contractId = address(this);
    IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
    keys[0] = IHederaTokenService.TokenKey(supplyKeyType, supplyKeyValue);

    IHederaTokenService.Expiry memory expiry;
    expiry.autoRenewAccount = address(this);
    expiry.autoRenewPeriod = 7776000; // 90 days

    IHederaTokenService.HederaToken memory myToken;
    myToken.name = 'Wrapped Steam';
    myToken.symbol = 'WSTEAM';
    myToken.treasury = address(this);
    myToken.expiry = expiry;
    myToken.tokenKeys = keys;

    (int256 responseCode2, address createdToken) = HederaTokenService.createFungibleToken(
      myToken,
      0,
      8
    );
    require(responseCode2 == HAPI_SUCCESS, 'Token creation failed');
    token = createdToken;
  }

  /**
   * @notice Converts STEAM amount (2 decimals) to WSTEAM amount (8 decimals)
   * @param steamAmount Amount in STEAM to convert
   * @return Amount in WSTEAM
   */
  function toWSTEAM(uint256 steamAmount) public pure returns (uint256) {
    return steamAmount.mul(DECIMALS_CONVERSION);
  }

  /**
   * @notice Converts WSTEAM amount (8 decimals) to STEAM amount (2 decimals)
   * @param wsteamAmount Amount in WSTEAM to convert
   * @return Amount in STEAM
   */
  function toSTEAM(uint256 wsteamAmount) public pure returns (uint256) {
    require(wsteamAmount % DECIMALS_CONVERSION == 0, 'Invalid WSTEAM amount');
    return wsteamAmount.div(DECIMALS_CONVERSION);
  }

  /**
   * @notice Standard deposit function - wraps STEAM to WSTEAM for msg.sender
   * @param amount The amount of STEAM tokens to deposit (2 decimals)
   */
  function deposit(uint256 amount) external {
    _deposit(msg.sender, msg.sender, amount);
  }

  /**
   * @notice Deposits STEAM tokens and mints WSTEAM tokens to a specified address
   * @dev Only callable by the STEAM token owner themselves
   * @param dst The destination address to receive WSTEAM
   * @param amount The amount of STEAM tokens to deposit (2 decimals)
   */
  function depositTo(address dst, uint256 amount) external {
    _deposit(msg.sender, dst, amount);
  }

  /**
   * @notice Internal deposit function to handle the actual deposit logic
   * @param src The source address providing the STEAM tokens
   * @param dst The destination address to receive WSTEAM tokens
   * @param steamAmount The amount of STEAM tokens to deposit (2 decimals)
   */
  function _deposit(address src, address dst, uint256 steamAmount) internal {
    require(steamAmount > 0, 'Amount must be greater than zero');
    require(dst != address(0), 'Invalid destination address');
    require(src == msg.sender, 'Only token owner can deposit');

    safeTransferToken(steamToken, src, address(this), steamAmount); // Transfer STEAM tokens from the source to the contract
    uint256 wsteamAmount = toWSTEAM(steamAmount); // Calculate the amount of WSTEAM to mint (adjusting for decimals difference)
    safeMintToken(token, dst, wsteamAmount, new bytes[](0)); // Mint WSTEAM tokens (tokens get minted to the treasury, which is the contract itself)
    safeTransferToken(token, address(this), dst, wsteamAmount); // Now, transfer the tokens from the treasury to the user

    emit Deposit(src, dst, steamAmount, wsteamAmount);
  }

  /**
   * @notice Standard withdraw function - unwraps WSTEAM to STEAM for msg.sender
   * @param wsteamAmount The amount of WSTEAM tokens to withdraw (8 decimals)
   */
  function withdraw(uint256 wsteamAmount) external {
    _withdraw(msg.sender, msg.sender, wsteamAmount);
  }

  /**
   * @notice Withdraws WSTEAM tokens and sends STEAM tokens to a specified address
   * @dev Only callable by the WSTEAM token owner themselves
   * @param dst The destination address to receive STEAM
   * @param wsteamAmount The amount of WSTEAM tokens to withdraw (8 decimals)
   */
  function withdrawTo(address dst, uint256 wsteamAmount) external {
    _withdraw(msg.sender, dst, wsteamAmount);
  }

  /**
   * @notice Internal withdraw function to handle the actual withdraw logic
   * @param src The source address providing the WSTEAM tokens
   * @param dst The destination address to receive STEAM tokens
   * @param wsteamAmount The amount of WSTEAM tokens to withdraw (8 decimals)
   */
  function _withdraw(address src, address dst, uint256 wsteamAmount) internal {
    require(wsteamAmount > 0, 'Amount must be greater than zero');
    require(dst != address(0), 'Invalid destination address');
    require(src == msg.sender, 'Only token owner can withdraw');

    uint256 steamAmount = toSTEAM(wsteamAmount); // Calculate the amount of STEAM to send back (adjusting for decimals)
    require(steamAmount > 0, 'WSTEAM amount too small');

    safeTransferToken(token, src, address(this), wsteamAmount); // Transfer WSTEAM tokens from the source to the contract and burn them
    safeBurnToken(token, src, wsteamAmount, new int64[](0));
    safeTransferToken(steamToken, address(this), dst, steamAmount); // Transfer STEAM tokens to the destination

    emit Withdrawal(src, dst, steamAmount, wsteamAmount);
  }
}
