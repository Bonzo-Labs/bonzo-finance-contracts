// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

import './ISupraSValueFeed.sol';
import {Ownable} from '../../../dependencies/openzeppelin/contracts/UpdatedOwnable.sol';

error InvalidAssetOrIndex();
error UnsupportedAsset();
error DivisionByZero();

contract SupraOracle is Ownable {
  ISupraSValueFeed private sValueFeed;

  mapping(address => uint16) private assetToPriceIndex;

  // Known asset addresses as constants for gas efficiency
  address private constant CLXY = 0x00000000000000000000000000000000000014F5;
  address private constant HBARX = 0x0000000000000000000000000000000000220cED;
  address private constant SAUCE = 0x0000000000000000000000000000000000120f46;
  address private constant DAI = 0x0000000000000000000000000000000000001599;
  address private constant USDC = 0x0000000000000000000000000000000000001549;

  constructor(ISupraSValueFeed _sValueFeed) {
    sValueFeed = _sValueFeed;
    assetToPriceIndex[CLXY] = 424;
    assetToPriceIndex[HBARX] = 427;
    assetToPriceIndex[SAUCE] = 425;
    assetToPriceIndex[DAI] = 432;
    assetToPriceIndex[USDC] = 432;
  }

  function updateSupraSvalueFeed(ISupraSValueFeed _newSValueFeed) external onlyOwner {
    sValueFeed = _newSValueFeed;
  }

  function getSupraSvalueFeed() external view returns (ISupraSValueFeed) {
    return sValueFeed;
  }

  function updatePriceIndex(address _asset, uint16 _newIndex) external onlyOwner {
    if (_asset == address(0) || _newIndex == 0) revert InvalidAssetOrIndex();
    assetToPriceIndex[_asset] = _newIndex;
  }

  // Gets the price of an asset in HBAR (not USD)
  function getAssetPrice(address _asset) public view returns (uint256) {
    uint16 priceIndex = assetToPriceIndex[_asset];
    if (priceIndex == 0) revert UnsupportedAsset();

    ISupraSValueFeed.priceFeed memory priceFeed = sValueFeed.getSvalue(priceIndex);

    // Early return for non-DAI/USDC assets
    if (_asset != DAI && _asset != USDC) {
      return priceFeed.price;
    }

    if (priceFeed.price == 0) revert DivisionByZero();

    // For DAI/USDC, calculate the reciprocal of the HBAR price in USDC
    // Use a large factor to scale up the numerator before division to maintain precision
    uint256 scaleFactor = 10 ** decimals(); // Assuming priceFeed.price and your desired result are both scaled to 18 decimal places
    uint256 reciprocalPrice = (scaleFactor * scaleFactor) / priceFeed.price; // Calculate the reciprocal with scaled precision

    return reciprocalPrice;
  }

  // Gets the price of an asset in USD
  function getAssetPriceInUSD(address _asset) public view returns (uint256) {
    uint256 priceInHbar = getAssetPrice(_asset); // This will give us the asset's price in HBAR
    ISupraSValueFeed.priceFeed memory priceFeedUSD = sValueFeed.getSvalue(432); // Index for HBAR to USD

    if (priceFeedUSD.price == 0) revert DivisionByZero();

    // Since getAssetPrice already adjusts DAI and USDC prices to HBAR,
    // we can use priceInHbar directly for conversion to USD.
    uint256 priceInUSD = (priceInHbar * priceFeedUSD.price) / (10 ** decimals()); // Adjust for decimal places

    return priceInUSD;
  }

  function decimals() public pure returns (uint8) {
    return 18;
  }
}
