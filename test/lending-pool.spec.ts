import exp from 'constants';

const { expect } = require('chai');
const { ethers } = require('hardhat');
import { LendingPool, LendingPoolAddressesProvider } from '../deployed-contracts.json';

describe('Addresses Provider', function () {
  it.skip('Should get the addresses provider from lending pool', async function () {
    const [owner] = await ethers.getSigners();
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;

    const contractAddress = LendingPool.hedera_testnet.address;

    const tokenContract = new ethers.Contract(contractAddress, abi, owner);
    const lendingPoolAddress = await tokenContract.getAddressesProvider();
    console.log('Lending Pool Addresses provider: ', lendingPoolAddress);
    expect(lendingPoolAddress).to.equal(LendingPoolAddressesProvider.hedera_testnet.address);
  });

  it('should return reserve data', async function () {
    const [owner] = await ethers.getSigners();
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;

    const contractAddress = LendingPool.hedera_testnet.address;

    const tokenContract = new ethers.Contract(contractAddress, abi, owner);
    const reserveData = await tokenContract.getReserveData(
      '0x0000000000000000000000000000000000220cED'
    );
    console.log('Reserve Data: ', reserveData);
    expect(reserveData).to.not.be.null;
  });

  it.skip('should return reserves list', async function () {
    const [owner] = await ethers.getSigners();
    const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
    const abi = contractArtifacts.abi;

    const contractAddress = LendingPool.hedera_testnet.address;

    const tokenContract = new ethers.Contract(contractAddress, abi, owner);
    const reserveData = await tokenContract.getReservesList();
    console.log('Reserve Data: ', reserveData);
    expect(reserveData).to.not.be.null;
  });
});
