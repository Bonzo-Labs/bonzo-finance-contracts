/**
 * STUB — staking admin address pending §0.2 discovery. Calldata is encoded
 * against the staking module's assumed interface, but the `target` must be
 * supplied explicitly by the bundle author until the module is wired into
 * `ctx.addresses`.
 */
import type { ActionModule } from '../types';
import { IStakingModule } from './_interfaces';
import { assertAddress, assertUint, makeAction } from './_helpers';

export interface StakingSetRewardRateArgs {
  stakingModule: string;
  rate: string | number;
}

const MODULE: ActionModule<StakingSetRewardRateArgs> = {
  kind: 'stakingSetRewardRate',
  defaultTargetSafe: 'executor',
  build(args) {
    const target = assertAddress('stakingModule', args.stakingModule);
    const rate = assertUint('rate', args.rate);
    const data = IStakingModule.encodeFunctionData('setRewardRate', [rate]);
    return makeAction(
      'stakingSetRewardRate',
      target,
      data,
      `Staking(${target}).setRewardRate(${rate}) [STUB]`,
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
