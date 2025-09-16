import { expect } from 'chai';
import { ethers } from 'hardhat';
import outputReserveData from '../scripts/outputReserveData.json';

// Pure ERC20 WHBAR minimal ABI for tests
const WHBAR_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function deposit() payable',
  'function withdraw(uint256)',
];

const { WHBARE, LendingPool } = outputReserveData;

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner, whbarTokenAddress, whbarGatewayAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  whbarTokenAddress = WHBARE.hedera_testnet.token.address;
  whbarGatewayAddress = '0x573D2EA9946C36cE266A826b7be7dAee5314B381';
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_LIQUIDATIONS || '', provider);
  whbarTokenAddress = WHBARE.hedera_mainnet.token.address;
  whbarGatewayAddress = process.env.WHBAR_GATEWAY_MAINNET || '';
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
  let lendingPoolContract,
    whbarTokenContract,
    aTokenContract,
    debtTokenContract,
    whbarGatewayContract;

  async function ensureBorrowAllowance(amount) {
    const allowance = await debtTokenContract.borrowAllowance(
      owner.address,
      whbarGatewayContract.address
    );
    console.log('Delegation allowance to gateway:', allowance.toString());

    if (allowance.lt(amount)) {
      console.log('Approving debt token delegation to gateway...');
      const approveDebtTx = await debtTokenContract.approveDelegation(
        whbarGatewayContract.address,
        ethers.constants.MaxUint256
      );
      await approveDebtTx.wait();
    }
  }

  before(async function () {
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_testnet.address);
    // Instantiate WHBAR token via minimal ABI (pure ERC20 wrapper with deposit/withdraw)
    whbarTokenContract = new ethers.Contract(whbarTokenAddress, WHBAR_ABI, owner);

    // Derive reserve token addresses dynamically from on-chain pool to avoid drift
    const reserve = await lendingPoolContract.getReserveData(whbarTokenAddress);
    aTokenContract = await setupContract('AToken', reserve.aTokenAddress);
    debtTokenContract = await setupContract('VariableDebtToken', reserve.variableDebtTokenAddress);

    if (whbarGatewayAddress && whbarGatewayAddress !== '') {
      whbarGatewayContract = await setupContract('WHBARGateway', whbarGatewayAddress);
    }
  });

  async function withdrawWHBAR(amount, to) {
    console.log('Inside withdrawWHBAR via Gateway...', amount, to);
    if (!whbarGatewayContract) throw new Error('WHBARGateway address not set');

    const userATokenBal = await aTokenContract.balanceOf(owner.address);
    console.log('aWHBAR balance before:', userATokenBal.toString());
    const approveATx = await aTokenContract.approve(whbarGatewayContract.address, amount);
    await approveATx.wait();

    const tx = await whbarGatewayContract.withdrawHBAR(lendingPoolContract.address, amount, to);
    await tx.wait();
    console.log('Gateway Withdraw tx:', tx.hash);

    const balanceOfAfter = await checkBalance(aTokenContract, owner.address, 'WHBAR aToken after');
    expect(balanceOfAfter).to.be.gte(0);
  }

  async function borrowWHBAR(amount, onBehalfOf) {
    if (!whbarGatewayContract) throw new Error('WHBARGateway address not set');
    const borrowTxn = await whbarGatewayContract.borrowHBAR(
      lendingPoolContract.address,
      amount,
      2,
      0
    );
    await borrowTxn.wait();
    console.log('Gateway Borrow tx:', borrowTxn.hash);
    await checkBalance(debtTokenContract, onBehalfOf, 'WHBAR debtToken');
  }

  it.skip('should send HBAR to WHBAR contract and get WHBAR tokens', async function () {
    console.log('Owner address:', owner.address);
    console.log('WHBAR token address:', whbarTokenContract.address);
    console.log('Lending pool address:', lendingPoolContract.address);

    const beforeTokenBal = await whbarTokenContract.balanceOf(owner.address);
    const amountInHBAR = '1';
    const amountInWei = ethers.utils.parseEther(amountInHBAR);
    const tx = await whbarTokenContract.deposit({ value: amountInWei });
    await tx.wait();
    console.log('Deposit tx hash:', tx.hash);

    const afterTokenBal = await whbarTokenContract.balanceOf(owner.address);
    const expectedAmount = ethers.utils.parseUnits(amountInHBAR, 8);
    expect(afterTokenBal.sub(beforeTokenBal)).to.equal(expectedAmount);
  });

  it.skip('should burn entire WHBAR balance and receive native HBAR', async function () {
    let currentBal = await whbarTokenContract.balanceOf(owner.address);
    console.log('Current WHBAR balance:', currentBal.toString());

    if (currentBal.eq(0)) {
      const amountInHBAR = '1';
      const amountInWei = ethers.utils.parseEther(amountInHBAR);
      const tx = await whbarTokenContract.deposit({ value: amountInWei });
      await tx.wait();
      console.log('Deposit tx hash:', tx.hash);
      currentBal = await whbarTokenContract.balanceOf(owner.address);
      console.log('Current WHBAR balance after deposit:', currentBal.toString());
    }

    const withdrawTx = await whbarTokenContract.withdraw(currentBal);
    await withdrawTx.wait();

    const endingTokenBal = await whbarTokenContract.balanceOf(owner.address);
    expect(endingTokenBal).to.equal(0);
  });

  it.skip('should supply native HBAR via Gateway and get aWHBAR tokens', async function () {
    if (!whbarGatewayContract) return this.skip();

    const amountInHBAR = '11';
    const amountInWei = ethers.utils.parseEther(amountInHBAR);
    const expectedAmount = ethers.utils.parseUnits(amountInHBAR, 8);

    const balanceBefore = await aTokenContract.balanceOf(owner.address);
    console.log('Balance before:', balanceBefore.toString());

    const txn = await whbarGatewayContract.depositHBAR(
      lendingPoolContract.address,
      owner.address,
      0,
      {
        value: amountInWei,
      }
    );
    await txn.wait();
    console.log('Gateway Deposit tx:', txn.hash);

    await new Promise((r) => setTimeout(r, 2000));

    const balanceAfter = await checkBalance(aTokenContract, owner.address, 'WHBAR aToken');
    expect(balanceAfter.sub(balanceBefore)).to.equal(expectedAmount);
  });

  it.skip('should withdraw WHBAR via Gateway and receive HBAR', async function () {
    if (!whbarGatewayContract) return this.skip();

    const amountToWithdrawHBAR = '5';
    const amountToWithdraw = ethers.utils.parseUnits(amountToWithdrawHBAR, 8);

    const balanceBefore = await aTokenContract.balanceOf(owner.address);
    if (balanceBefore.lt(amountToWithdraw)) {
      console.log('Not enough aWHBAR to withdraw, skipping test.');
      return this.skip();
    }
    await withdrawWHBAR(amountToWithdraw, owner.address);
    const balanceAfter = await aTokenContract.balanceOf(owner.address);

    expect(balanceBefore.sub(balanceAfter)).to.equal(amountToWithdraw);
  });

  it.skip('should borrow native HBAR via Gateway', async function () {
    if (!whbarGatewayContract) return this.skip();

    // To borrow, we need collateral. We should have some from the deposit test.
    const aTokenBalance = await aTokenContract.balanceOf(owner.address);
    checkBalance(aTokenContract, owner.address, 'WHBAR aToken');
    if (aTokenBalance.isZero()) {
      console.log('No collateral to borrow against, depositing some HBAR');

      const amountToDepositHBAR = '10';
      const amountToDeposit = ethers.utils.parseUnits(amountToDepositHBAR, 8);
      const amountToDepositWei = ethers.utils.parseEther(amountToDepositHBAR);
      const depositTxn = await whbarGatewayContract.depositHBAR(
        lendingPoolContract.address,
        owner.address,
        0,
        { value: amountToDepositWei }
      );
      await depositTxn.wait();
      console.log('Gateway Deposit tx:', depositTxn.hash);
    }

    const debtBefore = await debtTokenContract.balanceOf(owner.address);
    const amountToBorrow = ethers.utils.parseUnits('0.1', 8); // Borrow 0.1 HBAR (8 decimals)

    await ensureBorrowAllowance(amountToBorrow);

    console.log('Borrowing HBAR via gateway...');
    await borrowWHBAR(amountToBorrow, owner.address);
    const debtAfter = await debtTokenContract.balanceOf(owner.address);

    // Assert that debt increased by approximately the amount borrowed
    expect(debtAfter.sub(debtBefore)).to.be.closeTo(amountToBorrow, 2); // allow small difference for interest
  });

  it('should repay native HBAR via Gateway', async function () {
    if (!whbarGatewayContract) return this.skip();
    const debtBefore = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt before');

    if (debtBefore.isZero()) {
      console.log('No debt to repay, skipping repay test.');
      return this.skip();
    }

    const amountToRepayHBAR = '0.05';
    const amountToRepay = ethers.utils.parseUnits(amountToRepayHBAR, 8);
    const amountToRepayWei = ethers.utils.parseEther(amountToRepayHBAR);

    await ensureBorrowAllowance(amountToRepay);

    const repayTxn = await whbarGatewayContract.repayHBAR(
      lendingPoolContract.address,
      amountToRepay,
      2,
      owner.address,
      { value: amountToRepayWei }
    );
    await repayTxn.wait();
    console.log('Gateway Repay tx:', repayTxn.hash);

    const debtAfter = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt after');
    // Allow for a small difference due to interest accrual
    expect(debtBefore.sub(debtAfter)).to.be.closeTo(
      amountToRepay,
      ethers.utils.parseUnits('0.001', 8)
    );
  });
});
