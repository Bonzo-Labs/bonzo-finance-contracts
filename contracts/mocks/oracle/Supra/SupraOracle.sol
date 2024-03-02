pragma solidity 0.8.19;

import './ISupraSValueFeed.sol';
// import "@openzeppelin/contracts/access/Ownable.sol";

contract SupraOracle {
  ISupraSValueFeed internal sValueFeed;

  constructor(ISupraSValueFeed _sValueFeed) {
    sValueFeed = _sValueFeed;
  }

  function updateSupraSvalueFeed(ISupraSValueFeed _newSValueFeed) external {
    sValueFeed = _newSValueFeed;
  }

  function getSupraSvalueFeed() external view returns (ISupraSValueFeed) {
    return sValueFeed;
  }

  function getPrice(uint256 _priceIndex) external view returns (ISupraSValueFeed.priceFeed memory) {
    return sValueFeed.getSvalue(_priceIndex);
  }

  function getPriceForMultiplePair(
    uint256[] memory _pairIndexes
  ) external view returns (ISupraSValueFeed.priceFeed[] memory) {
    return sValueFeed.getSvalues(_pairIndexes);
  }

  function getDerivedValueOfPair(
    uint256 pair_id_1,
    uint256 pair_id_2,
    uint256 operation
  ) external view returns (ISupraSValueFeed.derivedData memory) {
    return sValueFeed.getDerivedSvalue(pair_id_1, pair_id_2, operation);
  }
}
