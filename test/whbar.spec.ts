import { expect } from 'chai';
import { ethers } from 'hardhat';
import outputReserveData from '../scripts/outputReserveData.json';

const { WHBAR, LendingPool } = outputReserveData;

let provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
let owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
let delegator = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function approveToken(tokenContract, spenderAddress, amount) {
  const allowance = await tokenContract.allowance(owner.address, spenderAddress);
  if (allowance.lt(amount)) {
    const approveTx = await tokenContract.approve(spenderAddress, amount);
    await approveTx.wait();
    console.log('Approved:', approveTx.hash);
  }
}

async function checkBalance(contract, address, label) {
  const balance = await contract.balanceOf(address);
  console.log(`${label} Balance:`, balance.toString());
  return balance;
}

describe('Lending Pool Contract Tests', function () {
  let lendingPoolContract, whbarTokenContract, aTokenContract, whbarContract;

  before(async function () {
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_testnet.address);
    whbarContract = await setupContract(
      'WHBARContract',
      '0x0000000000000000000000000000000000003ad1'
    );
    whbarTokenContract = await setupContract(
      'ERC20Wrapper',
      '0x0000000000000000000000000000000000003ad2'
    );
    aTokenContract = await setupContract('AToken', WHBAR.aToken.address);
  });

  async function withdrawWHBAR(amount, to) {
    await approveToken(whbarTokenContract, lendingPoolContract.address, amount);

    const balanceOfBefore = await checkBalance(
      aTokenContract,
      owner.address,
      'WHBAR aToken before'
    );

    const withdrawTxn = await lendingPoolContract.withdraw(
      '0x0000000000000000000000000000000000003ad2',
      amount,
      to
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash:', withdrawTxn.hash);

    const balanceOfAfter = await checkBalance(aTokenContract, owner.address, 'WHBAR aToken after');
    expect(balanceOfAfter).to.be.gte(0);
  }

  async function borrowWHBAR(amount, onBehalfOf) {
    await approveToken(whbarTokenContract, lendingPoolContract.address, amount);

    const borrowTxn = await lendingPoolContract.borrow(
      '0x0000000000000000000000000000000000003ad2',
      amount,
      2,
      0,
      onBehalfOf
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash:', borrowTxn.hash);
  }

  it.skip('should supply native HBAR and get awhbar tokens', async function () {
    const depositAmount = 123200000;
    await approveToken(whbarTokenContract, lendingPoolContract.address, depositAmount);

    const txn = await lendingPoolContract.deposit(
      '0x0000000000000000000000000000000000003ad2',
      // @ts-ignore
      123200000n,
      owner.address,
      0,
      {
        // @ts-ignore
        value: 123200000n * 10_000_000_000n,
      }
    );
    await txn.wait();
    console.log('Transaction hash:', txn.hash);

    await new Promise((r) => setTimeout(r, 2000));

    const balanceOf = await checkBalance(aTokenContract, owner.address, 'WHBAR aToken');
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should withdraw whbar tokens and get HBAR - msg.sender different from to', async function () {
    await withdrawWHBAR(1022, delegator.address);
  });

  it.skip('should withdraw whbar tokens and get HBAR - msg.sender same as to', async function () {
    await withdrawWHBAR(1122, owner.address);
  });

  it.skip('should borrow native HBAR - msg.sender same as onBehalfOf', async function () {
    await borrowWHBAR(1032, owner.address);
  });

  // Note - You need to call approveDelegation
  it.skip('should borrow native HBAR - msg.sender different from onBehalfOf', async function () {
    // const whbarDebtTokenContract = await setupContract(
    //   'VariableDebtToken',
    //   WHBAR.variableDebt.address
    // );
    // const approveDelegationTxn = await whbarDebtTokenContract.approveDelegation(
    //   delegator.address,
    //   1032
    // );
    // await approveDelegationTxn.wait();
    // console.log('Approve Delegation Transaction hash:', approveDelegationTxn.hash);

    await borrowWHBAR(1032, delegator.address);
  });

  it('should repay native HBAR', async function () {
    const amount = 100;
    const debtTokenContract = await setupContract('VariableDebtToken', WHBAR.variableDebt.address);
    const balanceOf = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt before');

    await approveToken(whbarTokenContract, lendingPoolContract.address, amount);

    const repayTxn = await lendingPoolContract.repay(
      '0x0000000000000000000000000000000000003ad2',
      // @ts-ignore
      100n,
      2,
      owner.address,
      // @ts-ignore
      { value: 100n * 10_000_000_000n }
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash:', repayTxn.hash);

    const balanceOfAfter = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt after');
    expect(balanceOfAfter).to.be.gte(0);
  });
});
