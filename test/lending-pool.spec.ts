import exp from 'constants';

const { expect } = require('chai');
const { ethers } = require('hardhat');
import {
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
} from '../deployed-contracts.json';
import { SAUCE, CLXY } from '../contract-addresses.json';
import {
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  Client,
  AccountBalanceQuery,
  Mnemonic,
} from '@hashgraph/sdk';

describe('Addresses Provider', function () {
  it.skip('Should get the addresses provider from lending pool', async function () {
    const [owner] = await ethers.getSigners();
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;

    const contractAddress = LendingPool.hedera_testnet.address;

    const tokenContract = new ethers.Contract(contractAddress, abi, owner);
    const lendingPoolAddress = await tokenContract.getAddressesProvider();
    console.log('Lending Pool Addresses provider: ', lendingPoolAddress);
    expect(lendingPoolAddress).to.equal(LendingPoolAddressesProvider.hedera_testnet.address);
  });

  it.skip('should return reserve data', async function () {
    const [owner] = await ethers.getSigners();
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;

    const contractAddress = LendingPool.hedera_testnet.address;

    const tokenContract = new ethers.Contract(contractAddress, abi, owner);
    const reserveData = await tokenContract.getReserveData(
      '0x0000000000000000000000000000000000220ced'
    );
    console.log('Reserve Data: ', reserveData);
    expect(reserveData).to.not.be.null;
  });

  it.skip('should return reserves list', async function () {
    const [owner] = await ethers.getSigners();
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;
    const contractAddress = LendingPool.hedera_testnet.address;
    const tokenContract = new ethers.Contract(contractAddress, abi, owner);

    const reserveData = await tokenContract.getReservesList();
    console.log('Reserve Data: ', reserveData);
    expect(reserveData).to.not.be.null;
  });

  it.skip('should deposit SAUCE tokens and get back aSAUCE tokens', async function () {
    const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
    console.log('Owner address: ', wallet.address);
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;
    const contractAddress = LendingPool.hedera_testnet.address;

    const erc20Artifacts = await hre.artifacts.readArtifact('ERC20Wrapper');
    const erc20Abi = erc20Artifacts.abi;
    const erc20Contract = new ethers.Contract(
      '0x0000000000000000000000000000000000120f46',
      erc20Abi,
      wallet
    );

    const balance = await erc20Contract.balanceOf(wallet.address);
    console.log('Balance: ', balance.toString());
    const allowance = await erc20Contract.allowance(wallet.address, contractAddress);
    console.log('Allowance: ', allowance.toString());

    // First, approve the token to the Lending pool contract
    if (balance.gt(0)) {
      if (allowance.lt(balance)) {
        const txn = await erc20Contract.approve(contractAddress, balance);
        console.log('Transaction hash: ', txn.hash);
        await txn.wait();
      }
    } else {
      throw new Error('Insufficient balance');
    }

    // const aTokenId = aTokenSAUCE.hedera_testnet.accountId;

    // const client = Client.forTestnet();
    // const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
    // const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
    // client.setOperator(operatorAccountId, operatorPrKey);

    // const tokenAssociateTxn = await new TokenAssociateTransaction()
    //   .setAccountId(operatorAccountId)
    //   .setTokenIds([aTokenId])
    //   .execute(client);
    // const tokenAssociateReceipt = await tokenAssociateTxn.getReceipt(client);
    // console.log(`- tokenAssociateReceipt ${tokenAssociateReceipt.status.toString()}`);

    const lendingPoolContract = new ethers.Contract(contractAddress, abi, wallet);
    const depositTxn = await lendingPoolContract.deposit(
      '0x0000000000000000000000000000000000120f46',
      10,
      wallet.address,
      0
    );
    console.log('Deposit Transaction hash: ', depositTxn.hash);
    await depositTxn.wait();
    console.log('Deposit Transaction confirmed');

    // const configuratorArtifact = await hre.artifacts.readArtifact('LendingPoolConfigurator');
    // const configuratorAbi = configuratorArtifact.abi;
    // const configuratorContract = new ethers.Contract(
    //   LendingPoolConfigurator.hedera_testnet.address,
    //   configuratorAbi,
    //   wallet
    // );
    // await configuratorContract.setPoolPause(false);

    const aTokenArtifact = await hre.artifacts.readArtifact('AToken');
    const aTokenAbi = aTokenArtifact.abi;
    const aTokenContract = new ethers.Contract(SAUCE.aToken.address, aTokenAbi, wallet);
    const balanceOf = await aTokenContract.balanceOf(wallet.address);
    console.log('Balance of aSAUCE: ', balanceOf.toString());
  });

  it.skip('should withdraw SAUCE tokens and aSAUCE tokens should be burned', async function () {
    const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
    console.log('Owner address: ', wallet.address);
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;
    const contractAddress = LendingPool.hedera_testnet.address;

    const withdrawAmount = 1;

    const aTokenArtifact = await hre.artifacts.readArtifact('AToken');
    const aTokenAbi = aTokenArtifact.abi;
    const aTokenContract = new ethers.Contract(SAUCE.aToken.address, aTokenAbi, wallet);
    const balanceOf = await aTokenContract.balanceOf(wallet.address);
    console.log('Balance of aSAUCE: ', balanceOf.toString());
    const allowance = await aTokenContract.allowance(wallet.address, contractAddress);
    console.log('Allowance of aSAUCE: ', allowance.toString());

    // First, approve the aToken to the Lending pool contract
    if (balanceOf.gt(withdrawAmount)) {
      if (allowance.lt(withdrawAmount)) {
        const txn = await aTokenContract.approve(contractAddress, withdrawAmount);
        console.log('Transaction hash for approve aSAUCE: ', txn.hash);
        await txn.wait();
      }
    } else {
      throw new Error('Insufficient balance');
    }

    const lendingPoolContract = new ethers.Contract(contractAddress, abi, wallet);
    const withdrawTxn = await lendingPoolContract.withdraw(
      '0x0000000000000000000000000000000000120f46',
      withdrawAmount,
      wallet.address
    );
    console.log('Withdraw Transaction hash: ', withdrawTxn.hash);
    await withdrawTxn.wait();
    console.log('Withdraw Transaction confirmed');

    const erc20Artifacts = await hre.artifacts.readArtifact('ERC20Wrapper');
    const erc20Abi = erc20Artifacts.abi;
    const erc20Contract = new ethers.Contract(
      '0x0000000000000000000000000000000000120f46',
      erc20Abi,
      wallet
    );

    const balance = await erc20Contract.balanceOf(wallet.address);
    console.log('Balance of SAUCE: ', balance.toString());
  });

  it('should borrow CLXY tokens and get back debt tokens', async function () {
    const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
    console.log('Owner address: ', wallet.address);
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;
    const contractAddress = LendingPool.hedera_testnet.address;

    const lendingPoolContract = new ethers.Contract(contractAddress, abi, wallet);
    const reserveData = await lendingPoolContract.getReserveData(
      '0x0000000000000000000000000000000000220ced'
    );
    console.log('Reserve Data: ', reserveData);

    // const client = Client.forTestnet();
    // const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
    // const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
    // client.setOperator(operatorAccountId, operatorPrKey);

    // const tokenAssociateTxn = await new TokenAssociateTransaction()
    //   .setAccountId(operatorAccountId)
    //   .setTokenIds([aTokenId])
    //   .execute(client);
    // const tokenAssociateReceipt = await tokenAssociateTxn.getReceipt(client);
    // console.log(`- tokenAssociateReceipt ${tokenAssociateReceipt.status.toString()}`);

    // TODO - Associate the borrow asset / token with the account

    // const erc20Artifacts = await hre.artifacts.readArtifact('ERC20Wrapper');
    // const erc20Abi = erc20Artifacts.abi;
    // const erc20Contract = new ethers.Contract(
    //   '0x0000000000000000000000000000000000120f46',
    //   erc20Abi,
    //   wallet
    // );

    // const balance = await erc20Contract.balanceOf(wallet.address);
    // console.log('Balance: ', balance.toString());
    // const allowance = await erc20Contract.allowance(wallet.address, contractAddress);
    // console.log('Allowance: ', allowance.toString());

    // // First, approve the token to the Lending pool contract
    // if (balance.gt(0)) {
    //   if (allowance.lt(balance)) {
    //     const txn = await erc20Contract.approve(contractAddress, balance);
    //     console.log('Transaction hash: ', txn.hash);
    //     await txn.wait();
    //   }
    // } else {
    //   throw new Error('Insufficient balance');
    // }

    // // const aTokenId = aTokenSAUCE.hedera_testnet.accountId;

    // // const configuratorArtifact = await hre.artifacts.readArtifact('LendingPoolConfigurator');
    // // const configuratorAbi = configuratorArtifact.abi;
    // // const configuratorContract = new ethers.Contract(
    // //   LendingPoolConfigurator.hedera_testnet.address,
    // //   configuratorAbi,
    // //   wallet
    // // );
    // // await configuratorContract.setPoolPause(false);

    // const aTokenArtifact = await hre.artifacts.readArtifact('AToken');
    // const aTokenAbi = aTokenArtifact.abi;
    // const aTokenContract = new ethers.Contract(
    //   aTokenSAUCE.hedera_testnet.address,
    //   aTokenAbi,
    //   wallet
    // );
    // const balanceOf = await aTokenContract.balanceOf(wallet.address);
    // console.log('Balance of aSAUCE: ', balanceOf.toString());
  });
});
