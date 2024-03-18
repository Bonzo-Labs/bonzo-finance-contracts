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
  const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

  const client = Client.forTestnet();
  const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
  const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
  client.setOperator(operatorAccountId, operatorPrKey);

  const contractId = AccountId.fromString('0.0.3685375');
  console.log('Contract ID: ', contractId);
  console.log('Operator Account ID: ', operatorAccountId);

  const tokenAssociateTxn = await new TokenAssociateTransaction()
    .setAccountId(contractId)
    .setTokenIds(['0.0.1183558'])
    .freezeWith(client)
    .sign(PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!));

  const tokenAssociateSubmit = await tokenAssociateTxn.execute(client);
  const tokenAssociateRx = await tokenAssociateSubmit.getReceipt(client);
  console.log(`Status of Token Associate Transaction: ${tokenAssociateRx.status}`);
  // const tokenAssociateReceipt = await tokenAssociateTxn.getReceipt(client);
  // console.log(`- tokenAssociateReceipt ${tokenAssociateReceipt.status.toString()}`);
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
