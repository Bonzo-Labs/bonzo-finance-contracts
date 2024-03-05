pragma solidity 0.8.19;

import './ISupraSValueFeed.sol';
import {Ownable} from '../../../dependencies/openzeppelin/contracts/UpdatedOwnable.sol';

contract SupraOracle is Ownable {
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
  function getAssetPrice(address _asset) external view returns (ISupraSValueFeed.priceFeed memory) {
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
    return sValueFeed.getSvalue(priceIndex);
  }

  // function getDerivedValueOfPair(uint256 pair_id_1, uint256 pair_id_2, uint256 operation)
  //     external
  //     view
  //     returns (ISupraSValueFeed.derivedData memory)
  // {
  //     return sValueFeed.getDerivedSvalue(pair_id_1, pair_id_2, operation);
  // }
}
