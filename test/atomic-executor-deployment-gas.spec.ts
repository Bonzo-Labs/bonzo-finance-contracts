import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  REVIEWED_EXECUTOR_DEPLOYMENT_GAS_ESTIMATE,
  REVIEWED_EXECUTOR_INIT_CODE_HASH,
  reviewedExecutorDeploymentGasEstimate,
} from '../scripts/lower-borrow-rates/atomicExecutorDeploymentGas';

describe('AtomicRatePokeExecutor deployment gas calibration', () => {
  it('accepts only the reviewed mainnet creation payload', async () => {
    const factory = await ethers.getContractFactory('AtomicRatePokeExecutor');
    const deployment = factory.getDeployTransaction(
      '0x76b846DAB3646527bfb75952E1f33AfAA72B56D1',
      '0x9763ABB52aa18624E22557be68930534D513a079',
      '0x0000000000000000000000000000000000163b5a',
      '0x000000000000000000000000000000000006f89a',
      '0xca367694cdac8f152e33683bb36cc9d6a73f1ef2',
      '0x0000000000000000000000000000000000a2551a',
      '0x0000000000000000000000000000000000a2551e',
      '0x0000000000000000000000000000000000a2557a'
    );
    expect(deployment.data).to.not.equal(undefined);
    expect(ethers.utils.keccak256(deployment.data!)).to.equal(REVIEWED_EXECUTOR_INIT_CODE_HASH);
    expect(reviewedExecutorDeploymentGasEstimate(deployment.data!).eq(3708192)).to.equal(true);
    expect(REVIEWED_EXECUTOR_DEPLOYMENT_GAS_ESTIMATE.eq(3708192)).to.equal(true);
  });

  it('rejects a changed creation payload', () => {
    expect(() => reviewedExecutorDeploymentGasEstimate('0x00')).to.throw(
      'Executor creation payload changed'
    );
  });
});
