/**
 * Calls `sweepToTreasury(address[])` on an aToken. Whether Bonzo's deployed
 * aToken implementation exposes this function is not guaranteed — §8.1 of the
 * execution-layer TODO marks this as `[!]` pending a check against
 * `contracts/protocol/tokenization/AToken.sol`. The calldata encoder here is
 * provided so a bundle can be authored once the capability is confirmed. If it
 * turns out to be unavailable, delete this module and the registry entry.
 */
import type { ActionModule } from '../types';
import { IAToken } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface ATokenSweepToTreasuryArgs {
  aToken: string;
  tokens: string[];
}

const MODULE: ActionModule<ATokenSweepToTreasuryArgs> = {
  kind: 'aTokenSweepToTreasury',
  defaultTargetSafe: 'executor',
  build(args) {
    const aToken = assertAddress('aToken', args.aToken);
    const tokens = args.tokens.map((t) => assertAddress('token', t));
    const data = IAToken.encodeFunctionData('sweepToTreasury', [tokens]);
    return makeAction(
      'aTokenSweepToTreasury',
      aToken,
      data,
      `aToken(${aToken}).sweepToTreasury([${tokens.length} tokens])`,
      [],
      'executor'
    );
  },
  async preview() {
    return { before: {}, after: {} };
  },
  async verify() {
    return true;
  },
};
export default MODULE;
