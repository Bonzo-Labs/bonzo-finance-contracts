import { task } from 'hardhat/config';
import { ConfigNames, loadPoolConfig } from '../../helpers/configuration';
import { getParamPerNetwork } from '../../helpers/contracts-helpers';
import { deployWHBARGateway } from '../../helpers/contracts-deployments';
import { getLendingPoolAddressesProvider } from '../../helpers/contracts-getters';
import { notFalsyOrZeroAddress, waitForTx } from '../../helpers/misc-utils';
import { eNetwork, ICommonConfiguration } from '../../helpers/types';

const CONTRACT_NAME = 'WHBARGateway';

task(`full-deploy-whbar-gateway`, `Deploys the ${CONTRACT_NAME} contract`)
  .addParam('pool', `Pool name to retrieve configuration, supported: ${Object.values(ConfigNames)}`)
  .addFlag('verify', `Verify ${CONTRACT_NAME} contract via HashScan API.`)
  .addFlag('authorize', `Authorize the current LendingPool after deploying ${CONTRACT_NAME}.`)
  .setAction(async ({ verify, authorize, pool }, localBRE) => {
    await localBRE.run('set-DRE');
    const network = localBRE.network.name as eNetwork;
    const poolConfig = loadPoolConfig(pool) as ICommonConfiguration;
    const reserveAssets = getParamPerNetwork(poolConfig.ReserveAssets, network);
    const addressesProvider = await getLendingPoolAddressesProvider();
    if (!poolConfig.WhbarHelper) {
      throw new Error(`WHBAR helper address is not configured for ${network}`);
    }
    const whbarHelper = getParamPerNetwork(poolConfig.WhbarHelper, network);
    const whbarToken = reserveAssets.WHBAR;

    if (!notFalsyOrZeroAddress(whbarHelper)) {
      throw new Error(`WHBAR helper address is not configured for ${network}`);
    }
    if (!notFalsyOrZeroAddress(whbarToken)) {
      throw new Error(`WHBAR reserve token address is not configured for ${network}`);
    }

    const whbarGateWay = await deployWHBARGateway([whbarHelper, addressesProvider.address], verify);
    console.log(`${CONTRACT_NAME}.address`, whbarGateWay.address);
    const gatewayWhbarToken = await whbarGateWay.getWHBARAddress();
    if (gatewayWhbarToken.toLowerCase() !== whbarToken.toLowerCase()) {
      throw new Error(
        `WHBARGateway token mismatch: expected ${whbarToken}, got ${gatewayWhbarToken}`
      );
    }
    console.log('WHBAR token address:', gatewayWhbarToken);
    if (authorize) {
      const lendingPoolAddress = await addressesProvider.getLendingPool();
      console.log('Authorizing LendingPool...');
      await waitForTx(await whbarGateWay.authorizeLendingPool(lendingPoolAddress));
      const authorizedLendingPool = await whbarGateWay.lendingPool();
      if (authorizedLendingPool.toLowerCase() !== lendingPoolAddress.toLowerCase()) {
        throw new Error('Authorized LendingPool in WHBARGateway does not match expected pool');
      }
      console.log('LendingPool authorized:', authorizedLendingPool);
    }
    console.log(`\tFinished ${CONTRACT_NAME} deployment`);
  });
