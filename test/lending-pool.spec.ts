import exp from 'constants';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import deployedContracts from '../deployed-contracts.json';
import outputReserveData from '../scripts/outputReserveData.json';
// import outputReserveData from '../scripts/outputReserveDataCurrent.json';
import {
  AccountId,
  PrivateKey,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  Client,
  Hbar,
  HbarUnit,
} from '@hashgraph/sdk';

const {
  LendingPool,
  LendingPoolAddressesProvider,
  AaveOracle,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} = deployedContracts;
const { SAUCE, USDC, XSAUCE, KARATE, WHBAR } = outputReserveData;
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_mainnet';

const api_key = process.env.QUICKNODE_API_KEY;
const quicknode_url = `https://serene-long-resonance.hedera-mainnet.quiknode.pro/${api_key}/`;

let provider, owner, contractAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_PROXY || '', provider);
}

// let delegator = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

const whbarTokenId = '0.0.15058';
const whbarContractId = '0.0.15057'; // TestWHBAR contract

const client = Client.forTestnet();
const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
client.setOperator(operatorAccountId, operatorPrKey);

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function approveAndDeposit(
  erc20Contract,
  owner1,
  spenderContract,
  amount,
  tokenAddress,
  lendingPoolContract
) {
  const balance = await erc20Contract.balanceOf(owner1.address);
  console.log('Balance:', balance.toString());
  if (balance.lt(amount)) throw new Error('Insufficient balance');

  const allowance = await erc20Contract.allowance(owner1.address, spenderContract.address);
  console.log('Allowance:', allowance.toString());
  console.log('Amount:', amount.toString());
  console.log('Spender:', spenderContract.address);
  if (allowance.lt(amount)) {
    console.log('Approving...');
    const approveTx = await erc20Contract.approve(spenderContract.address, amount);
    await approveTx.wait();
    console.log('Approved:', approveTx.hash);
  }

  console.log('Depositing...');
  const depositTx = await lendingPoolContract.deposit(tokenAddress, amount, owner1.address, 0);
  await depositTx.wait();
  console.log('Deposited:', depositTx.hash);
}

describe('Lending Pool Contract Tests', function () {
  let lendingPoolContract,
    aTokenContract,
    erc20Contract,
    dataProviderContract,
    whbarContract,
    whbarTokenContract;

  before(async function () {
    console.log('Owner:', owner.address);
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_mainnet.address);
    dataProviderContract = await setupContract(
      'AaveProtocolDataProvider',
      AaveProtocolDataProvider.hedera_mainnet.address
    );
    whbarContract = await setupContract(
      'WHBARContract',
      '0x0000000000000000000000000000000000163b59'
    );
    whbarTokenContract = await setupContract(
      'ERC20Wrapper',
      '0x0000000000000000000000000000000000163b5a'
    );
  });

  // TODO - Test with supply and borrow caps 0

  it.skip('should toggle an asset as collateral for the user', async function () {
    // IMP - The reserve should have aToken balance, otherwise the TXN fails
    const reserve = SAUCE.hedera_mainnet.token.address;
    const userReserveData = await dataProviderContract.getUserReserveData(reserve, owner.address);
    console.log('User Reserve Data:', userReserveData);
    if (userReserveData.usageAsCollateralEnabled) {
      const tx = await lendingPoolContract.setUserUseReserveAsCollateral(reserve, false);
      await tx.wait();
      console.log('Transaction hash:', tx.hash);
    } else {
      const tx = await lendingPoolContract.setUserUseReserveAsCollateral(reserve, true);
      await tx.wait();
      console.log('Transaction hash:', tx.hash);
    }

    expect(userReserveData.usageAsCollateralEnabled).to.exist;
  });

  it.skip('should return reserves list and data for each reserve', async function () {
    const reservesList = await lendingPoolContract.getReservesList();
    console.log('Reserves List:', reservesList);

    for (const reserve of reservesList) {
      const reserveData = await lendingPoolContract.getReserveData(reserve);
      console.log('Reserve Data:', reserveData);
    }

    expect(reservesList).to.not.be.null;
  });

  it.skip('should deposit and borrow KARATE tokens', async function () {
    const depositAmount = 300;
    const borrowAmount = 10;
    const erc20Contract = await setupContract('ERC20Wrapper', KARATE.hedera_mainnet.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      KARATE.hedera_mainnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', KARATE.hedera_mainnet.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of KARATE aTokens:', balanceOf.toString());

    const borrowTxn = await lendingPoolContract.borrow(
      KARATE.hedera_mainnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();

    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      KARATE.hedera_mainnet.variableDebt.address
    );
    const balanceOfDebt = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfDebt.toString());

    expect(balanceOfDebt).to.be.gt(0);
  });

  it('should deposit SAUCE tokens and get back aTokens', async function () {
    const depositAmount = 2000000;
    const erc20Contract = await setupContract('ERC20Wrapper', SAUCE.hedera_mainnet.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      SAUCE.hedera_mainnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', SAUCE.hedera_mainnet.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of SAUCE aTokens:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should withdraw SAUCE tokens and burn aTokens', async function () {
    let withdrawAmount = 5;
    const aTokenContract = await setupContract('AToken', SAUCE.hedera_mainnet.aToken.address);
    const balance = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens before:', balance.toString());

    const withdrawTxn = await lendingPoolContract.withdraw(
      SAUCE.hedera_mainnet.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should borrow SAUCE DebtTokens', async function () {
    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      SAUCE.hedera_mainnet.variableDebt.address
    );
    const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

    const borrowAmount = 2;
    const borrowTxn = await lendingPoolContract.borrow(
      SAUCE.hedera_mainnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash: ', borrowTxn.hash);

    const balanceOfAfter = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfAfter.toString());
    expect(balanceOfAfter).to.be.gt(0);
  });

  it.skip('should fail to borrow SAUCE tokens at a stable rate', async function () {
    const borrowAmount = 104;

    await expect(
      lendingPoolContract.borrow(
        SAUCE.hedera_mainnet.token.address,
        borrowAmount,
        1,
        0,
        owner.address
      )
    ).to.be.revertedWith('101');

    const debtTokenContract = await setupContract(
      'StableDebtToken',
      SAUCE.hedera_mainnet.stableDebt.address
    );
    const balanceOf = await debtTokenContract.balanceOf(owner.address);
    expect(balanceOf).to.equal(0);
  });

  it.skip('should return the proper decimals for an asset', async function () {
    const decimals = await lendingPoolContract.getDecimals(SAUCE.hedera_mainnet.token.address);
    console.log('Decimals:', decimals.toString());

    expect(decimals).to.be.gt(0);
  });

  it.skip('should deposit KARATE tokens and borrow KARATE tokens', async function () {
    // const depositAmount = 10000;
    // const erc20Contract = await setupContract('ERC20Wrapper', KARATE.token.address);
    // await approveAndDeposit(
    //   erc20Contract,
    //   owner,
    //   lendingPoolContract,
    //   depositAmount,
    //   KARATE.token.address,
    //   lendingPoolContract
    // );

    const aTokenContract = await setupContract('AToken', KARATE.hedera_mainnet.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of KARATE aTokens:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);

    const borrowAmount = 1000;
    const borrowTxn = await lendingPoolContract.borrow(
      KARATE.hedera_mainnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash:', borrowTxn.hash);

    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      KARATE.hedera_mainnet.variableDebt.address
    );
    const balanceOf1 = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of KARATE debtTokens:', balanceOf1.toString());

    const repayAmount = 12;
    const repayTxn = await lendingPoolContract.repay(
      KARATE.hedera_mainnet.token.address,
      repayAmount,
      2,
      owner.address
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash:', repayTxn.hash);

    const balanceOf2 = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of KARATE debtTokens after:', balanceOf2.toString());
    expect(balanceOf2).to.be.gt(0);
  });

  it.skip('should deposit and borrow USDC tokens and get back variableDebtTokens', async function () {
    const depositAmount = 1000;
    const erc20Contract = await setupContract('ERC20Wrapper', USDC.hedera_mainnet.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      USDC.hedera_mainnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', USDC.hedera_mainnet.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of USDC aTokens:', balanceOf.toString());

    const borrowAmount = 15;
    const borrowTxn = await lendingPoolContract.borrow(
      USDC.hedera_mainnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash: ', borrowTxn.hash);

    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      USDC.hedera_mainnet.variableDebt.address
    );
    const balanceOf1 = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of USDC debtTokens:', balanceOf1.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should repay SAUCE tokens and burn variableDebtTokens', async function () {
    let repayAmount = 2;
    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      SAUCE.hedera_mainnet.variableDebt.address
    );
    const sauceContract = await setupContract('ERC20Wrapper', SAUCE.hedera_mainnet.token.address);

    const balanceBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract before:', balanceBefore.toString());
    // repayAmount = balanceBefore;

    const sauceBalance = await sauceContract.balanceOf(owner.address);
    if (sauceBalance.lt(repayAmount)) throw new Error('Insufficient balance');

    const allowance = await sauceContract.allowance(owner.address, lendingPoolContract.address);
    if (allowance.lt(repayAmount)) {
      console.log('Approving...');
      const approveTxn = await sauceContract.approve(lendingPoolContract.address, repayAmount);
      await approveTxn.wait();
      console.log('Approved:', approveTxn.hash);
    }

    const repayTxn = await lendingPoolContract.repay(
      SAUCE.hedera_mainnet.token.address,
      repayAmount,
      2,
      owner.address
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash: ', repayTxn.hash);

    const balanceOf = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract after:', balanceOf.toString());
    expect(balanceOf).to.be.gte(0);
  });
});
