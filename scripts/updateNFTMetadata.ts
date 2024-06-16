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
  TokenCreateTransaction,
  TokenType,
  Hbar,
  TokenSupplyType,
  TokenUpdateTransaction
} from '@hashgraph/sdk';

async function mintNFT() {
  const client = Client.forTestnet();
  const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
  const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);

  client.setOperator(operatorAccountId, operatorPrKey);

  const publicKey = operatorPrKey.publicKey;
  console.log(`Public key: ${publicKey}`);
  const treasuryAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);

  const newMetadata = {
    'name': 'Your New Token Name',
    'symbol': 'F',
    'decimals': 0,
    'uri': 'https://yourdomain.com/nft/1',
    'creators': [
      {
        'address': process.env.ACCOUNT_ID!,
        'share': 100,
      },
    ],
  };
  }
  //Create the transaction and freeze for manual signing
  const transaction = await new TokenUpdateTransaction()
    .setTokenId('0.0.4448492')
    .setMetadata([1, 2])
    .setTokenName('Your New Token Name')
    .freezeWith(client);

  //Sign the transaction with the admin key
  const signTx = await transaction.sign(adminKey);

  //Submit the signed transaction to a Hedera network
  const txResponse = await signTx.execute(client);

  //Request the receipt of the transaction
  const receipt = await txResponse.getReceipt(client);

  //Get the transaction consensus status
  const transactionStatus = receipt.status.toString();

  console.log('The transaction consensus status is ' + transactionStatus);
}

async function main() {
  await mintNFT();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
