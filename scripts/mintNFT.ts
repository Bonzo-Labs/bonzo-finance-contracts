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
  TokenMintTransaction,
} from '@hashgraph/sdk';

async function mintNFT() {
  const client = Client.forMainnet();
  const operatorPrKey = PrivateKey.fromStringED25519(process.env.MAINNET_DUMMY_PRIVATE_KEY!);
  const operatorAccountId = AccountId.fromString(process.env.MAINNET_DUMMY_ACCOUNT_ID!);

  client.setOperator(operatorAccountId, operatorPrKey);

  const publicKey = operatorPrKey.publicKey;
  console.log(`Public key: ${publicKey}`);
  const treasuryAccountId = AccountId.fromString(process.env.MAINNET_DUMMY_ACCOUNT_ID!);

  const metadata = new Uint8Array(Buffer.from('Dummy Dum DUM metadata'));

  const transaction = await new TokenMintTransaction()
    .setTokenId('0.0.6173723')
    .setMetadata([metadata])
    .freezeWith(client);

  //Sign with the supply private key of the token
  const signTx = await transaction.sign(operatorPrKey);

  //Submit the transaction to a Hedera network
  const txResponse = await signTx.execute(client);

  //Request the receipt of the transaction
  const receipt = await txResponse.getReceipt(client);

  //Get the transaction consensus status
  const transactionStatus = receipt.status;

  console.log('The transaction consensus status ' + transactionStatus.toString());
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
