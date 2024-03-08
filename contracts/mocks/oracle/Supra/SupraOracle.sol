// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './ISupraSValueFeed.sol';
import {Ownable} from '../../../dependencies/openzeppelin/contracts/UpdatedOwnable.sol';
import './SelfFunding.sol';

contract SupraOracle is Ownable, SelfFunding {
  ISupraSValueFeed internal sValueFeed;

  constructor(ISupraSValueFeed _sValueFeed) {
    sValueFeed = _sValueFeed;
  }

  function updateSupraSvalueFeed(ISupraSValueFeed _newSValueFeed) external onlyOwner {
    sValueFeed = _newSValueFeed;
  }

  function getSupraSvalueFeed() external view returns (ISupraSValueFeed) {
    return sValueFeed;
  }

  // Check this page for the indices of the pairs: https://supra.com/docs/data-feeds/data-feeds-index
  function getAssetPrice(address _asset) public view returns (uint256 price) {
    uint16 priceIndex;

    if (_asset == address(0x00000000000000000000000000000000000014F5)) {
      priceIndex = 424;
    } else if (_asset == address(0x0000000000000000000000000000000000220cED)) {
      priceIndex = 427;
    } else if (_asset == address(0x0000000000000000000000000000000000120f46)) {
      priceIndex = 425;
    } else {
      revert('SupraOracle: asset not supported');
    }
    ISupraSValueFeed.priceFeed memory priceFeed = sValueFeed.getSvalue(priceIndex);
    price = priceFeed.price;
  }

  function decimals() public pure returns (uint8) {
    return 18;
  }

  function getAssetPriceInUSD(address _asset) external returns (uint256) {
    uint256 price = getAssetPrice(_asset);

    uint256 priceInTinyBars = (price * 100_000_000) / (10 ** decimals());
    uint256 priceInTinycents = tinybarsToTinycents(priceInTinyBars);
    uint256 priceInUSD = priceInTinycents / 100;

    return priceInUSD;
  }

  function convertTinybarsToTinycents(uint256 tinybars) external returns (uint256 tinycents) {
    tinycents = tinybarsToTinycents(tinybars);
  }
}
