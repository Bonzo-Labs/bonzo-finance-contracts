import exp from 'constants';

const { expect } = require('chai');
const { ethers } = require('hardhat');
import {
  LendingPool,
  LendingPoolAddressesProvider,
  AaveProtocolDataProvider,
} from '../deployed-contracts.json';

describe('Addresses Provider', function () {
  it('Should get the addresses provider from lending pool', async function () {
    const [owner] = await ethers.getSigners();
    console.log('Owner address: ', owner.address);
    const contractArtifacts = await hre.artifacts.readArtifact('AaveProtocolDataProvider');
    const abi = contractArtifacts.abi;

    const contractAddress = AaveProtocolDataProvider.hedera_testnet.address;

    const tokenContract = new ethers.Contract(contractAddress, abi, owner);
    console.log('Token Contract done');
    const reserveData = await tokenContract.getReserveData(
      '0x0000000000000000000000000000000000220ced'
    );
    console.log('Reserve Data: ', reserveData);
    const aTokens = await tokenContract.getAllATokens();
    console.log('aTokens: ', aTokens);
    expect(reserveData).to.not.be.null;
  });
});
