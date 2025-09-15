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
  whbarGatewayAddress = process.env.WHBAR_GATEWAY_TESTNET || '';
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

  before(async function () {
    lendingPoolContract = await setupContract('LendingPool', LendingPool.hedera_testnet.address);
    // Instantiate WHBAR token via minimal ABI (pure ERC20 wrapper with deposit/withdraw)
    whbarTokenContract = new ethers.Contract(whbarTokenAddress, WHBAR_ABI, owner);
    aTokenContract = await setupContract('AToken', WHBARE.hedera_testnet.aToken.address);
    debtTokenContract = await setupContract(
      'VariableDebtToken',
      WHBARE.hedera_testnet.variableDebt.address
    );
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
    await checkBalance(debtTokenContract, owner.address, 'WHBAR debtToken');
  }

  it.skip('should send HBAR to WHBAR contract and get WHBAR tokens', async function () {
    console.log('Owner address:', owner.address);
    console.log('WHBAR token address:', whbarTokenContract.address);
    console.log('Lending pool address:', lendingPoolContract.address);

    const beforeTokenBal = await whbarTokenContract.balanceOf(owner.address);
    // Hedera requires at least 1 tinybar = 10_000_000_000 wei
    const amountWei = ethers.BigNumber.from('10000000000');
    const tx = await whbarTokenContract.deposit({ value: amountWei });
    await tx.wait();
    console.log('Deposit tx hash:', tx.hash);

    const afterTokenBal = await whbarTokenContract.balanceOf(owner.address);
    const tinybarInWei = ethers.BigNumber.from('10000000000');
    expect(afterTokenBal.sub(beforeTokenBal)).to.equal(amountWei.div(tinybarInWei));
  });

  it('should burn entire WHBAR balance and receive native HBAR', async function () {
    let currentBal = await whbarTokenContract.balanceOf(owner.address);

    if (currentBal.eq(0)) {
      const amountWei = ethers.BigNumber.from('100000000000000');
      const tx = await whbarTokenContract.deposit({ value: amountWei });
      await tx.wait();
      console.log('Deposit tx hash:', tx.hash);
    }

    const withdrawTx = await whbarTokenContract.withdraw(currentBal);
    await withdrawTx.wait();

    const endingTokenBal = await whbarTokenContract.balanceOf(owner.address);
    expect(endingTokenBal).to.equal(0);
  });

  it.skip('should supply native HBAR via Gateway and get aWHBAR tokens', async function () {
    if (!whbarGatewayContract) return this.skip();
    const amount = ethers.BigNumber.from('11');
    const valueTiny = ethers.BigNumber.from('110000000000');
    const txn = await whbarGatewayContract.depositHBAR(
      lendingPoolContract.address,
      owner.address,
      0,
      {
        value: valueTiny,
      }
    );
    await txn.wait();
    console.log('Gateway Deposit tx:', txn.hash);

    await new Promise((r) => setTimeout(r, 2000));

    const balanceOf = await checkBalance(aTokenContract, owner.address, 'WHBAR aToken');
    expect(balanceOf).to.be.gt(0);
  });

  it.skip('should withdraw WHBAR via Gateway and receive HBAR', async function () {
    if (!whbarGatewayContract) return this.skip();
    await withdrawWHBAR(13, owner.address);
  });

  it.skip('should borrow native HBAR via Gateway', async function () {
    if (!whbarGatewayContract) return this.skip();
    await borrowWHBAR(100000000000, owner.address);
  });

  it.skip('should repay native HBAR via Gateway', async function () {
    if (!whbarGatewayContract) return this.skip();
    const debtTokenContract = await setupContract(
      'VariableDebtToken',
      WHBARE.hedera_testnet.variableDebt.address
    );
    await checkBalance(debtTokenContract, owner.address, 'WHBAR debt before');

    const repayTxn = await whbarGatewayContract.repayHBAR(
      lendingPoolContract.address,
      ethers.BigNumber.from('2'),
      2,
      owner.address,
      { value: ethers.BigNumber.from('20000000000') }
    );
    await repayTxn.wait();
    console.log('Gateway Repay tx:', repayTxn.hash);

    const balanceOfAfter = await checkBalance(debtTokenContract, owner.address, 'WHBAR debt after');
    expect(balanceOfAfter).to.be.gte(0);
  });
});
