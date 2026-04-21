/**
 * Phase A §11.4 — preflight logic unit test with mocked provider/Safe.
 *
 * preflight.ts is a script, so we mirror its core checks here against mocked
 * Contract instances to exercise the decision logic without touching a live RPC.
 */
import { expect } from 'chai';
import { REGISTRY } from '../scripts/dao/actions/_registry';
import type { BuildContext, Bundle } from '../scripts/dao/types';

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
    executorSafe: '0xE000000000000000000000000000000000000008',
    guardianSafe: '0xG000000000000000000000000000000000000009'.replace(/G/g, 'A'),
    multiSendCallOnly: '0x100000000000000000000000000000000000000A',
  },
};

const runPreflight = (bundle: Bundle, onChain: { poolAdmin: string; emergencyAdmin: string }) => {
  const errors: string[] = [];

  const safeAddr =
    bundle.targetSafe === 'executor' ? ctx.addresses.executorSafe : ctx.addresses.guardianSafe;
  if (!safeAddr) errors.push(`no ${bundle.targetSafe} Safe set`);

  if (
    bundle.targetSafe === 'executor' &&
    onChain.poolAdmin.toLowerCase() !== safeAddr.toLowerCase()
  ) {
    errors.push(`poolAdmin (${onChain.poolAdmin}) != executorSafe (${safeAddr})`);
  }
  if (
    bundle.targetSafe === 'guardian' &&
    onChain.emergencyAdmin.toLowerCase() !== safeAddr.toLowerCase()
  ) {
    errors.push(`emergencyAdmin (${onChain.emergencyAdmin}) != guardianSafe (${safeAddr})`);
  }

  for (const a of bundle.actions) {
    const mod = REGISTRY[a.kind];
    const enc = mod.build(a.args as any, ctx);
    if (enc.targetSafe !== bundle.targetSafe) {
      errors.push(`action ${a.kind} (${enc.targetSafe}) != bundle.targetSafe (${bundle.targetSafe})`);
    }
  }
  return errors;
};

describe('DAO preflight — decision logic', () => {
  const exec = ctx.addresses.executorSafe;
  const guard = ctx.addresses.guardianSafe;

  it('passes when poolAdmin matches executor Safe and actions are executor kind', () => {
    const bundle: Bundle = {
      bipId: 'T1',
      targetSafe: 'executor',
      actions: [
        { kind: 'setReserveFactor', args: { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1000 } },
      ],
    };
    const errors = runPreflight(bundle, { poolAdmin: exec, emergencyAdmin: guard });
    expect(errors).to.deep.equal([]);
  });

  it('fails when poolAdmin does not match executor Safe', () => {
    const bundle: Bundle = {
      bipId: 'T2',
      targetSafe: 'executor',
      actions: [
        { kind: 'setReserveFactor', args: { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1000 } },
      ],
    };
    const wrongAdmin = '0x0000000000000000000000000000000000000099';
    const errors = runPreflight(bundle, { poolAdmin: wrongAdmin, emergencyAdmin: guard });
    expect(errors.some((e) => e.includes('poolAdmin'))).to.equal(true);
  });

  it('fails on guardian bundle carrying an executor-kind action', () => {
    const bundle: Bundle = {
      bipId: 'T3',
      targetSafe: 'guardian',
      actions: [
        { kind: 'setReserveFactor', args: { asset: '0x0000000000000000000000000000000000001549', reserveFactor: 1000 } },
      ],
    };
    const errors = runPreflight(bundle, { poolAdmin: exec, emergencyAdmin: guard });
    expect(errors.some((e) => e.includes('bundle.targetSafe'))).to.equal(true);
  });
});
