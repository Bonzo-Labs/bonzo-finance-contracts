import exp from 'constants';

const { expect } = require('chai');
const { ethers } = require('hardhat');
import { LendingPool, LendingPoolAddressesProvider } from '../deployed-contracts.json';
import { aTokenSAUCE } from '../contract-addresses.json';
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
    const tokenContract = new ethers.Contract(contractAddress, abi, wallet);

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
        console.log('Transaction confirmed');
      }
    } else {
      console.log('Insufficient balance');
      throw new Error('Insufficient balance');
    }

    // Next, associate the aToken with the account
    const reserveData = await tokenContract.getReserveData(
      '0x0000000000000000000000000000000000120f46'
    );
    console.log('Reserve Data: ', reserveData);
    const aTokenAddress = reserveData.aTokenAddress;
    console.log('aToken Address: ', aTokenAddress);

    const client = Client.forTestnet();
    const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
    const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
    client.setOperator(operatorAccountId, operatorPrKey);

    const tokenAssociateTxn = await new TokenAssociateTransaction()
      .setAccountId(operatorAccountId)
      .setTokenIds([aTokenSAUCE.hedera_testnet.accountId])
      .execute(client);
    const tokenAssociateReceipt = await tokenAssociateTxn.getReceipt(client);
    console.log(`- tokenAssociateReceipt ${tokenAssociateReceipt.status.toString()}`);
  });
});
