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
} from '@hashgraph/sdk';

async function mintNFT() {
  const client = Client.forMainnet();
  const operatorPrKey = PrivateKey.fromStringED25519(process.env.MAINNET_SINGULARITY_PRIVATE_KEY!);
  const operatorAccountId = AccountId.fromString(process.env.MAINNET_SINGULARITY_ACCOUNT_ID!);

  client.setOperator(operatorAccountId, operatorPrKey);

  const publicKey = operatorPrKey.publicKey;
  console.log(`Public key: ${publicKey}`);
  const treasuryAccountId = AccountId.fromString(process.env.MAINNET_SINGULARITY_ACCOUNT_ID!);

  const mintTransaction = await new TokenCreateTransaction()
    .setTokenName('Bonzo Singularity Collectibles')
    .setTokenSymbol('SINGULARITY')
    .setTokenType(TokenType.NonFungibleUnique)
    .setTreasuryAccountId(treasuryAccountId)
    .setInitialSupply(0)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(400)
    .setDecimals(0)
    .setAdminKey(publicKey)
    .setSupplyKey(publicKey)
    .setFeeScheduleKey(publicKey)
    .setMetadataKey(publicKey)
    .setAutoRenewAccountId(treasuryAccountId)
    .freezeWith(client);

  const signTx = await mintTransaction.sign(operatorPrKey);
  const txResponse = await signTx.execute(client);
  const mintReceipt = await txResponse.getReceipt(client);
  console.log(`- Mint Receipt ${mintReceipt.status.toString()}`);

  const tokenId = mintReceipt.tokenId;
  console.log(`Token ID: ${tokenId}`);
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
