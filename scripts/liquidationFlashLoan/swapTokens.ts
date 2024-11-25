import { ethers } from 'hardhat';
import {
  ContractFunctionParameters,
  ContractExecuteTransaction,
  AccountAllowanceApproveTransaction,
  Client,
  AccountId,
  PrivateKey,
} from '@hashgraph/sdk';
import dotenv from 'dotenv';

dotenv.config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

interface ChainData {
  operatorPrKey: PrivateKey;
  operatorAccountId: AccountId;
  providerUrl: string;
  ownerPrivateKey: string;
  liquidatorContract: string;
  routerContractId: string;
  tokenPath: string[];
  toAddress: string;
  tokenId: string;
  ownerAccountId: string;
  liquidatorContractId: string;
}

let client: Client;
let provider;
let owner;
let chainData: ChainData;

if (chain_type === 'hedera_testnet') {
  chainData = {
    operatorPrKey: PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY2!),
    operatorAccountId: AccountId.fromString(process.env.ACCOUNT_ID2!),
    providerUrl: 'https://testnet.hashio.io/api',
    ownerPrivateKey: process.env.PRIVATE_KEY2!,
    liquidatorContract: '0x6465468ac43aAD50C322AcBf582eCFCB2222ea21',
    liquidatorContractId: '0.0.5168494',
    routerContractId: '0.0.5165264',
    tokenPath: [
      '0x0000000000000000000000000000000000120f46',
      '0x0000000000000000000000000000000000003aD2',
      '0x0000000000000000000000000000000000120f46',
    ],
    toAddress: '0xbe058ee0884696653e01cfc6f34678f2762d84db',
    tokenId: '0.0.5449',
    ownerAccountId: '0.0.3642525',
  };
} else if (chain_type === 'hedera_mainnet') {
  chainData = {
    operatorPrKey: PrivateKey.fromStringECDSA(process.env.MAINNET_PRIVATE_KEY!),
    operatorAccountId: AccountId.fromString(process.env.MAINNET_ACCOUNT_ID!),
    providerUrl: process.env.PROVIDER_URL_MAINNET!,
    ownerPrivateKey: process.env.PRIVATE_KEY_MAINNET!,
    liquidatorContract: '',
    routerContractId: '',
    tokenPath: [],
    toAddress: '',
    tokenId: '',
    ownerAccountId: '',
    liquidatorContractId: '',
  };
} else {
  throw new Error(`Unsupported chain type: ${chain_type}`);
}

client = chain_type === 'hedera_testnet' ? Client.forTestnet() : Client.forMainnet();
client.setOperator(chainData.operatorAccountId, chainData.operatorPrKey);

provider = new ethers.providers.JsonRpcProvider(chainData.providerUrl);
owner = new ethers.Wallet(chainData.ownerPrivateKey, provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function swapTokenForToken() {
  const amountInMax = 1000;
  const amountOut = 100;
  const deadline = Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60;

  // Approve transaction
  const approveTxn = await new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(
      chainData.tokenId,
      chainData.ownerAccountId,
      chainData.routerContractId,
      amountInMax
    )
    .freezeWith(client);
  const signTx = await approveTxn.sign(chainData.operatorPrKey);
  const txResponse = await signTx.execute(client);
  const receipt = await txResponse.getReceipt(client);
  console.log(`- Approve Receipt ${receipt.status.toString()}`);

  const params = new ContractFunctionParameters()
    .addUint256(amountOut)
    .addUint256(amountInMax)
    .addAddressArray(chainData.tokenPath)
    .addAddress(chainData.toAddress)
    .addUint256(deadline);

  const record = await new ContractExecuteTransaction()
    .setContractId(chainData.routerContractId)
    .setGas(1280000)
    .setFunction('swapTokensForExactTokens', params)
    .freezeWith(client);

  const signTx2 = await record.sign(chainData.operatorPrKey);
  const txResponse2 = await signTx2.execute(client);
  const receipt2 = await txResponse2.getReceipt(client);
  console.log(`- Swap Receipt ${receipt2.status.toString()}`);
}

async function swapTokensUsingContract() {
  const amountInMax = 1000;
  const amountOut = 100;

  const liquidator = await setupContract('Liquidator', chainData.liquidatorContract);
  const getSaucerswapRouter = await liquidator.getSaucerswapRouter();
  console.log(`- SaucerSwap Router: ${getSaucerswapRouter}`);

  const getWHBAR = await liquidator.getWHBAR();
  console.log(`- WHBAR: ${getWHBAR}`);

  const approveTxn = await new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(
      chainData.tokenId,
      chainData.ownerAccountId,
      chainData.liquidatorContractId,
      amountInMax
    )
    .freezeWith(client);
  const signTx = await approveTxn.sign(chainData.operatorPrKey);
  const txResponse = await signTx.execute(client);
  const receipt = await txResponse.getReceipt(client);
  console.log(`- Approve Receipt ${receipt.status.toString()}`);

  const swapTxn = await liquidator.testSwapFunction(
    chainData.tokenPath[0],
    chainData.tokenPath[2],
    amountInMax,
    amountOut,
    {
      gasLimit: 13800000,
    }
  );
  await swapTxn.wait();
  console.log(`- Swap transaction successful`);
}

async function main() {
  // await swapTokenForToken();
  await swapTokensUsingContract();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
