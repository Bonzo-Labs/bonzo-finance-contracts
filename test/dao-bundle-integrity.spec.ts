/**
 * Regression tests for four functional bugs:
 *
 *   1. [P2] encode.ts dropped bundle action `target` overrides — now fixed in
 *      scripts/dao/lib/buildBundle.ts; encoded action's `to` must reflect the
 *      override.
 *   2. [P2] submit.ts lacked the cross-safe guard that encode.ts has — now
 *      both go through buildBundle which throws on cross-safe bundles.
 *   3. [P2] setPriceOracle.verify always returned true — now compares on-chain
 *      getPriceOracle() against the bundle's target address.
 *   (4. [P2] submit.ts silently claimed submission with SUBMIT=true — covered
 *       by behavior: script now throws instead of returning success. That path
 *       is integration-level and tested via the file contents in dao-submit-safety.)
 */
import { expect } from 'chai';
import { utils } from 'ethers';
import { buildBundle } from '../scripts/dao/lib/buildBundle';
import setPriceOracle from '../scripts/dao/actions/setPriceOracle';
import type { Bundle, BuildContext } from '../scripts/dao/types';

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

describe('buildBundle — target override honored', () => {
  it('uses the default target when action.target is absent', () => {
    const bundle: Bundle = {
      bipId: 'T',
      targetSafe: 'executor',
      actions: [
        {
          kind: 'setReserveFactor',
          args: { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1000 },
        },
      ],
    };
    const out = buildBundle(bundle, ctx);
    expect(out[0].to.toLowerCase()).to.equal(ctx.addresses.lendingPoolConfigurator.toLowerCase());
  });

  it('overrides `to` when action.target is set', () => {
    const override = '0x00000000000000000000000000000000000000ff';
    const bundle: Bundle = {
      bipId: 'T',
      targetSafe: 'executor',
      actions: [
        {
          kind: 'setReserveFactor',
          target: override,
          args: { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1000 },
        },
      ],
    };
    const out = buildBundle(bundle, ctx);
    expect(out[0].to).to.equal(utils.getAddress(override));
    expect(out[0].description).to.match(/target overridden/);
  });

  it('rejects an invalid target override', () => {
    const bundle: Bundle = {
      bipId: 'T',
      targetSafe: 'executor',
      actions: [
        {
          kind: 'setReserveFactor',
          target: 'not-an-address',
          args: { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1000 },
        },
      ],
    };
    expect(() => buildBundle(bundle, ctx)).to.throw(/not a valid address/);
  });
});

describe('buildBundle — cross-safe rejection', () => {
  it('rejects an executor bundle containing a guardian-only action', () => {
    const bundle: Bundle = {
      bipId: 'X',
      targetSafe: 'executor',
      actions: [{ kind: 'setPoolPause', args: { val: true } }],
    };
    expect(() => buildBundle(bundle, ctx)).to.throw(/Cross-safe routing/);
  });

  it('rejects a guardian bundle containing an executor-only action', () => {
    const bundle: Bundle = {
      bipId: 'X',
      targetSafe: 'guardian',
      actions: [
        {
          kind: 'setReserveFactor',
          args: { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1000 },
        },
      ],
    };
    expect(() => buildBundle(bundle, ctx)).to.throw(/Cross-safe routing/);
  });

  it('accepts a guardian bundle with only guardian actions', () => {
    const bundle: Bundle = {
      bipId: 'G',
      targetSafe: 'guardian',
      actions: [{ kind: 'setPoolPause', args: { val: true } }],
    };
    expect(() => buildBundle(bundle, ctx)).not.to.throw();
  });
});

// Mock provider that responds to getPriceOracle() calls on the AddressesProvider.
const makeProvider = (onChainOracle: string) =>
  ({
    call: async ({ to, data }: { to: string; data: string }) => {
      if (to.toLowerCase() !== ctx.addresses.lendingPoolAddressesProvider.toLowerCase()) {
        throw new Error(`unexpected call to ${to}`);
      }
      // 0x... selector-stripped data doesn't matter for the stub — we return
      // the ABI-encoded address for any read call hitting the provider.
      void data;
      return utils.defaultAbiCoder.encode(['address'], [onChainOracle]);
    },
    getNetwork: async () => ({ chainId: 296, name: 'hedera_testnet' }),
    _isProvider: true,
    resolveName: async (n: string) => n,
  } as any);

describe('setPriceOracle.verify — real on-chain comparison', () => {
  const target = '0x0000000000000000000000000000000000000001';

  it('returns true when getPriceOracle() matches args.priceOracle', async () => {
    const provider = makeProvider(target);
    const ok = await setPriceOracle.verify(provider, { priceOracle: target }, ctx);
    expect(ok).to.equal(true);
  });

  it('returns false when on-chain oracle differs', async () => {
    const other = '0x0000000000000000000000000000000000000002';
    const provider = makeProvider(other);
    const ok = await setPriceOracle.verify(provider, { priceOracle: target }, ctx);
    expect(ok).to.equal(false);
  });
});

describe('submit.ts behavior guarantees (static contract check)', () => {
  // The bug this guards: previous submit.ts with SUBMIT=true + service URL
  // logged "Submitting …" and exited 0 without sending anything. The current
  // implementation must *throw* in that configuration so the process exits
  // non-zero. We assert the file contains the guarding throw rather than
  // spawning a subprocess (which would need env + RPC plumbing).
  it('submit.ts throws when SUBMIT=true path is reached', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../scripts/dao/submit.ts'),
      'utf8'
    );
    expect(src).to.match(/Refusing to claim submission without actually submitting/);
    // And uses buildBundle for cross-safe enforcement.
    expect(src).to.match(/buildBundle\(bundle/);
  });
});
