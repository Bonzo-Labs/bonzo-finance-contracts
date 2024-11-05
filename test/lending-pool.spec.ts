import exp from 'constants';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import deployedContracts from '../deployed-contracts.json';
import outputReserveData from '../scripts/outputReserveData.json';
// import outputReserveData from '../scripts/outputReserveDataTestnet.json';
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
  SAUCE,
  USDC,
  XSAUCE,
  WSTEAM,
  BSTEAM,
  BKARATE,
  KARATE,
  WHBAR,
  LendingPool,
  LendingPoolAddressesProvider,
  AaveOracle,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} = outputReserveData;
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner, contractAddress, spender;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_PROXY || '', provider);
  spender = '0x00000000000000000000000000000000005dbdc1'; // Bonzo spender wallet
}

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
    whbarTokenContract,
    wsteamContract,
    wsteamTokenContract;

  before(async function () {
    console.log('Owner:', owner.address);
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_testnet.address);
    dataProviderContract = await setupContract(
      'AaveProtocolDataProvider',
      AaveProtocolDataProvider.hedera_testnet.address
    );
    whbarContract = await setupContract(
      'WHBARContract',
      '0x0000000000000000000000000000000000163b59'
    );
    whbarTokenContract = await setupContract(
      'ERC20Wrapper',
      '0x0000000000000000000000000000000000163b5a'
    );
    wsteamContract = await setupContract('WSTEAM', '0x06da3554b380de078027157C4DDcef5E2056D82D');
    wsteamTokenContract = await setupContract('ERC20Wrapper', WSTEAM.hedera_testnet.token.address);
  });

  it.skip('should deposit and withdraw SAUCE tokens', async function () {
    console.log('In the test, owner:', owner.address);
    const depositAmount = 200;
    const erc20Contract = await setupContract('ERC20Wrapper', SAUCE.hedera_testnet.token.address);
    console.log('Sauce atoken address = ', SAUCE.hedera_testnet.aToken.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      SAUCE.hedera_testnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', SAUCE.hedera_testnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of SAUCE aTokens after depositing:', balanceDeposit.toString());

    let withdrawAmount = 98;
    const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await aTokenApprove.wait();
    console.log('aToken Approval:', aTokenApprove.hash);

    const withdrawTxn = await lendingPoolContract.withdraw(
      SAUCE.hedera_testnet.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());
    expect(balanceWithdrawal).to.be.gt(0);
  });

  it('should deposit and withdraw WSTEAM tokens', async function () {
    console.log('In the test, owner:', owner.address);
    const depositAmount = ethers.utils.parseUnits('200', 8);

    console.log('WSTEAM atoken address = ', WSTEAM.hedera_testnet.aToken.address);
    await approveAndDeposit(
      wsteamTokenContract,
      owner,
      lendingPoolContract,
      depositAmount,
      WSTEAM.hedera_testnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', WSTEAM.hedera_testnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of WSTEAM aTokens after depositing:', balanceDeposit.toString());

    let withdrawAmount = 98;
    const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await aTokenApprove.wait();
    console.log('aToken Approval:', aTokenApprove.hash);

    const withdrawTxn = await lendingPoolContract.withdraw(
      WSTEAM.hedera_testnet.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());
    expect(balanceDeposit).to.be.gt(0);
  });

  it.skip('should deposit and withdraw BSTEAM tokens', async function () {
    // console.log('In the test, owner:', owner.address);
    // const depositAmount = 2034524608;
    // const erc20Contract = await setupContract('ERC20Wrapper', BSTEAM.hedera_testnet.token.address);
    // console.log('BSTEAM atoken address = ', BSTEAM.hedera_testnet.aToken.address);
    // await approveAndDeposit(
    //   erc20Contract,
    //   owner,
    //   lendingPoolContract,
    //   depositAmount,
    //   BSTEAM.hedera_testnet.token.address,
    //   lendingPoolContract
    // );

    const aTokenContract = await setupContract('AToken', BSTEAM.hedera_testnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of BSTEAM aTokens after depositing:', balanceDeposit.toString());

    // let withdrawAmount = 98;
    // const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    // await aTokenApprove.wait();
    // console.log('aToken Approval:', aTokenApprove.hash);

    // const withdrawTxn = await lendingPoolContract.withdraw(
    //   BSTEAM.hedera_testnet.token.address,
    //   withdrawAmount,
    //   owner.address
    // );
    // await withdrawTxn.wait();
    // console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    // const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    // console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());
    expect(balanceDeposit).to.be.gt(0);
  });

  it.skip('should deposit and withdraw BKARATE tokens', async function () {
    // console.log('In the test, owner:', owner.address);
    // const depositAmount = ethers.utils.parseUnits('403581435', 8);
    // const erc20Contract = await setupContract('ERC20Wrapper', BKARATE.hedera_testnet.token.address);
    // console.log('BKARATE atoken address = ', BKARATE.hedera_testnet.aToken.address);
    // await approveAndDeposit(
    //   erc20Contract,
    //   owner,
    //   lendingPoolContract,
    //   depositAmount,
    //   BKARATE.hedera_testnet.token.address,
    //   lendingPoolContract
    // );

    const aTokenContract = await setupContract('AToken', BKARATE.hedera_testnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of BKARATE aTokens after depositing:', balanceDeposit.toString());

    // let withdrawAmount = 98;
    // const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    // await aTokenApprove.wait();
    // console.log('aToken Approval:', aTokenApprove.hash);

    // const withdrawTxn = await lendingPoolContract.withdraw(
    //   BKARATE.hedera_testnet.token.address,
    //   withdrawAmount,
    //   owner.address
    // );
    // await withdrawTxn.wait();
    // console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    // const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    // console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());
    expect(balanceDeposit).to.be.gt(0);
  });

  it.skip('should be able to transfer aTokens after depositing, but before borrowing', async function () {
    console.log('In the test, owner:', owner.address);
    const depositAmount = 2000;
    const erc20Contract = await setupContract('ERC20Wrapper', SAUCE.hedera_testnet.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      SAUCE.hedera_testnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', SAUCE.hedera_testnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of SAUCE aTokens after depositing:', balanceDeposit.toString());

    const transferTxn = await aTokenContract.transfer(spender, balanceDeposit);
    await transferTxn.wait();
    console.log('Transfer transaction completed...');

    const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after transfer:', balanceWithdrawal.toString());
    expect(balanceWithdrawal).to.be.eq(0);
  });

  // Supply SAUCE, borrow KARATE, try to transfer ALL the SAUCE aTokens
  it.skip('should not be able to withdraw aTokens after borrowing', async function () {
    console.log('In the test, owner:', owner.address);
    const depositAmount = 2000;
    const erc20Contract = await setupContract('ERC20Wrapper', SAUCE.hedera_testnet.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      SAUCE.hedera_testnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', SAUCE.hedera_testnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of SAUCE aTokens after depositing:', balanceDeposit.toString());

    let borrowAmount = 100;
    const borrowTxn = await lendingPoolContract.borrow(
      KARATE.hedera_testnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrowed KARATE tokens: ', borrowTxn.hash);

    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      KARATE.hedera_testnet.variableDebt.address
    );
    const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of KARATE debtTokens:', balanceOfBefore.toString());

    const balanceAfterBorrow = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of SAUCE aTokens after borrow:', balanceAfterBorrow.toString());

    try {
      const transferTxn = await aTokenContract.transfer(spender, balanceDeposit);
      await transferTxn.wait();
      console.log('Was able to transfer ALL aTokens');
    } catch (e) {
      console.error(e);
      console.log("Couldn't transfer ALL aTokens...");
    }

    try {
      const transferTxn = await aTokenContract.transfer(spender, 101);
      await transferTxn.wait();
      console.log('Was able to transfer 101 aTokens');
    } catch (e) {
      console.error(e);
      console.log("Couldn't transfer ALL aTokens...");
    }

    expect(balanceAfterBorrow).to.be.gt(0);
  });

  it.skip('should toggle an asset as collateral for the user', async function () {
    // IMP - The reserve should have aToken balance, otherwise the TXN fails
    const reserve = SAUCE.hedera_testnet.token.address;
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
    const erc20Contract = await setupContract('ERC20Wrapper', KARATE.hedera_testnet.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      KARATE.hedera_testnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', KARATE.hedera_testnet.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of KARATE aTokens after depositing:', balanceOf.toString());

    let withdrawAmount = 98;
    const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await aTokenApprove.wait();
    console.log('aToken Approval:', aTokenApprove.hash);

    const withdrawTxn = await lendingPoolContract.withdraw(
      KARATE.hedera_testnet.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());
    expect(balanceWithdrawal).to.be.gt(0);
  });

  it.skip('should borrow SAUCE DebtTokens', async function () {
    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      SAUCE.hedera_testnet.variableDebt.address
    );
    const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

    const borrowAmount = 2;
    const borrowTxn = await lendingPoolContract.borrow(
      SAUCE.hedera_testnet.token.address,
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
        SAUCE.hedera_testnet.token.address,
        borrowAmount,
        1,
        0,
        owner.address
      )
    ).to.be.revertedWith('101');

    const debtTokenContract = await setupContract(
      'StableDebtToken',
      SAUCE.hedera_testnet.stableDebt.address
    );
    const balanceOf = await debtTokenContract.balanceOf(owner.address);
    expect(balanceOf).to.equal(0);
  });

  it.skip('should return the proper decimals for an asset', async function () {
    const decimals = await lendingPoolContract.getDecimals(SAUCE.hedera_testnet.token.address);
    console.log('Decimals:', decimals.toString());

    expect(decimals).to.be.gt(0);
  });

  it.skip('should deposit and borrow USDC tokens and get back variableDebtTokens', async function () {
    const depositAmount = 1000;
    const erc20Contract = await setupContract('ERC20Wrapper', USDC.hedera_testnet.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      USDC.hedera_testnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', USDC.hedera_testnet.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of USDC aTokens:', balanceOf.toString());

    // const borrowAmount = 15;
    // const borrowTxn = await lendingPoolContract.borrow(
    //   USDC.hedera_testnet.token.address,
    //   borrowAmount,
    //   2,
    //   0,
    //   owner.address
    // );
    // await borrowTxn.wait();
    // console.log('Borrow Transaction hash: ', borrowTxn.hash);

    // const debtTokenContract = await setupContract(
    //   'VariableDebtToken',
    //   USDC.hedera_testnet.variableDebt.address
    // );
    // const balanceOf1 = await debtTokenContract.balanceOf(owner.address);
    // console.log('Balance of USDC debtTokens:', balanceOf1.toString());
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should repay SAUCE tokens and burn variableDebtTokens', async function () {
    let repayAmount = 2;
    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      SAUCE.hedera_testnet.variableDebt.address
    );
    const sauceContract = await setupContract('ERC20Wrapper', SAUCE.hedera_testnet.token.address);

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
      SAUCE.hedera_testnet.token.address,
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
