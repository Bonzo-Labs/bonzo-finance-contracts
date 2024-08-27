// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

import './ISupraSValueFeed.sol';
import {Ownable2Step} from '../../../dependencies/openzeppelin/contracts/Ownable2Step.sol';

error InvalidAssetOrIndex();
error UnsupportedAsset();
error DivisionByZero();
error AssetAlreadyExists();

/// @title SupraOracle Contract
/// @notice This contract interacts with the SupraSValueFeed to fetch and manage asset prices.
/// @dev This contract is designed to work with the SupraSValueFeed interface.
contract SupraOracle is Ownable2Step {
  ISupraSValueFeed private sValueFeed;

  mapping(address => uint16) private assetToPriceIndex;
  mapping(address => uint16) private assetToDecimals;
  mapping(string => address) private assetToAddress;

  // address private constant USDC = 0x000000000000000000000000000000000006f89a;
  // address private constant WHBAR = 0x0000000000000000000000000000000000163B5a;
  address private constant USDC = 0x0000000000000000000000000000000000001549;
  address private constant WHBAR = 0x0000000000000000000000000000000000003aD2;

  /// @notice Constructor to initialize the contract with the SupraSValueFeed address.
  /// @param _sValueFeed The address of the SupraSValueFeed contract.
  constructor(ISupraSValueFeed _sValueFeed) {
    sValueFeed = _sValueFeed;

    // assetToAddress['KARATE'] = 0x000000000000000000000000000000000022D6de;
    // assetToAddress['HBARX'] = 0x00000000000000000000000000000000000cbA44;
    // assetToAddress['SAUCE'] = 0x00000000000000000000000000000000000b2aD5;
    // assetToAddress['XSAUCE'] = 0x00000000000000000000000000000000001647e8;
    // assetToAddress['DOVU'] = 0x000000000000000000000000000000000038b3db;
    // assetToAddress['HST'] = 0x00000000000000000000000000000000000Ec585;
    // // assetToAddress['PACK'] = 0x000000000000000000000000000000000015a59b;
    // // assetToAddress['STEAM'] = 0x000000000000000000000000000000000015a59b;
    // assetToAddress['USDC'] = USDC;
    // assetToAddress['WHBAR'] = WHBAR;

    assetToAddress['KARATE'] = 0x00000000000000000000000000000000003991eD;
    assetToAddress['HBARX'] = 0x0000000000000000000000000000000000220cED;
    assetToAddress['SAUCE'] = 0x0000000000000000000000000000000000120f46;
    assetToAddress['XSAUCE'] = 0x000000000000000000000000000000000015a59b;
    assetToAddress['DOVU'] = 0x823d50cC1162071fD6F715830553b3aF7e8E9909;
    assetToAddress['HST'] = 0x0404859E5c8Ad52e92a5F159D018D2b5377fAA8C;
    // assetToAddress['PACK'] = 0x000000000000000000000000000000000015a59b;
    // assetToAddress['STEAM'] = 0x000000000000000000000000000000000015a59b;
    assetToAddress['USDC'] = USDC;
    assetToAddress['WHBAR'] = WHBAR;

    assetToPriceIndex[assetToAddress['KARATE']] = 472;
    assetToPriceIndex[assetToAddress['HBARX']] = 427;
    assetToPriceIndex[assetToAddress['SAUCE']] = 425;
    assetToPriceIndex[assetToAddress['XSAUCE']] = 426;
    assetToPriceIndex[assetToAddress['DOVU']] = 429;
    // assetToPriceIndex[assetToAddress['PACK']] = 426;
    // assetToPriceIndex[assetToAddress['STEAM']] = 426;
    assetToPriceIndex[assetToAddress['HST']] = 428;
    assetToPriceIndex[assetToAddress['USDC']] = 432;
    // This doesn't matter because for WHBAR we are always returning 1 HBAR as the price
    assetToPriceIndex[assetToAddress['WHBAR']] = 428;

    assetToDecimals[assetToAddress['KARATE']] = 8;
    assetToDecimals[assetToAddress['HBARX']] = 8;
    assetToDecimals[assetToAddress['SAUCE']] = 6;
    assetToDecimals[assetToAddress['XSAUCE']] = 6;
    assetToDecimals[assetToAddress['DOVU']] = 8;
    // assetToDecimals[assetToAddress['PACK']] = 6;
    // assetToDecimals[assetToAddress['STEAM']] = 6;
    assetToDecimals[assetToAddress['HST']] = 8;
    assetToDecimals[assetToAddress['USDC']] = 6;
    assetToDecimals[assetToAddress['WHBAR']] = 8;
  }

  /// @notice Updates the SupraSValueFeed contract address.
  /// @param _newSValueFeed The new address of the SupraSValueFeed contract.
  function updateSupraSvalueFeed(ISupraSValueFeed _newSValueFeed) external onlyOwner {
    sValueFeed = _newSValueFeed;
  }

  /// @notice Gets the current SupraSValueFeed contract address.
  /// @return The address of the current SupraSValueFeed contract.
  function getSupraSvalueFeed() external view returns (ISupraSValueFeed) {
    return sValueFeed;
  }

  /// @notice Adds a new asset to the oracle.
  /// @param _name The name of the asset.
  /// @param _asset The address of the asset.
  /// @param _index The price index of the asset.
  /// @param _decimals The number of decimals for the asset's price.
  /// @dev Reverts if the asset or index is invalid or if the asset already exists.
  function addNewAsset(
    string memory _name,
    address _asset,
    uint16 _index,
    uint16 _decimals
  ) external onlyOwner {
    if (_asset == address(0) || _index == 0) revert InvalidAssetOrIndex();
    if (assetToAddress[_name] != address(0) || assetToPriceIndex[_asset] != 0) {
      revert AssetAlreadyExists();
    }

    assetToAddress[_name] = _asset;
    assetToPriceIndex[_asset] = _index;
    assetToDecimals[_asset] = _decimals;
  }

  /// @notice Updates an existing asset's details.
  /// @param _name The name of the asset.
  /// @param _asset The new address of the asset.
  /// @param _newIndex The new price index of the asset.
  /// @param _newDecimals The new number of decimals for the asset's price.
  /// @dev Reverts if the asset or index is invalid or if the asset does not exist.
  function updateAsset(
    string memory _name,
    address _asset,
    uint16 _newIndex,
    uint16 _newDecimals
  ) external onlyOwner {
    if (_asset == address(0) || _newIndex == 0) revert InvalidAssetOrIndex();

    address currentAddress = assetToAddress[_name];
    if (currentAddress == address(0)) revert UnsupportedAsset();

    delete assetToPriceIndex[currentAddress];
    delete assetToDecimals[currentAddress];

    assetToAddress[_name] = _asset;
    assetToPriceIndex[_asset] = _newIndex;
    assetToDecimals[_asset] = _newDecimals;
  }

  /// @notice Helper function for tests to get the address of an asset.
  /// @param _asset The address of the asset.
  /// @return The price feed of an asset
  /// @dev Reverts if the asset is unsupported.
  function getPriceFeed(address _asset) external view returns (ISupraSValueFeed.priceFeed memory) {
    uint16 priceIndex = assetToPriceIndex[_asset];
    if (priceIndex == 0) revert UnsupportedAsset();
    return sValueFeed.getSvalue(priceIndex);
  }

  /// @notice Helper function to test the price of an asset in HBAR.
  /// @param asset The address of the asset.
  /// @param amount The amount of the asset.
  /// @return amountInEth The equivalent price in HBAR.
  /// @dev Reverts if the asset is unsupported or if there's a division by zero.
  function getAmountInEth(
    uint256 amount,
    address asset
  ) external view returns (uint256 amountInEth) {
    uint256 price = getAssetPrice(asset);
    amountInEth = (price * amount) / (10 ** assetToDecimals[asset]);
  }

  /// @notice Gets the price of an asset in HBAR.
  /// @param _asset The address of the asset.
  /// @return The price of the asset in HBAR.
  /// @dev Reverts if the asset is unsupported or if there's a division by zero.
  function getAssetPrice(address _asset) public view returns (uint256) {
    uint16 priceIndex = assetToPriceIndex[_asset];
    if (priceIndex == 0) revert UnsupportedAsset();

    ISupraSValueFeed.priceFeed memory priceFeed = sValueFeed.getSvalue(priceIndex);

    // Early return for non-USDC assets
    if (_asset != USDC) {
      if (_asset == WHBAR) {
        return (10 ** decimals());
      } else {
        return priceFeed.price;
      }
    }

    if (priceFeed.price == 0) revert DivisionByZero();

    uint256 scaleFactor = 10 ** decimals();
    uint256 reciprocalPrice = (scaleFactor * scaleFactor) / priceFeed.price;

    return reciprocalPrice;
  }

  /// @notice Gets the price of an asset in USD.
  /// @param _asset The address of the asset.
  /// @return The price of the asset in USD.
  /// @dev Reverts if there's a division by zero.
  function getAssetPriceInUSD(address _asset) public view returns (uint256) {
    uint256 priceInHbar = getAssetPrice(_asset);
    ISupraSValueFeed.priceFeed memory priceFeedUSD = sValueFeed.getSvalue(assetToPriceIndex[USDC]);

    if (priceFeedUSD.price == 0) revert DivisionByZero();

    uint256 priceInUSD = (priceInHbar * priceFeedUSD.price) / (10 ** decimals());

    return priceInUSD;
  }

  /// @notice Converts an amount of HBAR to USD.
  /// @param _amount The amount of HBAR.
  /// @return priceInUSD The equivalent price in USD.
  /// @dev Reverts if there's a division by zero.
  function getHbarUSD(uint256 _amount) public view returns (uint256 priceInUSD) {
    ISupraSValueFeed.priceFeed memory priceFeedUSD = sValueFeed.getSvalue(assetToPriceIndex[USDC]);
    if (priceFeedUSD.price == 0) revert DivisionByZero();

    priceInUSD = (_amount * priceFeedUSD.price) / (10 ** decimals());
  }

  /// @notice Gets the number of decimals used for prices.
  /// @return The number of decimals (18).
  function decimals() public pure returns (uint8) {
    return 18;
  }
}
