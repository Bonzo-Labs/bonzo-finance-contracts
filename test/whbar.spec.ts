import exp from 'constants';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import deployedContracts from '../deployed-contracts.json';
import outputReserveData from '../scripts/outputReserveData.json';
// import outputReserveData from '../scripts/outputReserveDataCurrent.json';
import {
  AccountId,
  PrivateKey,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  Client,
  Hbar,
  HbarUnit,
} from '@hashgraph/sdk';

const {
  LendingPool,
  LendingPoolAddressesProvider,
  AaveOracle,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} = deployedContracts;
const { SAUCE, USDC, XSAUCE, KARATE } = outputReserveData;

let provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
let owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

let delegator = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

const whbarTokenId = '0.0.15058';
const whbarContractId = '0.0.15057'; // TestWHBAR contract

const client = Client.forTestnet();
const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY!);
const operatorAccountId = AccountId.fromString(process.env.ACCOUNT_ID!);
client.setOperator(operatorAccountId, operatorPrKey);

async function setupContract(artifactName, contractAddress, wallet) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, wallet);
}

describe('WHBAR Contract Tests', function () {
  let lendingPoolContract, whbarContract, tokenContract, dataProviderContract;

  before(async function () {
    console.log('Owner:', owner.address);
    console.log('Delegator:', delegator.address);
    lendingPoolContract = await setupContract(
      'LendingPool',
      LendingPool.hedera_testnet.address,
      owner
    );
    whbarContract = await setupContract(
      'WHBARContract',
      '0x0000000000000000000000000000000000003ad1',
      owner
    );
    tokenContract = await setupContract(
      'ERC20Wrapper',
      '0x0000000000000000000000000000000000003ad2',
      owner
    );

    // // Log ABI and function names for WHBAR contract
    // console.log('WHBARContract ABI:', whbarContract.interface.fragments);
    // console.log('WHBARContract Functions:', whbarContract.functions);
  });

  it.skip('should deposit HBAR from the signer and get equivalent whbar in the normal deposit function', async function () {
    const hbarBalance = await owner.getBalance();
    console.log('HBAR Balance:', hbarBalance.toString());

    const whbarBalance = await tokenContract.balanceOf(owner.address);
    console.log('WHBAR Balance:', whbarBalance.toString());

    const scWrite2 = new ContractExecuteTransaction()
      .setContractId(whbarContractId)
      .setGas(100_000)
      .setPayableAmount(new Hbar(1232, HbarUnit.Tinybar))
      .setFunction('deposit', new ContractFunctionParameters());
    const scWrite2Tx = await scWrite2.execute(client);
    await scWrite2Tx.getReceipt(client);
    console.log('Deposit txn done');

    const whbarBalanceAfter = await tokenContract.balanceOf(owner.address);
    console.log('WHBAR Balance after:', whbarBalanceAfter.toString());
  });
});
