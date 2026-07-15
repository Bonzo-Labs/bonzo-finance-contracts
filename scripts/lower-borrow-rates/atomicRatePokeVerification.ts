import fs from 'fs';
import path from 'path';
import { BytesLike, utils } from 'ethers';

export const EXECUTOR_SOURCE_NAME = 'scripts/lower-borrow-rates/AtomicRatePokeExecutor.sol';
export const EXECUTOR_CONTRACT_NAME = 'AtomicRatePokeExecutor';
export const EXECUTOR_FQN = `${EXECUTOR_SOURCE_NAME}:${EXECUTOR_CONTRACT_NAME}`;
export const REVIEWED_EXECUTOR_CREATION_BYTECODE_HASH =
  '0x6c67b788f05838b3e3d29e7fba3863a69ed0619f0af357daf2f9e4bf3ab6f908';

type ImmutableReference = { start: number; length: number };
type ImmutableReferences = Record<string, ImmutableReference[]>;
type VerificationOptions = { log?: (message: string) => void };

function normalizeBytecode(bytecode: string) {
  if (!/^0x[0-9a-fA-F]*$/.test(bytecode) || bytecode.length % 2 !== 0) {
    throw new Error('Executor bytecode is not valid hex.');
  }
  return bytecode.toLowerCase();
}

export function assertReviewedExecutorDeploymentPayload(
  initCode: BytesLike,
  creationBytecode: BytesLike
) {
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

export async function assertReviewedExecutorRuntime(
  hre: any,
  deployedCode: string,
  options: VerificationOptions = {}
) {
  const log = options.log || (() => undefined);
  log('Loading the reviewed executor artifact and compiler build information.');
  const artifact = await hre.artifacts.readArtifact(EXECUTOR_FQN);
  const buildInfo = await hre.artifacts.getBuildInfo(EXECUTOR_FQN);
  if (!buildInfo) throw new Error('Missing build information for AtomicRatePokeExecutor.');

  log('Checking that the compiled artifact matches the current Solidity source.');
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
  const immutableSlots = Object.values(immutableReferences).reduce(
    (total, references) => total + references.length,
    0
  );
  log(`Loaded ${immutableSlots} immutable bytecode reference(s).`);

  const localRuntime = normalizeBytecode(artifact.deployedBytecode);
  const liveRuntime = normalizeBytecode(deployedCode);
  log(
    `Comparing live runtime (${
      (liveRuntime.length - 2) / 2
    } bytes) with the reviewed runtime template.`
  );
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

  const runtimeBytecodeHash = utils.keccak256(liveRuntime);
  const reviewedSourceHash = utils.keccak256(utils.toUtf8Bytes(currentSource));
  log(`Runtime bytecode hash: ${runtimeBytecodeHash}`);
  log(`Reviewed runtime template hash: ${reviewedRuntimeTemplateHash}`);
  log(`Reviewed source hash: ${reviewedSourceHash}`);

  return {
    runtimeBytecodeHash,
    reviewedRuntimeTemplateHash,
    reviewedSourceHash,
  };
}

async function runStandaloneVerification() {
  const hre = require('hardhat');
  const { EXECUTOR_STATE_PATH, MAINNET_CHAIN_ID } = require('./rateConfig');
  const { readJson } = require('./scriptUtils');

  console.log('AtomicRatePokeExecutor standalone verification');
  console.log(`State file: ${EXECUTOR_STATE_PATH}`);
  if (!fs.existsSync(EXECUTOR_STATE_PATH)) {
    throw new Error(`Executor state file does not exist: ${EXECUTOR_STATE_PATH}`);
  }

  const state = readJson(EXECUTOR_STATE_PATH);
  if (!state?.executor) throw new Error('Executor state file has no executor address.');

  const network = await hre.ethers.provider.getNetwork();
  console.log(`Network: ${hre.network.name} (chain ID ${network.chainId})`);
  if (network.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(
      `Expected Hedera mainnet chain ID ${MAINNET_CHAIN_ID}, got ${network.chainId}.`
    );
  }
  if (state.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(`State file chain ID ${state.chainId} does not match ${MAINNET_CHAIN_ID}.`);
  }

  console.log(`Executor: ${state.executor}`);
  console.log(`Deployment transaction: ${state.deploymentTxHash || 'not recorded'}`);
  console.log(`State validation flag: ${state.validated === true ? 'true' : 'false/incomplete'}`);
  console.log('Reading deployed runtime bytecode.');
  const deployedCode = await hre.ethers.provider.getCode(state.executor);
  if (deployedCode === '0x') throw new Error('Executor has no deployed runtime bytecode.');

  const verified = await assertReviewedExecutorRuntime(hre, deployedCode, {
    log: (message) => console.log(`  ${message}`),
  });

  for (const key of [
    'runtimeBytecodeHash',
    'reviewedRuntimeTemplateHash',
    'reviewedSourceHash',
  ] as const) {
    if (state[key] && state[key] !== verified[key]) {
      throw new Error(`Recorded ${key} ${state[key]} does not match live ${verified[key]}.`);
    }
    console.log(
      state[key]
        ? `Recorded ${key} matches.`
        : `Recorded ${key} is absent because deployment state is not finalized.`
    );
  }

  console.log('Runtime verification PASSED.');
  if (state.validated !== true) {
    console.log(
      'Deployment state is incomplete. The deploy script will archive this attempt and deploy a fresh executor; it never resumes an existing address.'
    );
  }
}

if (require.main === module) {
  runStandaloneVerification().catch((error: any) => {
    const { conciseRpcError } = require('./scriptUtils');
    console.error(`Verification FAILED: ${conciseRpcError(error)}`);
    process.exit(1);
  });
}
