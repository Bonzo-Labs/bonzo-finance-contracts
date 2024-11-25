import { ethers, artifacts } from 'hardhat';
import dotenv from 'dotenv';
dotenv.config(); // Load environment variables
import {
  LendingPool,
  AaveProtocolDataProvider,
  PriceOracle,
} from '../outputReserveDataTestnet.json';
import {
  ContractFunctionParameters,
  ContractExecuteTransaction,
  AccountAllowanceApproveTransaction,
  Client,
  AccountId,
  PrivateKey,
} from '@hashgraph/sdk';

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
let lendingPool;
let dataProviderContract;
let supraOracleContract;
let liquidationContract;

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

if (chain_type === 'hedera_testnet') {
  chainData = {
    operatorPrKey: PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY2!),
    operatorAccountId: AccountId.fromString(process.env.ACCOUNT_ID2!),
    providerUrl: 'https://testnet.hashio.io/api',
    ownerPrivateKey: process.env.PRIVATE_KEY2!,
    liquidatorContract: '0x6465468ac43aAD50C322AcBf582eCFCB2222ea21',
    liquidatorContractId: '0.0.5168494',
    routerContractId: '0.0.19264',
    tokenPath: [
      '0x0000000000000000000000000000000000001549',
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

// List of users to liquidate
const liquidatables = [
  '0x0000000000000000000000000000000000372b1a',
  '0x000000000000000000000000000000000046ee16',
  '0x986d107ba40b8e85ae2151cd8b0e1608d2bba15d',
  '0x00000000000000000000000000000000004748ec',
];

// Function to get user reserve data
async function getUserReserveData(reserve: string, user: string) {
  const userReserveData = await dataProviderContract.getUserReserveData(reserve, user);
  const supplied = ethers.utils.formatUnits(userReserveData.currentATokenBalance.toString(), 6);
  const borrowed = ethers.utils.formatUnits(userReserveData.currentVariableDebt.toString(), 6);
  const ltv = userReserveData.currentVariableDebt.gt(0)
    ? (parseFloat(borrowed) / parseFloat(supplied)) * 100
    : 0;

  return {
    supplied,
    borrowed,
    ltv,
  };
}

// Helper function to process supplied and borrowed amounts
async function processAmount(
  amount: string,
  decimals: number,
  reserveAddress: string
): Promise<number> {
  const parsedAmount = ethers.utils.parseUnits(amount, decimals);
  const amountInETH = await supraOracleContract.getAmountInEth(parsedAmount, reserveAddress);
  return parseFloat(ethers.utils.formatUnits(amountInETH, 'ether'));
}

// Function to get the highest collateral and debt
async function getHighestCollateralAndDebt(
  user: string
): Promise<{ collateralReserve: string; debtReserve: string; supplied: number; borrowed: number }> {
  const reserves: Record<string, { name: string; decimals: number }> = {
    '0x00000000000000000000000000000000003991eD': { name: 'KARATE', decimals: 8 },
    '0x0000000000000000000000000000000000001549': { name: 'USDC', decimals: 6 },
    '0x000000000000000000000000000000000015a59b': { name: 'XSAUCE', decimals: 6 },
    '0x0000000000000000000000000000000000220ced': { name: 'HBARX', decimals: 8 },
    '0x0000000000000000000000000000000000120f46': { name: 'SAUCE', decimals: 6 },
    '0x0000000000000000000000000000000000003ad2': { name: 'WHBAR', decimals: 8 },
  };

  let highestCollateral = { reserve: '', supplied: 0 };
  let highestDebt = { reserve: '', borrowed: 0 };

  for (const reserveAddress in reserves) {
    const { supplied, borrowed } = await getUserReserveData(reserveAddress, user);

    const formattedSupplied = await processAmount(
      supplied,
      reserves[reserveAddress].decimals,
      reserveAddress
    );
    if (formattedSupplied > highestCollateral.supplied) {
      highestCollateral = { reserve: reserveAddress, supplied: formattedSupplied };
    }

    const formattedBorrowed = await processAmount(
      borrowed,
      reserves[reserveAddress].decimals,
      reserveAddress
    );
    if (formattedBorrowed > highestDebt.borrowed) {
      highestDebt = { reserve: reserveAddress, borrowed: formattedBorrowed };
    }
  }

  return {
    collateralReserve: highestCollateral.reserve,
    debtReserve: highestDebt.reserve,
    supplied: highestCollateral.supplied,
    borrowed: highestDebt.borrowed,
  };
}

// Function to perform liquidation
async function liquidateWithScript() {
  const user = liquidatables[2];
  const { collateralReserve, debtReserve, supplied, borrowed } = await getHighestCollateralAndDebt(
    user
  );
  console.log(`User: ${user}`);
  console.log(`Collateral Reserve: ${collateralReserve}`);
  console.log(`Debt Reserve: ${debtReserve}`);
  console.log(`Supplied: ${supplied}`);
  console.log(`Borrowed: ${borrowed}`);

  const debtTokenERC20 = await setupContract('ERC20', debtReserve);
  const approvalTxn = await debtTokenERC20.approve(lendingPool.address, 100000);
  await approvalTxn.wait();
  console.log('Approval successful');

  const liquidationCallTxn = await lendingPool.liquidationCall(
    collateralReserve,
    debtReserve,
    user,
    100,
    false
  );
  await liquidationCallTxn.wait();
  console.log('Liquidation successful');
}

async function liquidateWithContract() {
  const user = liquidatables[2];
  const { collateralReserve, debtReserve, supplied, borrowed } = await getHighestCollateralAndDebt(
    user
  );
  console.log(`User: ${user}`);
  console.log(`Collateral Reserve: ${collateralReserve}`);
  console.log(`Debt Reserve: ${debtReserve}`);
  console.log(`Supplied: ${supplied}`);
  console.log(`Borrowed: ${borrowed}`);

  const debtTokenERC20 = await setupContract('ERC20', debtReserve);
  const approvalTxn = await debtTokenERC20.approve(chainData.liquidatorContract, 100000);
  await approvalTxn.wait();
  console.log('Approval successful');

  const liquidationTxn = await liquidationContract.liquidateWithoutFlashloan(
    user,
    debtReserve,
    collateralReserve,
    100,
    {
      gasLimit: 13800000,
    }
  );
  await liquidationTxn.wait();
  console.log('Liquidation successful');
}

async function liquidate() {
  const user = liquidatables[2];
  const collateralReserve = '0x0000000000000000000000000000000000120f46';
  const debtReserve = '0x0000000000000000000000000000000000003ad2';
  const borrowed = 100;
  console.log(`User: ${user}`);
  console.log(`Caller address: ${owner.address}`);
  console.log(`Collateral Reserve: ${collateralReserve}`);
  console.log(`Debt Reserve: ${debtReserve}`);
  console.log(`Borrowed: ${borrowed}`);

  const flashloanTxn = await liquidationContract.liquidate(
    user,
    debtReserve,
    collateralReserve,
    borrowed,
    {
      gasLimit: 13800000,
    }
  );
  await flashloanTxn.wait();
  console.log('Flash loan successful');
}

// Main function
async function main() {
  // Initialize contracts inside main to avoid top-level await
  lendingPool = await setupContract('LendingPool', LendingPool.hedera_testnet.address);
  dataProviderContract = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_testnet.address
  );
  supraOracleContract = await setupContract('SupraOracle', PriceOracle.hedera_testnet.address);
  liquidationContract = await setupContract('Liquidator', chainData.liquidatorContract);

  await liquidateWithScript();
  // await liquidate();
  // await liquidateWithContract();
}

// Execute the main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
