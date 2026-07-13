import { expect } from 'chai';
import { recordRateUpdateStep } from '../scripts/lower-borrow-rates/rateUpdateState';
import {
  TARGET_BASE_VARIABLE_RATE_RAY,
  TARGET_MAX_VARIABLE_RATE_RAY,
  TARGET_VARIABLE_RATE_SLOPE_RAY,
} from '../scripts/lower-borrow-rates/rateTargets';

describe('lower-borrow-rates state replacement', () => {
  it('encodes the approved 0% + 0.005% + 0.005% curve exactly in ray', () => {
    expect(TARGET_BASE_VARIABLE_RATE_RAY).to.equal('0');
    expect(TARGET_VARIABLE_RATE_SLOPE_RAY).to.equal('50000000000000000000000');
    expect(TARGET_MAX_VARIABLE_RATE_RAY).to.equal('100000000000000000000000');
  });

  it('archives the previous deploy/wire pair and clears active wiring on redeploy', () => {
    const state: any = {
      reserves: {
        WHBAR: {
          deploy: { address: 'old-strategy', completed: true },
          wire: { toStrategy: 'old-strategy', completed: true },
        },
      },
    };

    recordRateUpdateStep(
      state,
      'WHBAR',
      'deploy',
      { address: 'new-strategy' },
      '2026-07-13T00:00:00.000Z'
    );

    expect(state.reserves.WHBAR.deploy).to.deep.equal({
      address: 'new-strategy',
      completed: true,
    });
    expect(state.reserves.WHBAR.wire).to.equal(undefined);
    expect(state.reserves.WHBAR.history).to.deep.equal([
      {
        archivedAt: '2026-07-13T00:00:00.000Z',
        deploy: { address: 'old-strategy', completed: true },
        wire: { toStrategy: 'old-strategy', completed: true },
      },
    ]);
  });

  it('writes a fresh active wire record after the replacement is wired', () => {
    const state: any = {
      reserves: { USDC: { deploy: { address: 'new-strategy', completed: true } } },
    };

    recordRateUpdateStep(state, 'USDC', 'wire', { toStrategy: 'new-strategy' });

    expect(state.reserves.USDC.wire).to.deep.equal({
      toStrategy: 'new-strategy',
      completed: true,
    });
  });
});
