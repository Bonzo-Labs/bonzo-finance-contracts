import { ethers, network } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
import {
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  Client,
  AccountBalanceQuery,
  Mnemonic,
} from '@hashgraph/sdk';

async function tokenWrapper() {
  //   const [deployer] = await ethers.getSigners();
  //   console.log('Deployer address: ', deployer.address);
  // Load the contract artifacts
  const contractArtifacts = await hre.artifacts.readArtifact('ERC20Wrapper');
  // The ABI is now available as a JavaScript object
  const abi = contractArtifacts.abi;

  const CLXY_Token = '0x00000000000000000000000000000000000014f5';

  const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

  const tokenContract = new ethers.Contract(CLXY_Token, abi, wallet);
  const balance = await tokenContract.balanceOf('0x1e17a29d259ff4f78f02e97c7deccc7ec3aea103');
  console.log('Balance: ', balance.toString());

  //   const txn = await tokenContract.approve('0x0000000000000000000000000000000000382089', 1000);
  //   console.log('Transaction hash: ', txn.hash);
  //   await txn.wait();
  //   console.log('Transaction confirmed');

  //   const client = Client.forTestnet();
  //   const operatorPrKey = PrivateKey.fromStringECDSA(process.env.TESTNET2_PRIVATE_KEY!);
  //   const operatorAccountId = AccountId.fromString(process.env.TESTNET2_ACCOUNT_ID!);
  //   client.setOperator(operatorAccountId, operatorPrKey);

  //   const tokenAssociateTxn = await new TokenAssociateTransaction()
  //     .setAccountId(operatorAccountId)
  //     .setTokenIds(['0.0.5365'])
  //     .execute(client);
  //   const tokenAssociateReceipt = await tokenAssociateTxn.getReceipt(client);
  //   console.log(`- tokenAssociateReceipt ${tokenAssociateReceipt.status.toString()}`);

  const txn1 = await tokenContract.transfer('0xbe058ee0884696653e01cfc6f34678f2762d84db', 10);
  console.log('Transaction hash: ', txn1.hash);
  await txn1.wait();
  console.log('Transaction confirmed');
}

async function main() {
  await tokenWrapper();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
