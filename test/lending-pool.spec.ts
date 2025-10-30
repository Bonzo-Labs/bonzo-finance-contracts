import exp from 'constants';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import hre from 'hardhat';
import deployedContracts from '../deployed-contracts.json';
// import outputReserveData from '../scripts/outputReserveDataTestnet.json';
import outputReserveData from '../scripts/outputReserveData.json';
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
  KARATE,
  BONZO,
  KBL,
  XPACK,
  GRELF,
  HBARX,
  WHBAR,
  WHBARE,
  WETH,
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
}

const client = Client.forTestnet();
const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
client.setOperator(operatorAccountId, operatorPrKey);

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

// Minimal ABI for WHBAR(E) wrapper token to mint via native HBAR
const WHBAR_MIN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function deposit() payable',
];

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
    // For Hedera HTS tokens, reset allowance to 0 first if there's an existing non-zero allowance
    if (allowance.gt(0)) {
      console.log('Resetting allowance to 0 first...');
      const resetTx = await erc20Contract.approve(spenderContract.address, 0, {
        gasLimit: 1000000, // Manual gas limit required for HTS tokens
      });
      await resetTx.wait();
      console.log('Reset allowance:', resetTx.hash);
    }
    console.log('Approving...');
    const approveTx = await erc20Contract.approve(spenderContract.address, amount, {
      gasLimit: 1000000, // Manual gas limit required for HTS tokens
    });
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
    const assets = [XSAUCE];
    const amounts = [22];
    const decimals = [6];

    console.log('In the test, owner:', owner.address);

    for (const [index, asset] of assets.entries()) {
      console.log('Depositing:', asset.hedera_mainnet.token.address);
      const depositAmount = ethers.utils.parseUnits(amounts[index].toString(), decimals[index]);
      // const depositAmount = amounts[index];
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

  it('should deposit, borrow, withdraw and repay for USDC and SAUCE', async function () {
    // const assets = [HBARX, USDC, SAUCE];
    // const decimals = [8, 6, 6];
    const assets = [SAUCE, BONZO];
    const decimals = [6, 8];
    console.log('In the test, owner:', owner.address);

    for (const [index, asset] of assets.entries()) {
      const tokenAddr = asset[chain_type].token.address;
      const aTokenAddr = asset[chain_type].aToken.address;
      const variableDebtAddr = asset[chain_type].variableDebt.address;
      console.log('\n============================================================');
      console.log(`🪙 Asset: ${tokenAddr}`);
      console.log(`🔗 aToken: ${aTokenAddr}`);
      console.log(`🧾 VariableDebt: ${variableDebtAddr}`);
      console.log('------------------------------------------------------------');

      const erc20Contract = await setupContract('ERC20Wrapper', tokenAddr);
      const aTokenContract = await setupContract('AToken', aTokenAddr);
      const debtTokenContract = await setupContract('VariableDebtToken', variableDebtAddr);

      // 1) Deposit 1
      const depositAmount = ethers.utils.parseUnits('1', decimals[index]);
      console.log(`\n💰 Deposit → ${ethers.utils.formatUnits(depositAmount, decimals[index])}`);
      await approveAndDeposit(
        erc20Contract,
        owner,
        lendingPoolContract,
        depositAmount,
        tokenAddr,
        lendingPoolContract
      );
      const aTokenBalanceAfterDeposit = await aTokenContract.balanceOf(owner.address);
      console.log(
        `   ✅ aToken after deposit: ${ethers.utils.formatUnits(
          aTokenBalanceAfterDeposit.toString(),
          decimals[index]
        )}`
      );
      const debtAfterDeposit = await debtTokenContract.balanceOf(owner.address);
      console.log(
        `   🧮 Debt after deposit: ${ethers.utils.formatUnits(
          debtAfterDeposit.toString(),
          decimals[index]
        )}`
      );

      // 2) Borrow 0.1
      const borrowAmount = ethers.utils.parseUnits('0.1', decimals[index]);
      console.log(`\n📥 Borrow → ${ethers.utils.formatUnits(borrowAmount, decimals[index])}`);
      const overrides = { gasLimit: 3000000 };
      console.log('   🔧 Attempting actual borrow with gas limit:', overrides.gasLimit);

      const borrowTxn = await lendingPoolContract.borrow(
        tokenAddr,
        borrowAmount,
        2,
        0,
        owner.address,
        overrides
      );
      const receipt = await borrowTxn.wait();
      console.log('   ✅ Borrow successful! Gas used:', receipt.gasUsed.toString());
      console.log(`   ✅ Borrow tx: ${borrowTxn.hash}`);
      const aTokenAfterBorrow = await aTokenContract.balanceOf(owner.address);
      const debtAfterBorrow = await debtTokenContract.balanceOf(owner.address);
      console.log(
        `   🟣 aToken after borrow: ${ethers.utils.formatUnits(
          aTokenAfterBorrow.toString(),
          decimals[index]
        )}`
      );
      console.log(
        `   🔻 Debt after borrow: ${ethers.utils.formatUnits(
          debtAfterBorrow.toString(),
          decimals[index]
        )}`
      );

      // 3) Withdraw 0.01
      const withdrawAmount = ethers.utils.parseUnits('0.01', decimals[index]);
      console.log(`\n🏧 Withdraw → ${ethers.utils.formatUnits(withdrawAmount, decimals[index])}`);
      const aTokenApprove = await aTokenContract.approve(
        lendingPoolContract.address,
        withdrawAmount
      );
      await aTokenApprove.wait();
      console.log(`   📝 aToken approve tx: ${aTokenApprove.hash}`);
      const withdrawTxn = await lendingPoolContract.withdraw(
        tokenAddr,
        withdrawAmount,
        owner.address
      );
      await withdrawTxn.wait();
      console.log(`   ✅ Withdraw tx: ${withdrawTxn.hash}`);
      const aTokenAfterWithdraw = await aTokenContract.balanceOf(owner.address);
      const debtAfterWithdraw = await debtTokenContract.balanceOf(owner.address);
      console.log(
        `   🟢 aToken after withdraw: ${ethers.utils.formatUnits(
          aTokenAfterWithdraw.toString(),
          decimals[index]
        )}`
      );
      console.log(
        `   🧮 Debt after withdraw: ${ethers.utils.formatUnits(
          debtAfterWithdraw.toString(),
          decimals[index]
        )}`
      );

      // 4) Repay remaining
      let currentDebt = await debtTokenContract.balanceOf(owner.address);

      console.log(
        `\n💸 Repay → current debt: ${ethers.utils.formatUnits(
          currentDebt.toString(),
          decimals[index]
        )}`
      );
      if (currentDebt.gt(0)) {
        const currentAllowance = await erc20Contract.allowance(
          owner.address,
          lendingPoolContract.address
        );
        if (currentAllowance.lt(currentDebt)) {
          if (currentAllowance.gt(0)) {
            const resetTx = await erc20Contract.approve(lendingPoolContract.address, 0, {
              gasLimit: 1000000,
            });
            await resetTx.wait();
          }
          const approveTxn = await erc20Contract.approve(lendingPoolContract.address, currentDebt, {
            gasLimit: 1000000,
          });
          await approveTxn.wait();
          console.log(`   📝 Approve repay tx: ${approveTxn.hash}`);
        }

        const repayTxn = await lendingPoolContract.repay(
          tokenAddr,
          currentDebt / 2,
          2,
          owner.address
        );
        await repayTxn.wait();
        console.log(`   ✅ Repay tx: ${repayTxn.hash}`);
        const aTokenAfterRepay = await aTokenContract.balanceOf(owner.address);
        const balanceOfAfterRepay = await debtTokenContract.balanceOf(owner.address);
        console.log(
          `   🟦 aToken after repay: ${ethers.utils.formatUnits(
            aTokenAfterRepay.toString(),
            decimals[index]
          )}`
        );
        console.log(
          `   🟨 Debt after repay: ${ethers.utils.formatUnits(
            balanceOfAfterRepay.toString(),
            decimals[index]
          )}`
        );
        console.log('------------------------------------------------------------\n');
        expect(balanceOfAfterRepay).to.be.gte(0);
      }
    }
  });

  it.skip('should deposit, borrow, withdraw and repay for WETH', async function () {
    const asset = WETH;
    const decimals = 18; // WETH uses 18 decimals
    console.log('In the test, owner:', owner.address);

    const tokenAddr = asset[chain_type].token.address;
    const aTokenAddr = asset[chain_type].aToken.address;
    const variableDebtAddr = asset[chain_type].variableDebt.address;
    console.log('\n============================================================');
    console.log(`🪙 Asset: WETH`);
    console.log(`🔗 Token Address: ${tokenAddr}`);
    console.log(`🔗 aToken: ${aTokenAddr}`);
    console.log(`🧾 VariableDebt: ${variableDebtAddr}`);
    console.log('------------------------------------------------------------');

    const erc20Contract = await setupContract('ERC20Wrapper', tokenAddr);
    const aTokenContract = await setupContract('AToken', aTokenAddr);
    const debtTokenContract = await setupContract('VariableDebtToken', variableDebtAddr);

    // 1) Deposit 1 WETH
    const depositAmount = ethers.utils.parseUnits('1', decimals);
    console.log(`\n💰 Deposit → ${ethers.utils.formatUnits(depositAmount, decimals)} WETH`);
    await approveAndDeposit(
      erc20Contract,
      owner,
      lendingPoolContract,
      depositAmount,
      tokenAddr,
      lendingPoolContract
    );
    const aTokenBalanceAfterDeposit = await aTokenContract.balanceOf(owner.address);
    console.log(
      `   ✅ aToken after deposit: ${ethers.utils.formatUnits(
        aTokenBalanceAfterDeposit.toString(),
        decimals
      )}`
    );
    const debtAfterDeposit = await debtTokenContract.balanceOf(owner.address);
    console.log(
      `   🧮 Debt after deposit: ${ethers.utils.formatUnits(debtAfterDeposit.toString(), decimals)}`
    );

    // 2) Borrow 0.1 WETH
    const borrowAmount = ethers.utils.parseUnits('0.1', decimals);
    console.log(`\n📥 Borrow → ${ethers.utils.formatUnits(borrowAmount, decimals)} WETH`);
    const overrides = { gasLimit: 3000000 };
    console.log('   🔧 Attempting actual borrow with gas limit:', overrides.gasLimit);

    const borrowTxn = await lendingPoolContract.borrow(
      tokenAddr,
      borrowAmount,
      2,
      0,
      owner.address,
      overrides
    );
    const receipt = await borrowTxn.wait();
    console.log('   ✅ Borrow successful! Gas used:', receipt.gasUsed.toString());
    console.log(`   ✅ Borrow tx: ${borrowTxn.hash}`);
    const aTokenAfterBorrow = await aTokenContract.balanceOf(owner.address);
    const debtAfterBorrow = await debtTokenContract.balanceOf(owner.address);
    console.log(
      `   🟣 aToken after borrow: ${ethers.utils.formatUnits(
        aTokenAfterBorrow.toString(),
        decimals
      )}`
    );
    console.log(
      `   🔻 Debt after borrow: ${ethers.utils.formatUnits(debtAfterBorrow.toString(), decimals)}`
    );

    // 3) Withdraw 0.01 WETH
    const withdrawAmount = ethers.utils.parseUnits('0.01', decimals);
    console.log(`\n🏧 Withdraw → ${ethers.utils.formatUnits(withdrawAmount, decimals)} WETH`);
    const aTokenApprove = await aTokenContract.approve(lendingPoolContract.address, withdrawAmount);
    await aTokenApprove.wait();
    console.log(`   📝 aToken approve tx: ${aTokenApprove.hash}`);
    const withdrawTxn = await lendingPoolContract.withdraw(
      tokenAddr,
      withdrawAmount,
      owner.address
    );
    await withdrawTxn.wait();
    console.log(`   ✅ Withdraw tx: ${withdrawTxn.hash}`);
    const aTokenAfterWithdraw = await aTokenContract.balanceOf(owner.address);
    const debtAfterWithdraw = await debtTokenContract.balanceOf(owner.address);
    console.log(
      `   🟢 aToken after withdraw: ${ethers.utils.formatUnits(
        aTokenAfterWithdraw.toString(),
        decimals
      )}`
    );
    console.log(
      `   🧮 Debt after withdraw: ${ethers.utils.formatUnits(
        debtAfterWithdraw.toString(),
        decimals
      )}`
    );

    // 4) Repay remaining
    let currentDebt = await debtTokenContract.balanceOf(owner.address);

    console.log(
      `\n💸 Repay → current debt: ${ethers.utils.formatUnits(
        currentDebt.toString(),
        decimals
      )} WETH`
    );
    if (currentDebt.gt(0)) {
      const currentAllowance = await erc20Contract.allowance(
        owner.address,
        lendingPoolContract.address
      );
      if (currentAllowance.lt(currentDebt)) {
        if (currentAllowance.gt(0)) {
          const resetTx = await erc20Contract.approve(lendingPoolContract.address, 0, {
            gasLimit: 1000000,
          });
          await resetTx.wait();
        }
        const approveTxn = await erc20Contract.approve(lendingPoolContract.address, currentDebt, {
          gasLimit: 1000000,
        });
        await approveTxn.wait();
        console.log(`   📝 Approve repay tx: ${approveTxn.hash}`);
      }

      const repayTxn = await lendingPoolContract.repay(
        tokenAddr,
        currentDebt / 10,
        2,
        owner.address
      );
      await repayTxn.wait();
      console.log(`   ✅ Repay tx: ${repayTxn.hash}`);
      const aTokenAfterRepay = await aTokenContract.balanceOf(owner.address);
      const balanceOfAfterRepay = await debtTokenContract.balanceOf(owner.address);
      console.log(
        `   🟦 aToken after repay: ${ethers.utils.formatUnits(
          aTokenAfterRepay.toString(),
          decimals
        )}`
      );
      console.log(
        `   🟨 Debt after repay: ${ethers.utils.formatUnits(
          balanceOfAfterRepay.toString(),
          decimals
        )}`
      );
      console.log('------------------------------------------------------------\n');
      expect(balanceOfAfterRepay).to.be.gte(0);
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
