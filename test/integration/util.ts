import hre, { ethers } from "hardhat";
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

export async function htsAssociate(token: string, owner: Signer): Promise<any> {
    const signerAddress = await owner.getAddress();
    const tx = await getHederaTokenServiceContract().connect(owner).associateToken(signerAddress, token);
    return await tx.wait();
}

export async function htsTransfer(token: string, owner: Signer, destination: string, amount: BigNumberish) {
    const fromAddress = await owner.getAddress();
    const tx = await getHederaTokenServiceContract().connect(owner).transferToken(token, fromAddress, destination, amount, { gasLimit: 750000 });
    return await tx.wait();
}

export async function hbarTransfer(owner: Signer, destination: string, tinybars: BigNumberish) {
    const amount = BigNumber.from(tinybars).mul(10_000_000_000);
    var tx = await owner.sendTransaction({
        to: destination,
        value: amount
    })
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

let precompile: Contract | undefined = undefined;
function getHederaTokenServiceContract() {
    return precompile || (
        precompile = new Contract('0x0000000000000000000000000000000000000167', [{
            "inputs": [
                {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                },
                {
                    "internalType": "address",
                    "name": "from",
                    "type": "address"
                },
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
            "name": "transferFrom",
            "outputs": [
                {
                    "internalType": "int64",
                    "name": "responseCode",
                    "type": "int64"
                }
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        }, {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "account",
                    "type": "address"
                },
                {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                }
            ],
            "name": "associateToken",
            "outputs": [
                {
                    "internalType": "int64",
                    "name": "responseCode",
                    "type": "int64"
                }
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        }, {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                },
                {
                    "internalType": "address",
                    "name": "sender",
                    "type": "address"
                },
                {
                    "internalType": "address",
                    "name": "recipient",
                    "type": "address"
                },
                {
                    "internalType": "int64",
                    "name": "amount",
                    "type": "int64"
                }
            ],
            "name": "transferToken",
            "outputs": [
                {
                    "internalType": "int64",
                    "name": "responseCode",
                    "type": "int64"
                }
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        }], hre.ethers.provider));
}