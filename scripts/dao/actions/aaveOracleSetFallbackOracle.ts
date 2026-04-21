import type { ActionModule } from '../types';
import { IAaveOracle } from './_interfaces';
import { assertAddress, getAaveOracle, makeAction } from './_helpers';

export interface AaveOracleSetFallbackOracleArgs {
  fallbackOracle: string;
}

const MODULE: ActionModule<AaveOracleSetFallbackOracleArgs> = {
  kind: 'aaveOracleSetFallbackOracle',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const fb = assertAddress('fallbackOracle', args.fallbackOracle);
    const data = IAaveOracle.encodeFunctionData('setFallbackOracle', [fb]);
    return makeAction(
      'aaveOracleSetFallbackOracle',
      ctx.addresses.aaveOracle,
      data,
      `AaveOracle.setFallbackOracle(${fb})`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const oracle = getAaveOracle(provider, ctx);
    let before = '(unreadable)';
    try {
      before = await oracle.getFallbackOracle();
    } catch {}
    return { before: { fallbackOracle: before }, after: { fallbackOracle: args.fallbackOracle } };
  },
  async verify(provider, args, ctx) {
    const oracle = getAaveOracle(provider, ctx);
    return (
      (await oracle.getFallbackOracle()).toLowerCase() ===
      assertAddress('fallbackOracle', args.fallbackOracle).toLowerCase()
    );
  },
};
export default MODULE;
