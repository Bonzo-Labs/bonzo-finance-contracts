/**
 * Shared pre-encode logic used by encode.ts, submit.ts, simulate.ts, preflight.ts.
 *
 * Two invariants that must hold for every production path:
 *   1. action.kind's defaultTargetSafe must match bundle.targetSafe — otherwise
 *      the encoded transaction targets the wrong Safe and cannot execute.
 *   2. If a bundle action supplies a `target` override, it must be honored in
 *      the encoded action's `to` field. Dropping it silently would cause
 *      operators to review one address in JSON and execute another on-chain.
 */
import { utils } from 'ethers';
import type { Bundle, BuildContext, EncodedAction } from '../types';
import { getAction } from '../actions/_registry';

export const buildBundle = (bundle: Bundle, ctx: BuildContext): EncodedAction[] =>
  bundle.actions.map((a, i) => {
    const mod = getAction(a.kind);
    if (bundle.targetSafe !== mod.defaultTargetSafe) {
      throw new Error(
        `bundle.targetSafe=${bundle.targetSafe} but actions[${i}] kind=${a.kind} ` +
          `is a ${mod.defaultTargetSafe} action. Cross-safe routing would execute on ` +
          `the wrong Safe.`
      );
    }
    const enc = mod.build(a.args as any, ctx);
    if (a.target) {
      if (!utils.isAddress(a.target)) {
        throw new Error(`actions[${i}].target is not a valid address: ${a.target}`);
      }
      enc.to = utils.getAddress(a.target);
      enc.description = `${enc.description} [target overridden → ${enc.to}]`;
    }
    return enc;
  });
