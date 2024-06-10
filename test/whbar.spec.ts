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

async function setupContract(artifactName, contractAddress, wallet) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, wallet || owner);
}

describe('Lending Pool Contract Tests', function () {
  let lendingPoolContract, whbarContract, tokenContract, dataProviderContract;

  before(async function () {
    console.log('Owner:', owner.address);
    console.log('Delegator:', delegator.address);
    lendingPoolContract = await setupContract(
      'LendingPool',
      LendingPool.hedera_testnet.address,
      owner
    );
    // Make sure the ABI includes the deposit function
    const whbarArtifact = await hre.artifacts.readArtifact('WHBARContract');
    console.log('WHBAR Artifact:', whbarArtifact);
    whbarContract = new ethers.Contract(
      '0x0000000000000000000000000000000000003ad1',
      whbarArtifact.abi,
      owner
    );
    tokenContract = await setupContract(
      'ERC20Wrapper',
      '0x0000000000000000000000000000000000003ad2',
      owner
    );
  });

  it('should deposit HBAR from the signer and get equivalent whbar in the normal deposit function', async function () {
    const hbarBalance = await owner.getBalance();
    console.log('HBAR Balance:', hbarBalance.toString());

    const whbarBalance = await tokenContract.balanceOf(owner.address);
    console.log('WHBAR Balance:', whbarBalance.toString());

    const txn = await whbarContract.deposit(
      { value: ethers.utils.parseEther('0.01') },
      owner.address,
      delegator.address
    );
    await txn.wait();

    const whbarBalanceAfter = await tokenContract.balanceOf(owner.address);
    console.log('WHBAR Balance After:', whbarBalanceAfter.toString());

    expect(whbarBalanceAfter).to.be.greaterThan(0);
  });
});
