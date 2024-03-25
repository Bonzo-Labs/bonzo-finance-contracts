import { ethers, network } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
import { AccountId, PrivateKey, TokenAssociateTransaction, Client } from '@hashgraph/sdk';

async function tokenWrapper() {
  const client = Client.forTestnet();
  const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY2!);
  const operatorAccountId = AccountId.fromString(process.env.TESTNET2_ACCOUNT_ID!);
  client.setOperator(operatorAccountId, operatorPrKey);

  const tokenAssociateTxn = await new TokenAssociateTransaction()
    .setAccountId(operatorAccountId)
    .setTokenIds(['0.0.1183558'])
    .freezeWith(client)
    .sign(operatorPrKey);

  const tokenAssociateSubmit = await tokenAssociateTxn.execute(client);
  const tokenAssociateRx = await tokenAssociateSubmit.getReceipt(client);
  console.log(`Status of Token Associate Transaction: ${tokenAssociateRx.status}`);
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
