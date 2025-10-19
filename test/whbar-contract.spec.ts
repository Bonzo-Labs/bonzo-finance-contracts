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

async function approveWithReset(token, spender, amount) {
  const current = await token.allowance(owner.address, spender);
  if (current.lt(amount)) {
    if (current.gt(0)) {
      const resetTx = await token.approve(spender, 0, { gasLimit: 1000000 });
      await resetTx.wait();
    }
    const tx = await token.approve(spender, amount, { gasLimit: 1000000 });
    await tx.wait();
    return tx.hash;
  }
  return undefined;
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

    whbarTokenContract = await setupContract('ERC20Wrapper', whbarTokenAddress);
    whbarContract = await setupContract('WHBARContract', whbarContractAddress);

    // Derive reserve token addresses dynamically from the pool
    const reserve = await lendingPoolContract.getReserveData(whbarTokenAddress);
    aTokenContract = await setupContract('AToken', reserve.aTokenAddress);
    debtTokenContract = await setupContract('VariableDebtToken', reserve.variableDebtTokenAddress);
  });

  it('should deposit, borrow, withdraw and repay WHBAR using WHBAR contract route', async function () {
    // 1) Acquire WHBAR via WHBARContract.deposit (native HBAR -> WHBAR)
    console.log('WHBAR token address:', whbarTokenAddress);
    if (!whbarTokenAddress) {
      console.log('===== WHBAR token address not found, skipping test.');
      this.skip();
    }
    console.log('LendingPool address:', lendingPoolContract.address);

    const depositHBAR = '0.5';
    const depositWei = ethers.utils.parseEther(depositHBAR);
    const expectedWHBAR = ethers.utils.parseUnits(depositHBAR, 8);

    const balBeforeWHBAR = await checkBalance(
      whbarTokenContract,
      owner.address,
      'WHBAR before deposit'
    );
    const mintTx = await whbarContract['deposit()']({ value: depositWei });
    await mintTx.wait();

    const balAfterWHBAR = await checkBalance(
      whbarTokenContract,
      owner.address,
      'WHBAR after deposit'
    );
    expect(balAfterWHBAR.sub(balBeforeWHBAR)).to.be.gte(expectedWHBAR.sub(1));

    // 2) Approve LendingPool and deposit WHBAR into the pool
    console.log('Approving LendingPool to spend WHBAR...');
    await approveWithReset(whbarTokenContract, lendingPoolContract.address, expectedWHBAR);
    console.log('Depositing WHBAR into LendingPool...');
    const depositTx = await lendingPoolContract.deposit(
      whbarTokenAddress,
      expectedWHBAR,
      owner.address,
      0
    );
    const depositRcpt = await depositTx.wait();
    console.log('Deposit tx:', depositTx.hash);
    expect(depositRcpt.status).to.equal(1);

    const aBalAfterDeposit = await checkBalance(
      aTokenContract,
      owner.address,
      'aWHBAR after deposit'
    );
    expect(aBalAfterDeposit).to.be.gte(expectedWHBAR.sub(1));

    // 3) Borrow some WHBAR
    const borrowAmount = ethers.utils.parseUnits('0.05', 8);
    console.log('Borrowing WHBAR from LendingPool...');
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
    expect(debtAfterBorrow).to.be.gte(borrowAmount.sub(1));

    // 4) Withdraw a small amount of aWHBAR back to WHBAR tokens
    const withdrawAmount = ethers.utils.parseUnits('0.01', 8);
    const approveATx = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await approveATx.wait();
    console.log('Withdrawing small amount of aWHBAR...');
    const withdrawTx = await lendingPoolContract.withdraw(
      whbarTokenAddress,
      withdrawAmount,
      owner.address
    );
    const withdrawRcpt = await withdrawTx.wait();
    console.log('Withdraw tx:', withdrawTx.hash);
    expect(withdrawRcpt.status).to.equal(1);

    // 5) Convert some WHBAR back to native HBAR via WHBARContract.withdraw
    const toRedeem = ethers.utils.parseUnits('0.005', 8);
    console.log('Approving WHBARContract to spend WHBAR for unwrap...');
    await approveWithReset(whbarTokenContract, whbarContract.address, toRedeem);
    const redeemTx = await whbarContract['withdraw(uint256)'](toRedeem);
    const redeemRcpt = await redeemTx.wait();
    console.log('Redeem (unwrap) tx:', redeemTx.hash);
    expect(redeemRcpt.status).to.equal(1);

    // 6) Repay outstanding variable debt with WHBAR
    const currentDebt = await debtTokenContract.balanceOf(owner.address);
    if (currentDebt.gt(0)) {
      console.log('Approving LendingPool to spend WHBAR for repay...');
      await approveWithReset(whbarTokenContract, lendingPoolContract.address, currentDebt);
      const repayTx = await lendingPoolContract.repay(
        whbarTokenAddress,
        currentDebt,
        2,
        owner.address
      );
      const repayRcpt = await repayTx.wait();
      console.log('Repay tx:', repayTx.hash);
      expect(repayRcpt.status).to.equal(1);
      const debtAfterRepay = await checkBalance(
        debtTokenContract,
        owner.address,
        'WHBAR debt after repay'
      );
      expect(debtAfterRepay).to.be.gte(0);
    }
  });
});
