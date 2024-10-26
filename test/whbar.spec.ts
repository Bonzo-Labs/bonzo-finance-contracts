import { expect } from 'chai';
import { ethers } from 'hardhat';
import outputReserveData from '../scripts/outputReserveData.json';

const { WHBAR, LendingPool } = outputReserveData;

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner, whbarTokenAddress, whbarContractAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
  whbarTokenAddress = WHBAR.hedera_testnet.token.address;
  whbarContractAddress = '0x0000000000000000000000000000000000003ad1';
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
  whbarTokenAddress = WHBAR.hedera_mainnet.token.address;
  whbarContractAddress = '0x0000000000000000000000000000000000163b59';
}

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function approveToken(tokenContract, spenderAddress, amount) {
  console.log('Checking allowance now for...', owner.address);
  const allowance = await tokenContract.allowance(owner.address, spenderAddress);
  console.log('Allowance:', allowance.toString());
  if (allowance.lt(amount)) {
    const approveTx = await tokenContract.approve(spenderAddress, amount);
    await approveTx.wait();
    console.log('Approved:', approveTx.hash);

    const newAllowance = await tokenContract.allowance(owner.address, spenderAddress);
    console.log('New Allowance:', newAllowance.toString());
  }
}

async function checkBalance(contract, address, label) {
  const balance = await contract.balanceOf(address);
  console.log(`${label} Balance:`, balance.toString());
  return balance;
}

describe('WHBAR Tests', function () {
  let lendingPoolContract, whbarTokenContract, aTokenContract, whbarContract;

  before(async function () {
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_mainnet.address);
    whbarContract = await setupContract('WHBARContract', whbarContractAddress);
    whbarTokenContract = await setupContract('ERC20Wrapper', whbarTokenAddress);
    aTokenContract = await setupContract('AToken', WHBAR.hedera_mainnet.aToken.address);
  });

  async function withdrawWHBAR(amount, to) {
    console.log('Inside withdrawWHBAR...', amount, to);

    await approveToken(whbarTokenContract, lendingPoolContract.address, amount);
    await approveToken(whbarTokenContract, whbarContract.address, amount);

    const balanceOfBefore = await checkBalance(
      aTokenContract,
      owner.address,
      'WHBAR aToken before'
    );

    const withdrawTxn = await lendingPoolContract.withdraw(whbarTokenAddress, amount, to);
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash:', withdrawTxn.hash);

    const balanceOfAfter = await checkBalance(aTokenContract, owner.address, 'WHBAR aToken after');
    expect(balanceOfAfter).to.be.gte(0);
  }

  async function borrowWHBAR(amount, onBehalfOf) {
    await approveToken(whbarTokenContract, lendingPoolContract.address, amount);
    await approveToken(whbarTokenContract, whbarContract.address, amount);

    const borrowTxn = await lendingPoolContract.borrow(whbarTokenAddress, amount, 2, 0, onBehalfOf);
    await borrowTxn.wait();
    console.log('Borrow Transaction hash:', borrowTxn.hash);
  }

  it.skip('should supply native HBAR and get awhbar tokens', async function () {
    await approveToken(whbarTokenContract, lendingPoolContract.address, 102);

    const txn = await lendingPoolContract.deposit(
      whbarTokenAddress,
      // @ts-ignore
      102n,
      owner.address,
      0,
      {
        // @ts-ignore
        value: 102n * 10_000_000_000n,
      }
    );
    await txn.wait();
    console.log('Transaction hash:', txn.hash);

    await new Promise((r) => setTimeout(r, 2000));

    const balanceOf = await checkBalance(aTokenContract, owner.address, 'WHBAR aToken');
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should withdraw whbar tokens and get HBAR - msg.sender same as to', async function () {
    await withdrawWHBAR(13, owner.address);
  });

  it.skip('should borrow native HBAR - msg.sender same as onBehalfOf', async function () {
    await borrowWHBAR(4, owner.address);
  });

  it.skip('should repay native HBAR', async function () {
    const amount = 4;
    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      WHBAR.hedera_mainnet.variableDebt.address
    );
    const balanceOf = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt before');

    await approveToken(whbarTokenContract, lendingPoolContract.address, amount);

    const repayTxn = await lendingPoolContract.repay(
      whbarTokenAddress,
      // @ts-ignore
      4n,
      2,
      owner.address,
      // @ts-ignore
      { value: 4n * 10_000_000_000n }
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash:', repayTxn.hash);

    const balanceOfAfter = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt after');
    expect(balanceOfAfter).to.be.gte(0);
  });
});
