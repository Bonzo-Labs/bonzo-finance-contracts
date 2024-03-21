// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './ISupraSValueFeed.sol';
import {Ownable} from '../../../dependencies/openzeppelin/contracts/UpdatedOwnable.sol';
import './SelfFunding.sol';

contract SupraOracle is Ownable, SelfFunding {
  ISupraSValueFeed internal sValueFeed;

  mapping(address => uint16) private assetToPriceIndex;

  constructor(ISupraSValueFeed _sValueFeed) {
    sValueFeed = _sValueFeed;

    // Initialize the mapping with asset addresses and their corresponding indices
    assetToPriceIndex[0x00000000000000000000000000000000000014F5] = 424; // CLXY
    assetToPriceIndex[0x0000000000000000000000000000000000220cED] = 427; // HBARX
    assetToPriceIndex[0x0000000000000000000000000000000000120f46] = 425; // SAUCE
    assetToPriceIndex[0x0000000000000000000000000000000000001599] = 75; // DAI
    assetToPriceIndex[0x0000000000000000000000000000000000001549] = 75; // USDC
  }

  function updateSupraSvalueFeed(ISupraSValueFeed _newSValueFeed) external onlyOwner {
    sValueFeed = _newSValueFeed;
  }

  function getSupraSvalueFeed() external view returns (ISupraSValueFeed) {
    return sValueFeed;
  }

  function updatePriceIndex(address _asset, uint16 _newIndex) external onlyOwner {
    require(_asset != address(0), 'InvalidAsset');
    require(_newIndex != 0, 'InvalidIndex');
    assetToPriceIndex[_asset] = _newIndex;
  }

  function getAssetPrice(address _asset) public view returns (uint256 price) {
    uint16 priceIndex = assetToPriceIndex[_asset];
    require(priceIndex != 0, 'UnsupportedAsset');

    ISupraSValueFeed.priceFeed memory priceFeed = sValueFeed.getSvalue(priceIndex);
    return priceFeed.price;
  }

  function decimals() public pure returns (uint8) {
    return 18;
  }

  function getAssetPriceInUSD(address _asset) external returns (uint256) {
    uint256 price = getAssetPrice(_asset);

    uint256 priceInTinyBars = (price * 100_000_000) / (10 ** decimals());
    return tinybarsToTinycents(priceInTinyBars) / 100;
  }
}
