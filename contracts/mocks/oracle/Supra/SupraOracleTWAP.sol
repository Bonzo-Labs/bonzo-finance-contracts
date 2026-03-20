// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

import './ISupraSValueFeed.sol';
import {Ownable2Step} from '../../../dependencies/openzeppelin/contracts/Ownable2Step.sol';
import {AggregatorV3Interface} from '@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol';

error InvalidAssetOrIndex();
error UnsupportedAsset();
error DivisionByZero();
error AssetAlreadyExists();
error InvalidPrice();
error StalePrice();
error InvalidStaleness();
error InvalidPriceDecimals();
error InvalidDeviationThreshold();
error InvalidTWAPWindow();
error InvalidMinObservations();
error InvalidRecoveryConfig();
error NotRecorder();
error RecorderAlreadyExists();
error RecorderNotFound();

/// @title SupraOracle Contract with TWAP Circuit Breaker
/// @notice Wraps Supra price feeds with a TWAP-based circuit breaker that prevents
///         extreme oracle deviations from triggering incorrect liquidations.
/// @dev Architecture:
///
///   TWAP observations are recorded by an authorized RECORDER that periodically
///   calls `recordObservations()`. This is necessary because `getAssetPrice()` must
///   remain `view` to satisfy the Aave V2 `IPriceOracleGetter` interface (STATICCALL).
///
///   On each `getAssetPrice()` call, the contract:
///     1. Fetches the current spot price from Supra
///     2. Computes a TWAP from stored observations
///     3. If spot deviates beyond the threshold from TWAP -> returns TWAP
///     4. On any feed failure -> returns last known valid price (never reverts)
///
contract SupraOracleTWAP is Ownable2Step {
  ISupraSValueFeed private sValueFeed;
  AggregatorV3Interface internal HBAR_USD_dataFeed;
  AggregatorV3Interface internal USDC_USD_dataFeed;
  AggregatorV3Interface internal ETH_USD_dataFeed;

  mapping(address => uint16) private assetToPriceIndex;
  mapping(address => uint16) private assetToDecimals;
  mapping(string => address) private assetToAddress;
  uint256 public maxPriceStaleness = 30 minutes;

  /// @notice All Supra-fed assets eligible for TWAP observation recording
  address[] private supraAssets;

  // ============================================================
  //                    TWAP CONFIGURATION
  // ============================================================

  uint256 public constant MAX_OBSERVATIONS = 48;
  uint256 public twapWindow = 30 minutes;
  uint256 public maxDeviationBps = 5000;
  uint256 public minObservationsForEnforcement = 5;
  uint256 public recorderDeviationMultiplierBps = 20000;
  uint256 public recoveryConfirmationCount = 6;
  uint256 public recoveryStabilityBps = 300;
  uint256 public recoveryMinDuration = 30 minutes;
  uint256 public maxReanchorDeviationBps = 20000;

  // ============================================================
  //                    RECORDER ROLE
  // ============================================================

  address[] private recorders;
  mapping(address => bool) private isRecorder;

  // ============================================================
  //                    TWAP STORAGE
  // ============================================================

  struct PriceObservation {
    uint128 price;
    uint128 timestamp;
  }

  struct RecoveryState {
    uint128 candidatePrice;
    uint64 candidateCount;
    uint64 firstSeenAt;
    uint64 lastFeedTimestamp;
  }

  mapping(address => mapping(uint256 => PriceObservation)) private observations;
  mapping(address => uint256) private observationIndex;
  mapping(address => uint256) private observationCount;
  mapping(address => RecoveryState) private recoveryStates;
  mapping(address => uint256) private lastValidPrice;

  // ============================================================
  //                         EVENTS
  // ============================================================

  event TWAPWindowUpdated(uint256 oldWindow, uint256 newWindow);
  event MaxDeviationUpdated(uint256 oldDeviation, uint256 newDeviation);
  event RecorderAdded(address indexed recorder);
  event RecorderRemoved(address indexed recorder);
  event ObservationRecorded(address indexed asset, uint256 price, uint256 timestamp);
  event PriceDeviationDetected(
    address indexed asset,
    uint256 spotPrice,
    uint256 twapPrice,
    uint256 deviationBps
  );
  event RecoveryTrackingStarted(
    address indexed asset,
    uint256 candidatePrice,
    uint256 feedTimestamp
  );
  event RecoveryTrackingUpdated(
    address indexed asset,
    uint256 candidatePrice,
    uint256 candidateCount,
    uint256 feedTimestamp
  );
  event RecoveryTrackingReset(
    address indexed asset,
    uint256 oldCandidatePrice,
    uint256 newCandidatePrice,
    uint256 feedTimestamp
  );
  event TWAPReanchored(
    address indexed asset,
    uint256 anchorPrice,
    uint256 candidateCount,
    uint256 recoveryDuration
  );
  event RecorderDeviationMultiplierUpdated(uint256 oldMultiplierBps, uint256 newMultiplierBps);
  event RecoveryConfirmationCountUpdated(uint256 oldCount, uint256 newCount);
  event RecoveryStabilityUpdated(uint256 oldStabilityBps, uint256 newStabilityBps);
  event RecoveryMinDurationUpdated(uint256 oldDuration, uint256 newDuration);
  event MaxReanchorDeviationUpdated(uint256 oldDeviation, uint256 newDeviation);
  event LastValidPriceUsed(address indexed asset, uint256 price);

  address private constant USDC = 0x000000000000000000000000000000000006f89a;
  address private constant WHBAR = 0x0000000000000000000000000000000000163B5a;

  // ============================================================
  //                      MODIFIERS
  // ============================================================

  modifier onlyRecorder() {
    if (!isRecorder[msg.sender] && msg.sender != owner()) revert NotRecorder();
    _;
  }

  // ============================================================
  //                      CONSTRUCTOR
  // ============================================================

  constructor(
    ISupraSValueFeed _sValueFeed,
    AggregatorV3Interface _HBAR_USD_dataFeed,
    AggregatorV3Interface _USDC_USD_dataFeed,
    AggregatorV3Interface _ETH_USD_dataFeed
  ) {
    sValueFeed = _sValueFeed;
    HBAR_USD_dataFeed = _HBAR_USD_dataFeed;
    USDC_USD_dataFeed = _USDC_USD_dataFeed;
    ETH_USD_dataFeed = _ETH_USD_dataFeed;

    assetToAddress['KARATE'] = 0x000000000000000000000000000000000022D6de;
    assetToAddress['HBARX'] = 0x00000000000000000000000000000000000cbA44;
    assetToAddress['SAUCE'] = 0x00000000000000000000000000000000000b2aD5;
    assetToAddress['XSAUCE'] = 0x00000000000000000000000000000000001647e8;
    assetToAddress['DOVU'] = 0x000000000000000000000000000000000038b3db;
    assetToAddress['HST'] = 0x00000000000000000000000000000000000Ec585;
    assetToAddress['PACK'] = 0x0000000000000000000000000000000000492A28;
    assetToAddress['STEAM'] = 0x000000000000000000000000000000000030fb8b;
    assetToAddress['GRELF'] = 0x000000000000000000000000000000000011afa2;
    assetToAddress['KBL'] = 0x00000000000000000000000000000000005B665A;
    assetToAddress['BONZO'] = 0x00000000000000000000000000000000007e545e;
    assetToAddress['WETH'] = 0xCa367694CDaC8f152e33683BB36CC9d6A73F1ef2;

    assetToAddress['USDC'] = USDC;
    assetToAddress['WHBAR'] = WHBAR;

    assetToPriceIndex[assetToAddress['KARATE']] = 472;
    assetToPriceIndex[assetToAddress['HBARX']] = 427;
    assetToPriceIndex[assetToAddress['SAUCE']] = 425;
    assetToPriceIndex[assetToAddress['XSAUCE']] = 426;
    assetToPriceIndex[assetToAddress['USDC']] = 505;
    assetToPriceIndex[assetToAddress['WHBAR']] = 471;
    assetToPriceIndex[assetToAddress['STEAM']] = 479;
    assetToPriceIndex[assetToAddress['DOVU']] = 429;
    assetToPriceIndex[assetToAddress['PACK']] = 478;
    assetToPriceIndex[assetToAddress['HST']] = 428;
    assetToPriceIndex[assetToAddress['GRELF']] = 527;
    assetToPriceIndex[assetToAddress['KBL']] = 526;
    assetToPriceIndex[assetToAddress['BONZO']] = 532;
    assetToPriceIndex[assetToAddress['WETH']] = 1001;

    assetToDecimals[assetToAddress['KARATE']] = 8;
    assetToDecimals[assetToAddress['HBARX']] = 8;
    assetToDecimals[assetToAddress['SAUCE']] = 6;
    assetToDecimals[assetToAddress['XSAUCE']] = 6;
    assetToDecimals[assetToAddress['USDC']] = 6;
    assetToDecimals[assetToAddress['WHBAR']] = 8;
    assetToDecimals[assetToAddress['DOVU']] = 8;
    assetToDecimals[assetToAddress['PACK']] = 6;
    assetToDecimals[assetToAddress['HST']] = 8;
    assetToDecimals[assetToAddress['STEAM']] = 2;
    assetToDecimals[assetToAddress['GRELF']] = 8;
    assetToDecimals[assetToAddress['KBL']] = 6;
    assetToDecimals[assetToAddress['BONZO']] = 8;
    assetToDecimals[assetToAddress['WETH']] = 18;

    // Supra-fed assets (excludes WHBAR, USDC, WETH which use Chainlink)
    supraAssets.push(assetToAddress['KARATE']);
    supraAssets.push(assetToAddress['HBARX']);
    supraAssets.push(assetToAddress['SAUCE']);
    supraAssets.push(assetToAddress['XSAUCE']);
    supraAssets.push(assetToAddress['DOVU']);
    supraAssets.push(assetToAddress['HST']);
    supraAssets.push(assetToAddress['PACK']);
    supraAssets.push(assetToAddress['STEAM']);
    supraAssets.push(assetToAddress['GRELF']);
    supraAssets.push(assetToAddress['KBL']);
    supraAssets.push(assetToAddress['BONZO']);
  }

  // ============================================================
  //                    ADMIN FUNCTIONS
  // ============================================================

  function updateSupraSvalueFeed(ISupraSValueFeed _newSValueFeed) external onlyOwner {
    sValueFeed = _newSValueFeed;
  }

  function updateMaxPriceStaleness(uint256 _newMaxPriceStaleness) external onlyOwner {
    if (_newMaxPriceStaleness == 0) revert InvalidStaleness();
    maxPriceStaleness = _newMaxPriceStaleness;
  }

  function updateTWAPWindow(uint256 _newWindow) external onlyOwner {
    if (_newWindow < 60) revert InvalidTWAPWindow();
    emit TWAPWindowUpdated(twapWindow, _newWindow);
    twapWindow = _newWindow;
  }

  function updateMaxDeviation(uint256 _newDeviationBps) external onlyOwner {
    if (_newDeviationBps > 10000) revert InvalidDeviationThreshold();
    emit MaxDeviationUpdated(maxDeviationBps, _newDeviationBps);
    maxDeviationBps = _newDeviationBps;
  }

  function updateMinObservations(uint256 _minObs) external onlyOwner {
    if (_minObs < 2 || _minObs > MAX_OBSERVATIONS) revert InvalidMinObservations();
    minObservationsForEnforcement = _minObs;
  }

  function updateRecorderDeviationMultiplier(uint256 _newMultiplierBps) external onlyOwner {
    if (_newMultiplierBps < 10000 || _newMultiplierBps > 100000) revert InvalidRecoveryConfig();
    emit RecorderDeviationMultiplierUpdated(recorderDeviationMultiplierBps, _newMultiplierBps);
    recorderDeviationMultiplierBps = _newMultiplierBps;
  }

  function updateRecoveryConfirmationCount(uint256 _newCount) external onlyOwner {
    if (_newCount < 2 || _newCount > MAX_OBSERVATIONS) revert InvalidRecoveryConfig();
    emit RecoveryConfirmationCountUpdated(recoveryConfirmationCount, _newCount);
    recoveryConfirmationCount = _newCount;
  }

  function updateRecoveryStability(uint256 _newStabilityBps) external onlyOwner {
    if (_newStabilityBps > 10000) revert InvalidRecoveryConfig();
    emit RecoveryStabilityUpdated(recoveryStabilityBps, _newStabilityBps);
    recoveryStabilityBps = _newStabilityBps;
  }

  function updateRecoveryMinDuration(uint256 _newDuration) external onlyOwner {
    if (_newDuration == 0) revert InvalidRecoveryConfig();
    emit RecoveryMinDurationUpdated(recoveryMinDuration, _newDuration);
    recoveryMinDuration = _newDuration;
  }

  function updateMaxReanchorDeviation(uint256 _newDeviationBps) external onlyOwner {
    if (_newDeviationBps < 5000 || _newDeviationBps > 50000) revert InvalidRecoveryConfig();
    emit MaxReanchorDeviationUpdated(maxReanchorDeviationBps, _newDeviationBps);
    maxReanchorDeviationBps = _newDeviationBps;
  }

  function addNewAsset(
    string memory _name,
    address _asset,
    uint16 _index,
    uint16 _decimals,
    bool _isSupraFed
  ) external onlyOwner {
    if (_asset == address(0) || _index == 0) revert InvalidAssetOrIndex();
    if (assetToAddress[_name] != address(0) || assetToPriceIndex[_asset] != 0) {
      revert AssetAlreadyExists();
    }
    assetToAddress[_name] = _asset;
    assetToPriceIndex[_asset] = _index;
    assetToDecimals[_asset] = _decimals;
    if (_isSupraFed) {
      supraAssets.push(_asset);
    }
  }

  function updateAsset(
    string memory _name,
    address _asset,
    uint16 _newIndex,
    uint16 _newDecimals
  ) external onlyOwner {
    if (_asset == address(0) || _newIndex == 0) revert InvalidAssetOrIndex();
    address currentAddress = assetToAddress[_name];
    if (currentAddress == address(0)) revert UnsupportedAsset();

    // Remove old address from supraAssets if present, add new one
    for (uint256 i = 0; i < supraAssets.length; i++) {
      if (supraAssets[i] == currentAddress) {
        supraAssets[i] = _asset;
        break;
      }
    }

    delete assetToPriceIndex[currentAddress];
    delete assetToDecimals[currentAddress];
    assetToAddress[_name] = _asset;
    assetToPriceIndex[_asset] = _newIndex;
    assetToDecimals[_asset] = _newDecimals;
  }

  // ============================================================
  //                    RECORDER MANAGEMENT
  // ============================================================

  function addRecorder(address _recorder) external onlyOwner {
    if (isRecorder[_recorder]) revert RecorderAlreadyExists();
    recorders.push(_recorder);
    isRecorder[_recorder] = true;
    emit RecorderAdded(_recorder);
  }

  function removeRecorder(address _recorder) external onlyOwner {
    if (!isRecorder[_recorder]) revert RecorderNotFound();
    isRecorder[_recorder] = false;
    for (uint256 i = 0; i < recorders.length; i++) {
      if (recorders[i] == _recorder) {
        recorders[i] = recorders[recorders.length - 1];
        recorders.pop();
        break;
      }
    }
    emit RecorderRemoved(_recorder);
  }

  function getRecorders() external view returns (address[] memory) {
    return recorders;
  }

  // ============================================================
  //               OBSERVATION RECORDING
  // ============================================================

  /// @notice Record price observations for all Supra-fed assets in one call.
  /// @dev Called periodically (every 1-5 min) by an authorized recorder.
  ///      Skips stale/invalid prices and auto re-anchors if a dislocation persists.
  function recordObservations() external onlyRecorder {
    for (uint256 i = 0; i < supraAssets.length; i++) {
      address asset = supraAssets[i];
      uint16 priceIndex = assetToPriceIndex[asset];
      if (priceIndex == 0) continue;

      ISupraSValueFeed.priceFeed memory priceFeed = sValueFeed.getSvalue(priceIndex);

      if (priceFeed.price == 0) continue;
      if (priceFeed.time == 0 || priceFeed.time > block.timestamp) continue;
      if (block.timestamp - priceFeed.time > maxPriceStaleness) continue;
      if (priceFeed.decimals != 18) continue;

      // Reject prices that deviate too far from the existing TWAP. If the dislocation persists
      // with stable, fresh updates, automatically re-anchor the TWAP baseline.
      uint256 count = observationCount[asset];
      if (count >= minObservationsForEnforcement && maxDeviationBps > 0) {
        uint256 twap = _computeTWAP(asset);
        if (twap > 0) {
          uint256 deviation = _calculateDeviationBps(priceFeed.price, twap);
          uint256 recorderDeviationThreshold = (maxDeviationBps * recorderDeviationMultiplierBps) /
            10000;
          if (deviation > recorderDeviationThreshold) {
            emit PriceDeviationDetected(asset, priceFeed.price, twap, deviation);
            _trackRecoveryCandidate(asset, priceFeed.price, priceFeed.time);
            continue;
          }
        }
      }

      _resetRecoveryState(asset);
      _recordObservation(asset, priceFeed.price);
      lastValidPrice[asset] = priceFeed.price;
      emit ObservationRecorded(asset, priceFeed.price, block.timestamp);
    }

    _recordChainlinkLastValidPrices();
  }

  /// @dev Cache Chainlink-sourced prices so getAssetPrice can fall back
  ///      to them if the Chainlink feeds revert.
  function _recordChainlinkLastValidPrices() internal {
    try this.getUSDCPrice() returns (uint256 usdcPrice) {
      lastValidPrice[USDC] = usdcPrice;
    } catch {}

    address weth = assetToAddress['WETH'];
    if (weth != address(0)) {
      try this.getETHPrice() returns (uint256 ethPrice) {
        lastValidPrice[weth] = ethPrice;
      } catch {}
    }
  }

  /// @notice Manually seed a TWAP observation (owner only, for bootstrapping)
  function seedObservation(address _asset, uint256 _price) external onlyOwner {
    if (_price == 0) revert InvalidPrice();
    if (assetToPriceIndex[_asset] == 0) revert UnsupportedAsset();
    _resetRecoveryState(_asset);
    _recordObservation(_asset, _price);
    lastValidPrice[_asset] = _price;
  }

  /// @notice Clear all TWAP observations for an asset (owner only)
  function clearObservations(address _asset) external onlyOwner {
    observationCount[_asset] = 0;
    observationIndex[_asset] = 0;
    _resetRecoveryState(_asset);
  }

  // ============================================================
  //                    TWAP INTERNAL LOGIC
  // ============================================================

  function _recordObservation(address _asset, uint256 _price) internal {
    uint256 idx = observationIndex[_asset];
    observations[_asset][idx] = PriceObservation({
      price: uint128(_price),
      timestamp: uint128(block.timestamp)
    });
    observationIndex[_asset] = (idx + 1) % MAX_OBSERVATIONS;
    if (observationCount[_asset] < MAX_OBSERVATIONS) {
      observationCount[_asset]++;
    }
  }

  function _calculateDeviationBps(uint256 _a, uint256 _b) internal pure returns (uint256) {
    if (_b == 0) revert DivisionByZero();
    if (_a > _b) {
      return ((_a - _b) * 10000) / _b;
    }
    return ((_b - _a) * 10000) / _b;
  }

  function _resetRecoveryState(address _asset) internal {
    if (recoveryStates[_asset].candidateCount > 0) {
      delete recoveryStates[_asset];
    }
  }

  function _trackRecoveryCandidate(
    address _asset,
    uint256 _price,
    uint256 _feedTimestamp
  ) internal {
    RecoveryState storage state = recoveryStates[_asset];

    // Ignore repeated recorder calls for the same provider update.
    if (state.lastFeedTimestamp == _feedTimestamp) {
      return;
    }

    if (state.candidateCount == 0) {
      state.candidatePrice = uint128(_price);
      state.candidateCount = 1;
      state.firstSeenAt = uint64(block.timestamp);
      state.lastFeedTimestamp = uint64(_feedTimestamp);
      emit RecoveryTrackingStarted(_asset, _price, _feedTimestamp);
      return;
    }

    uint256 oldCandidatePrice = uint256(state.candidatePrice);
    uint256 candidateDeviation = _calculateDeviationBps(_price, oldCandidatePrice);

    if (candidateDeviation > recoveryStabilityBps) {
      emit RecoveryTrackingReset(_asset, oldCandidatePrice, _price, _feedTimestamp);
      state.candidatePrice = uint128(_price);
      state.candidateCount = 1;
      state.firstSeenAt = uint64(block.timestamp);
      state.lastFeedTimestamp = uint64(_feedTimestamp);
      return;
    }

    uint256 nextCount = uint256(state.candidateCount) + 1;
    uint256 averagedPrice = ((oldCandidatePrice * uint256(state.candidateCount)) + _price) /
      nextCount;
    state.candidatePrice = uint128(averagedPrice);
    state.candidateCount = uint64(nextCount);
    state.lastFeedTimestamp = uint64(_feedTimestamp);

    emit RecoveryTrackingUpdated(
      _asset,
      uint256(state.candidatePrice),
      uint256(state.candidateCount),
      _feedTimestamp
    );

    if (nextCount < recoveryConfirmationCount) {
      return;
    }

    uint256 recoveryDuration = block.timestamp - uint256(state.firstSeenAt);
    if (recoveryDuration < recoveryMinDuration) {
      return;
    }

    uint256 anchorPrice = uint256(state.candidatePrice);

    uint256 currentTwap = _computeTWAP(_asset);
    if (currentTwap > 0) {
      uint256 reanchorDeviation = _calculateDeviationBps(anchorPrice, currentTwap);
      if (reanchorDeviation > maxReanchorDeviationBps) {
        return;
      }
    }

    _reanchorObservations(_asset, anchorPrice);
    emit TWAPReanchored(_asset, anchorPrice, nextCount, recoveryDuration);
    delete recoveryStates[_asset];
  }

  function _reanchorObservations(address _asset, uint256 _anchorPrice) internal {
    uint256 targetCount = minObservationsForEnforcement;
    if (targetCount < 2) {
      targetCount = 2;
    }
    if (targetCount > MAX_OBSERVATIONS) {
      targetCount = MAX_OBSERVATIONS;
    }

    uint256 spacing = twapWindow / targetCount;
    uint256 startTimestamp = block.timestamp - (spacing * (targetCount - 1));
    for (uint256 i = 0; i < targetCount; i++) {
      observations[_asset][i] = PriceObservation({
        price: uint128(_anchorPrice),
        timestamp: uint128(startTimestamp + (i * spacing))
      });
    }

    observationCount[_asset] = targetCount;
    observationIndex[_asset] = targetCount % MAX_OBSERVATIONS;
    lastValidPrice[_asset] = _anchorPrice;
  }

  function _computeTWAP(address _asset) internal view returns (uint256) {
    uint256 count = observationCount[_asset];
    if (count < 2) return 0;

    uint256 currentIdx = observationIndex[_asset];
    uint256 cutoffTime = block.timestamp > twapWindow ? block.timestamp - twapWindow : 0;

    uint256 weightedSum = 0;
    uint256 totalWeight = 0;

    for (uint256 i = 0; i < count && i < MAX_OBSERVATIONS; i++) {
      uint256 idx = (currentIdx + MAX_OBSERVATIONS - 1 - i) % MAX_OBSERVATIONS;
      PriceObservation memory obs = observations[_asset][idx];

      if (obs.timestamp == 0 || obs.timestamp < cutoffTime) break;

      uint256 weight;
      if (i == 0) {
        weight = block.timestamp - obs.timestamp;
        if (weight == 0) weight = 1;
      } else {
        uint256 nextIdx = (idx + 1) % MAX_OBSERVATIONS;
        PriceObservation memory nextObs = observations[_asset][nextIdx];
        weight = nextObs.timestamp - obs.timestamp;
      }

      weightedSum += uint256(obs.price) * weight;
      totalWeight += weight;
    }

    if (totalWeight == 0) return 0;
    return weightedSum / totalWeight;
  }

  // ============================================================
  //             PRICE FUNCTIONS (view — Aave-compatible)
  // ============================================================

  function getSupraSvalueFeed() external view returns (ISupraSValueFeed) {
    return sValueFeed;
  }

  function getUSDCPrice() public view returns (uint256) {
    (, int priceUSDC, , uint256 updatedAtUSDC, ) = USDC_USD_dataFeed.latestRoundData();
    (, int priceHBAR, , uint256 updatedAtHBAR, ) = HBAR_USD_dataFeed.latestRoundData();
    _validateChainlinkStaleness(updatedAtUSDC);
    _validateChainlinkStaleness(updatedAtHBAR);
    if (priceUSDC <= 0 || priceHBAR <= 0) revert DivisionByZero();

    uint8 usdcFeedDecimals = USDC_USD_dataFeed.decimals();
    uint8 hbarFeedDecimals = HBAR_USD_dataFeed.decimals();

    uint256 normalizedUSDC = uint256(priceUSDC) * (10 ** (18 - usdcFeedDecimals));
    uint256 normalizedHBAR = uint256(priceHBAR) * (10 ** (18 - hbarFeedDecimals));

    return (normalizedUSDC * (10 ** 18)) / normalizedHBAR;
  }

  function getETHPrice() public view returns (uint256) {
    (, int priceETH, , uint256 updatedAtETH, ) = ETH_USD_dataFeed.latestRoundData();
    (, int priceHBAR, , uint256 updatedAtHBAR, ) = HBAR_USD_dataFeed.latestRoundData();
    _validateChainlinkStaleness(updatedAtETH);
    _validateChainlinkStaleness(updatedAtHBAR);
    if (priceETH <= 0 || priceHBAR <= 0) revert DivisionByZero();

    uint8 ethFeedDecimals = ETH_USD_dataFeed.decimals();
    uint8 hbarFeedDecimals = HBAR_USD_dataFeed.decimals();

    uint256 normalizedETH = uint256(priceETH) * (10 ** (18 - ethFeedDecimals));
    uint256 normalizedHBAR = uint256(priceHBAR) * (10 ** (18 - hbarFeedDecimals));

    return (normalizedETH * (10 ** 18)) / normalizedHBAR;
  }

  function getPriceFeed(address _asset) external view returns (ISupraSValueFeed.priceFeed memory) {
    uint16 priceIndex = assetToPriceIndex[_asset];
    if (priceIndex == 0) revert UnsupportedAsset();
    return sValueFeed.getSvalue(priceIndex);
  }

  function getHbarUSD(uint256 _amount) public view returns (uint256 priceInUSD) {
    ISupraSValueFeed.priceFeed memory priceFeedUSD = sValueFeed.getSvalue(assetToPriceIndex[USDC]);
    _validateSupraStaleness(priceFeedUSD.time);
    _validateSupraDecimals(priceFeedUSD.decimals);
    if (priceFeedUSD.price == 0) revert InvalidPrice();
    priceInUSD = (_amount * priceFeedUSD.price) / (10 ** decimals());
  }

  function getAssetPriceInUSD(address _asset) public view returns (uint256) {
    uint256 priceInHbar = getAssetPrice(_asset);
    ISupraSValueFeed.priceFeed memory priceFeedUSD = sValueFeed.getSvalue(assetToPriceIndex[USDC]);
    _validateSupraStaleness(priceFeedUSD.time);
    _validateSupraDecimals(priceFeedUSD.decimals);
    if (priceFeedUSD.price == 0) revert InvalidPrice();
    return (priceInHbar * priceFeedUSD.price) / (10 ** decimals());
  }

  function getAmountInEth(
    uint256 amount,
    address asset
  ) external view returns (uint256 amountInEth) {
    uint256 price = getAssetPrice(asset);
    amountInEth = (price * amount) / (10 ** assetToDecimals[asset]);
  }

  function getXPackPrice() public view returns (uint256) {
    uint16 packPriceIndex = assetToPriceIndex[assetToAddress['PACK']];
    uint16 xPackPriceIndex = assetToPriceIndex[assetToAddress['XPACK']];
    if (packPriceIndex == 0 || xPackPriceIndex == 0) revert UnsupportedAsset();

    ISupraSValueFeed.priceFeed memory packPriceFeed = sValueFeed.getSvalue(packPriceIndex);
    ISupraSValueFeed.priceFeed memory xPackPriceFeed = sValueFeed.getSvalue(xPackPriceIndex);
    _validateSupraStaleness(packPriceFeed.time);
    _validateSupraStaleness(xPackPriceFeed.time);
    _validateSupraDecimals(packPriceFeed.decimals);
    _validateSupraDecimals(xPackPriceFeed.decimals);
    if (packPriceFeed.price == 0 || xPackPriceFeed.price == 0) revert InvalidPrice();

    return (xPackPriceFeed.price * packPriceFeed.price) / (10 ** decimals());
  }

  /// @notice Gets the price of an asset in HBAR, with TWAP circuit breaker.
  /// @dev Main entry point called by the LendingPool via IPriceOracleGetter.
  ///      MUST remain `view` for STATICCALL compatibility with Aave V2.
  ///      This function NEVER reverts for oracle failures — it falls back to
  ///      TWAP or the last known valid price to keep the protocol operational.
  function getAssetPrice(address _asset) public view returns (uint256) {
    uint16 priceIndex = assetToPriceIndex[_asset];
    if (priceIndex == 0) revert UnsupportedAsset();

    if (_asset == WHBAR) {
      return (10 ** decimals());
    }
    if (_asset == USDC) {
      return _safeGetUSDCPrice();
    }
    if (_asset == assetToAddress['WETH']) {
      return _safeGetETHPrice();
    }

    return _safeGetSupraPrice(_asset, priceIndex);
  }

  function _safeGetUSDCPrice() internal view returns (uint256) {
    try this.getUSDCPrice() returns (uint256 price) {
      return price;
    } catch {
      uint256 cachedPrice = lastValidPrice[USDC];
      if (cachedPrice > 0) return cachedPrice;

      (uint256 rawSpotPrice, bool hasRawSpotPrice) = _tryGetRawChainlinkDerivedPrice(
        USDC_USD_dataFeed,
        HBAR_USD_dataFeed
      );
      if (hasRawSpotPrice) return rawSpotPrice;

      return 0;
    }
  }

  function _safeGetETHPrice() internal view returns (uint256) {
    try this.getETHPrice() returns (uint256 price) {
      return price;
    } catch {
      uint256 cachedPrice = lastValidPrice[assetToAddress['WETH']];
      if (cachedPrice > 0) return cachedPrice;

      (uint256 rawSpotPrice, bool hasRawSpotPrice) = _tryGetRawChainlinkDerivedPrice(
        ETH_USD_dataFeed,
        HBAR_USD_dataFeed
      );
      if (hasRawSpotPrice) return rawSpotPrice;

      return 0;
    }
  }

  function _safeGetSupraPrice(address _asset, uint16 _priceIndex) internal view returns (uint256) {
    uint256 spotPrice;
    bool spotAvailable = false;
    bool spotValid = false;

    try sValueFeed.getSvalue(_priceIndex) returns (ISupraSValueFeed.priceFeed memory priceFeed) {
      if (priceFeed.price > 0 && priceFeed.decimals == 18) {
        spotPrice = priceFeed.price;
        spotAvailable = true;
        if (
          priceFeed.time > 0 &&
          priceFeed.time <= block.timestamp &&
          block.timestamp - priceFeed.time <= maxPriceStaleness
        ) {
          spotValid = true;
        }
      }
    } catch {}

    if (!spotValid) {
      uint256 cached = lastValidPrice[_asset];
      if (cached > 0) return cached;

      uint256 fallbackTwap = _computeTWAP(_asset);
      if (fallbackTwap > 0) return fallbackTwap;

      if (spotAvailable) return spotPrice;
      return 0;
    }

    if (maxDeviationBps == 0) return spotPrice;
    if (observationCount[_asset] < minObservationsForEnforcement) return spotPrice;

    uint256 twap = _computeTWAP(_asset);
    if (twap == 0) return spotPrice;

    uint256 deviation;
    if (spotPrice > twap) {
      deviation = ((spotPrice - twap) * 10000) / twap;
    } else {
      deviation = ((twap - spotPrice) * 10000) / twap;
    }

    if (deviation > maxDeviationBps) {
      return twap;
    }

    return spotPrice;
  }

  // ============================================================
  //               VIEW / DIAGNOSTIC FUNCTIONS
  // ============================================================

  function getSupraAssets() external view returns (address[] memory) {
    return supraAssets;
  }

  function getTWAP(address _asset) external view returns (uint256) {
    return _computeTWAP(_asset);
  }

  function getObservationCount(address _asset) external view returns (uint256) {
    return observationCount[_asset];
  }

  function getRecoveryState(
    address _asset
  )
    external
    view
    returns (
      uint256 candidatePrice,
      uint256 candidateCount,
      uint256 firstSeenAt,
      uint256 lastFeedTimestamp,
      bool inRecovery
    )
  {
    RecoveryState memory state = recoveryStates[_asset];
    candidatePrice = uint256(state.candidatePrice);
    candidateCount = uint256(state.candidateCount);
    firstSeenAt = uint256(state.firstSeenAt);
    lastFeedTimestamp = uint256(state.lastFeedTimestamp);
    inRecovery = state.candidateCount > 0;
  }

  function getLastValidPrice(address _asset) external view returns (uint256) {
    return lastValidPrice[_asset];
  }

  function getLatestObservation(
    address _asset
  ) external view returns (uint256 price, uint256 timestamp) {
    uint256 count = observationCount[_asset];
    if (count == 0) return (0, 0);
    uint256 latestIdx = (observationIndex[_asset] + MAX_OBSERVATIONS - 1) % MAX_OBSERVATIONS;
    PriceObservation memory obs = observations[_asset][latestIdx];
    return (uint256(obs.price), uint256(obs.timestamp));
  }

  function checkCurrentDeviation(
    address _asset
  )
    external
    view
    returns (uint256 spotPrice, uint256 twapPrice, uint256 deviationBps, bool wouldBlock)
  {
    uint16 priceIndex = assetToPriceIndex[_asset];
    if (priceIndex == 0) revert UnsupportedAsset();

    ISupraSValueFeed.priceFeed memory priceFeed = sValueFeed.getSvalue(priceIndex);
    spotPrice = priceFeed.price;
    twapPrice = _computeTWAP(_asset);

    if (twapPrice == 0 || observationCount[_asset] < minObservationsForEnforcement) {
      return (spotPrice, twapPrice, 0, false);
    }

    deviationBps = _calculateDeviationBps(spotPrice, twapPrice);

    wouldBlock = maxDeviationBps > 0 && deviationBps > maxDeviationBps;
  }

  function decimals() public pure returns (uint8) {
    return 18;
  }

  // ============================================================
  //                    INTERNAL VALIDATION
  // ============================================================

  function _validateChainlinkStaleness(uint256 updatedAt) internal view {
    if (updatedAt == 0 || updatedAt > block.timestamp) revert StalePrice();
    if (block.timestamp - updatedAt > maxPriceStaleness) revert StalePrice();
  }

  function _validateSupraStaleness(uint256 updatedAt) internal view {
    if (updatedAt == 0 || updatedAt > block.timestamp) revert StalePrice();
    if (block.timestamp - updatedAt > maxPriceStaleness) revert StalePrice();
  }

  function _validateSupraDecimals(uint256 feedDecimals) internal pure {
    if (feedDecimals != 18) revert InvalidPriceDecimals();
  }

  function _tryGetRawChainlinkDerivedPrice(
    AggregatorV3Interface _baseFeed,
    AggregatorV3Interface _quoteFeed
  ) internal view returns (uint256 price, bool ok) {
    try _baseFeed.latestRoundData() returns (uint80, int256 baseAnswer, uint256, uint256, uint80) {
      try _quoteFeed.latestRoundData() returns (
        uint80,
        int256 quoteAnswer,
        uint256,
        uint256,
        uint80
      ) {
        if (baseAnswer <= 0 || quoteAnswer <= 0) return (0, false);

        try _baseFeed.decimals() returns (uint8 baseDecimals) {
          try _quoteFeed.decimals() returns (uint8 quoteDecimals) {
            if (baseDecimals > 18 || quoteDecimals > 18) return (0, false);

            uint256 normalizedBase = uint256(baseAnswer) * (10 ** (18 - baseDecimals));
            uint256 normalizedQuote = uint256(quoteAnswer) * (10 ** (18 - quoteDecimals));
            if (normalizedQuote == 0) return (0, false);

            return ((normalizedBase * (10 ** 18)) / normalizedQuote, true);
          } catch {
            return (0, false);
          }
        } catch {
          return (0, false);
        }
      } catch {
        return (0, false);
      }
    } catch {
      return (0, false);
    }
  }
}
