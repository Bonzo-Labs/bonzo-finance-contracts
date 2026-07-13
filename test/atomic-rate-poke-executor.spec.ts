import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { assertReviewedExecutorRuntime } from '../scripts/lower-borrow-rates/atomicRatePokeVerification';

const hre = require('hardhat');

const HTS = '0x0000000000000000000000000000000000000167';

async function deployFixture(aTokenSupply = 100, strategySlope = '50000000000000000000000') {
  const [controller, other] = await ethers.getSigners();

  const htsFactory = await ethers.getContractFactory('MockAtomicHederaTokenService');
  const hts = await htsFactory.deploy();
  await hts.deployed();
  await network.provider.send('hardhat_setCode', [HTS, await ethers.provider.getCode(hts.address)]);

  const tokenFactory = await ethers.getContractFactory('MockAtomicToken');
  const aTokenFactory = await ethers.getContractFactory('MockAtomicAToken');
  const poolFactory = await ethers.getContractFactory('MockAtomicPool');
  const configuratorFactory = await ethers.getContractFactory('MockAtomicConfigurator');
  const providerFactory = await ethers.getContractFactory('MockAtomicAddressesProvider');
  const strategyFactory = await ethers.getContractFactory('MockAtomicRateStrategy');

  const pool = await poolFactory.deploy();
  const configurator = await configuratorFactory.deploy(pool.address);
  const provider = await providerFactory.deploy(pool.address, configurator.address);

  const tokens: any[] = [];
  const aTokens: any[] = [];
  const strategies: string[] = [];
  for (let i = 0; i < 3; i++) {
    const strategy = await strategyFactory.deploy(0, strategySlope, strategySlope);
    strategies.push(strategy.address);
  }
  for (let i = 0; i < 3; i++) {
    const token = await tokenFactory.deploy();
    const aToken = await aTokenFactory.deploy(token.address, aTokenSupply);
    await token.mint(aToken.address, 100);
    await pool.setReserve(token.address, aToken.address, strategies[i]);
    tokens.push(token);
    aTokens.push(aToken);
  }

  const executorFactory = await ethers.getContractFactory('AtomicRatePokeExecutor');
  const executor = await executorFactory.deploy(
    provider.address,
    controller.address,
    tokens[0].address,
    tokens[1].address,
    tokens[2].address,
    strategies[0],
    strategies[1],
    strategies[2]
  );
  await executor.deployed();

  return {
    controller,
    other,
    provider,
    pool,
    configurator,
    executor,
    tokens,
    aTokens,
  };
}

describe('AtomicRatePokeExecutor', () => {
  it('executes the complete refresh and ends paused', async () => {
    const { provider, pool, executor, tokens, aTokens } = await deployFixture();
    const reviewedRuntime = await assertReviewedExecutorRuntime(
      hre,
      await ethers.provider.getCode(executor.address)
    );
    expect(reviewedRuntime.runtimeBytecodeHash).to.equal(
      ethers.utils.keccak256(await ethers.provider.getCode(executor.address))
    );
    await provider.setEmergencyAdmin(executor.address);

    await expect(executor.executeAtomicRefresh()).to.emit(executor, 'AtomicRateRefreshExecuted');

    expect(await pool.paused()).to.equal(true);
    expect(await executor.used()).to.equal(true);
    for (let i = 0; i < tokens.length; i++) {
      expect(await pool.refreshed(tokens[i].address)).to.equal(true);
      expect(await tokens[i].balanceOf(executor.address)).to.equal(0);
      expect(await tokens[i].balanceOf(aTokens[i].address)).to.equal(100);
      expect(await tokens[i].allowance(executor.address, pool.address)).to.equal(0);
    }
  });

  it('reverts the unpause, refresh, and used flag when the final pause fails', async () => {
    const { provider, pool, configurator, executor, tokens } = await deployFixture();
    await provider.setEmergencyAdmin(executor.address);
    await configurator.setFailFinalPause(true);

    await expect(executor.executeAtomicRefresh()).to.be.revertedWith('MOCK: final pause failed');

    expect(await pool.paused()).to.equal(true);
    expect(await executor.used()).to.equal(false);
    for (const token of tokens) expect(await pool.refreshed(token.address)).to.equal(false);
  });

  it('rejects execution before the emergency-admin handoff', async () => {
    const { executor } = await deployFixture();
    await expect(executor.executeAtomicRefresh()).to.be.revertedWith(
      'EXECUTOR: not emergency admin'
    );
  });

  it('rejects zero aToken supply before unpausing', async () => {
    const { provider, pool, executor } = await deployFixture(0);
    await provider.setEmergencyAdmin(executor.address);

    await expect(executor.executeAtomicRefresh()).to.be.revertedWith(
      'EXECUTOR: zero aToken supply'
    );
    expect(await pool.paused()).to.equal(true);
    expect(await executor.used()).to.equal(false);
  });

  it('rejects a strategy that does not have the approved 0.01% maximum curve', async () => {
    const { provider, pool, executor } = await deployFixture(100, '10000000000000000000000');
    await provider.setEmergencyAdmin(executor.address);

    await expect(executor.executeAtomicRefresh()).to.be.revertedWith('EXECUTOR: wrong slope1');
    expect(await pool.paused()).to.equal(true);
    expect(await executor.used()).to.equal(false);
  });

  it('rejects callbacks that do not originate from the LendingPool', async () => {
    const { executor, tokens } = await deployFixture();
    await expect(
      executor.executeOperation(
        tokens.map((token) => token.address),
        [1, 1, 1],
        [0, 0, 0],
        executor.address,
        '0x'
      )
    ).to.be.revertedWith('EXECUTOR: callback not pool');
  });

  it('allows only the controller to use the pause-only rescue', async () => {
    const { other, provider, pool, executor } = await deployFixture();
    await provider.setEmergencyAdmin(executor.address);
    await pool.setPause(false);

    await expect(executor.pauseOnly()).to.emit(executor, 'PauseOnlyRescueExecuted');
    expect(await pool.paused()).to.equal(true);

    await pool.setPause(false);
    await expect(executor.connect(other).pauseOnly()).to.be.revertedWith(
      'EXECUTOR: caller not controller'
    );
  });
});
