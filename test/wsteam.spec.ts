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

let provider, owner, contractAddress, spender, userAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
  userAddress = new ethers.Wallet(process.env.PRIVATE_KEY3 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_PROXY || '', provider);
  spender = '0x00000000000000000000000000000000005dbdc1'; // Bonzo spender wallet
}

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

describe('WSTEAM Contract Tests', function () {
  let wsteamContract, steamTokenContract, wsteamTokenContract;
  const DECIMALS_CONVERSION = ethers.BigNumber.from(10).pow(6); // 10^(8-2)

  before(async function () {
    console.log('Owner:', owner.address);
    wsteamContract = await setupContract('WSTEAM', '0x06da3554b380de078027157C4DDcef5E2056D82D');
    steamTokenContract = await setupContract('ERC20Wrapper', BSTEAM.hedera_testnet.token.address);
    wsteamTokenContract = await setupContract(
      'ERC20Wrapper',
      '0x00000000000000000000000000000000004d6427'
    );
  });

  it('should get wsteam tokens after depositing steam to msg.sender', async function () {
    const steamAmount = ethers.utils.parseUnits('100', 2); // 1 STEAM (2 decimals)
    const expectedWsteamAmount = steamAmount.mul(DECIMALS_CONVERSION); // Convert to 8 decimals

    // Get initial balances
    const initialSteamBalance = await steamTokenContract.balanceOf(owner.address);
    const initialWsteamBalance = await wsteamTokenContract.balanceOf(owner.address);
    console.log(
      'Initial Steam Balance:',
      initialSteamBalance.toString(),
      'Initial WSteam Balance:',
      initialWsteamBalance.toString()
    );

    const allowance = await steamTokenContract.allowance(owner.address, wsteamContract.address);
    if (allowance.lt(steamAmount)) {
      console.log('Approving WSTEAM contract to spend STEAM tokens...');
      await steamTokenContract.approve(wsteamContract.address, steamAmount);
    }

    // Deposit STEAM tokens
    const depositTx = await wsteamContract.deposit(steamAmount);
    await depositTx.wait();

    // Check final balances
    const finalSteamBalance = await steamTokenContract.balanceOf(owner.address);
    const finalWsteamBalance = await wsteamTokenContract.balanceOf(owner.address);
    console.log(
      'Final Steam Balance:',
      finalSteamBalance.toString(),
      'Final WSteam Balance:',
      finalWsteamBalance.toString()
    );

    expect(finalSteamBalance).to.equal(initialSteamBalance.sub(steamAmount));
    expect(finalWsteamBalance).to.equal(initialWsteamBalance.add(expectedWsteamAmount));
  });

  it('should burn wsteam tokens and get steam tokens after withdrawing to msg.sender', async function () {
    const wsteamAmount = ethers.utils.parseUnits('10', 8); // 0.1 WSTEAM (8 decimals)
    const expectedSteamAmount = wsteamAmount.div(DECIMALS_CONVERSION); // Convert to 2 decimals

    // Get initial balances
    const initialSteamBalance = await steamTokenContract.balanceOf(owner.address);
    const initialWsteamBalance = await wsteamTokenContract.balanceOf(owner.address);
    console.log(
      'Initial Steam Balance:',
      initialSteamBalance.toString(),
      'Initial WSteam Balance:',
      initialWsteamBalance.toString()
    );

    const allowance = await wsteamTokenContract.allowance(owner.address, wsteamContract.address);
    if (allowance.lt(wsteamAmount)) {
      console.log('Approving WSTEAM contract to spend WSTEAM tokens...');
      await wsteamTokenContract.approve(wsteamContract.address, wsteamAmount);
    }

    // Withdraw WSTEAM tokens
    const withdrawTx = await wsteamContract.withdraw(wsteamAmount);
    await withdrawTx.wait();

    // Check final balances
    const finalSteamBalance = await steamTokenContract.balanceOf(owner.address);
    const finalWsteamBalance = await wsteamTokenContract.balanceOf(owner.address);
    console.log(
      'Final Steam Balance:',
      finalSteamBalance.toString(),
      'Final WSteam Balance:',
      finalWsteamBalance.toString()
    );

    expect(finalWsteamBalance).to.equal(initialWsteamBalance.sub(wsteamAmount));
    expect(finalSteamBalance).to.equal(initialSteamBalance.add(expectedSteamAmount));
  });

  it('should get wsteam tokens after depositing steam to userAddress', async function () {
    const steamAmount = ethers.utils.parseUnits('15', 2); // 1 STEAM (2 decimals)
    const expectedWsteamAmount = steamAmount.mul(DECIMALS_CONVERSION); // Convert to 8 decimals

    // Get initial balances
    const initialSteamBalance = await steamTokenContract.balanceOf(owner.address);
    const initialUserWsteamBalance = await wsteamTokenContract.balanceOf(userAddress.address);
    console.log(
      'Initial Steam Balance:',
      initialSteamBalance.toString(),
      'Initial User WSteam Balance:',
      initialUserWsteamBalance.toString()
    );

    const allowance = await steamTokenContract.allowance(owner.address, wsteamContract.address);
    if (allowance.lt(steamAmount)) {
      console.log('Approving WSTEAM contract to spend STEAM tokens...');
      await steamTokenContract.approve(wsteamContract.address, steamAmount);
    }

    // Deposit STEAM tokens to userAddress
    const depositTx = await wsteamContract.depositTo(userAddress.address, steamAmount);
    await depositTx.wait();

    // Check final balances
    const finalSteamBalance = await steamTokenContract.balanceOf(owner.address);
    const finalUserWsteamBalance = await wsteamTokenContract.balanceOf(userAddress.address);
    console.log(
      'Final Steam Balance:',
      finalSteamBalance.toString(),
      'Final User WSteam Balance:',
      finalUserWsteamBalance.toString()
    );

    expect(finalSteamBalance).to.equal(initialSteamBalance.sub(steamAmount));
    expect(finalUserWsteamBalance).to.equal(initialUserWsteamBalance.add(expectedWsteamAmount));
  });

  it('should burn wsteam tokens and get steam tokens after withdrawing to userAddress', async function () {
    const wsteamAmount = ethers.utils.parseUnits('13', 8); // 0.1 WSTEAM (8 decimals)
    const expectedSteamAmount = wsteamAmount.div(DECIMALS_CONVERSION); // Convert to 2 decimals

    // Get initial balances
    const initialWsteamBalance = await wsteamTokenContract.balanceOf(owner.address);
    const initialUserSteamBalance = await steamTokenContract.balanceOf(userAddress.address);
    console.log(
      'Initial WSteam Balance:',
      initialWsteamBalance.toString(),
      'Initial User Steam Balance:',
      initialUserSteamBalance.toString()
    );

    const allowance = await wsteamTokenContract.allowance(owner.address, wsteamContract.address);
    if (allowance.lt(wsteamAmount)) {
      console.log('Approving WSTEAM contract to spend WSTEAM tokens...');
      await wsteamTokenContract.approve(wsteamContract.address, wsteamAmount);
    }

    // Withdraw WSTEAM tokens to userAddress
    const withdrawTx = await wsteamContract.withdrawTo(userAddress.address, wsteamAmount);
    await withdrawTx.wait();

    // Check final balances
    const finalWsteamBalance = await wsteamTokenContract.balanceOf(owner.address);
    const finalUserSteamBalance = await steamTokenContract.balanceOf(userAddress.address);

    expect(finalWsteamBalance).to.equal(initialWsteamBalance.sub(wsteamAmount));
    expect(finalUserSteamBalance).to.equal(initialUserSteamBalance.add(expectedSteamAmount));
  });

  it.skip('should fail when trying to deposit 0 amount', async function () {
    await expect(wsteamContract.deposit(0)).to.be.revertedWith('Amount must be greater than zero');
  });

  it.skip('should fail when trying to withdraw 0 amount', async function () {
    await expect(wsteamContract.withdraw(0)).to.be.revertedWith('Amount must be greater than zero');
  });

  it.skip('should fail when withdrawing to zero address', async function () {
    const wsteamAmount = ethers.utils.parseUnits('10000000', 8); // 0.1 WSTEAM (8 decimals)
    await expect(
      wsteamContract.withdrawTo(ethers.constants.AddressZero, wsteamAmount)
    ).to.be.revertedWith('Invalid destination address');
  });

  it.skip('should maintain correct decimal conversion ratios', async function () {
    const steamAmount = ethers.utils.parseUnits('100', 2); // 1 STEAM (2 decimals)
    const wsteamAmount = await wsteamContract.toWSTEAM(steamAmount);
    expect(wsteamAmount).to.equal(steamAmount.mul(DECIMALS_CONVERSION));

    const convertedSteamAmount = await wsteamContract.toSTEAM(wsteamAmount);
    expect(convertedSteamAmount).to.equal(steamAmount);
  });
});
