# FINAL: Oracle Price Discrepancy in WHBAR Liquidation — Incident Analysis

**TX:** `0xa60852e961543d7074efc89f0f76fb9c5bb9e072bd67fea1f6c5e9b135cd1e21`
**Time:** 2026-03-18T07:21:20 UTC
**Affected User:** `0x00000000000000000000000000000000002d3b9d` (Hedera: 0.0.2964381)
**Analyst:** Claude (code-level investigation)
**Date:** 2026-03-18

---

## Executive Summary

This analysis reviews a pricing discrepancy affecting the STEAM/HBAR oracle feed (Supra index 479) during a sequence of 22 liquidation transactions. The available evidence indicates that the feed returned values up to **15.728162 HBAR** for STEAM while the market reference used in this analysis was approximately **0.032 HBAR**, implying an overvaluation of about **492x** at the time of the largest liquidation.

The main liquidation transaction seized **292,918.49 WHBAR**, and the full sequence seized **301,593+ WHBAR** from one user account. Using the liquidation formula and on-chain transaction values, the implied oracle price at the time of TX `0xa60852...1e21` is **15.73 HBAR**, which matches the peak value present in the raw per-second feed data.

Supra stated that the issue coincided with a data provider transition in which one provider went down while another was being onboarded. Based on the code path reviewed here, the Bonzo oracle contract accepted the reported value without an additional price deviation check, secondary oracle comparison, or circuit breaker.

---

## Confirmed Inputs and Observations

### Oracle Provider Statement

> *"We had few issues last few days with our data providers with one going down and one onboarding and this has caused this issue. We have already have taken corrective actions for the feed and should be normal now."*

### Confirmed Facts

| Item | Detail |
|------|--------|
| **Price feed** | Supra index 479 = STEAM/HBAR |
| **Denomination** | HBAR-denominated |
| **Provider note** | Supra reported a provider issue during provider transition |
| **Observed peak value** | **15.728162 HBAR** |
| **Reference market value used in this analysis** | **~0.032 HBAR** |
| **Observed overvaluation at peak** | **~49,200% (492x)** |
| **Oracle response** | Corrective actions reported by Supra; feed later normalized |

---

## Incident Overview

The sequence analyzed here is consistent with the following flow:

1. The STEAM/HBAR oracle feed began returning elevated values during a provider transition.
2. `SupraOracle.getAssetPrice(STEAM)` forwarded those values to the lending system.
3. The elevated debt valuation reduced the affected account's health factor.
4. Liquidation transactions were executed while the elevated prices were present.
5. The largest liquidation occurred during the highest observed oracle value.

This report focuses on the pricing behavior, the code path that consumed the price, and the liquidation outcomes observable on-chain.

---

## Timeline of Events

1. **Mar 17, 03:46 UTC**: First precursor episode, approximately 4 seconds at **7.80 HBAR** (~230x relative to normal range).
2. **Mar 18, 00:11 UTC**: Second precursor episode, approximately 4 seconds at **7.81 HBAR**.
3. **Mar 18, 07:20:46 UTC**: Main episode begins, with the feed moving from **0.035 HBAR** to **7.88 HBAR** and then **15.73 HBAR** within 2 seconds.
4. **Mar 18, 07:21:20 UTC**: **Liquidation TX #3** executes while the reported price is **15.728 HBAR**.
5. **Mar 18, 07:21:41 UTC**: Price returns to approximately **0.032 HBAR**; the 54-second episode ends.
6. **Mar 18, 07:23–10:42 UTC**: Additional intermittent elevated-price episodes occur, overlapping with the remaining liquidation activity.
7. **Mar 18, ~10:42 UTC**: Final observed episode; feed stabilizes.
8. **Post-incident**: Supra reports corrective actions for the feed.

---

## On-Chain Calculation

### Liquidation Formula

The relevant liquidation formula in `LendingPoolCollateralManager.sol` is:

```
maxCollateral = (debtAssetPrice × debtToCover × 10^collateralDecimals × liquidationBonus)
                / (PERCENTAGE_FACTOR × collateralPrice × 10^debtAssetDecimals)
```

### Inputs Used for TX #3

| Parameter | Value | Source |
|-----------|-------|--------|
| Collateral seized | 292,918.49 WHBAR | On-chain (TX #3) |
| Debt covered | 18,262.23 STEAM | On-chain (TX #3) |
| WHBAR oracle price | 10^18 (hardcoded) | `SupraOracle.sol` |
| WHBAR decimals | 8 | `reservesConfigs.ts` |
| STEAM decimals | 2 | `reservesConfigs.ts` |
| WHBAR liquidation bonus | 10198 (1.98%) | `reservesConfigs.ts` |

### Implied Oracle Price

Using the values above:

**Implied `getAssetPrice(STEAM)` = 15.73 × 10^18**

That is, the liquidation math implies the oracle reported:

**1 STEAM = 15.73 HBAR**

For comparison, the market reference used in this analysis is:

**1 STEAM = 0.032 HBAR**

### Scenario Comparison

| Scenario | Oracle STEAM Price | WHBAR Seized | Factor |
|----------|-------------------|--------------|--------|
| Reference pricing | 0.032 HBAR | **595 WHBAR** | 1x |
| Earlier external estimate (25x) | 0.80 HBAR | **14,877 WHBAR** | 25x |
| **Observed on-chain outcome** | **15.73 HBAR** | **292,918 WHBAR** | **492x** |

---

## Feed Data Analysis

Raw Supra price feed data for STEAM/HBAR (index 479), covering **2026-03-17 03:00 UTC to 2026-03-18 15:00 UTC**, contains **129,536 per-second observations**.

### Two Distinct Elevated Price Levels

The data shows two recurring elevated ranges rather than one continuous level:

| Level | Price | Multiple | Records | Interpretation |
|-------|-------|----------|---------|----------------|
| Normal | ~0.034 HBAR | 1x | 128,764 (99.4%) | Baseline observed range |
| **Level 1** | **~7.53 HBAR** | **221x** | **612 (0.5%)** | First elevated range |
| **Level 2** | **~15.52 HBAR** | **456x** | **160 (0.1%)** | Second elevated range |

**Level 2 is approximately 2x Level 1** (ratio: 2.06x). This pattern is consistent with Supra's note that the issue occurred during a provider transition involving one provider going down and another onboarding.

### 57 Intermittent Episodes Across 7.5 Hours

The elevated values appear in **57 intermittent episodes**, totaling about **13 minutes** of anomalous data over approximately **7.5 hours**:

| Phase | Time Range | Episodes | Peak Price | Pattern |
|-------|-----------|----------|-----------|---------|
| **Precursor** | Mar 17 03:46 | 1 | 7.80 (230x) | 4-second early episode |
| **Precursor** | Mar 18 00:11 | 1 | 7.81 (230x) | 4-second early episode |
| **Main event** | Mar 18 07:20–07:30 | 5 | **15.73 (463x)** | Longest and highest episodes |
| **Aftershocks** | Mar 18 07:30–08:35 | 22 | 15.69 (462x) | Frequent but shorter |
| **Decay** | Mar 18 09:00–10:42 | 28 | 14.39 (423x) | Lower frequency over time |
| **Final** | Mar 18 10:42+ | 0 | — | Feed stabilized |

### Second-by-Second Window Around TX #3

The largest liquidation transaction occurred during the following 54-second interval:

```
07:20:45  price = 0.0347 HBAR   (baseline)
07:20:46  price = 7.883 HBAR    (first elevated step)
07:20:48  price = 15.728 HBAR   (second elevated step, peak)
  ... 33 seconds at 15.728 ...
07:21:20  price = 15.728 HBAR   (liquidation TX #3)
07:21:22  price = 7.880 HBAR    (partial step-down)
  ... 19 seconds at 7.880 ...
07:21:41  price = 0.032 HBAR    (return to baseline)
```

### Back-Calculation Validation

| Method | Implied Price | Match? |
|--------|---------------|--------|
| Back-calculated from liquidation formula | 15.728 HBAR | ✓ |
| Raw Supra feed data peak | 15.728162 HBAR | ✓ |

The correspondence between the back-calculated liquidation price and the raw feed peak supports the conclusion that the liquidation outcome aligns with the oracle values observed during this interval.

---

## Code-Level Findings

### 1. Decimal Mismatch Not Observed

| System | File | STEAM Decimals |
|--------|------|---------------|
| Oracle (`assetToDecimals`) | `SupraOracle.sol:99` | **2** |
| Reserve config (`reserveDecimals`) | `reservesConfigs.ts:220` | **2** |

The oracle and reserve configuration both use **2 decimals** for STEAM. Based on this review, a decimal mismatch does not appear to explain the liquidation outcome.

### 2. Price Sanity Check Not Present in the Oracle Path

`SupraOracle.getAssetPrice()` for Supra-fed assets applies two checks in the reviewed path:

- **Staleness check**: `maxPriceStaleness = 1 days`
- **Decimal check**: `feedDecimals == 18`

The path reviewed here does **not** include a maximum price deviation check, TWAP comparison, secondary oracle comparison, or circuit breaker before returning the price to the lending system.

### 3. WHBAR Price Path

```solidity
if (_asset == WHBAR) { return (10 ** decimals()); }  // always returns 10^18
```

In the reviewed implementation, the WHBAR oracle price is hardcoded and is not affected by the external STEAM feed.

### 4. Liquidation Bonus Correction

The WHBAR liquidation bonus is **1.98%** (`10198`), not 8% as assumed in earlier analysis. In the formula path reviewed here, the collateral asset's liquidation bonus applies.

---

## Impact Assessment

### Liquidation Totals

| Category | Amount |
|----------|--------|
| Total WHBAR seized across 22 liquidations | **301,593+ WHBAR** |
| WHBAR that would have been seized under reference pricing (TX #3 only) | **~595 WHBAR** |
| Difference relative to reference pricing | **~301,000 WHBAR** |
| Approximate USD value at `$0.10/HBAR` | **~$30,100** |

### Transaction #3 Economics

| Item | Amount |
|------|--------|
| WHBAR seized | 292,918.49 |
| WHBAR needed to repay flash loan | 584.06 |
| Net retained amount | **292,334.43 WHBAR** |
| Margin relative to flash loan repayment | **99.8%** |

The transaction required sale of approximately **0.20%** of the seized collateral to cover flash loan repayment.

### Health Position Under Reference Pricing

Using the reference price in this analysis:

**18,262 STEAM × 0.032 HBAR = ~584 HBAR**

On that basis, the account appears materially healthier than it appeared under the elevated oracle value. The liquidation eligibility observed on-chain is therefore consistent with the elevated STEAM valuation rather than the baseline market reference used here.

---

## Protocol Safeguards and Recommendations

The reviewed oracle path accepts the reported price without an additional deviation filter. The following safeguards would reduce exposure to similar events:

### 1. Price Deviation Circuit Breaker

Reject or pause updates that deviate beyond a configurable threshold from the last accepted price within a defined window.

### 2. Multi-Oracle Validation

Compare the reported value against a secondary source such as a TWAP or another oracle and reject materially divergent values.

### 3. Asset-Level Price Bounds

Allow configurable bounds for assets whose historical trading ranges are well understood.

### 4. Tighter Staleness Limits

`maxPriceStaleness = 1 day` is permissive for volatile assets. A shorter freshness window would reduce acceptance risk for stale or anomalous values.

### 5. Liquidation Pause Capability

Allow governance or designated operators to pause liquidations during known oracle disruptions.

---

## Role Summary

| Party | Role in Observed Sequence |
|-------|----------------------------|
| **Supra (oracle provider)** | Reported a provider issue during a provider transition affecting the feed |
| **Bonzo protocol** | Consumed the reported value through the reviewed oracle path without an additional deviation safeguard |
| **Liquidation bot operator** | Executed liquidation transactions permitted by the on-chain state during the event window |
| **Affected user** | Account subject to the liquidation sequence analyzed here |

---

## Full Configuration Reference

### STEAM Reserve Parameters

```
reserveDecimals: '2'
baseLTVAsCollateral: '1000'     (10%)
liquidationThreshold: '5700'    (57%)
liquidationBonus: '10814'       (108.14% → 8.14% bonus)
borrowCap: 5,419,281
```

### WHBAR Reserve Parameters

```
reserveDecimals: '8'
baseLTVAsCollateral: '6272'     (62.72%)
liquidationThreshold: '6798'    (67.98%)
liquidationBonus: '10198'       (101.98% → 1.98% bonus)
```

### SupraOracle Token Decimals

```
KARATE=8, HBARX=8, SAUCE=6, XSAUCE=6, USDC=6, WHBAR=8,
DOVU=8, PACK=6, HST=8, STEAM=2, GRELF=8, KBL=6, BONZO=8, WETH=18
```

---

## All 22 Liquidation Transactions

```
 #  TX Hash                                                              Type              WHBAR Seized
 1. 0xbae5f0fd47abd81087c6c5e6ec1effb78a64a697293c27dff785ac411c1f3cfa  STEAM→STEAM       -
 2. 0xfb030eb52fa28eeaa2c3f844f2ad74a2988fc5231848455806d2c97770d09250  STEAM→STEAM       -
 3. 0xa60852e961543d7074efc89f0f76fb9c5bb9e072bd67fea1f6c5e9b135cd1e21  STEAM→WHBAR       292,918
 4. 0x2976e25ad940a36ead27d7d242011feced9a06b4fd623499dc5a19079d355eae  STEAM→WHBAR       8,674
 5. 0x51fc7556070e962b55a6e7001cb15ed943607fec200bcd9b4a35f8d98258d8b6  -                 -
 6. 0x88b448def3deaf9aa09f36810dbab77ee44e46d115e52e0ed3fe70c14bd88451  -                 -
 7. 0x55935fda9782e44033dd82473fdcf10a80ac61f79c37bf86797388711f61664d  -                 -
 8. 0x69076cbb3abc4bb72fe145afef0ead83b5c2d9bc4a41477bc77a2ac7fc4a1ca8  -                 -
 9. 0xa2127a4e06b46964bdd13be70ad8b91630fae695846373bdd9a565858164f7ad  -                 -
10. 0x7c8dac65190660c7053346594ffa690f75862841af0f3d787a3e5e6eda7c731a  -                 -
11. 0x6e52a42a8c0cca39d9da8a22c21787e11949215fffa6cca85a002be5a5538088  -                 -
12. 0xe6aed282daff68145fb8bdfdf27d52f01ea4ac982409d45962c95c9843725df5  -                 -
13. 0x1d89e2f12db94441aa744759016e0f3f221141bd5086719dd9895049b5476165  -                 -
14. 0x7800b0e9639fa107e515c5331d8a1829767cf775f5867fe1cb5d075b54090170  -                 -
15. 0x6f891fdf534063fb7d17ed043f33be41aff692b8220a852227f2278a60efbbb0  -                 -
16. 0xe3f6486a39ef8cddb8577b2a7c95dd33fa7abca52309025160aedb090883517b  XSAUCE→BONZO      -
17. 0x07b391c225f75e2659f9e9daf89b4abec90f6297db2bf3700fef458479131a9b  -                 -
18. 0x8ca66404358f2dc3cde42c66bdbab0418c6d4563de0a4656a5548f5932e36bbd  HST→HST           -
19. 0x06464485dc170563947394ba9494bf351e480207605b347631ad57957d2357d4  -                 -
20. 0x4f14a7cc3bfe4d315e89950ae9407ad7b905819074d286adb7432d2323f7fdb5  -                 -
21. 0x3d3eaa92ec86e33c471c70a0653992c0156ebea9e24e67a9979a31f6b9fb125c  -                 -
22. 0xa5daf6951fee7e0a328ebbab2382c052c01e25adf4f0b1d52193ca8b2030f3e0  -                 -
```

---

## Conclusion

The evidence reviewed here supports the following points:

- The STEAM/HBAR feed returned elevated values up to **15.728162 HBAR** during the incident window.
- The largest liquidation transaction implies an oracle price of **15.73 HBAR**, matching the raw feed peak.
- The observed liquidation outcomes are consistent with the elevated oracle values rather than the baseline market reference used in this report.
- Supra reported a provider issue during a provider transition, and the feed later normalized.
- The reviewed Bonzo oracle path did not apply an additional deviation-based safeguard before passing the value into the liquidation flow.

Taken together, these observations support the conclusion that the liquidation sequence was driven by the reported oracle values during the incident window, with no indication in this review that a decimal mismatch or WHBAR pricing path issue was responsible for the result.
