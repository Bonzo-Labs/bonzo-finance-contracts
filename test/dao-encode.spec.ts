/**
 * Phase A §11.5 — encode determinism.
 * For each bundle fixture, build the encoded actions from the registry and
 * snapshot the calldata. Two builds of the same bundle must produce byte-for-byte
 * identical outputs.
 */
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { loadBundle } from '../scripts/dao/schema/validate';
import { REGISTRY } from '../scripts/dao/actions/_registry';
import type { BuildContext } from '../scripts/dao/types';

const bundlesDir = path.resolve(__dirname, '../scripts/dao/fixtures/bundles');

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

const listJson = (dir: string): string[] =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));

const encodeBundle = (bundle: any): string[] =>
  bundle.actions.map((a: any) => REGISTRY[a.kind as keyof typeof REGISTRY].build(a.args, ctx).data);

describe('DAO encode — deterministic output', () => {
  for (const file of listJson(bundlesDir)) {
    it(`encodes ${path.basename(file)} deterministically`, () => {
      const bundle = loadBundle(file);
      const first = encodeBundle(bundle);
      const second = encodeBundle(bundle);
      expect(first).to.deep.equal(second);
      expect(first.length).to.equal(bundle.actions.length);
      for (const d of first) expect(d).to.match(/^0x[a-fA-F0-9]+$/);
    });
  }
});
