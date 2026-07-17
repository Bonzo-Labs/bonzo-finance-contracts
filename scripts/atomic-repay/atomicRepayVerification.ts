import fs from 'fs';
import path from 'path';
import { BytesLike, utils } from 'ethers';

export const SOURCE_NAME = 'scripts/atomic-repay/AtomicRepayHelper.sol';
export const CONTRACT_NAME = 'AtomicRepayHelper';
export const FQN = `${SOURCE_NAME}:${CONTRACT_NAME}`;

// Updated only after compiling and reviewing the exact source. Deployment
// refuses any creation bytecode that differs from this value.
export const REVIEWED_CREATION_BYTECODE_HASH =
  '0xc171571477d4f61ff1a218d59b317fe95d13e949e0a1cd2504333765d4200e85';

type ImmutableReference = { start: number; length: number };
type ImmutableReferences = Record<string, ImmutableReference[]>;

function normalize(bytecode: string) {
  if (!/^0x[0-9a-fA-F]*$/.test(bytecode) || bytecode.length % 2 !== 0) {
    throw new Error('Atomic repay helper bytecode is not valid hex.');
  }
  return bytecode.toLowerCase();
}

export function assertReviewedDeploymentPayload(initCode: BytesLike, creationBytecode: BytesLike) {
  const init = utils.hexlify(initCode).toLowerCase();
  const creation = utils.hexlify(creationBytecode).toLowerCase();
  const hash = utils.keccak256(creation);
  if (hash !== REVIEWED_CREATION_BYTECODE_HASH) {
    throw new Error(
      `Atomic repay helper creation bytecode changed (${hash} != ${REVIEWED_CREATION_BYTECODE_HASH}).`
    );
  }
  if (!init.startsWith(creation)) {
    throw new Error('Atomic repay helper deployment payload has an unexpected creation prefix.');
  }
}

function maskImmutables(bytecode: string, references: ImmutableReferences) {
  const data = normalize(bytecode).slice(2).split('');
  for (const slots of Object.values(references)) {
    for (const { start, length } of slots) {
      const from = start * 2;
      const to = (start + length) * 2;
      if (from < 0 || to > data.length) throw new Error('Immutable reference exceeds bytecode.');
      data.fill('0', from, to);
    }
  }
  return `0x${data.join('')}`;
}

export async function verifyAtomicRepayHelperRuntime(hre: any, deployedCode: string) {
  const artifact = await hre.artifacts.readArtifact(FQN);
  const buildInfo = await hre.artifacts.getBuildInfo(FQN);
  if (!buildInfo) throw new Error('Missing build information for AtomicRepayHelper.');

  const source = fs.readFileSync(path.join(__dirname, 'AtomicRepayHelper.sol'), 'utf8');
  if (buildInfo.input.sources?.[SOURCE_NAME]?.content !== source) {
    throw new Error('AtomicRepayHelper artifact is stale relative to its source.');
  }

  const compilerOutput = buildInfo.output.contracts?.[SOURCE_NAME]?.[CONTRACT_NAME];
  const references: ImmutableReferences | undefined =
    compilerOutput?.evm?.deployedBytecode?.immutableReferences;
  if (!references || Object.keys(references).length === 0) {
    throw new Error('Missing AtomicRepayHelper immutable-reference metadata.');
  }

  const localRuntime = normalize(artifact.deployedBytecode);
  const liveRuntime = normalize(deployedCode);
  if (localRuntime.length !== liveRuntime.length) {
    throw new Error('AtomicRepayHelper runtime length mismatch.');
  }

  const reviewedRuntimeTemplateHash = utils.keccak256(maskImmutables(localRuntime, references));
  const liveRuntimeTemplateHash = utils.keccak256(maskImmutables(liveRuntime, references));
  if (liveRuntimeTemplateHash !== reviewedRuntimeTemplateHash) {
    throw new Error('AtomicRepayHelper runtime does not match the reviewed artifact.');
  }

  return {
    runtimeBytecodeHash: utils.keccak256(liveRuntime),
    reviewedRuntimeTemplateHash,
    reviewedSourceHash: utils.keccak256(utils.toUtf8Bytes(source)),
  };
}
