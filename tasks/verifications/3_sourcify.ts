import { subtask } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

subtask('verify:sourcify-attempt-verification').setAction(
  async (taskArgs: any, hre: HardhatRuntimeEnvironment) => {
    const { address, verificationInterface, contractInformation } = taskArgs;
    const { sourceName, contractName } = contractInformation;

    var info = await hre.artifacts.getBuildInfo(`${sourceName}:${contractName}`);
    var index = findContractIndex();
    const response = await verificationInterface.verify(
      address,
      { 'metadata.json': JSON.stringify(info) },
      index
    );

    if (response.isOk()) {
      const contractURL = verificationInterface.getContractUrl(address, response.status);
      console.log(`Successfully verified contract ${contractName} on Sourcify.\r\n${contractURL}`);
    }

    return {
      success: response.isSuccess(),
      message: 'Contract successfuly verified on Sourcify',
    };

    function findContractIndex() {
      let contractIndex = 0;
      const contractsObject = info!.output.contracts;
      for (const path in contractsObject) {
        for (const testName in contractsObject[path]) {
          if (testName === contractName) {
            return contractIndex;
          }
          // @ts-ignore
          if (contractsObject[path][testName]['metadata']) {
            contractIndex++;
          }
        }
      }
      return 0;
    }
  }
);
