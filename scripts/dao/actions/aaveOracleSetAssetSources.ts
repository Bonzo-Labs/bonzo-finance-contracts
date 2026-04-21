import type { ActionModule } from '../types';
import { IAaveOracle } from './_interfaces';
import { assertAddress, getAaveOracle, makeAction } from './_helpers';

export interface AaveOracleSetAssetSourcesArgs {
  assets: string[];
  sources: string[];
}

const MODULE: ActionModule<AaveOracleSetAssetSourcesArgs> = {
  kind: 'aaveOracleSetAssetSources',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    if (args.assets.length !== args.sources.length) {
      throw new Error(
        `aaveOracleSetAssetSources: assets.length (${args.assets.length}) !== sources.length (${args.sources.length})`
      );
    }
    if (args.assets.length === 0) {
      throw new Error('aaveOracleSetAssetSources: assets must be non-empty');
    }
    const assets = args.assets.map((a) => assertAddress('asset', a));
    const sources = args.sources.map((s) => assertAddress('source', s));
    const data = IAaveOracle.encodeFunctionData('setAssetSources', [assets, sources]);
    return makeAction(
      'aaveOracleSetAssetSources',
      ctx.addresses.aaveOracle,
      data,
      `AaveOracle.setAssetSources(${assets.length} assets)`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const oracle = getAaveOracle(provider, ctx);
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    for (let i = 0; i < args.assets.length; i++) {
      const a = assertAddress('asset', args.assets[i]);
      try {
        before[a] = await oracle.getSourceOfAsset(a);
      } catch {
        before[a] = '(unreadable)';
      }
      after[a] = assertAddress('source', args.sources[i]);
    }
    return { before, after };
  },
  async verify(provider, args, ctx) {
    const oracle = getAaveOracle(provider, ctx);
    for (let i = 0; i < args.assets.length; i++) {
      const got = await oracle.getSourceOfAsset(assertAddress('asset', args.assets[i]));
      if (got.toLowerCase() !== assertAddress('source', args.sources[i]).toLowerCase()) return false;
    }
    return true;
  },
};
export default MODULE;
