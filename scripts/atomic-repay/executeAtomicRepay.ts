/**
 * Staged atomic repayment operations.
 *
 * ATOMIC_REPAY_ACTION=status              read only (default)
 * ATOMIC_REPAY_ACTION=handoff             controller assigns emergency admin
 * ATOMIC_REPAY_ACTION=repay               authorised caller funds one repayment
 * ATOMIC_REPAY_ACTION=repay-from          controller submits after payer allowance
 * ATOMIC_REPAY_ACTION=repay-hbar          authorised caller repays WHBAR debt with native HBAR
 * ATOMIC_REPAY_ACTION=add-caller          controller adds another authorised payer
 * ATOMIC_REPAY_ACTION=pause-repayments    controller pauses helper repayments
 * ATOMIC_REPAY_ACTION=resume-repayments   controller resumes helper repayments
 * ATOMIC_REPAY_ACTION=pool-pause-only     controller restores LendingPool pause
 * ATOMIC_REPAY_ACTION=close-and-restore   controller closes and restores role
 * ATOMIC_REPAY_ACTION=sweep-after-close   controller recovers an accidental token
 * ATOMIC_REPAY_ACTION=sweep-hbar-after-close controller recovers accidental native HBAR
 *
 * Every write also requires CONFIRM_ATOMIC_REPAY_ACTION to equal the
 * uppercase action name. REPAY additionally requires REPAYMENT_SYMBOL and
 * REPAYMENT_AMOUNT in human token units.
 */
import fs from 'fs';
import { ethers } from 'hardhat';
const hre = require('hardhat');
import {
  MAINNET_CHAIN_ID,
  BORROWER,
  PROTOCOL_ADDRESSES,
  SETTLEMENT_SYMBOLS,
  STATE_PATH,
  SettlementSymbol,
} from './atomicRepayConfig';
import { verifyAtomicRepayHelperRuntime } from './atomicRepayVerification';
import { conciseRpcError, eqAddress, readJson, writeJson } from '../lower-borrow-rates/scriptUtils';

type Action =
  | 'status'
  | 'handoff'
  | 'repay'
  | 'repay-from'
  | 'repay-hbar'
  | 'add-caller'
  | 'pause-repayments'
  | 'resume-repayments'
  | 'pool-pause-only'
  | 'close-and-restore'
  | 'sweep-after-close'
  | 'sweep-hbar-after-close';
const ACTION = (process.env.ATOMIC_REPAY_ACTION || 'status') as Action;
const VALID_ACTIONS: Action[] = [
  'status',
  'handoff',
  'repay',
  'repay-from',
  'repay-hbar',
  'add-caller',
  'pause-repayments',
  'resume-repayments',
  'pool-pause-only',
  'close-and-restore',
  'sweep-after-close',
  'sweep-hbar-after-close',
];

function saveOperation(state: any, entry: Record<string, unknown>) {
  const operations = Array.isArray(state.operations) ? [...state.operations] : [];
  operations.push({ ...entry, recordedAt: new Date().toISOString() });
  writeJson(STATE_PATH, { ...state, operations });
}

async function loadAndVerify() {
  if (!VALID_ACTIONS.includes(ACTION)) throw new Error(`Unknown action: ${ACTION}`);
  if (!fs.existsSync(STATE_PATH)) throw new Error(`Missing deployment state: ${STATE_PATH}`);
  const state = readJson<any>(STATE_PATH);
  if (!state.validated || !state.helper) throw new Error('Helper deployment state is incomplete.');

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== MAINNET_CHAIN_ID || state.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(`Expected Hedera mainnet chain ID ${MAINNET_CHAIN_ID}.`);
  }

  const ap = await ethers.getContractAt(
    'LendingPoolAddressesProvider',
    PROTOCOL_ADDRESSES.provider
  );
  const pool = await ethers.getContractAt('LendingPool', PROTOCOL_ADDRESSES.pool);
  const configurator = await ethers.getContractAt(
    'LendingPoolConfigurator',
    PROTOCOL_ADDRESSES.configurator
  );
  const helper = await ethers.getContractAt('AtomicRepayHelper', state.helper);
  const code = await ethers.provider.getCode(state.helper);
  if (code === '0x') throw new Error('Helper has no runtime code.');
  const verified = await verifyAtomicRepayHelperRuntime(hre, code);
  for (const field of [
    'runtimeBytecodeHash',
    'reviewedRuntimeTemplateHash',
    'reviewedSourceHash',
  ]) {
    if (state[field] !== verified[field as keyof typeof verified]) {
      throw new Error(`Live helper ${field} differs from deployment state.`);
    }
  }

  const [livePool, liveConfigurator, controller, borrower] = await Promise.all([
    ap.getLendingPool(),
    ap.getLendingPoolConfigurator(),
    helper.CONTROLLER(),
    helper.BORROWER(),
  ]);
  if (!eqAddress(livePool, PROTOCOL_ADDRESSES.pool)) throw new Error('Pool changed.');
  if (!eqAddress(liveConfigurator, PROTOCOL_ADDRESSES.configurator)) {
    throw new Error('Configurator changed.');
  }
  if (!eqAddress(controller, state.controller) || !eqAddress(borrower, BORROWER)) {
    throw new Error('Helper controller or borrower immutable changed.');
  }
  if (!Array.isArray(state.authorizedCallers) || state.authorizedCallers.length === 0) {
    throw new Error('Deployment state has no authorised caller list.');
  }
  const callerCount = await helper.callerCount();
  if (!callerCount.eq(state.authorizedCallers.length)) {
    throw new Error(
      `Authorised caller state length ${state.authorizedCallers.length} differs from ` +
        `on-chain caller count ${callerCount.toString()}.`
    );
  }
  for (let i = 0; i < state.authorizedCallers.length; i++) {
    const [caller, allowed] = await Promise.all([
      helper.AUTHORIZED_CALLERS(i),
      helper.authorizedCaller(state.authorizedCallers[i]),
    ]);
    if (!eqAddress(caller, state.authorizedCallers[i]) || !allowed) {
      throw new Error(`Authorised caller mismatch at index ${i}.`);
    }
  }
  return { state, ap, pool, configurator, helper };
}

async function printStatus(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  const [emergencyAdmin, paused, repaymentsPaused, closed] = await Promise.all([
    c.ap.getEmergencyAdmin(),
    c.pool.paused(),
    c.helper.repaymentsPaused(),
    c.helper.closed(),
  ]);
  console.log('Helper:', c.state.helper);
  console.log('Borrower:', BORROWER);
  console.log('Authorised callers:', c.state.authorizedCallers.join(', '));
  console.log('Controller:', c.state.controller);
  console.log('Emergency admin:', emergencyAdmin);
  console.log('Pool paused:', paused);
  console.log('Repayments paused:', repaymentsPaused);
  console.log('Helper closed:', closed);
  for (const symbol of SETTLEMENT_SYMBOLS) {
    const item = c.state.settlements[symbol];
    const [debt, repaid] = await Promise.all([
      c.helper.currentDebt(item.asset),
      c.helper.totalRepaid(item.asset),
    ]);
    console.log(
      `${symbol}: debt=${ethers.utils.formatUnits(debt, item.decimals)} ` +
        `repaid=${ethers.utils.formatUnits(repaid, item.decimals)}`
    );
  }
}

function requireConfirmation(action: Action) {
  const expected = action.toUpperCase();
  if (process.env.CONFIRM_ATOMIC_REPAY_ACTION !== expected) {
    throw new Error(`Set CONFIRM_ATOMIC_REPAY_ACTION=${expected} for this write.`);
  }
}

async function controllerSigner(expected: string) {
  const [signer] = await ethers.getSigners();
  if (!eqAddress(signer.address, expected)) {
    throw new Error(`Configured signer ${signer.address} is not controller ${expected}.`);
  }
  return signer;
}

async function authorizedSigner(helper: any) {
  const [signer] = await ethers.getSigners();
  if (!(await helper.authorizedCaller(signer.address))) {
    throw new Error(`Configured signer ${signer.address} is not an authorised caller.`);
  }
  return signer;
}

async function handoff(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  requireConfirmation('handoff');
  const signer = await controllerSigner(c.state.controller);
  const [liveAdmin, paused, closed] = await Promise.all([
    c.ap.getEmergencyAdmin(),
    c.pool.paused(),
    c.helper.closed(),
  ]);
  if (!eqAddress(liveAdmin, c.state.originalEmergencyAdmin)) {
    throw new Error(`Unexpected emergency admin before handoff: ${liveAdmin}`);
  }
  if (!paused || closed) throw new Error('Handoff requires a paused pool and open helper.');
  const tx = await c.ap.connect(signer).setEmergencyAdmin(c.state.helper);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error('Emergency-admin handoff failed.');
  if (!eqAddress(await c.ap.getEmergencyAdmin(), c.state.helper)) {
    throw new Error('Emergency-admin handoff did not persist.');
  }
  saveOperation(c.state, { action: 'handoff', txHash: tx.hash, blockNumber: receipt.blockNumber });
  console.log('Emergency admin assigned to helper. Pool remains paused.');
}

async function repay(c: Awaited<ReturnType<typeof loadAndVerify>>, controllerSubmitted: boolean) {
  const action: Action = controllerSubmitted ? 'repay-from' : 'repay';
  requireConfirmation(action);
  const symbol = process.env.REPAYMENT_SYMBOL as SettlementSymbol;
  const amountTokens = process.env.REPAYMENT_AMOUNT || '';
  if (!SETTLEMENT_SYMBOLS.includes(symbol)) throw new Error('Invalid REPAYMENT_SYMBOL.');
  if (!/^\d+(\.\d+)?$/.test(amountTokens)) throw new Error('Invalid REPAYMENT_AMOUNT.');
  const signer = controllerSubmitted
    ? await controllerSigner(c.state.controller)
    : await authorizedSigner(c.helper);
  const payer = controllerSubmitted ? process.env.REPAYMENT_PAYER || '' : signer.address;
  if (!ethers.utils.isAddress(payer)) throw new Error('REPAYMENT_PAYER is not a valid address.');
  if (!(await c.helper.authorizedCaller(payer))) {
    throw new Error(`Repayment payer ${payer} is not authorised.`);
  }
  const item = c.state.settlements[symbol];
  const amount = ethers.utils.parseUnits(amountTokens, item.decimals);
  const helper = c.helper.connect(signer);
  const token = new ethers.Contract(
    item.asset,
    [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address,address) view returns (uint256)',
      'function approve(address,uint256) returns (bool)',
    ],
    signer
  );
  const [admin, paused, repaymentsPaused, closed, debt, balance] = await Promise.all([
    c.ap.getEmergencyAdmin(),
    c.pool.paused(),
    c.helper.repaymentsPaused(),
    c.helper.closed(),
    c.helper.currentDebt(item.asset),
    token.balanceOf(payer),
  ]);
  if (!eqAddress(admin, c.state.helper)) throw new Error('Helper is not emergency admin.');
  if (!paused || repaymentsPaused || closed) {
    throw new Error('Repayment requires a paused pool and active helper.');
  }
  if (amount.isZero()) throw new Error('Repayment amount must be positive.');
  const preflightPull = amount.lt(debt) ? amount : debt;
  if (preflightPull.isZero()) throw new Error(`${symbol}: borrower has no live debt.`);
  if (balance.lt(preflightPull)) throw new Error(`${symbol}: payer token balance is insufficient.`);

  const allowance = await token.allowance(payer, c.state.helper);
  // Approve the caller's requested ceiling, not a debt balance that can accrue
  // between this read and execution. The helper still pulls only
  // min(requested amount, live debt) inside the repayment transaction.
  if (allowance.lt(amount)) {
    if (controllerSubmitted) {
      throw new Error(
        `${symbol}: payer allowance is ${allowance.toString()}, but ` +
          `${amount.toString()} is required. The payer must approve the helper first.`
      );
    }
    const approveTx = await token.approve(c.state.helper, amount);
    const approveReceipt = await approveTx.wait();
    if (approveReceipt.status !== 1) throw new Error(`${symbol}: approval failed.`);
    saveOperation(c.state, {
      action: 'approve',
      symbol,
      amountAtomic: amount.toString(),
      txHash: approveTx.hash,
      blockNumber: approveReceipt.blockNumber,
    });
    c.state = readJson<any>(STATE_PATH);
  }

  if (controllerSubmitted) {
    await helper.callStatic.repayTokenFrom(payer, item.asset, amount);
  } else {
    await helper.callStatic.repayToken(item.asset, amount);
  }
  const estimate = controllerSubmitted
    ? await helper.estimateGas.repayTokenFrom(payer, item.asset, amount)
    : await helper.estimateGas.repayToken(item.asset, amount);
  const configuredLimit = process.env.ATOMIC_REPAY_GAS_LIMIT
    ? ethers.BigNumber.from(process.env.ATOMIC_REPAY_GAS_LIMIT)
    : undefined;
  if (configuredLimit && configuredLimit.lt(estimate.mul(105).div(100))) {
    throw new Error('Configured repayment gas limit is below 105% of the estimate.');
  }
  const gasLimit = configuredLimit || estimate.mul(110).div(100);
  const tx = controllerSubmitted
    ? await helper.repayTokenFrom(payer, item.asset, amount, { gasLimit })
    : await helper.repayToken(item.asset, amount, { gasLimit });
  saveOperation(c.state, {
    action: `${action}-submitted`,
    symbol,
    requestedTokens: amountTokens,
    payer,
    submittedBy: signer.address,
    txHash: tx.hash,
  });
  c.state = readJson<any>(STATE_PATH);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${symbol}: repayment failed.`);
  const repaymentEvents =
    receipt.events?.filter((event: any) => event.event === 'AtomicRepaymentExecuted') || [];
  if (repaymentEvents.length !== 1 || !repaymentEvents[0].args) {
    throw new Error(`${symbol}: expected exactly one decoded repayment event.`);
  }
  const repayment = repaymentEvents[0].args;
  if (
    !eqAddress(repayment.asset, item.asset) ||
    !eqAddress(repayment.payer, payer) ||
    !eqAddress(repayment.borrower, BORROWER)
  ) {
    throw new Error(`${symbol}: repayment event identities do not match the request.`);
  }
  if (repayment.amount.isZero() || repayment.amount.gt(amount)) {
    throw new Error(`${symbol}: repayment event amount is outside the requested ceiling.`);
  }
  const pausedAfter = await c.pool.paused();
  if (!pausedAfter) throw new Error('Pool is not paused after repayment.');
  saveOperation(c.state, {
    action,
    symbol,
    requestedTokens: amountTokens,
    payer,
    submittedBy: signer.address,
    preflightDebt: debt.toString(),
    repaidAtomic: repayment.amount.toString(),
    debtBefore: repayment.debtBefore.toString(),
    debtAfter: repayment.debtAfter.toString(),
    totalRepaidForAsset: repayment.totalRepaidForAsset.toString(),
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    poolPausedAfter: pausedAfter,
  });
  console.log(`${symbol} repayment completed. Pool is paused.`);
}

async function repayHbar(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  requireConfirmation('repay-hbar');
  const amountHbar = process.env.REPAYMENT_AMOUNT || '';
  if (!/^\d+(\.\d+)?$/.test(amountHbar)) throw new Error('Invalid REPAYMENT_AMOUNT.');
  const tinybars = ethers.utils.parseUnits(amountHbar, 8);
  const weibars = ethers.utils.parseEther(amountHbar);
  if (tinybars.isZero()) throw new Error('Native HBAR repayment must be positive.');

  const signer = await authorizedSigner(c.helper);
  const [admin, poolPaused, repaymentsPaused, closed, debt, hbarBalance] = await Promise.all([
    c.ap.getEmergencyAdmin(),
    c.pool.paused(),
    c.helper.repaymentsPaused(),
    c.helper.closed(),
    c.helper.currentDebt(c.state.settlements.WHBAR.asset),
    signer.getBalance(),
  ]);
  if (!eqAddress(admin, c.state.helper)) throw new Error('Helper is not emergency admin.');
  if (!poolPaused || repaymentsPaused || closed) {
    throw new Error('Native HBAR repayment requires a paused pool and active helper.');
  }
  if (debt.isZero()) throw new Error('Wallet B has no live WHBAR debt.');
  if (hbarBalance.lt(weibars)) {
    throw new Error('Authorised caller has insufficient HBAR for the requested repayment value.');
  }

  const helper = c.helper.connect(signer);
  await helper.callStatic.repayHbar({ value: weibars });
  const estimate = await helper.estimateGas.repayHbar({ value: weibars });
  const gasLimit = estimate.mul(110).div(100);
  const feeData = await ethers.provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas || feeData.gasPrice;
  if (feePerGas && hbarBalance.lt(weibars.add(gasLimit.mul(feePerGas)))) {
    throw new Error('Authorised caller has insufficient HBAR for repayment value plus gas.');
  }
  const tx = await helper.repayHbar({ value: weibars, gasLimit });
  saveOperation(c.state, {
    action: 'repay-hbar-submitted',
    requestedHbar: amountHbar,
    requestedTinybars: tinybars.toString(),
    payer: signer.address,
    txHash: tx.hash,
  });
  c.state = readJson<any>(STATE_PATH);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error('Native HBAR repayment failed.');
  const repaymentEvent = receipt.events?.find(
    (event: any) => event.event === 'AtomicRepaymentExecuted'
  );
  const nativeEvent = receipt.events?.find(
    (event: any) => event.event === 'NativeHbarRepaymentExecuted'
  );
  if (!repaymentEvent?.args || !nativeEvent?.args) {
    throw new Error('Native HBAR repayment events were not decoded.');
  }
  if (!(await c.pool.paused())) throw new Error('Pool is not paused after native repayment.');

  saveOperation(c.state, {
    action: 'repay-hbar',
    requestedHbar: amountHbar,
    requestedTinybars: tinybars.toString(),
    repaidTinybars: repaymentEvent.args.amount.toString(),
    refundedTinybars: nativeEvent.args.hbarRefunded.toString(),
    payer: signer.address,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    poolPausedAfter: true,
  });
  console.log('Native HBAR repayment completed. Pool is paused.');
}

async function addCaller(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  requireConfirmation('add-caller');
  const caller = process.env.AUTHORIZED_CALLER || '';
  if (!ethers.utils.isAddress(caller) || eqAddress(caller, ethers.constants.AddressZero)) {
    throw new Error('AUTHORIZED_CALLER is not a valid non-zero address.');
  }
  const signer = await controllerSigner(c.state.controller);
  if (await c.helper.authorizedCaller(caller)) throw new Error('Caller is already authorised.');
  if (await c.helper.closed()) throw new Error('Cannot add a caller after helper closure.');
  const callerCount = await c.helper.callerCount();
  const tx = await c.helper.connect(signer).addAuthorizedCaller(caller);
  const receipt = await tx.wait();
  if (
    !(await c.helper.authorizedCaller(caller)) ||
    !eqAddress(await c.helper.AUTHORIZED_CALLERS(callerCount), caller)
  ) {
    throw new Error('Authorised caller addition did not persist.');
  }
  saveOperation(c.state, {
    action: 'add-caller',
    caller,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  });
  const updatedState = readJson<any>(STATE_PATH);
  writeJson(STATE_PATH, {
    ...updatedState,
    authorizedCallers: [...updatedState.authorizedCallers, caller],
  });
  console.log('Authorised caller added:', caller);
}

async function setRepaymentsPause(c: Awaited<ReturnType<typeof loadAndVerify>>, paused: boolean) {
  const action: Action = paused ? 'pause-repayments' : 'resume-repayments';
  requireConfirmation(action);
  const signer = await controllerSigner(c.state.controller);
  if (!paused && (await c.helper.closed())) throw new Error('Closed helper cannot be resumed.');
  const tx = await c.helper.connect(signer).setRepaymentsPaused(paused);
  const receipt = await tx.wait();
  if ((await c.helper.repaymentsPaused()) !== paused) {
    throw new Error('Repayment pause state did not persist.');
  }
  saveOperation(c.state, {
    action,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  });
  console.log(`Helper repayments ${paused ? 'paused' : 'resumed'}.`);
}

async function pausePoolOnly(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  requireConfirmation('pool-pause-only');
  const signer = await controllerSigner(c.state.controller);
  if (!eqAddress(await c.ap.getEmergencyAdmin(), c.state.helper)) {
    throw new Error('Helper is not emergency admin.');
  }
  const tx = await c.helper.connect(signer).pausePoolOnly();
  const receipt = await tx.wait();
  if (!(await c.pool.paused())) throw new Error('Pool pause rescue did not pause the pool.');
  saveOperation(c.state, {
    action: 'pool-pause-only',
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  });
}

async function closeAndRestore(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  requireConfirmation('close-and-restore');
  const signer = await controllerSigner(c.state.controller);
  const liveAdmin = await c.ap.getEmergencyAdmin();
  if (
    !eqAddress(liveAdmin, c.state.helper) &&
    !eqAddress(liveAdmin, c.state.originalEmergencyAdmin)
  ) {
    throw new Error(`Unexpected emergency admin: ${liveAdmin}`);
  }

  let operationError: unknown;
  try {
    if (!(await c.pool.paused()) && eqAddress(liveAdmin, c.state.helper)) {
      const rescue = await c.helper.connect(signer).pausePoolOnly();
      await rescue.wait();
    }
    if (!(await c.helper.closed())) {
      const closeTx = await c.helper.connect(signer).close();
      const closeReceipt = await closeTx.wait();
      saveOperation(c.state, {
        action: 'close',
        txHash: closeTx.hash,
        blockNumber: closeReceipt.blockNumber,
      });
      c.state = readJson<any>(STATE_PATH);
    }
  } catch (error) {
    operationError = error;
  } finally {
    if (!eqAddress(await c.ap.getEmergencyAdmin(), c.state.originalEmergencyAdmin)) {
      const restoreTx = await c.ap
        .connect(signer)
        .setEmergencyAdmin(c.state.originalEmergencyAdmin);
      const restoreReceipt = await restoreTx.wait();
      saveOperation(c.state, {
        action: 'restore-emergency-admin',
        txHash: restoreTx.hash,
        blockNumber: restoreReceipt.blockNumber,
      });
      c.state = readJson<any>(STATE_PATH);
    }
    if (!(await c.pool.paused())) {
      const pauseTx = await c.configurator.connect(signer).setPoolPause(true);
      await pauseTx.wait();
    }
  }

  if (operationError) throw operationError;
  const [finalAdmin, finalPaused, finalClosed] = await Promise.all([
    c.ap.getEmergencyAdmin(),
    c.pool.paused(),
    c.helper.closed(),
  ]);
  if (!eqAddress(finalAdmin, c.state.originalEmergencyAdmin) || !finalPaused || !finalClosed) {
    throw new Error('Final close-and-restore state is incorrect.');
  }
  console.log('Helper closed, emergency admin restored, and pool paused.');
}

async function sweepAfterClose(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  requireConfirmation('sweep-after-close');
  const signer = await controllerSigner(c.state.controller);
  const tokenAddress = process.env.SWEEP_TOKEN || '';
  if (!ethers.utils.isAddress(tokenAddress)) throw new Error('SWEEP_TOKEN is not a valid address.');
  if (!(await c.helper.closed())) throw new Error('Helper must be closed before sweeping.');
  if (!(await c.pool.paused())) throw new Error('LendingPool must be paused before sweeping.');
  const token = new ethers.Contract(
    tokenAddress,
    ['function balanceOf(address) view returns (uint256)'],
    ethers.provider
  );
  const balance = await token.balanceOf(c.state.helper);
  if (balance.isZero()) throw new Error('Helper has no balance of SWEEP_TOKEN.');
  const tx = await c.helper.connect(signer).sweepAfterClose(tokenAddress);
  const receipt = await tx.wait();
  if (!(await token.balanceOf(c.state.helper)).isZero()) {
    throw new Error('Token balance remains after sweep.');
  }
  saveOperation(c.state, {
    action: 'sweep-after-close',
    token: tokenAddress,
    amountAtomic: balance.toString(),
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  });
  console.log('Closed helper token balance swept to controller.');
}

async function sweepHbarAfterClose(c: Awaited<ReturnType<typeof loadAndVerify>>) {
  requireConfirmation('sweep-hbar-after-close');
  const signer = await controllerSigner(c.state.controller);
  if (!(await c.helper.closed())) throw new Error('Helper must be closed before sweeping.');
  if (!(await c.pool.paused())) throw new Error('LendingPool must be paused before sweeping.');
  const balance = await ethers.provider.getBalance(c.state.helper);
  if (balance.isZero()) throw new Error('Helper has no native HBAR balance.');
  const tx = await c.helper.connect(signer).sweepHbarAfterClose();
  const receipt = await tx.wait();
  if (!(await ethers.provider.getBalance(c.state.helper)).isZero()) {
    throw new Error('Native HBAR balance remains after sweep.');
  }
  saveOperation(c.state, {
    action: 'sweep-hbar-after-close',
    amountTinybars: balance.toString(),
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  });
  console.log('Closed helper native HBAR balance swept to controller.');
}

async function main() {
  const c = await loadAndVerify();
  if (ACTION === 'status') return printStatus(c);
  if (ACTION === 'handoff') return handoff(c);
  if (ACTION === 'repay') return repay(c, false);
  if (ACTION === 'repay-from') return repay(c, true);
  if (ACTION === 'repay-hbar') return repayHbar(c);
  if (ACTION === 'add-caller') return addCaller(c);
  if (ACTION === 'pause-repayments') return setRepaymentsPause(c, true);
  if (ACTION === 'resume-repayments') return setRepaymentsPause(c, false);
  if (ACTION === 'pool-pause-only') return pausePoolOnly(c);
  if (ACTION === 'sweep-after-close') return sweepAfterClose(c);
  if (ACTION === 'sweep-hbar-after-close') return sweepHbarAfterClose(c);
  return closeAndRestore(c);
}

main().catch((error) => {
  console.error(conciseRpcError(error));
  process.exit(1);
});
