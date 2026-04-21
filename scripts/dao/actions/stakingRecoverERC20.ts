/** STUB — see stakingSetRewardRate.ts. */
import type { ActionModule } from '../types';
import { IStakingModule } from './_interfaces';
import { assertAddress, assertUint, makeAction } from './_helpers';

export interface StakingRecoverERC20Args {
  stakingModule: string;
  token: string;
  amount: string | number;
}

const MODULE: ActionModule<StakingRecoverERC20Args> = {
  kind: 'stakingRecoverERC20',
  defaultTargetSafe: 'executor',
  build(args) {
    const target = assertAddress('stakingModule', args.stakingModule);
    const token = assertAddress('token', args.token);
    const amount = assertUint('amount', args.amount);
    const data = IStakingModule.encodeFunctionData('recoverERC20', [token, amount]);
    return makeAction(
      'stakingRecoverERC20',
      target,
      data,
      `Staking(${target}).recoverERC20(${token}, ${amount}) [STUB]`,
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
