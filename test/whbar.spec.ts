import { expect } from 'chai';
import { ethers } from 'hardhat';
import outputReserveData from '../scripts/outputReserveDataTestnet.json';

import {
  AccountId,
  PrivateKey,
  Client,
  ContractExecuteTransaction,
  Hbar,
  ContractFunctionParameters,
  AccountAllowanceApproveTransaction,
} from '@hashgraph/sdk';

const { WHBAR, LendingPool } = outputReserveData;

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner, whbarTokenAddress, whbarContractAddress, whbarContractId, tokenId;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  whbarTokenAddress = WHBAR.token.address;
  whbarContractAddress = '0x0000000000000000000000000000000000003ad1';
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
  whbarTokenAddress = WHBAR.token.address;
  whbarContractAddress = '0x0000000000000000000000000000000000163b59';
  whbarContractId = '0.0.1456985';
  tokenId = '0.0.1456986';
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
  let lendingPoolContract, whbarTokenContract, aTokenContract, whbarContract, debtTokenContract;

  before(async function () {
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_testnet.address);
    whbarContract = await setupContract('WHBARContract', whbarContractAddress);
    whbarTokenContract = await setupContract('ERC20Wrapper', whbarTokenAddress);
    aTokenContract = await setupContract('AToken', WHBAR.aToken.address);
    debtTokenContract = await setupContract('VariableDebtToken', WHBAR.variableDebt.address);
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

    await checkBalance(debtTokenContract, owner.address, 'WHBAR debtToken');
  }

  it('should send HBAR to WHBAR contract and get WHBAR tokens', async function () {
    console.log('Owner address:', owner.address);
    console.log('WHBAR contract address:', whbarContract.address);
    console.log('WHBAR token address:', whbarTokenContract.address);

    const client = Client.forMainnet();
    const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY_MAINNET!);
    const operatorAccountId = AccountId.fromString(process.env.MAINNET_ACCOUNT_ID!);

    client.setOperator(operatorAccountId, operatorPrKey);

    const depositTx = await new ContractExecuteTransaction()
      .setContractId(whbarContractId)
      .setGas(300000)
      .setPayableAmount(new Hbar(80000))
      .setFunction('deposit')
      .freezeWith(client)
      .signWithOperator(client);

    const signTx = await depositTx.sign(operatorPrKey);
    const txResponse = await signTx.execute(client);
    const depositReceipt = await txResponse.getReceipt(client);
    console.log(`- Deposit Receipt ${depositReceipt.status.toString()}`);
  });

  it.skip('should send WHBAR to WHBAR contract and get native HBAR', async function () {
    console.log('Owner address:', owner.address);
    console.log('WHBAR contract address:', whbarContract.address);
    console.log('WHBAR token address:', whbarTokenContract.address);

    const client = Client.forMainnet();
    const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY_MAINNET!);
    const operatorAccountId = AccountId.fromString(process.env.MAINNET_ACCOUNT_ID!);

    client.setOperator(operatorAccountId, operatorPrKey);

    const approveTxn = await new AccountAllowanceApproveTransaction()
      .approveTokenAllowance(
        tokenId,
        operatorAccountId,
        AccountId.fromString(whbarContractId),
        300000
      )
      .freezeWith(client)
      .signWithOperator(client);
    const approveResponse = await approveTxn.execute(client);
    const approveReceipt = await approveResponse.getReceipt(client);
    console.log(`- Approval Receipt: ${approveReceipt.status.toString()}`);

    const burnTx = await new ContractExecuteTransaction()
      .setContractId(whbarContractId)
      .setGas(300000)
      .setFunction('withdraw', new ContractFunctionParameters().addUint256(300000))
      .freezeWith(client)
      .signWithOperator(client);

    const signTx = await burnTx.sign(operatorPrKey);
    const txResponse = await signTx.execute(client);
    const depositReceipt = await txResponse.getReceipt(client);
    console.log(`- Withdraw Receipt ${depositReceipt.status.toString()}`);
  });

  it.skip('should supply native HBAR and get awhbar tokens', async function () {
    await approveToken(whbarTokenContract, lendingPoolContract.address, 103);

    const txn = await lendingPoolContract.deposit(
      whbarTokenAddress,
      // @ts-ignore
      103n,
      owner.address,
      0,
      {
        // @ts-ignore
        value: 103n * 10_000_000_000n,
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
    await borrowWHBAR(100000000000, owner.address);
  });

  it.skip('should repay native HBAR', async function () {
    const amount = 2;
    const debtTokenContract = await setupContract('VariableDebtToken', WHBAR.variableDebt.address);
    const balanceOf = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt before');

    await approveToken(whbarTokenContract, lendingPoolContract.address, amount);

    const repayTxn = await lendingPoolContract.repay(
      whbarTokenAddress,
      // @ts-ignore
      2n,
      2,
      owner.address,
      // @ts-ignore
      { value: 2n * 10_000_000_000n }
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash:', repayTxn.hash);

    const balanceOfAfter = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt after');
    expect(balanceOfAfter).to.be.gte(0);
  });
});
