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

async function mintClaimBonzo() {
  const client = Client.forTestnet();
  const operatorPrKey = PrivateKey.fromStringED25519(process.env.MAINNET_SINGULARITY_PRIVATE_KEY!);
  const operatorAccountId = AccountId.fromString(process.env.MAINNET_SINGULARITY_ACCOUNT_ID!);

  client.setOperator(operatorAccountId, operatorPrKey);

  const publicKey = operatorPrKey.publicKey;
  console.log(`Public key: ${publicKey}`);
  const treasuryAccountId = operatorAccountId;

  const mintTransaction = await new TokenCreateTransaction()
    .setTokenName('B Claim Token')
    .setTokenSymbol('BCT')
    .setTokenType(TokenType.FungibleCommon)
    .setTreasuryAccountId(treasuryAccountId)
    .setInitialSupply(100000000)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(40000000000000000)
    .setDecimals(8)
    .setAdminKey(publicKey)
    .setSupplyKey(publicKey)
    .setFeeScheduleKey(publicKey)
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
  await mintClaimBonzo();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
