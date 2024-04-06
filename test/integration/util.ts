import hre from "hardhat";
import { BigNumber, BigNumberish, Contract, Signer } from 'ethers';
import { LendingPoolConfiguratorFactory, LendingPoolFactory } from "../../types";
import deployments from '../../deployed-contracts.json';

export const lendingPoolContract = LendingPoolFactory.connect(deployments.LendingPool.hedera_testnet.address, hre.ethers.provider);
export const lendingPoolConfiguratorContract = LendingPoolConfiguratorFactory.connect(deployments.LendingPoolConfigurator.hedera_testnet.address, hre.ethers.provider);

export async function getHtsBalance(token: string, account: string): Promise<BigNumber> {
    return await getErc20Contract(token).balanceOf(account);
}

export async function htsApprove(token: string, amount: BigNumberish, spender: string, owner: Signer): Promise<any> {
    const tx = await getErc20Contract(token).connect(owner).approve(spender, amount);
    return await tx.wait();
}

export async function htsTransfer(token: string, owner: Signer, destination: string, amount: BigNumberish) {
    const tx = await getErc20Contract(token).connect(owner).transfer(destination, amount);
    return await tx.wait();
}

const testableTokens: any[] = [];
const reserveTokens: any[] = [];
export async function getTestableTokens() {
    if (reserveTokens.length === 0) {
        const tokens = await lendingPoolContract.getReservesList();
        for (const token of tokens) {
            reserveTokens.push({ tokenAddress: token, ...(await lendingPoolContract.getReserveData(token)) });
        }
    }
    if (testableTokens.length === 0) {
        let signer = (await hre.ethers.getSigners())[0];
        for (const token of reserveTokens) {
            if ((await getHtsBalance(token.tokenAddress, signer.address)).gte(0)) {
                testableTokens.push(token);
            }
        }
    }
    return testableTokens;
}

const contracts = {};
function getErc20Contract(token: string) {
    return contracts[token] || (
        contracts[token] = new Contract(token, [{
            "inputs": [
                {
                    "internalType": "address",
                    "name": "",
                    "type": "address"
                }
            ],
            "name": "balanceOf",
            "outputs": [
                {
                    "internalType": "uint256",
                    "name": "",
                    "type": "uint256"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        }, {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "spender",
                    "type": "address"
                },
                {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                }
            ],
            "name": "approve",
            "outputs": [
                {
                    "internalType": "bool",
                    "name": "",
                    "type": "bool"
                }
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        }, {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "to",
                    "type": "address"
                },
                {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                }
            ],
            "name": "transfer",
            "outputs": [
                {
                    "internalType": "bool",
                    "name": "",
                    "type": "bool"
                }
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        }], hre.ethers.provider));
}