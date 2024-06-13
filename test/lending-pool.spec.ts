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

let provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
let owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

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

function getRevertReason(transactionRecord) {
  // Extract the revert reason from the transaction record
  const result = transactionRecord.contractFunctionResult;
  if (result && result.errorMessage) {
    return result.errorMessage;
  }
  return 'No revert reason found';
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
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_testnet.address);
    dataProviderContract = await setupContract(
      'AaveProtocolDataProvider',
      AaveProtocolDataProvider.hedera_testnet.address
    );
    whbarContract = await setupContract(
      'WHBARContract',
      '0x0000000000000000000000000000000000003ad1'
    );
    whbarTokenContract = await setupContract(
      'ERC20Wrapper',
      '0x0000000000000000000000000000000000003aD2'
    );
  });

  it('should supply native HBAR from the signer and get awhbar tokens', async function () {
    const hbarBalance = await owner.getBalance();
    console.log('HBAR Balance:', hbarBalance.toString());

    const address = await lendingPoolContract.getWhbarAddress();
    console.log('WHBAR Address inside the contract:', address);

    // NOTE - Refer to this link for why we're converting the tinybars to weibars https://docs.hedera.com/hedera/tutorials/smart-contracts/hscs-workshop/hardhat
    const txn = await lendingPoolContract.deposit(
      '0x0000000000000000000000000000000000003aD2',
      1232,
      owner.address,
      0,
      // @ts-ignore
      { value: 1232n * 10_000_000_000n }
    );
    await txn.wait();
    console.log('Transaction hash:', txn.hash);

    // Sleep for 5 seconds to allow the transaction to be processed
    await new Promise((r) => setTimeout(r, 5000));

    const aTokenContract = await setupContract('AToken', WHBAR.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens:', balanceOf.toString());

    // expect(balanceOf).to.be.gt(0);
  });

  it.skip('should toggle an asset as collateral for the user', async function () {
    // IMP - The reserve should have aToken balance, otherwise the TXN fails
    const reserve = SAUCE.token.address;
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
    const depositAmount = 100000;
    const borrowAmount = 10;
    const erc20Contract = await setupContract('ERC20Wrapper', KARATE.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      KARATE.token.address,
      lendingPoolContract
    );

    const userData = await lendingPoolContract.getUserAccountData(owner.address);
    console.log('User Data after deposit:', userData);

    const borrowTxn = await lendingPoolContract.borrow(
      KARATE.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();

    const userData1 = await lendingPoolContract.getUserAccountData(owner.address);
    console.log('User Data after borrow:', userData1);

    expect(userData).to.exist;
  });

  it.skip('should deposit SAUCE tokens and get back aTokens', async function () {
    const depositAmount = 10000000;
    const erc20Contract = await setupContract('ERC20Wrapper', SAUCE.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      SAUCE.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', SAUCE.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should deposit CLXY tokens and get back aTokens', async function () {
    const depositAmount = 200;
    const erc20Contract = await setupContract('ERC20Wrapper', CLXY.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      CLXY.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', CLXY.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should withdraw CLXY tokens and burn aTokens', async function () {
    let withdrawAmount = 100;
    const aTokenContract = await setupContract('AToken', CLXY.aToken.address);
    const balance = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens before:', balance.toString());
    withdrawAmount = balance;

    const withdrawTxn = await lendingPoolContract.withdraw(
      CLXY.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should deposit and borrow USDC tokens and get back variableDebtTokens', async function () {
    const depositAmount = 100000;
    const erc20Contract = await setupContract('ERC20Wrapper', USDC.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      USDC.token.address,
      lendingPoolContract
    );

    const borrowAmount = 15;
    const borrowTxn = await lendingPoolContract.borrow(
      USDC.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash: ', borrowTxn.hash);

    const debtTokenContract = await setupContract('VariableDebtToken', USDC.variableDebt.address);
    const balanceOf = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should borrow SAUCE with a stable rate get back stableDebtTokens', async function () {
    const borrowAmount = 10;
    const borrowTxn = await lendingPoolContract.borrow(
      CLXY.token.address,
      borrowAmount,
      1,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash: ', borrowTxn.hash);

    const debtTokenContract = await setupContract('StableDebtToken', CLXY.stableDebt.address);
    const balanceOf = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should repay SAUCE tokens and burn variableDebtTokens', async function () {
    let repayAmount = 10;
    const debtTokenContract = await setupContract('VariableDebtToken', USDC.variableDebt.address);
    const sauceContract = await setupContract('ERC20Wrapper', USDC.token.address);

    const balanceBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract before:', balanceBefore.toString());
    repayAmount = balanceBefore;

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
      USDC.token.address,
      repayAmount,
      2,
      owner.address
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash: ', repayTxn.hash);

    const balanceOf = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract after:', balanceOf.toString());
    expect(balanceOf).to.be.gt(0);
  });
});
