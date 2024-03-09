import exp from 'constants';

const { expect } = require('chai');
const { ethers } = require('hardhat');
import { LendingPool, LendingPoolAddressesProvider } from '../deployed-contracts.json';

describe('Addresses Provider', function () {
  it.skip('Should read addresses from the addresses provider', async function () {
    const [owner] = await ethers.getSigners();
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPoolAddressesProvider');
    const abi = contractArtifacts.abi;

    const contractAddress = LendingPoolAddressesProvider.hedera_testnet.address;

    const tokenContract = new ethers.Contract(contractAddress, abi, owner);
    const lendingPoolAddress = await tokenContract.getLendingPool();
    console.log('Lending Pool Address: ', lendingPoolAddress);
    expect(lendingPoolAddress).to.equal(LendingPool.hedera_testnet.address);
  });
});
