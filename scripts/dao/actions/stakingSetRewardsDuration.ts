/** STUB — see stakingSetRewardRate.ts. */
import type { ActionModule } from '../types';
import { IStakingModule } from './_interfaces';
import { assertAddress, assertUint, makeAction } from './_helpers';

export interface StakingSetRewardsDurationArgs {
  stakingModule: string;
  duration: string | number;
}

const MODULE: ActionModule<StakingSetRewardsDurationArgs> = {
  kind: 'stakingSetRewardsDuration',
  defaultTargetSafe: 'executor',
  build(args) {
    const target = assertAddress('stakingModule', args.stakingModule);
    const duration = assertUint('duration', args.duration);
    const data = IStakingModule.encodeFunctionData('setRewardsDuration', [duration]);
    return makeAction(
      'stakingSetRewardsDuration',
      target,
      data,
      `Staking(${target}).setRewardsDuration(${duration}) [STUB]`,
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
