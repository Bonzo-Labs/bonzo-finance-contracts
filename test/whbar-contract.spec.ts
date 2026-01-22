import { expect } from 'chai';
import { ethers } from 'hardhat';
import hre from 'hardhat';
import outputReserveData from '../scripts/outputReserveData.json';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

// Known WHBARContract addresses (can be overridden via env)
const DEFAULT_WHBAR_CONTRACT_MAINNET = '0x0000000000000000000000000000000000163b59';
const DEFAULT_WHBAR_CONTRACT_TESTNET = '0x0000000000000000000000000000000000003ad1';

const WHBAR_TOKEN_ADDRESS_TESTNET = '0x0000000000000000000000000000000000003ad2';
const WHBAR_TOKEN_ADDRESS_MAINNET = '0x0000000000000000000000000000000000163b5a';

const WHBAR_TOKEN_ABI = [
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

let provider, owner;

if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_LIQUIDATIONS || '', provider);
}

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function checkBalance(contract, address, label) {
  const balance = await contract.balanceOf(address);
  console.log(`${label} Balance:`, balance.toString());
  return balance;
}

describe('WHBAR Contract Integration Tests', function () {
  let lendingPoolContract,
    whbarContract,
    whbarTokenContract,
    aTokenContract,
    debtTokenContract,
    whbarTokenAddress;

  before(async function () {
    console.log('Owner:', owner.address);
    lendingPoolContract = await setupContract(
      'LendingPool',
      outputReserveData.LendingPool[chain_type].address
    );

    // Resolve WHBARContract address and attempt to read its token()
    const whbarContractAddress =
      chain_type === 'hedera_mainnet'
        ? DEFAULT_WHBAR_CONTRACT_MAINNET
        : DEFAULT_WHBAR_CONTRACT_TESTNET;

    whbarTokenAddress =
      chain_type === 'hedera_testnet' ? WHBAR_TOKEN_ADDRESS_TESTNET : WHBAR_TOKEN_ADDRESS_MAINNET;

    whbarTokenContract = new ethers.Contract(whbarTokenAddress, WHBAR_TOKEN_ABI, owner);
    whbarContract = await setupContract('WHBARContract', whbarContractAddress);

    // Derive reserve token addresses dynamically from the pool
    const reserve = await lendingPoolContract.getReserveData(whbarTokenAddress);
    aTokenContract = await setupContract('AToken', reserve.aTokenAddress);
    debtTokenContract = await setupContract('VariableDebtToken', reserve.variableDebtTokenAddress);
  });

  it.skip('should deposit, borrow, withdraw and repay WHBAR using WHBAR contract route', async function () {
    console.log('WHBAR token address:', whbarTokenAddress);
    if (!whbarTokenAddress) {
      console.log('===== WHBAR token address not found, skipping test.');
      this.skip();
    }
    console.log('LendingPool address:', lendingPoolContract.address);

    const depositHBAR = '1';
    const depositAmount = ethers.utils.parseUnits(depositHBAR, 8); // HBAR in tinybars (8 decimals)
    const depositValue = ethers.utils.parseEther(depositHBAR); // HBAR in wei (18 decimals) for msg.value

    // 1) Deposit native HBAR to LendingPool (sends tinybars, LendingPool wraps to WHBAR internally)
    console.log('Depositing native HBAR to LendingPool (will be wrapped to WHBAR)...');
    const depositTx = await lendingPoolContract.deposit(
      whbarTokenAddress,
      depositAmount,
      owner.address,
      0,
      { value: depositValue } // Hedera RPC converts 18dp wei to 8dp tinybar for msg.value
    );
    const depositRcpt = await depositTx.wait();
    console.log('Deposit tx:', depositTx.hash);
    expect(depositRcpt.status).to.equal(1);

    // 2) Verify aWHBAR balance after deposit
    const aBalAfterDeposit = await checkBalance(
      aTokenContract,
      owner.address,
      'aWHBAR after deposit'
    );
    expect(aBalAfterDeposit).to.be.gte(depositAmount.sub(100)); // allow small tolerance

    // 3) Borrow some WHBAR (receive actual WHBAR tokens)
    const borrowAmount = ethers.utils.parseUnits('0.05', 8);

    // Pre-approve WHBARContract to be able to pull WHBAR tokens during borrow->unwrap flow
    console.log(`Approving WHBAR for WHBARContract: ${whbarContract.address}`);
    const approveTx = await whbarTokenContract.approve(whbarContract.address, borrowAmount, {
      gasLimit: 1000000,
    });
    await approveTx.wait();

    console.log('Borrowing WHBAR tokens from LendingPool...');
    const borrowTx = await lendingPoolContract.borrow(
      whbarTokenAddress,
      borrowAmount,
      2,
      0,
      owner.address,
      {
        gasLimit: 3000000,
      }
    );
    const borrowRcpt = await borrowTx.wait();
    console.log('Borrow tx:', borrowTx.hash);
    expect(borrowRcpt.status).to.equal(1);

    const debtAfterBorrow = await checkBalance(
      debtTokenContract,
      owner.address,
      'WHBAR debt after borrow'
    );
    expect(debtAfterBorrow).to.be.gte(borrowAmount.sub(100));

    // 4) Withdraw a small amount of aWHBAR back to native HBAR
    const withdrawAmount = ethers.utils.parseUnits('0.01', 8);

    // Add approvals based on UI flow for withdrawal
    console.log('Approving aWHBAR for LendingPool...');
    const approveATokenTx = await aTokenContract.approve(
      lendingPoolContract.address,
      withdrawAmount,
      { gasLimit: 1000000 }
    );
    await approveATokenTx.wait();

    console.log('Approving WHBAR for WHBARContract...');
    const approveWhbarTx = await whbarTokenContract.approve(whbarContract.address, withdrawAmount, {
      gasLimit: 1000000,
    });
    await approveWhbarTx.wait();

    console.log('Withdrawing small amount of aWHBAR (receive native HBAR)...');
    const withdrawTx = await lendingPoolContract.withdraw(
      whbarTokenAddress,
      withdrawAmount,
      owner.address
    );
    const withdrawRcpt = await withdrawTx.wait();
    console.log('Withdraw tx:', withdrawTx.hash);
    expect(withdrawRcpt.status).to.equal(1);

    // 5) Wrap some native HBAR to WHBAR via WHBARContract
    const wrapAmountHBAR = '0.005';
    const wrapAmountWei = ethers.utils.parseEther(wrapAmountHBAR);
    console.log('Wrapping native HBAR to WHBAR tokens via WHBARContract...');
    const wrapTx = await whbarContract['deposit()']({ value: wrapAmountWei });
    await wrapTx.wait();
    console.log('Wrap tx:', wrapTx.hash);

    // 6) Unwrap some WHBAR tokens back to native HBAR via WHBARContract.withdraw
    const toRedeem = ethers.utils.parseUnits(wrapAmountHBAR, 8);
    console.log('Unwrapping WHBAR tokens to native HBAR via WHBARContract...');
    const approveUnwrapTx = await whbarTokenContract.approve(whbarContract.address, toRedeem, {
      gasLimit: 1000000,
    });
    await approveUnwrapTx.wait();
    const redeemTx = await whbarContract['withdraw(uint256)'](toRedeem);
    const redeemRcpt = await redeemTx.wait();
    console.log('Unwrap tx:', redeemTx.hash);
    expect(redeemRcpt.status).to.equal(1);

    // 7) Repay outstanding variable debt with native HBAR
    const currentDebt = await debtTokenContract.balanceOf(owner.address);
    if (currentDebt.gt(0)) {
      console.log('Repaying WHBAR debt with native HBAR...');
      const repayAmount = currentDebt.div(2); // Repay half the debt
      const repayAmountInHBAR = ethers.utils.formatUnits(repayAmount, 8);
      const repayValue = ethers.utils.parseEther(repayAmountInHBAR);

      const repayTx = await lendingPoolContract.repay(
        whbarTokenAddress,
        repayAmount,
        2,
        owner.address,
        { value: repayValue } // Send native HBAR in wei
      );
      const repayRcpt = await repayTx.wait();
      console.log('Repay tx:', repayTx.hash);
      expect(repayRcpt.status).to.equal(1);
      const debtAfterRepay = await checkBalance(
        debtTokenContract,
        owner.address,
        'WHBAR debt after repay'
      );
      expect(debtAfterRepay).to.be.lt(currentDebt);
    }
  });
});
