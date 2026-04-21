/**
 * Phase A §11.6 — verify() unit tests using AaveProtocolDataProvider mocks.
 */
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import setReserveFactor from '../scripts/dao/actions/setReserveFactor';
import setLtv from '../scripts/dao/actions/setLtv';
import setPoolPause from '../scripts/dao/actions/setPoolPause';
import type { BuildContext } from '../scripts/dao/types';

const ctx: BuildContext = {
  chain_type: 'hedera_testnet',
  addresses: {
    lendingPool: '0x1000000000000000000000000000000000000001',
    lendingPoolConfigurator: '0x1000000000000000000000000000000000000002',
    lendingPoolAddressesProvider: '0x1000000000000000000000000000000000000003',
    aaveProtocolDataProvider: '0x1000000000000000000000000000000000000004',
    aaveOracle: '0x1000000000000000000000000000000000000005',
    lendingRateOracle: '0x1000000000000000000000000000000000000006',
    lendingPoolCollateralManager: '0x1000000000000000000000000000000000000007',
    executorSafe: '0x1000000000000000000000000000000000000008',
    guardianSafe: '0x1000000000000000000000000000000000000009',
    multiSendCallOnly: '0x100000000000000000000000000000000000000A',
  },
};

const mockProvider = (handlers: Record<string, (data: string) => string>) =>
  ({
    call: async ({ to, data }: { to: string; data: string }) => {
      const handler = handlers[to.toLowerCase()];
      if (!handler) throw new Error(`unexpected call to ${to}`);
      return handler(data);
    },
    getNetwork: async () => ({ chainId: 296, name: 'hedera_testnet' }),
    _isProvider: true,
    resolveName: async (n: string) => n,
  } as any);

// Encode a mock getReserveConfigurationData return matching ILendingPool values
const encodeReserveConfig = (cfg: { ltv: number; reserveFactor: number }): string => {
  const { utils } = require('ethers');
  return utils.defaultAbiCoder.encode(
    ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bool', 'bool', 'bool', 'bool', 'bool'],
    [18, cfg.ltv, 7500, 10500, cfg.reserveFactor, true, true, false, true, false]
  );
};

describe('DAO verify() — mocked data provider', () => {
  it('setReserveFactor.verify returns true when on-chain value matches', async () => {
    const provider = mockProvider({
      [ctx.addresses.aaveProtocolDataProvider.toLowerCase()]: () =>
        encodeReserveConfig({ ltv: 7000, reserveFactor: 1100 }),
    });
    const ok = await setReserveFactor.verify(
      provider,
      { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1100 },
      ctx
    );
    expect(ok).to.equal(true);
  });

  it('setReserveFactor.verify returns false on mismatch', async () => {
    const provider = mockProvider({
      [ctx.addresses.aaveProtocolDataProvider.toLowerCase()]: () =>
        encodeReserveConfig({ ltv: 7000, reserveFactor: 900 }),
    });
    const ok = await setReserveFactor.verify(
      provider,
      { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1100 },
      ctx
    );
    expect(ok).to.equal(false);
  });

  it('setLtv.verify compares ltv only', async () => {
    const provider = mockProvider({
      [ctx.addresses.aaveProtocolDataProvider.toLowerCase()]: () =>
        encodeReserveConfig({ ltv: 6500, reserveFactor: 1000 }),
    });
    const ok = await setLtv.verify(
      provider,
      { asset: '0x0000000000000000000000000000000000001549', ltv: 6500 },
      ctx
    );
    expect(ok).to.equal(true);
  });

  it('setPoolPause.verify reads LendingPool.paused()', async () => {
    const { utils } = require('ethers');
    const provider = mockProvider({
      [ctx.addresses.lendingPool.toLowerCase()]: () =>
        utils.defaultAbiCoder.encode(['bool'], [true]),
    });
    const ok = await setPoolPause.verify(provider, { val: true }, ctx);
    expect(ok).to.equal(true);
    void BigNumber;
  });
});
