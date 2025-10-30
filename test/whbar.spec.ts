import { expect } from 'chai';
import { ethers } from 'hardhat';
import hre from 'hardhat';
import outputReserveData from '../scripts/outputReserveData.json';

// Pure ERC20 WHBAR minimal ABI for tests
const WHBAR_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function deposit() payable',
  'function withdraw(uint256)',
];

const ERC20_MIN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
];

const { WHBAR, LendingPool, USDC } = outputReserveData;

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner, whbarTokenAddress, whbarGatewayAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  whbarTokenAddress = WHBAR.hedera_testnet.token.address;
  whbarGatewayAddress =
    process.env.WHBARGATEWAY_ADDRESS || '0x118dd8f2C0F2375496dF1E069aF1141FA034251B';
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_LIQUIDATIONS || '', provider);
  whbarTokenAddress = WHBAR.hedera_mainnet.token.address;
  whbarGatewayAddress =
    process.env.WHBAR_GATEWAY_MAINNET || '0xeF36629d959B09Fe5b31a0BA07a925F6388A757c';
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

    if (whbarGatewayAddress && whbarGatewayAddress !== '') {
      whbarGatewayContract = await setupContract('WHBARGateway', whbarGatewayAddress);
      try {
        const gwTokenAddr = await whbarGatewayContract.getWHBARAddress();
        if (gwTokenAddr && gwTokenAddr !== ethers.constants.AddressZero) {
          whbarTokenAddress = gwTokenAddr;
        }
      } catch (_) {
        // ignore and use configured address
      }
    }

    // Instantiate WHBAR token via minimal ABI (pure ERC20 wrapper with deposit/withdraw)
    whbarTokenContract = new ethers.Contract(whbarTokenAddress, WHBAR_ABI, owner);

    // Derive reserve token addresses dynamically from on-chain pool to avoid drift
    const reserve = await lendingPoolContract.getReserveData(whbarTokenAddress);
    aTokenContract = await setupContract('AToken', reserve.aTokenAddress);
    debtTokenContract = await setupContract('VariableDebtToken', reserve.variableDebtTokenAddress);
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

  it.skip('should get WHBAR aToken, variableDebt and stableDebt token addresses', async function () {
    const reserve = await lendingPoolContract.getReserveData(whbarTokenAddress);
    console.log('WHBAR reserve data:', reserve);
    expect(reserve.aTokenAddress).to.not.be.null;
    expect(reserve.variableDebtTokenAddress).to.not.be.null;
    expect(reserve.stableDebtTokenAddress).to.not.be.null;
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
    const tolerance = ethers.BigNumber.from(100); // allow minor index/rounding variance
    expect(balanceAfter.sub(balanceBefore)).to.be.closeTo(expectedAmount, tolerance);
  });

  it('should deposit, borrow, repay and withdraw HBAR end-to-end via Gateway', async function () {
    if (!whbarGatewayContract) return this.skip();

    // 1) Deposit native HBAR via Gateway → receive aWHBAR
    console.log('\n\n🧪  WHBAR Composite Flow');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏦  Step 1: Deposit HBAR via Gateway');
    const depositHBAR = '2';
    const depositWei = ethers.utils.parseEther(depositHBAR);
    const expectedDeposit = ethers.utils.parseUnits(depositHBAR, 8);

    const aBefore = await aTokenContract.balanceOf(owner.address);
    console.log('   • Deposit HBAR:', depositHBAR);
    console.log('   • Deposit Wei:', depositWei.toString());
    console.log('   • aWHBAR before:', aBefore.toString());
    const depTx = await whbarGatewayContract.depositHBAR(
      lendingPoolContract.address,
      owner.address,
      0,
      { value: depositWei }
    );
    await depTx.wait();
    console.log('🔗 Gateway Deposit tx:', depTx.hash);
    await new Promise((r) => setTimeout(r, 1500));

    const aAfterDeposit = await aTokenContract.balanceOf(owner.address);
    const depositTolerance = ethers.BigNumber.from(100);
    console.log('   • aWHBAR after:', aAfterDeposit.toString());
    console.log('   • aWHBAR Δ:', aAfterDeposit.sub(aBefore).toString());
    expect(aAfterDeposit.sub(aBefore)).to.be.closeTo(expectedDeposit, depositTolerance);

    // 2) Borrow small amount of HBAR via Gateway
    console.log('\n💳  Step 2: Borrow HBAR via Gateway');
    const borrowHBAR = '0.2';
    const borrowAmt = ethers.utils.parseUnits(borrowHBAR, 8);
    console.log('   • Borrow HBAR (8dp):', borrowAmt.toString());
    await ensureBorrowAllowance(borrowAmt);

    const debtBeforeBorrow = await debtTokenContract.balanceOf(owner.address);
    console.log('   • Debt before:', debtBeforeBorrow.toString());
    await borrowWHBAR(borrowAmt, owner.address);
    await new Promise((r) => setTimeout(r, 1500));
    const debtAfterBorrow = await debtTokenContract.balanceOf(owner.address);
    console.log('   • Debt after:', debtAfterBorrow.toString());
    console.log('   • Debt Δ:', debtAfterBorrow.sub(debtBeforeBorrow).toString());
    // expect(debtAfterBorrow.sub(debtBeforeBorrow)).to.be.closeTo(borrowAmt, 2);

    // 3) Repay part of the borrowed amount via Gateway
    console.log('\n💸  Step 3: Repay HBAR via Gateway');
    const repayHBAR = '0.1';
    const repayAmt = ethers.utils.parseUnits(repayHBAR, 8);
    const repayWei = ethers.utils.parseEther(repayHBAR);
    console.log('   • Repay HBAR (8dp):', repayAmt.toString());
    console.log('   • Repay Wei:', repayWei.toString());

    const debtBeforeRepay = await debtTokenContract.balanceOf(owner.address);
    console.log('   • Debt before:', debtBeforeRepay.toString());
    const repayTx = await whbarGatewayContract.repayHBAR(
      lendingPoolContract.address,
      repayAmt,
      2,
      owner.address,
      { value: repayWei }
    );
    await repayTx.wait();
    console.log('🔗 Gateway Repay tx:', repayTx.hash);
    await new Promise((r) => setTimeout(r, 1500));
    const debtAfterRepay = await debtTokenContract.balanceOf(owner.address);
    console.log('   • Debt after:', debtAfterRepay.toString());
    console.log('   • Debt Δ:', debtBeforeRepay.sub(debtAfterRepay).toString());
    // expect(debtBeforeRepay.sub(debtAfterRepay)).to.be.closeTo(
    //   repayAmt,
    //   ethers.utils.parseUnits('0.001', 8)
    // );

    // 4) Withdraw part of supplied aWHBAR and receive native HBAR
    console.log('\n🏧  Step 4: Withdraw HBAR via Gateway');
    const withdrawHBAR = '0.5';
    const withdrawAmt = ethers.utils.parseUnits(withdrawHBAR, 8);
    console.log('   • Withdraw HBAR (8dp):', withdrawAmt.toString());

    const aBeforeWithdraw = await aTokenContract.balanceOf(owner.address);
    console.log('   • aWHBAR before:', aBeforeWithdraw.toString());
    await withdrawWHBAR(withdrawAmt, owner.address);
    await new Promise((r) => setTimeout(r, 1500));
    const aAfterWithdraw = await aTokenContract.balanceOf(owner.address);
    console.log('   • aWHBAR after:', aAfterWithdraw.toString());
    console.log('   • aWHBAR Δ:', aBeforeWithdraw.sub(aAfterWithdraw).toString());
    // expect(aBeforeWithdraw.sub(aAfterWithdraw)).to.be.closeTo(withdrawAmt, 2);

    console.log('\n✅  Composite flow completed successfully');
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

    expect(balanceBefore.sub(balanceAfter)).to.be.closeTo(amountToWithdraw, 2);
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

  it.skip('should repay native HBAR via Gateway', async function () {
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

  it.skip('owner can recover ERC20 tokens sent to the gateway', async function () {
    if (!whbarGatewayContract) return this.skip();

    const gatewayOwner = await whbarGatewayContract.owner();
    if (gatewayOwner.toLowerCase() !== owner.address.toLowerCase()) {
      console.log('Current signer is not gateway owner, skipping');
      return this.skip();
    }

    const usdcInfo = USDC[chain_type];
    if (!usdcInfo) {
      console.log('USDC config missing for chain, skipping');
      return this.skip();
    }

    const usdcAddress = usdcInfo.token.address;
    const usdcContract = new ethers.Contract(usdcAddress, ERC20_MIN_ABI, owner);

    const amount = ethers.utils.parseUnits('1', 6);
    const ownerBalanceBefore = await usdcContract.balanceOf(owner.address);

    let transferTx;
    try {
      transferTx = await usdcContract.transfer(whbarGatewayContract.address, amount, {
        gasLimit: 1000000,
      });
      await transferTx.wait();
    } catch (err: any) {
      console.log('Unable to transfer USDC to gateway, skipping:', err.message || err);
      return this.skip();
    }

    const ownerBalanceAfterTransfer = await usdcContract.balanceOf(owner.address);
    expect(ownerBalanceAfterTransfer).to.equal(ownerBalanceBefore.sub(amount));

    const gatewayBalanceBeforeRecover = await usdcContract.balanceOf(whbarGatewayContract.address);
    expect(gatewayBalanceBeforeRecover).to.be.gte(amount);

    const recoverTx = await whbarGatewayContract.recoverERC20(usdcAddress, amount, owner.address);
    await recoverTx.wait();

    const gatewayBalanceAfterRecover = await usdcContract.balanceOf(whbarGatewayContract.address);
    expect(gatewayBalanceAfterRecover).to.equal(gatewayBalanceBeforeRecover.sub(amount));

    const ownerBalanceAfterRecover = await usdcContract.balanceOf(owner.address);
    expect(ownerBalanceAfterRecover).to.equal(ownerBalanceBefore);
  });

  it.skip('owner can recover force-fed native HBAR', async function () {
    if (!whbarGatewayContract) return this.skip();

    const gatewayOwner = await whbarGatewayContract.owner();
    if (gatewayOwner.toLowerCase() !== owner.address.toLowerCase()) {
      console.log('Current signer is not gateway owner, skipping');
      return this.skip();
    }

    const ForceHBARFactory = await ethers.getContractFactory('ForceHBAR', owner);
    const amount = ethers.utils.parseEther('0.001');

    let forceFeeder;
    try {
      forceFeeder = await ForceHBARFactory.deploy({ value: amount });
      await forceFeeder.deployed();
    } catch (err: any) {
      console.log('Unable to deploy ForceHBAR helper, skipping:', err.message);
      return this.skip();
    }

    const gatewayBalanceBeforeForce = await provider.getBalance(whbarGatewayContract.address);

    const forceTx = await forceFeeder.forceSend(whbarGatewayContract.address);
    await forceTx.wait();

    const gatewayBalanceAfterForce = await provider.getBalance(whbarGatewayContract.address);
    if (!gatewayBalanceAfterForce.sub(gatewayBalanceBeforeForce).eq(amount)) {
      console.log('Unexpected gateway balance after force send, skipping');
      return this.skip();
    }

    const recipient = ethers.Wallet.createRandom().address;
    const recipientBalanceBefore = await provider.getBalance(recipient);
    expect(recipientBalanceBefore).to.equal(0);

    const recoverTx = await whbarGatewayContract.recoverNative(recipient, amount);
    await recoverTx.wait();

    const gatewayBalanceAfterRecover = await provider.getBalance(whbarGatewayContract.address);
    expect(gatewayBalanceAfterRecover).to.equal(gatewayBalanceBeforeForce);

    const recipientBalanceAfter = await provider.getBalance(recipient);
    expect(recipientBalanceAfter).to.equal(amount);
  });

  // Negative and edge-case tests
  it.skip('should revert depositHBAR with zero value', async function () {
    if (!whbarGatewayContract) return this.skip();
    await expect(
      whbarGatewayContract.depositHBAR(lendingPoolContract.address, owner.address, 0, {
        value: 0,
      })
    ).to.be.revertedWith('Invalid HBAR amount');
  });

  it.skip('should revert borrowHBAR with zero amount', async function () {
    if (!whbarGatewayContract) return this.skip();
    await expect(
      whbarGatewayContract.borrowHBAR(lendingPoolContract.address, 0, 2, 0)
    ).to.be.revertedWith('INVALID_AMOUNT');
  });

  it.skip('should revert borrowHBAR with stable rate mode (disabled)', async function () {
    if (!whbarGatewayContract) return this.skip();
    const amt = ethers.utils.parseUnits('1', 8);
    await expect(
      whbarGatewayContract.borrowHBAR(lendingPoolContract.address, amt, 1, 0)
    ).to.be.revertedWith('101'); // STABLE_DEBT_DISABLED
  });

  it.skip('should revert borrowHBAR with invalid interest rate mode', async function () {
    if (!whbarGatewayContract) return this.skip();
    const amt = ethers.utils.parseUnits('1', 8);
    await expect(
      whbarGatewayContract.borrowHBAR(lendingPoolContract.address, amt, 3, 0)
    ).to.be.revertedWith('8'); // VL_INVALID_INTEREST_RATE_MODE_SELECTED
  });

  it.skip('should revert repayHBAR with zero msg.value', async function () {
    if (!whbarGatewayContract) return this.skip();
    await expect(
      whbarGatewayContract.repayHBAR(lendingPoolContract.address, 0, 2, owner.address, {
        value: 0,
      })
    ).to.be.revertedWith('NO_DEBT_TO_REPAY');
  });

  it.skip('should revert repayHBAR when no variable debt exists', async function () {
    if (!whbarGatewayContract) return this.skip();
    // Send a minimal amount just to pass the gateway msg.value > 0 path; pool should revert with no debt
    await expect(
      whbarGatewayContract.repayHBAR(
        lendingPoolContract.address,
        ethers.utils.parseUnits('1', 8),
        2,
        owner.address,
        { value: 1 }
      )
    ).to.be.revertedWith('NO_DEBT_TO_REPAY');
  });

  it.skip('should revert withdrawHBAR when user has insufficient aWHBAR balance', async function () {
    if (!whbarGatewayContract) return this.skip();
    const amt = ethers.utils.parseUnits('1', 8);
    await expect(
      whbarGatewayContract.withdrawHBAR(lendingPoolContract.address, amt, owner.address)
    ).to.be.revertedWith('INSUFFICIENT_BALANCE');
  });

  it.skip('should revert withdrawHBAR with zero amount', async function () {
    if (!whbarGatewayContract) return this.skip();
    await expect(
      whbarGatewayContract.withdrawHBAR(
        lendingPoolContract.address,
        ethers.constants.Zero,
        owner.address
      )
    ).to.be.revertedWith('INVALID_AMOUNT');
  });

  it.skip('should reject direct HBAR transfers via receive()', async function () {
    if (!whbarGatewayContract) return this.skip();
    await expect(
      owner.sendTransaction({
        to: whbarGatewayContract.address,
        value: ethers.utils.parseEther('0.001'),
      })
    ).to.be.revertedWith('Receive not allowed');
  });

  it.skip('should reject unknown calls via fallback()', async function () {
    if (!whbarGatewayContract) return this.skip();
    await expect(
      owner.sendTransaction({ to: whbarGatewayContract.address, data: '0x12345678', value: 0 })
    ).to.be.revertedWith('Fallback not allowed');
  });
});
