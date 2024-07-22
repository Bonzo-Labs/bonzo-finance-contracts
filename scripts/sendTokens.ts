import { ethers, network } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
import {
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  TransferTransaction,
  Client,
} from '@hashgraph/sdk';

async function tokenWrapper() {
  const client = Client.forTestnet();
  const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
  const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
  client.setOperator(operatorAccountId, operatorPrKey);

  const tokenTransferTxn = await new TransferTransaction()
    .addTokenTransfer('0.0.1183558', operatorAccountId, -1)
    .addTokenTransfer('0.0.1183558', '0.0.3642525', 1)
    .freezeWith(client)
    .sign(operatorPrKey);

  const tokenTransferSubmit = await tokenTransferTxn.execute(client);
  const tokenTransferRx = await tokenTransferSubmit.getReceipt(client);
  console.log(`Status of Token Transfer Transaction: ${tokenTransferRx}`);
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
