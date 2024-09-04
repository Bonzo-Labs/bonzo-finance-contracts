import { ethers } from 'hardhat';
import { expect } from 'chai';
import { fail } from 'assert';
import { BigNumberish } from 'ethers';
import { AccountId, PrivateKey, Client } from '@hashgraph/sdk';
import { ATokenFactory, ERC20Factory, LendingPoolConfiguratorFactory, LendingPoolFactory, VariableDebtTokenFactory } from '../types';
import { LendingPool, LendingPoolConfigurator } from '../deployed-contracts.json';
import outputReserveData from '../scripts/outputReserveData.json';

require('dotenv').config();

const { SAUCE: { hedera_testnet: SAUCE } } = outputReserveData;
const client = Client.forTestnet();
const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
client.setOperator(operatorAccountId, operatorPrKey);

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const sauceATokenContract = ATokenFactory.connect(SAUCE.aToken.address, owner);
const sauceTokenContract = ERC20Factory.connect(SAUCE.token.address, owner);
const sauceDebtTokenContract = VariableDebtTokenFactory.connect(SAUCE.variableDebt.address, owner);
const lendingPoolContract = LendingPoolFactory.connect(LendingPool.hedera_testnet.address, owner);
const lendingPoolConfiguratorContract = LendingPoolConfiguratorFactory.connect(LendingPoolConfigurator.hedera_testnet.address, owner);

async function depositSAUCE(amount) {
  const balance = await sauceTokenContract.balanceOf(owner.address);
  if (balance.lt(amount)) throw new Error('Insufficient balance');
  const allowance = await sauceTokenContract.allowance(owner.address, lendingPoolContract.address);
  if (allowance.lt(amount)) {
    console.log(`Creating Allowance for ${lendingPoolContract.address} to spend ${amount.toString()} `);
    const approveTx = await sauceTokenContract.approve(lendingPoolContract.address, amount);
    console.log('Allowance Approve Tx:', approveTx.hash);
    await approveTx.wait();
  } else {
    console.log(`Allowance for ${lendingPoolContract.address} to spend ${allowance.toString()} already exists.`);
  }
  console.log(`Depositing ${amount.toString()} into ${lendingPoolContract.address}`);
  const depositTx = await lendingPoolContract.deposit(SAUCE.token.address, amount, owner.address, 0, { gasLimit: 300000 });
  console.log('Deposit Tx:', depositTx.hash);
  await depositTx.wait();
}
async function withdrawSAUCE(amount: BigNumberish) {
  console.log(`Withdrawing ${amount.toString()} from ${lendingPoolContract.address}`);
  const withdrawTxn = await lendingPoolContract.withdraw(SAUCE.token.address, amount, owner.address, { gasLimit: 300000 });
  console.log('Withdraw Tx: ', withdrawTxn.hash);
  await withdrawTxn.wait();
}
async function borrowSAUCE(amount: BigNumberish) {
  console.log(`Borrowing ${amount.toString()} from ${lendingPoolContract.address}`);
  const borrowTxn = await lendingPoolContract.borrow(SAUCE.token.address, amount, 2, 0, owner.address, { gasLimit: 300000 });
  console.log('Borrow Tx: ', borrowTxn.hash);
  await borrowTxn.wait();
}
async function repaySAUCE(amount: BigNumberish) {
  console.log(`Creating Allowance for ${lendingPoolContract.address} to spend ${amount.toString()} `);
  await (await sauceTokenContract.approve(lendingPoolContract.address, amount)).wait();
  console.log(`Repaying ${amount.toString()} to ${lendingPoolContract.address}`);
  const repayTxn = await lendingPoolContract.repay(SAUCE.token.address, amount, 2, owner.address, { gasLimit: 300000 });
  console.log('Repay Tx: ', repayTxn.hash);
  await repayTxn.wait();
}
async function getSupplyCap() {
  const supplyCapInWholeToken = await lendingPoolConfiguratorContract.getSupplyCap(SAUCE.token.address)
  const decimals = await sauceTokenContract.decimals();
  const supplyCap = supplyCapInWholeToken.mul(10 ** decimals);
  console.log('SAUCE Supply Cap:         ', supplyCap.toString());
  return supplyCap;
}
async function getBorrowCap() {
  const supplyCapInWholeToken = await lendingPoolConfiguratorContract.getBorrowCap(SAUCE.token.address)
  const decimals = await sauceTokenContract.decimals();
  const borrowCap = supplyCapInWholeToken.mul(10 ** decimals);
  console.log('SAUCE Borrow Cap:         ', borrowCap.toString());
  return borrowCap;
}
async function getTotalSupplied() {
  const totalSupplied = await sauceATokenContract.totalSupply();
  console.log('SAUCE Total Supplied:     ', totalSupplied.toString());
  return totalSupplied;
}
async function getTotalBorrowed() {
  const totalBorrowed = await sauceDebtTokenContract.totalSupply();
  console.log('SAUCE Total Borrowed:     ', totalBorrowed.toString());
  return totalBorrowed;
}
async function getErrorData(transactionHash: string) {
  // Why ethers does not expose error.data?
  const errorPrefix = "0x08c379a0";
  const { revertReason } = await provider.send("eth_getTransactionReceipt", [transactionHash]);
  if (revertReason && revertReason.startsWith(errorPrefix)) {
    return ethers.utils.defaultAbiCoder.decode(["string"], "0x" + revertReason.slice(10))[0];
  }
  return revertReason;
}
describe('Lending Pool Supply and Borrow Cap Tests', function () {
  beforeEach(async function () {
    const originalBalance = await sauceTokenContract.balanceOf(owner.address);
    const totalSupplied = await sauceATokenContract.balanceOf(owner.address);
    const totalBorrowed = await sauceDebtTokenContract.balanceOf(owner.address);
    console.log('Pre-Test SAUCE Balance: ', originalBalance.toString());
    console.log('Pre-Test SAUCE Supply:  ', totalSupplied.toString());
    console.log('Pre-Test SAUCE Debt:    ', totalBorrowed.toString());
    if (totalBorrowed.gt(0)) {
      expect(originalBalance.gt(totalBorrowed), "The test account has insufficient SAUCE to clear its debt.").to.be.true;
      await repaySAUCE(totalBorrowed.add(1000000));
    }
    if (totalSupplied.gt(0)) {
      await withdrawSAUCE(totalSupplied);
    }
  });
  afterEach(async function () {
    const originalBalance = await sauceTokenContract.balanceOf(owner.address);
    const totalSupplied = await sauceATokenContract.balanceOf(owner.address);
    const totalBorrowed = await sauceDebtTokenContract.balanceOf(owner.address);
    console.log('Post-Test SAUCE Balance: ', originalBalance.toString());
    console.log('Post-Test SAUCE Supply:  ', totalSupplied.toString());
    console.log('Post-Test SAUCE Debt:    ', totalBorrowed.toString());
    if (totalBorrowed.gt(0)) {
      expect(originalBalance.gt(totalBorrowed), "The test account has insufficient SAUCE to clear its debt.").to.be.true;
      await repaySAUCE(totalBorrowed.add(1000000));
    }
    if (totalSupplied.gt(0)) {
      await withdrawSAUCE(totalSupplied);
    }
  });
  it('can only deposit SAUCE within the supply cap limit', async function () {
    const depositAmount1 = 10;
    const supplyCap = await getSupplyCap();
    const originalBalance = await sauceTokenContract.balanceOf(owner.address);
    const totalSupplied = await getTotalSupplied();
    const depositAmount2 = supplyCap.sub(totalSupplied);
    expect(originalBalance.gt(supplyCap), "The test account has insufficient SAUCE to complete test.").to.be.true;
    expect(totalSupplied.lt(supplyCap.sub(depositAmount1)), "The pools currently has too much supplied SAUCE to complete the test").to.be.true;

    // Should Succeed
    await depositSAUCE(depositAmount1);

    // Should FAIL
    try {
      await depositSAUCE(depositAmount2);
      throw "Supply Cap Limit Test Failed"
    } catch (error) {
      if (error instanceof Error) {
        expect((error as any).code).to.equal('CALL_EXCEPTION');
        const reason = await getErrorData((error as any).transactionHash);
        expect(reason).to.equal("84");
      } else {
        fail("Something else was thrown" + (error as any).toString());
      }
    }
  });
  it('can not deposit SAUCE when limit has been reached', async function () {
    const supplyCap = await getSupplyCap();
    const originalBalance = await sauceTokenContract.balanceOf(owner.address);
    const totalSupplied = await getTotalSupplied();
    const depositAmount = supplyCap.sub(totalSupplied);
    console.log('Balance of SAUCE aTokens:', originalBalance.toString());
    expect(originalBalance.gt(supplyCap), "The test account has insufficient SAUCE to complete test.").to.be.true;
    expect(totalSupplied.lt(supplyCap), "The pools currently has too much supplied SAUCE to complete the test").to.be.true;

    // Should Succeed
    await depositSAUCE(depositAmount);

    // Should FAIL
    try {
      await depositSAUCE(10);
      throw "Supply Cap Limit Test Failed"
    } catch (error) {
      if (error instanceof Error) {
        expect((error as any).code).to.equal('CALL_EXCEPTION');
        const reason = await getErrorData((error as any).transactionHash);
        expect(reason).to.equal("84");
      } else {
        fail("Something else was thrown" + (error as any).toString());
      }
    }
  });
  it('can only borrow SAUCE within the borrow cap limit', async function () {
    const supplyCap = await getSupplyCap();
    const borrowCap = await getBorrowCap();
    const totalSupplied = await getTotalSupplied();
    const totalBorrowed = await getTotalBorrowed();
    const depositAmount = supplyCap.sub(totalSupplied);
    const originalBalance = await sauceTokenContract.balanceOf(owner.address);
    expect(originalBalance.gt(depositAmount), "The test account has insufficient SAUCE to complete test.").to.be.true;
    expect(totalBorrowed.lt(borrowCap), "The pools currently has too much borrowed SAUCE to complete the test").to.be.true;

    if (depositAmount.gt(0)) {
      await depositSAUCE(depositAmount);
    }

    const borrowAmount1 = 25;
    await borrowSAUCE(borrowAmount1)

    try {
      const borrowAmount2 = borrowCap.sub(totalBorrowed);
      await borrowSAUCE(borrowAmount2)
      throw "Borrow Limit Test Failed"
    } catch (error) {
      if (error instanceof Error) {
        expect((error as any).code).to.equal('CALL_EXCEPTION');
        const reason = await getErrorData((error as any).transactionHash);
        expect(reason).to.equal("83");
      } else {
        fail("Something else was thrown" + (error as any).toString());
      }
    }
  });
  it('can not borrow SAUCE when limit has been reached', async function () {
    const supplyCap = await getSupplyCap();
    const borrowCap = await getBorrowCap();
    const totalSupplied = await getTotalSupplied();
    const totalBorrowed = await getTotalBorrowed();
    const depositAmount = supplyCap.sub(totalSupplied);
    const originalBalance = await sauceTokenContract.balanceOf(owner.address);
    const borrowAmount1 = borrowCap.sub(totalBorrowed);
    expect(originalBalance.gt(depositAmount), "The test account has insufficient SAUCE to complete test.").to.be.true;

    if (depositAmount.gt(0)) {
      await depositSAUCE(depositAmount);
    }

    if (borrowAmount1.gt(0)) {
      await borrowSAUCE(borrowAmount1);
    }

    try {
      const borrowAmount2 = 25;
      await borrowSAUCE(borrowAmount2);
      throw "Borrow Limit Test Failed"
    } catch (error) {
      if (error instanceof Error) {
        expect((error as any).code).to.equal('CALL_EXCEPTION');
        const reason = await getErrorData((error as any).transactionHash);
        expect(reason).to.equal("83");
      } else {
        fail("Something else was thrown" + (error as any).toString());
      }
    }
  });
});