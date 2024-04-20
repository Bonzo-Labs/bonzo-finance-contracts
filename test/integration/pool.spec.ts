import { expect } from 'chai';
import hre from "hardhat";
import { getHtsBalance, getTestableTokens, hbarTransfer, htsApprove, htsAssociate, htsTransfer, lendingPoolConfiguratorContract, lendingPoolContract } from './util';

describe('Lending Pool Contract Tests', function () {

  before(async function () {
    let signer = (await hre.ethers.getSigners())[0];
    await lendingPoolConfiguratorContract.connect(signer).setPoolPause(false);
  });

  it('is not paused', async function () {
    const paused = await lendingPoolContract.paused();
    expect(paused).to.be.false;
  });

  it('Can retrieve the list of Reserve Currencies', async function () {
    const addresses = await lendingPoolContract.getReservesList();
    expect(addresses).to.not.be.empty;
  });

  it('Has Reserve Currencies that can test with', async function () {
    const currencies = await getTestableTokens();
    expect(currencies).to.not.be.empty;
  });

  it('Accepts Deposit and Honors immediate Witdraw', async function () {
    const currency = (await getTestableTokens())[0].tokenAddress;
    const account = (await hre.ethers.getSigners())[0];
    const originalBalance = await getHtsBalance(currency, account.address);
    await htsApprove(currency, 1, lendingPoolContract.address, account);
    await (await lendingPoolContract.connect(account).deposit(currency, 1, account.address, 0)).wait();
    const adjustedBalance = await getHtsBalance(currency, account.address);
    expect(originalBalance.sub(adjustedBalance)).eq(1);
    await (await lendingPoolContract.connect(account).withdraw(currency, 1, account.address)).wait();
    const finalBalance = await getHtsBalance(currency, account.address);
    expect(finalBalance).to.eq(originalBalance);
  });
  it('Accepts Deposit and Honors immediate Witdraw from Non Privileged Account', async function () {
    const currency = (await getTestableTokens())[0].tokenAddress;
    const wallet = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
    const source = (await hre.ethers.getSigners())[0];
    await htsTransfer(currency, source, wallet.address, 1);
    await hbarTransfer(source, wallet.address, 5_00_000_000);
    expect(await getHtsBalance(currency, wallet.address)).eq(1);
    await htsApprove(currency, 1, lendingPoolContract.address, wallet);
    await (await lendingPoolContract.connect(wallet).deposit(currency, 1, wallet.address, 0)).wait();
    expect(await getHtsBalance(currency, wallet.address)).eq(0);
    await (await lendingPoolContract.connect(wallet).withdraw(currency, 1, wallet.address)).wait();
    expect(await getHtsBalance(currency, wallet.address)).eq(1);
    await htsTransfer(currency, wallet, source.address, 1);
    expect(await getHtsBalance(currency, wallet.address)).eq(0);
  });
});

