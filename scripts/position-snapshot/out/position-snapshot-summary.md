# Bonzo position snapshot summary

Generated: 2026-07-16T17:27:54.807Z

## Executive summary

The three snapshots contain 2,726 position-holding accounts before Wallet A's exploit borrows, 2,726 immediately after the pool was paused, and 2,727 after the interest-rate changes. The middle snapshot is block 97506158, which contains the successful `setPoolPause(true)` transaction after both incident wallets' borrowing activity. Its aggregate borrowed-value increase of **+$10,020,619.07** spans the abnormal-oracle window, but it is an accounting-position delta rather than a transaction-level principal or final-loss figure.

The transaction-level incident analysis identifies exactly two SAUCE-collateral borrowers during that window. Their rough combined principal was **$10,057,434**: approximately **$9,050,125** for Wallet A and **$1,007,309** for Wallet B. Wallet B's position is treated separately as recoverable because it contacted the team as a white-hat responder and stated an intention to return the funds.

The later aggregate change of **+$138,994.89** begins after the pause and spans subsequent position evolution through the post-rate snapshot. Both snapshot deltas include debt-index accrual and other account changes between their blocks. USD and HBAR figures are comparison values, not contemporaneous market values or reserve liquidity.

| Snapshot | Block | Users | Suppliers | Borrowers | Supplied USD | Borrowed USD | Supplied HBAR | Borrowed HBAR | Debt / supply |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Before exploit | 97504300 | 2,726 | 1,498 | 608 | $17,226,299.48 | $3,320,302.04 | 246,090,004.73 HBAR | 47,432,889.34 HBAR | 19.27% |
| After pause | 97506158 | 2,726 | 1,498 | 608 | $16,268,711.28 | $13,340,921.11 | 232,410,171.21 HBAR | 190,584,591.66 HBAR | 82% |
| After interest-rate changes | 97702331 | 2,727 | 1,499 | 608 | $16,406,931.92 | $13,479,916 | 234,384,750.69 HBAR | 192,570,231.75 HBAR | 82.15% |

## Snapshot boundaries and integrity

| Snapshot | Source file | Block | UTC timestamp | Rows | Columns |
|---|---|---:|---|---:|---:|
| Before exploit | `01-positions-before-exploit.csv` | 97504300 | 2026-07-11T00:39:02.000Z | 2,726 | 106 |
| After pause | `02-positions-after-pause.csv` | 97506158 | 2026-07-11T01:40:58.000Z | 2,726 | 106 |
| After interest-rate changes | `03-positions-after-interest-rate-changes.csv` | 97702331 | 2026-07-15T14:40:32.000Z | 2,727 | 106 |

- All three files use the same column schema.
- Every CSV has one unique row per EVM address.
- Stable debt is intentionally absent because Bonzo has kept stable-rate borrowing disabled since inception.
- The healthFactor column is the block-pinned protocol health factor returned by LendingPool.getUserAccountData. It does not use the fixed investigation prices.
- These CSVs do not contain reserve cash or liquidation thresholds. This report does not infer those values.

## Reserve-level positions

| Asset | Before supplied | Before borrowed | After-pause supplied | After-pause borrowed | After-rates supplied | After-rates borrowed | Suppliers after rates | Borrowers after rates |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| XSAUCE | $253,920.86 | $3,130.74 | $250,520.88 | $62,630.77 | $250,546.13 | $62,656.03 | 380 | 39 |
| USDC | $8,861,603.74 | $2,227,080.79 | $8,862,124.64 | $8,861,878.23 | $8,933,835.14 | $8,933,818.22 | 936 | 567 |
| KARATE | $9,745.42 | $2,696.81 | $9,745.42 | $2,696.82 | $9,747.01 | $2,698.02 | 317 | 41 |
| HBARX | $4,108,007.11 | $83,411.92 | $3,161,039.48 | $893,442.88 | $3,161,395.11 | $893,798.65 | 449 | 108 |
| SAUCE | $158,472.87 | $35,131.4 | $158,477.81 | $33,753.8 | $158,492.72 | $33,768.72 | 433 | 95 |
| WHBAR | $3,346,372.02 | $930,085.22 | $3,346,593.96 | $3,346,537.07 | $3,411,631.48 | $3,412,115.58 | 1,884 | 491 |
| DOVU | $33,903.99 | $1,353.84 | $33,891.91 | $1,342.85 | $33,892.07 | $1,342.98 | 382 | 44 |
| HST | $36,824.8 | $572.12 | $36,824.8 | $572.12 | $36,824.84 | $572.14 | 103 | 24 |
| PACK | $10,486.77 | $27.39 | $10,486.77 | $27.39 | $10,486.77 | $27.39 | 253 | 31 |
| STEAM | $40,291.31 | $1,018.75 | $40,291.31 | $1,018.75 | $40,291.41 | $1,018.8 | 137 | 16 |
| GRELF | $93,817.23 | $1,515.16 | $93,047.24 | $1,515.16 | $93,047.32 | $1,515.22 | 164 | 17 |
| KBL | $19,542.87 | $369.31 | $19,540.63 | $367.15 | $19,540.64 | $367.17 | 148 | 14 |
| BONZO | $155,292.5 | $20,989.79 | $148,749.51 | $38,085.63 | $148,773.83 | $38,109.89 | 588 | 34 |
| WETH | $98,017.99 | $12,918.8 | $97,376.92 | $97,052.49 | $98,427.45 | $98,107.19 | 29 | 21 |

## Changes through the pool pause

Across this interval, **742 accounts** had a supplied-value or borrowed-value change at the CSV's fixed prices. This interval includes both Wallet A and Wallet B, but its aggregate position changes must not be substituted for the transaction-level incident-principal figures above.

| Metric | Change |
|---|---:|
| Aggregate supplied USD | -$957,588.2 |
| Aggregate borrowed USD | +$10,020,619.07 |
| Aggregate supplied HBAR | -13,679,833.51 HBAR |
| Aggregate borrowed HBAR | 143,151,702.31 HBAR |

| Asset | Supplied amount change | Supplied USD change | Borrowed amount change | Borrowed USD change |
|---|---:|---:|---:|---:|
| XSAUCE | -199,998.153403 | -$3,399.98 | 3,500,001.915514 | +$59,500.03 |
| USDC | 520.851048 | +$520.9 | 6,634,797.4994 | +$6,634,797.44 |
| KARATE | 504.279455 | +$0 | 627.72504 | +$0.01 |
| HBARX | -9,762,552.975534 | -$946,967.63 | 8,350,834.593634 | +$810,030.96 |
| SAUCE | 358.044674 | +$4.94 | -100,054.17732 | -$1,377.6 |
| WHBAR | 3,170.571173 | +$221.94 | 34,520,740.677691 | +$2,416,451.85 |
| DOVU | -10,975.775776 | -$12.08 | -9,989.595578 | -$10.99 |
| HST | 0.134467 | +$0 | 0.158649 | +$0 |
| PACK | 0.000268 | +$0 | 0.000305 | +$0 |
| STEAM | 0.19 | +$0 | 0.23 | +$0 |
| GRELF | -9,999.867254 | -$769.99 | 0.007493 | +$0 |
| KBL | -3,210.445318 | -$2.24 | -3,081.882893 | -$2.16 |
| BONZO | -594,826.38234 | -$6,542.99 | 1,554,169.06455 | +$17,095.84 |
| WETH | -0.358138 | -$641.07 | 47.002062 | +$84,133.69 |

### Largest borrowed-value increases

| Hedera account | EVM address | Supplied USD change | Borrowed USD change |
|---|---|---:|---:|
| 0.0.10633526 | `0x9a4966152f6e10b33cb7a37975e8619816d6a494` | +$3.44 | +$9,051,570.75 |
| 0.0.683607 | `0x00000000000000000000000000000000000a6e57` | -$47,837.3 | +$981,492.32 |
| 0.0.7951 | `0x0000000000000000000000000000000000001f0f` | -$856,643.75 | +$67.66 |
| 0.0.834592 | `0x00000000000000000000000000000000000cbc20` | +$3.74 | +$11.8 |
| 0.0.445590 | `0x000000000000000000000000000000000006cc96` | +$4.84 | +$9.21 |
| 0.0.10052868 | `0x0441bb99299a6065e2c57cfc133e4e186734c8d8` | +$28.94 | +$8.7 |
| 0.0.1314568 | `0x0000000000000000000000000000000000140f08` | +$1.12 | +$7.8 |
| 0.0.880302 | `0x00000000000000000000000000000000000d6eae` | +$14.53 | +$6.25 |
| 0.0.10248067 | `0x00000000000000000000000000000000009c5f83` | +$27.05 | +$5.9 |
| 0.0.868412 | `0x00000000000000000000000000000000000d403c` | +$19.44 | +$5.7 |

### Largest supplied-value decreases

| Hedera account | EVM address | Supplied USD change | Borrowed USD change |
|---|---|---:|---:|
| 0.0.7951 | `0x0000000000000000000000000000000000001f0f` | -$856,643.75 | +$67.66 |
| 0.0.683607 | `0x00000000000000000000000000000000000a6e57` | -$47,837.3 | +$981,492.32 |
| 0.0.1988666 | `0x00000000000000000000000000000000001e583a` | -$37,692.17 | +$2.2 |
| 0.0.732888 | `0x00000000000000000000000000000000000b2ed8` | -$7,286.24 | -$7,199.88 |
| 0.0.7205628 | `0x00000000000000000000000000000000006df2fc` | -$3,426.52 | +$0.4 |
| 0.0.839530 | `0x00000000000000000000000000000000000ccf6a` | -$2,841.58 | -$2,666.44 |
| 0.0.8741292 | `0x00000000000000000000000000000000008561ac` | -$2,386.45 | -$2,237.77 |
| 0.0.7031357 | `0x72e08d06bb313c3a77c890ddf92aeeb5b033b0aa` | -$264.68 | -$266.35 |
| 0.0.789038 | `0x00000000000000000000000000000000000c0a2e` | -$111.96 | +$0 |
| 0.0.956030 | `0x00000000000000000000000000000000000e967e` | -$58.82 | -$57.94 |

## Changes between the pool pause and the post-rate snapshot

Across this interval, **1,090 accounts** had a supplied-value or borrowed-value change. The interval includes several days of indexed position evolution and the stored-rate refresh. These deltas must not be attributed solely to the rate-change transactions.

| Metric | Change |
|---|---:|
| Aggregate supplied USD | +$138,220.64 |
| Aggregate borrowed USD | +$138,994.89 |
| Aggregate supplied HBAR | 1,974,579.48 HBAR |
| Aggregate borrowed HBAR | 1,985,640.09 HBAR |

| Asset | Supplied amount change | Supplied USD change | Borrowed amount change | Borrowed USD change |
|---|---:|---:|---:|---:|
| XSAUCE | 1,485.650984 | +$25.25 | 1,485.71225 | +$25.26 |
| USDC | 71,710.528898 | +$71,710.5 | 71,939.939283 | +$71,939.99 |
| KARATE | 89,991.947136 | +$1.59 | 66,294.184183 | +$1.2 |
| HBARX | 3,666.717281 | +$355.63 | 3,667.365676 | +$355.77 |
| SAUCE | 1,083.440002 | +$14.91 | 1,082.921239 | +$14.92 |
| WHBAR | 929,106.158781 | +$65,037.52 | 936,836.010276 | +$65,578.51 |
| DOVU | 115.447551 | +$0.16 | 115.245514 | +$0.13 |
| HST | 37.933586 | +$0.04 | 16.751578 | +$0.02 |
| PACK | 0.04253 | +$0 | 0.032107 | +$0 |
| STEAM | 46.5 | +$0.1 | 24.27 | +$0.05 |
| GRELF | 0.797412 | +$0.08 | 0.797333 | +$0.06 |
| KBL | 24.548951 | +$0.01 | 24.522661 | +$0.02 |
| BONZO | 2,206.506151 | +$24.32 | 2,206.493072 | +$24.26 |
| WETH | 0.586881 | +$1,050.53 | 0.589219 | +$1,054.7 |

### Largest borrowed-value increases

| Hedera account | EVM address | Supplied USD change | Borrowed USD change |
|---|---|---:|---:|
| 0.0.10633526 | `0x9a4966152f6e10b33cb7a37975e8619816d6a494` | +$0 | +$101,218.08 |
| 0.0.7951 | `0x0000000000000000000000000000000000001f0f` | +$0.2 | +$9,062.37 |
| 0.0.683607 | `0x00000000000000000000000000000000000a6e57` | +$0.44 | +$1,818.76 |
| 0.0.834592 | `0x00000000000000000000000000000000000cbc20` | +$258.19 | +$1,580.23 |
| 0.0.445590 | `0x000000000000000000000000000000000006cc96` | +$30 | +$1,201.35 |
| 0.0.10052868 | `0x0441bb99299a6065e2c57cfc133e4e186734c8d8` | +$3,853.89 | +$1,134.24 |
| 0.0.1314568 | `0x0000000000000000000000000000000000140f08` | +$9.35 | +$1,045.06 |
| 0.0.880302 | `0x00000000000000000000000000000000000d6eae` | +$91.76 | +$814.75 |
| 0.0.10248067 | `0x00000000000000000000000000000000009c5f83` | +$3,601.45 | +$768.96 |
| 0.0.868412 | `0x00000000000000000000000000000000000d403c` | +$2,588.17 | +$744.16 |

### Largest supplied-value increases

| Hedera account | EVM address | Supplied USD change | Borrowed USD change |
|---|---|---:|---:|
| 0.0.9125858 | `0x242cabc5000d887c45dbb9802581d8f5784eb9b8` | +$57,925.22 | +$0 |
| 0.0.6145236 | `0x00000000000000000000000000000000005dc4d4` | +$17,997.77 | +$0 |
| 0.0.10052868 | `0x0441bb99299a6065e2c57cfc133e4e186734c8d8` | +$3,853.89 | +$1,134.24 |
| 0.0.10248067 | `0x00000000000000000000000000000000009c5f83` | +$3,601.45 | +$768.96 |
| 0.0.2959345 | `0x00000000000000000000000000000000002d27f1` | +$2,667.21 | +$583.19 |
| 0.0.868412 | `0x00000000000000000000000000000000000d403c` | +$2,588.17 | +$744.16 |
| 0.0.1321 | `0x0000000000000000000000000000000000000529` | +$2,446.47 | +$633.79 |
| 0.0.10053078 | `0xf234e6fc3bbd459523d490769d629c71edd376a4` | +$2,374.86 | +$734.34 |
| 0.0.9597424 | `0x00000000000000000000000000000000009271f0` | +$2,197.63 | +$0 |
| 0.0.10052136 | `0xe697b3898367ced7b379ce8b690bf2e80a100afe` | +$1,203.14 | +$189.69 |

## Incident wallets

### Wallet A: 0.0.10633526

| Snapshot | Hedera account | Supplied USD | Borrowed USD | Supplied HBAR | Borrowed HBAR |
|---|---|---:|---:|---:|---:|
| Before exploit |  | $0 | $0 | 0 HBAR | 0 HBAR |
| After pause | 0.0.10633526 | $3.44 | $9,051,570.75 | 49.17 HBAR | 129,308,153.57 HBAR |
| After interest-rate changes | 0.0.10633526 | $3.44 | $9,152,788.83 | 49.17 HBAR | 130,754,126.17 HBAR |

| Asset | Before supplied | Before borrowed | After-pause supplied | After-pause borrowed | After-rates supplied | After-rates borrowed |
|---|---:|---:|---:|---:|---:|---:|
| USDC | 0 | 0 | 0 | 6,634,931.853419 | 0 | 6,688,793.639345 |
| SAUCE | 0 | 0 | 250.000192 | 0 | 250.020274 | 0 |
| WHBAR | 0 | 0 | 0 | 34,523,412.807787 | 0 | 35,199,931.325153 |

### Wallet B: 0.0.683607

Wallet B is shown separately because it contacted the team as a white-hat responder. Its positions should not be combined with Wallet A without return and reconciliation evidence.

| Snapshot | Hedera account | Supplied USD | Borrowed USD | Supplied HBAR | Borrowed HBAR |
|---|---|---:|---:|---:|---:|
| Before exploit | 0.0.683607 | $48,247.04 | $28,983.8 | 689,243.59 HBAR | 414,054.32 HBAR |
| After pause | 0.0.683607 | $409.74 | $1,010,476.12 | 5,853.48 HBAR | 14,435,373.21 HBAR |
| After interest-rate changes | 0.0.683607 | $410.18 | $1,012,294.88 | 5,859.79 HBAR | 14,461,355.43 HBAR |

| Asset | Before supplied | Before borrowed | After-pause supplied | After-pause borrowed | After-rates supplied | After-rates borrowed |
|---|---:|---:|---:|---:|---:|---:|
| XSAUCE | 220,133.709223 | 0 | 20,133.711865 | 3,500,001.791178 | 20,135.519282 | 3,501,413.236708 |
| USDC | 54.083831 | 0 | 54.086693 | 0 | 54.464939 | 0 |
| HBARX | 429,941.590311 | 0 | 0.000944 | 8,425,080.140161 | 0.000945 | 8,428,434.681768 |
| SAUCE | 0 | 100,064.229993 | 98.086264 | 0 | 98.094143 | 0 |
| WHBAR | 0 | 394,372.480319 | 0 | 394,430.166703 | 0 | 402,159.3942 |
| GRELF | 10,063.146787 | 0 | 63.146834 | 0 | 63.146869 | 0 |
| BONZO | 120,301.098025 | 0 | 306.969511 | 2,000,002.000504 | 307.010946 | 2,001,276.572541 |
| WETH | 0.362115 | 0 | 0.002119 | 47.00178 | 0.002137 | 47.512565 |

## Interpretation limits

- Supplied positions and outstanding debt are accounting positions. Outstanding debt is not cash available for supplier withdrawals.
- Values use the same fixed investigation prices across all three snapshots so the abnormal incident oracle observation cannot distort comparisons.
- Rounding occurs in the source CSVs: USD values are cents and HBAR values use up to eight decimals. Totals in this report sum those displayed cells exactly.
- Account-level changes identify where positions moved. They do not establish transaction intent, actor identity, recoverability, or causation by themselves.
