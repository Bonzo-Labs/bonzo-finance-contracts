import fs from 'fs';
import path from 'path';
import { BigNumber, BytesLike, utils } from 'ethers';

export const EXECUTOR_SOURCE_NAME = 'scripts/lower-borrow-rates/AtomicRatePokeExecutor.sol';
export const EXECUTOR_CONTRACT_NAME = 'AtomicRatePokeExecutor';
export const EXECUTOR_FQN = `${EXECUTOR_SOURCE_NAME}:${EXECUTOR_CONTRACT_NAME}`;
export const REVIEWED_EXECUTOR_CREATION_BYTECODE_HASH =
  '0x781b462bdd1958d56ae4f62a65e3756087e25d83ec19ec2d08bee9345e2f4ae2';
export const REVIEWED_EXECUTOR_DEPLOYMENT_GAS_ESTIMATE = BigNumber.from('5428786');

type ImmutableReference = { start: number; length: number };
type ImmutableReferences = Record<string, ImmutableReference[]>;

function normalizeBytecode(bytecode: string) {
  if (!/^0x[0-9a-fA-F]*$/.test(bytecode) || bytecode.length % 2 !== 0) {
    throw new Error('Executor bytecode is not valid hex.');
  }
  return bytecode.toLowerCase();
}

export function reviewedExecutorDeploymentGasEstimate(
  initCode: BytesLike,
  creationBytecode: BytesLike
): BigNumber {
  const initCodeHex = utils.hexlify(initCode).toLowerCase();
  const creationBytecodeHex = utils.hexlify(creationBytecode).toLowerCase();
  const creationBytecodeHash = utils.keccak256(creationBytecodeHex);
  if (creationBytecodeHash !== REVIEWED_EXECUTOR_CREATION_BYTECODE_HASH) {
    throw new Error(
      `Executor creation bytecode changed (${creationBytecodeHash} != ` +
        `${REVIEWED_EXECUTOR_CREATION_BYTECODE_HASH}). Refusing deployment.`
    );
  }
  if (!initCodeHex.startsWith(creationBytecodeHex)) {
    throw new Error(
      'Executor deployment payload does not start with the reviewed creation bytecode.'
    );
  }
  return REVIEWED_EXECUTOR_DEPLOYMENT_GAS_ESTIMATE;
}

export function maskImmutableReferences(
  bytecode: string,
  immutableReferences: ImmutableReferences
) {
  const normalized = normalizeBytecode(bytecode);
  const data = normalized.slice(2).split('');

  for (const references of Object.values(immutableReferences)) {
    for (const { start, length } of references) {
      const from = start * 2;
      const to = (start + length) * 2;
      if (from < 0 || to > data.length) {
        throw new Error(`Immutable reference ${start}:${length} exceeds runtime bytecode.`);
      }
      data.fill('0', from, to);
    }
  }

  return `0x${data.join('')}`;
}

export async function assertReviewedExecutorRuntime(hre: any, deployedCode: string) {
  const artifact = await hre.artifacts.readArtifact(EXECUTOR_FQN);
  const buildInfo = await hre.artifacts.getBuildInfo(EXECUTOR_FQN);
  if (!buildInfo) throw new Error('Missing build information for AtomicRatePokeExecutor.');

  const buildSource = buildInfo.input.sources?.[EXECUTOR_SOURCE_NAME]?.content;
  const currentSource = fs.readFileSync(path.join(__dirname, 'AtomicRatePokeExecutor.sol'), 'utf8');
  if (!buildSource || buildSource !== currentSource) {
    throw new Error('AtomicRatePokeExecutor artifact is stale relative to the reviewed source.');
  }

  const compilerOutput =
    buildInfo.output.contracts?.[EXECUTOR_SOURCE_NAME]?.[EXECUTOR_CONTRACT_NAME];
  const immutableReferences: ImmutableReferences | undefined =
    compilerOutput?.evm?.deployedBytecode?.immutableReferences;
  if (!immutableReferences || Object.keys(immutableReferences).length === 0) {
    throw new Error('Missing immutable-reference metadata for AtomicRatePokeExecutor.');
  }

  const localRuntime = normalizeBytecode(artifact.deployedBytecode);
  const liveRuntime = normalizeBytecode(deployedCode);
  if (localRuntime.length !== liveRuntime.length) {
    throw new Error(
      `Executor runtime length mismatch: live ${liveRuntime.length} != reviewed ${localRuntime.length}`
    );
  }

  const reviewedRuntimeTemplateHash = utils.keccak256(
    maskImmutableReferences(localRuntime, immutableReferences)
  );
  const liveRuntimeTemplateHash = utils.keccak256(
    maskImmutableReferences(liveRuntime, immutableReferences)
  );
  if (liveRuntimeTemplateHash !== reviewedRuntimeTemplateHash) {
    throw new Error(
      `Executor runtime does not match the reviewed artifact: ${liveRuntimeTemplateHash} != ${reviewedRuntimeTemplateHash}`
    );
  }

  return {
    runtimeBytecodeHash: utils.keccak256(liveRuntime),
    reviewedRuntimeTemplateHash,
    reviewedSourceHash: utils.keccak256(utils.toUtf8Bytes(currentSource)),
  };
}
