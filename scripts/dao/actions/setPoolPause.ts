/**
 * Guardian-only action. The registry and preflight both assert `targetSafe === 'guardian'`
 * before this module is routed into a bundle.
 */
import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { getLendingPool, makeAction } from './_helpers';

export interface SetPoolPauseArgs {
  val: boolean;
}

const MODULE: ActionModule<SetPoolPauseArgs> = {
  kind: 'setPoolPause',
  defaultTargetSafe: 'guardian',
  build(args, ctx) {
    const val = Boolean(args.val);
    const data = ILendingPoolConfigurator.encodeFunctionData('setPoolPause', [val]);
    return makeAction(
      'setPoolPause',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setPoolPause(${val})`,
      [],
      'guardian'
    );
  },
  async preview(provider, args, ctx) {
    const lp = getLendingPool(provider, ctx);
    let before = '(unreadable)';
    try {
      before = String(await lp.paused());
    } catch {}
    return { before: { paused: before }, after: { paused: String(Boolean(args.val)) } };
  },
  async verify(provider, args, ctx) {
    const lp = getLendingPool(provider, ctx);
    const paused = await lp.paused();
    return Boolean(paused) === Boolean(args.val);
  },
};
export default MODULE;
