/* Generated by ts-generator ver. 0.0.8 */
/* tslint:disable */

import { Contract, ContractFactory, Signer } from "ethers";
import { Provider } from "ethers/providers";
import { UnsignedTransaction } from "ethers/utils/transaction";

import { TransactionOverrides } from ".";
import { Example } from "./Example";

export class ExampleFactory extends ContractFactory {
  constructor(signer?: Signer) {
    super(_abi, _bytecode, signer);
  }

  deploy(overrides?: TransactionOverrides): Promise<Example> {
    return super.deploy(overrides) as Promise<Example>;
  }
  getDeployTransaction(overrides?: TransactionOverrides): UnsignedTransaction {
    return super.getDeployTransaction(overrides);
  }
  attach(address: string): Example {
    return super.attach(address) as Example;
  }
  connect(signer: Signer): ExampleFactory {
    return super.connect(signer) as ExampleFactory;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): Example {
    return new Contract(address, _abi, signerOrProvider) as Example;
  }
}

const _abi = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [],
    name: "_n",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "test",
    outputs: [
      {
        internalType: "uint256",
        name: "n",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
];

const _bytecode =
  "0x608060405234801561001057600080fd5b50600560008190555060b4806100276000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80631aadff81146037578063f8a8fd6d146053575b600080fd5b603d606f565b6040518082815260200191505060405180910390f35b60596075565b6040518082815260200191505060405180910390f35b60005481565b6000805490509056fea264697066735822122057a64b654e079499c1bcb7323ed02df7274732301ad598f3679f40351bdb288464736f6c63430006080033";