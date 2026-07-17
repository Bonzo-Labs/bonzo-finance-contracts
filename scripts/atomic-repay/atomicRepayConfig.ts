import path from 'path';

const deployment = require('../outputReserveData.json');

export const MAINNET_CHAIN_ID = 295;

// The debt target is fixed for this deployment. Whitelisted callers may fund
// repayments, but every repayment reduces only this borrower's variable debt.
export const BORROWER = '0x00000000000000000000000000000000000A6E57';

export const PROTOCOL_ADDRESSES = {
  provider: deployment.LendingPoolAddressesProvider.hedera_mainnet.address,
  pool: deployment.LendingPool.hedera_mainnet.address,
  configurator: deployment.LendingPoolConfigurator.hedera_mainnet.address,
  dataProvider: deployment.AaveProtocolDataProvider.hedera_mainnet.address,
};

export type SettlementSymbol = 'BONZO' | 'HBARX' | 'WETH' | 'WHBAR' | 'XSAUCE';

export const SETTLEMENT_SYMBOLS: SettlementSymbol[] = ['BONZO', 'HBARX', 'WETH', 'WHBAR', 'XSAUCE'];

// These are the four HTS constants explicitly associated by the contract.
// The deploy script uses this list only to verify the hardcoded on-chain order.
// WETH is an ERC-20 contract and is deliberately omitted.
export const HTS_SETTLEMENT_SYMBOLS: SettlementSymbol[] = ['BONZO', 'HBARX', 'WHBAR', 'XSAUCE'];

export const ASSET_BY_SYMBOL: Record<SettlementSymbol, string> = Object.fromEntries(
  SETTLEMENT_SYMBOLS.map((symbol) => [symbol, deployment[symbol].hedera_mainnet.token.address])
) as Record<SettlementSymbol, string>;

export const VARIABLE_DEBT_BY_SYMBOL: Record<SettlementSymbol, string> = Object.fromEntries(
  SETTLEMENT_SYMBOLS.map((symbol) => [
    symbol,
    deployment[symbol].hedera_mainnet.variableDebt.address,
  ])
) as Record<SettlementSymbol, string>;

// The deploy script always whitelists BORROWER and the live AddressesProvider
// owner/controller. Add any separately approved company test wallet here before
// deployment. The resulting on-chain array cannot be changed after deployment.
export const ADDITIONAL_AUTHORIZED_CALLERS: string[] = [
  '0x12Ab96bEBf0bc4fe1A8f62049c7d840ac949CaB6',
];

export const STATE_PATH = path.join(__dirname, 'atomic-repay-state.json');
