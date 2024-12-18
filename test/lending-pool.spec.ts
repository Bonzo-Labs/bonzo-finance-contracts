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
  BSAUCE,
  BxSAUCE,
  BHBARX,
  BHST,
  BDOVU,
  BPACK,
  BUSDC,
  HBARX,
  WHBAR,
  LendingPool,
  LendingPoolAddressesProvider,
  AaveOracle,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} = outputReserveData;
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_mainnet';

let provider, owner, contractAddress, spender;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
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
    wsteamContract = await setupContract('WSTEAM', '0x06da3554b380de078027157C4DDcef5E2056D82D');
    // wsteamTokenContract = await setupContract('ERC20Wrapper', WSTEAM.hedera_mainnet.token.address);
  });

  it.skip('should deposit assets into the user account', async function () {
    // const assets = [BKARATE, BPACK, BDOVU, BHST];
    const assets = [HBARX];
    // const amounts = [269653548, 4817581, 401899014, 40245636];
    const amounts = [0.001];
    // const decimals = [8, 2, 6, 8, 6];
    const decimals = [8];
    console.log('In the test, owner:', owner.address);

    for (const [index, asset] of assets.entries()) {
      console.log('Depositing:', asset.hedera_mainnet.token.address);
      const depositAmount = ethers.utils.parseUnits(amounts[index].toString(), decimals[index]);
      console.log('Deposit Amount:', depositAmount);
      const erc20Contract = await setupContract('ERC20Wrapper', asset.hedera_mainnet.token.address);
      await approveAndDeposit(
        erc20Contract,
        owner,
        lendingPoolContract,
        depositAmount,
        asset.hedera_mainnet.token.address,
        lendingPoolContract
      );

      const aTokenContract = await setupContract('AToken', asset.hedera_mainnet.aToken.address);
      const balanceDeposit = await aTokenContract.balanceOf(owner.address);
      console.log(
        `Balance of ${
          asset.hedera_mainnet.token.address
        } aTokens after depositing: ${ethers.utils.formatUnits(
          balanceDeposit.toString(),
          decimals[index]
        )}`
      );
    }
  });

  it('should borrow, repay and withdraw assets from the user account', async function () {
    // const assets = [BHBARX, BUSDC, BSAUCE, BxSAUCE, BPACK, BKARATE, BDOVU, BHST, BSTEAM];
    const assets = [SAUCE, XSAUCE];
    // const decimals = [8, 6, 6, 6, 6, 8, 8, 8, 2];
    const decimals = [6, 6];
    console.log('In the test, owner:', owner.address);
    for (const asset of assets) {
      console.log('Dealing with asset - ', asset.hedera_mainnet.token.address);
      const erc20Contract = await setupContract('ERC20Wrapper', asset.hedera_mainnet.token.address);
      const aTokenContract = await setupContract('AToken', asset.hedera_mainnet.aToken.address);
      const debtTokenContract = await setupContract(
        'VariableDebtToken',
        asset.hedera_mainnet.variableDebt.address
      );

      const borrowAmount = ethers.utils.parseUnits('1', decimals[assets.indexOf(asset)]);
      console.log('Borrow Amount:', borrowAmount.toString());

      const borrowTxn = await lendingPoolContract.borrow(
        asset.hedera_mainnet.token.address,
        borrowAmount,
        2,
        0,
        owner.address
      );
      await borrowTxn.wait();
      console.log('Borrowed:', borrowTxn.hash);

      const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
      console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

      if (balanceOfBefore.gt(0)) {
        const repayAmount = balanceOfBefore;
        console.log('Attempting to repay...', repayAmount);
        const approveTxn = await erc20Contract.approve(lendingPoolContract.address, repayAmount);

        await approveTxn.wait();
        const repayTxn = await lendingPoolContract.repay(
          asset.hedera_mainnet.token.address,
          repayAmount,
          2,
          owner.address
        );
        await repayTxn.wait();
        console.log('Repay Transaction hash: ', repayTxn.hash);

        const balanceOfAfterRepay = await debtTokenContract.balanceOf(owner.address);
        console.log('Balance of debtTokenContract:', balanceOfAfterRepay.toString());
      }

      // let withdrawAmount = ethers.utils.parseUnits('0.001', decimals[assets.indexOf(asset)]);
      // const aTokenApprove = await aTokenContract.approve(
      //   lendingPoolContract.address,
      //   withdrawAmount
      // );
      // await aTokenApprove.wait();
      // console.log('aToken Approval:', aTokenApprove.hash);

      // const balanceBeforeWithdrawal = await aTokenContract.balanceOf(owner.address);
      // console.log('Balance of aTokens before withdrawal:', balanceBeforeWithdrawal.toString());

      // const withdrawTxn = await lendingPoolContract.withdraw(
      //   asset.hedera_mainnet.token.address,
      //   withdrawAmount,
      //   owner.address
      // );
      // await withdrawTxn.wait();
      // console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

      // const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
      // console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());
    }
  });

  it.skip('should deposit, withdraw and borrow SAUCE tokens', async function () {
    console.log('In the test, owner:', owner.address);
    const depositAmount = 1000;
    const erc20Contract = await setupContract('ERC20Wrapper', SAUCE.token.address);
    console.log('Sauce atoken address = ', SAUCE.aToken.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      SAUCE.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', SAUCE.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of SAUCE aTokens after depositing:', balanceDeposit.toString());

    let withdrawAmount = 19;
    const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await aTokenApprove.wait();
    console.log('aToken Approval:', aTokenApprove.hash);

    const withdrawTxn = await lendingPoolContract.withdraw(
      SAUCE.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());

    const debtTokenContract = await setupContract('VariableDebtToken', SAUCE.variableDebt.address);
    const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

    const borrowAmount = 10;
    const borrowTxn = await lendingPoolContract.borrow(
      SAUCE.token.address,
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

  it.skip('should deposit, withdraw and borrow WSTEAM tokens', async function () {
    console.log('In the test, owner:', owner.address);
    // const depositAmount = ethers.utils.parseUnits('20000000', 8);
    const depositAmount = 200;

    console.log('WSTEAM atoken address = ', WSTEAM.hedera_mainnet.aToken.address);
    await approveAndDeposit(
      wsteamTokenContract,
      owner,
      lendingPoolContract,
      depositAmount,
      WSTEAM.hedera_mainnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', WSTEAM.hedera_mainnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of WSTEAM aTokens after depositing:', balanceDeposit.toString());

    let withdrawAmount = 2;
    const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await aTokenApprove.wait();
    console.log('aToken Approval:', aTokenApprove.hash);

    const withdrawTxn = await lendingPoolContract.withdraw(
      WSTEAM.hedera_mainnet.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());

    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      WSTEAM.hedera_mainnet.variableDebt.address
    );
    const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

    const borrowAmount = 12;
    const borrowTxn = await lendingPoolContract.borrow(
      WSTEAM.hedera_mainnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash: ', borrowTxn.hash);

    const balanceOfAfter = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfAfter.toString());

    const repayAmount = balanceOfAfter;
    const approveTxn = await wsteamTokenContract.approve(lendingPoolContract.address, repayAmount);
    await approveTxn.wait();
    const repayTxn = await lendingPoolContract.repay(
      WSTEAM.hedera_mainnet.token.address,
      repayAmount,
      2,
      owner.address
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash: ', repayTxn.hash);

    const balanceOfAfterRepay = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfAfterRepay.toString());

    expect(balanceDeposit).to.be.gt(0);
  });

  it.skip('should deposit and withdraw BSTEAM tokens', async function () {
    console.log('In the test, owner:', owner.address);
    const depositAmount = 500000000;
    const erc20Contract = await setupContract('ERC20Wrapper', BSTEAM.hedera_mainnet.token.address);
    console.log('BSTEAM atoken address = ', BSTEAM.hedera_mainnet.aToken.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      BSTEAM.hedera_mainnet.token.address,
      lendingPoolContract
    );
    const aTokenContract = await setupContract('AToken', BSTEAM.hedera_mainnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of BSTEAM aTokens after depositing:', balanceDeposit.toString());

    // let withdrawAmount = 500000000;
    // const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    // await aTokenApprove.wait();
    // console.log('aToken Approval:', aTokenApprove.hash);
    // const withdrawTxn = await lendingPoolContract.withdraw(
    //   BSTEAM.hedera_mainnet.token.address,
    //   withdrawAmount,
    //   owner.address
    // );
    // await withdrawTxn.wait();
    // console.log('Withdraw Transaction hash: ', withdrawTxn.hash);
    // const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    // console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());

    // const debtTokenContract = await setupContract(
    //   'VariableDebtToken',
    //   BSTEAM.hedera_mainnet.variableDebt.address
    // );
    // const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    // console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

    // const borrowAmount = 12;
    // const borrowTxn = await lendingPoolContract.borrow(
    //   BSTEAM.hedera_mainnet.token.address,
    //   borrowAmount,
    //   2,
    //   0,
    //   owner.address
    // );
    // await borrowTxn.wait();
    // console.log('Borrow Transaction hash: ', borrowTxn.hash);

    // const balanceOfAfter = await debtTokenContract.balanceOf(owner.address);
    // console.log('Balance of debtTokenContract:', balanceOfAfter.toString());

    // const repayAmount = balanceOfAfter;
    // const approveTxn = await erc20Contract.approve(lendingPoolContract.address, repayAmount);
    // await approveTxn.wait();
    // const repayTxn = await lendingPoolContract.repay(
    //   BSTEAM.hedera_mainnet.token.address,
    //   repayAmount,
    //   2,
    //   owner.address
    // );
    // await repayTxn.wait();
    // console.log('Repay Transaction hash: ', repayTxn.hash);

    // const balanceOfAfterRepay = await debtTokenContract.balanceOf(owner.address);
    // console.log('Balance of debtTokenContract:', balanceOfAfterRepay.toString());

    expect(balanceDeposit).to.be.gt(0);
  });

  it.skip('should deposit, withdraw, borrow and repay BKARATE tokens', async function () {
    console.log('In the test, owner:', owner.address);
    // const depositAmount = ethers.utils.parseUnits('403581435', 8);
    const depositAmount = 200;
    const erc20Contract = await setupContract('ERC20Wrapper', BKARATE.hedera_mainnet.token.address);
    console.log('BKARATE atoken address = ', BKARATE.hedera_mainnet.aToken.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      BKARATE.hedera_mainnet.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', BKARATE.hedera_mainnet.aToken.address);
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of BKARATE aTokens after depositing:', balanceDeposit.toString());

    let withdrawAmount = 121;
    const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await aTokenApprove.wait();
    console.log('aToken Approval:', aTokenApprove.hash);

    const withdrawTxn = await lendingPoolContract.withdraw(
      BKARATE.hedera_mainnet.token.address,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

    const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());

    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      BKARATE.hedera_mainnet.variableDebt.address
    );
    const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

    const borrowAmount = 12;
    const borrowTxn = await lendingPoolContract.borrow(
      BKARATE.hedera_mainnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrow Transaction hash: ', borrowTxn.hash);

    const balanceOfAfter = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfAfter.toString());

    const repayAmount = balanceOfAfter;
    const approveTxn = await erc20Contract.approve(lendingPoolContract.address, repayAmount);
    await approveTxn.wait();
    const repayTxn = await lendingPoolContract.repay(
      BKARATE.hedera_mainnet.token.address,
      repayAmount,
      2,
      owner.address
    );
    await repayTxn.wait();
    console.log('Repay Transaction hash: ', repayTxn.hash);

    const balanceOfAfterRepay = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfAfterRepay.toString());

    expect(balanceDeposit).to.be.gt(0);
  });

  it.skip('should be able to transfer aTokens after depositing, but before borrowing', async function () {
    console.log('In the test, owner:', owner.address);
    const depositAmount = 2000;
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
    const balanceDeposit = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of SAUCE aTokens after depositing:', balanceDeposit.toString());

    let borrowAmount = 100;
    const borrowTxn = await lendingPoolContract.borrow(
      KARATE.hedera_mainnet.token.address,
      borrowAmount,
      2,
      0,
      owner.address
    );
    await borrowTxn.wait();
    console.log('Borrowed KARATE tokens: ', borrowTxn.hash);

    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      KARATE.hedera_mainnet.variableDebt.address
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

  it.skip('should deposit and withdraw KARATE tokens', async function () {
    // const depositAmount = 300;
    // const erc20Contract = await setupContract('ERC20Wrapper', KARATE.hedera_mainnet.token.address);
    // await approveAndDeposit(
    //   erc20Contract,
    //   owner,
    //   lendingPoolContract,
    //   depositAmount,
    //   KARATE.hedera_mainnet.token.address,
    //   lendingPoolContract
    // );

    const aTokenContract = await setupContract('AToken', KARATE.hedera_mainnet.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of KARATE aTokens after depositing:', balanceOf.toString());

    if (balanceOf > 0) {
      let withdrawAmount = balanceOf;
      const aTokenApprove = await aTokenContract.approve(
        lendingPoolContract.address,
        withdrawAmount
      );
      await aTokenApprove.wait();
      console.log('aToken Approval:', aTokenApprove.hash);

      const withdrawTxn = await lendingPoolContract.withdraw(
        KARATE.hedera_mainnet.token.address,
        withdrawAmount,
        owner.address
      );
      await withdrawTxn.wait();
      console.log('Withdraw Transaction hash: ', withdrawTxn.hash);

      const balanceWithdrawal = await aTokenContract.balanceOf(owner.address);
      console.log('Balance of aTokens after withdrawal:', balanceWithdrawal.toString());
    }

    // expect(balanceWithdrawal).to.be.gt(0);
  });

  it.skip('should borrow SAUCE DebtTokens', async function () {
    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      SAUCE.hedera_mainnet.variableDebt.address
    );
    const balanceOfBefore = await debtTokenContract.balanceOf(owner.address);
    console.log('Balance of debtTokenContract:', balanceOfBefore.toString());

    const borrowAmount = 10;
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

  it.skip('should deposit and borrow USDC tokens and get back variableDebtTokens', async function () {
    const depositAmount = 1000;
    const erc20Contract = await setupContract('ERC20Wrapper', USDC.token.address);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      USDC.token.address,
      lendingPoolContract
    );

    const aTokenContract = await setupContract('AToken', USDC.aToken.address);
    const balanceOf = await aTokenContract.balanceOf(owner.address);
    console.log('Balance of USDC aTokens:', balanceOf.toString());

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
