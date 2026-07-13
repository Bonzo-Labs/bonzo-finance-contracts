import { BigNumber, BytesLike, utils } from 'ethers';

// Hashio mainnet estimated this exact reviewed creation payload at 3,708,192
// gas on 13 July 2026. The hash includes the compiled creation bytecode and all
// eight constructor arguments. This calibration is only a final fallback when
// public Hashio estimation is unavailable.
export const REVIEWED_EXECUTOR_INIT_CODE_HASH =
  '0x954b268f0d4085c9ca0cdf8b0be1815106930a30a28ff9a5bf052b9ee2924d50';
export const REVIEWED_EXECUTOR_DEPLOYMENT_GAS_ESTIMATE = BigNumber.from('3708192');

export function reviewedExecutorDeploymentGasEstimate(initCode: BytesLike): BigNumber {
  const initCodeHash = utils.keccak256(initCode);
  if (initCodeHash !== REVIEWED_EXECUTOR_INIT_CODE_HASH) {
    throw new Error(
      `Executor creation payload changed (${initCodeHash} != ${REVIEWED_EXECUTOR_INIT_CODE_HASH}). ` +
        'Refusing the reviewed deployment-gas calibration.'
    );
  }
  return REVIEWED_EXECUTOR_DEPLOYMENT_GAS_ESTIMATE;
}
