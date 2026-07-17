import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import {
  REVIEWED_CREATION_BYTECODE_HASH,
  assertReviewedDeploymentPayload,
  verifyAtomicRepayHelperRuntime,
} from '../scripts/atomic-repay/atomicRepayVerification';

const hre = require('hardhat');
const HTS = '0x0000000000000000000000000000000000000167';
const ASSETS = [
  '0x00000000000000000000000000000000007e545e',
  '0x00000000000000000000000000000000000cba44',
  '0xca367694cdac8f152e33683bb36cc9d6a73f1ef2',
  '0x0000000000000000000000000000000000163b5a',
  '0x00000000000000000000000000000000001647e8',
];
const HTS_ASSETS = [ASSETS[0], ASSETS[1], ASSETS[3], ASSETS[4]];

async function fixture() {
  await network.provider.send('hardhat_reset');
  const [controller, borrower, other] = await ethers.getSigners();
  const htsFactory = await ethers.getContractFactory('MockAtomicRepayHederaTokenService');
  const hts = await htsFactory.deploy();
  await hts.deployed();
  await network.provider.send('hardhat_setCode', [HTS, await ethers.provider.getCode(hts.address)]);

  const pool = await (await ethers.getContractFactory('MockAtomicRepayPool')).deploy();
  const configurator = await (
    await ethers.getContractFactory('MockAtomicRepayConfigurator')
  ).deploy(pool.address);
  const provider = await (
    await ethers.getContractFactory('MockAtomicRepayAddressesProvider')
  ).deploy(pool.address, configurator.address);

  const tokenFactory = await ethers.getContractFactory('MockAtomicRepayToken');
  const tokenTemplate = await tokenFactory.deploy();
  const tokenRuntime = await ethers.provider.getCode(tokenTemplate.address);
  for (const asset of ASSETS) {
    await network.provider.send('hardhat_setCode', [asset, tokenRuntime]);
  }

  const tokens: any[] = ASSETS.map((asset) => tokenFactory.attach(asset));
  const debtTokens: any[] = [];
  const aTokens = ASSETS.map((_, index) => (index % 2 === 0 ? other.address : controller.address));
  for (let i = 0; i < ASSETS.length; i++) {
    const token = tokens[i];
    const debt = await (await ethers.getContractFactory('MockAtomicRepayDebtToken')).deploy();
    await pool.setReserve(token.address, aTokens[i], debt.address);
    await token.mint(borrower.address, 1_000);
    await token.mint(controller.address, 1_000);
    await debt.mint(borrower.address, i === 0 ? 500 : 300);
    debtTokens.push(debt);
  }
  const unrelatedToken = await (await ethers.getContractFactory('MockAtomicRepayToken')).deploy();

  const callers = [borrower.address, controller.address];
  const helper = await (
    await ethers.getContractFactory('AtomicRepayHelper')
  ).deploy(provider.address, controller.address, borrower.address, callers);
  await helper.deployed();

  return {
    controller,
    borrower,
    other,
    pool,
    configurator,
    provider,
    tokens,
    debtTokens,
    aTokens,
    unrelatedToken,
    callers,
    assets: ASSETS,
    htsAssets: HTS_ASSETS,
    helper,
  };
}

describe('AtomicRepayHelper', () => {
  it('matches the locked creation bytecode and reviewed runtime template', async () => {
    const { controller, borrower, provider, callers, assets, htsAssets, helper } = await fixture();
    const factory = await ethers.getContractFactory('AtomicRepayHelper');
    const deployment = factory.getDeployTransaction(
      provider.address,
      controller.address,
      borrower.address,
      callers
    );
    expect(ethers.utils.keccak256(factory.bytecode)).to.equal(REVIEWED_CREATION_BYTECODE_HASH);
    expect(() =>
      assertReviewedDeploymentPayload(deployment.data!, factory.bytecode)
    ).to.not.throw();
    const runtime = await verifyAtomicRepayHelperRuntime(
      hre,
      await ethers.provider.getCode(helper.address)
    );
    expect(runtime.runtimeBytecodeHash).to.equal(
      ethers.utils.keccak256(await ethers.provider.getCode(helper.address))
    );
    expect(await helper.assetCount()).to.equal(assets.length);
    expect(await helper.htsAssetCount()).to.equal(htsAssets.length);
    for (let i = 0; i < assets.length; i++) {
      expect(await helper.ASSETS(i)).to.equal(ethers.utils.getAddress(assets[i]));
      expect(await helper.allowedAsset(assets[i])).to.equal(true);
    }
    for (let i = 0; i < htsAssets.length; i++) {
      expect(await helper.HTS_ASSETS(i)).to.equal(ethers.utils.getAddress(htsAssets[i]));
    }
  });

  it('repays the fixed borrower atomically and finishes paused', async () => {
    const { borrower, pool, provider, tokens, debtTokens, aTokens, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await tokens[0].connect(borrower).approve(helper.address, 200);

    await expect(helper.connect(borrower).repayToken(tokens[0].address, 200))
      .to.emit(helper, 'AtomicRepaymentExecuted')
      .withArgs(tokens[0].address, borrower.address, borrower.address, 200, 500, 300, 200);

    expect(await pool.paused()).to.equal(true);
    expect(await debtTokens[0].balanceOf(borrower.address)).to.equal(300);
    expect(await tokens[0].balanceOf(aTokens[0])).to.equal(200);
    expect(await tokens[0].balanceOf(helper.address)).to.equal(0);
    expect(await tokens[0].allowance(helper.address, pool.address)).to.equal(0);
  });

  it('allows another whitelisted wallet to fund repayment for the fixed borrower', async () => {
    const { controller, borrower, provider, tokens, debtTokens, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await tokens[0].connect(controller).approve(helper.address, 100);
    await helper.connect(controller).repayToken(tokens[0].address, 100);

    expect(await tokens[0].balanceOf(controller.address)).to.equal(900);
    expect(await debtTokens[0].balanceOf(borrower.address)).to.equal(400);
    expect(await helper.totalRepaid(tokens[0].address)).to.equal(100);
  });

  it('lets the controller submit after the payer grants an allowance', async () => {
    const { controller, borrower, provider, tokens, debtTokens, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await tokens[0].connect(borrower).approve(helper.address, 125);

    await expect(
      helper.connect(controller).repayTokenFrom(borrower.address, tokens[0].address, 125)
    )
      .to.emit(helper, 'AtomicRepaymentExecuted')
      .withArgs(tokens[0].address, borrower.address, borrower.address, 125, 500, 375, 125);

    expect(await debtTokens[0].balanceOf(borrower.address)).to.equal(375);
    expect(await tokens[0].balanceOf(borrower.address)).to.equal(875);
  });

  it('supports unlimited tranches up to the remaining live debt', async () => {
    const { borrower, provider, tokens, debtTokens, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await tokens[0].connect(borrower).approve(helper.address, 500);
    await helper.connect(borrower).repayToken(tokens[0].address, 200);
    await helper.connect(borrower).repayToken(tokens[0].address, 300);

    expect(await debtTokens[0].balanceOf(borrower.address)).to.equal(0);
    expect(await helper.totalRepaid(tokens[0].address)).to.equal(500);
  });

  it('pulls only the live debt when the requested amount is larger', async () => {
    const { borrower, pool, provider, tokens, debtTokens, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await tokens[1].connect(borrower).approve(helper.address, 300);
    await helper.connect(borrower).repayToken(tokens[1].address, 10_000);

    expect(await debtTokens[1].balanceOf(borrower.address)).to.equal(0);
    expect(await tokens[1].balanceOf(borrower.address)).to.equal(700);
    expect(await pool.paused()).to.equal(true);
  });

  it('rejects non-whitelisted callers and non-selected assets', async () => {
    const { controller, borrower, other, provider, tokens, unrelatedToken, helper } =
      await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await expect(helper.connect(other).repayToken(tokens[0].address, 1)).to.be.revertedWith(
      'REPAYMENT: caller not authorized'
    );
    await expect(helper.connect(borrower).repayToken(unrelatedToken.address, 1)).to.be.revertedWith(
      'REPAYMENT: asset not allowed'
    );
    await expect(
      helper.connect(controller).repayTokenFrom(other.address, tokens[0].address, 1)
    ).to.be.revertedWith('REPAYMENT: payer not authorized');
  });

  it('requires the helper to be the current emergency admin', async () => {
    const { borrower, pool, tokens, helper } = await fixture();
    await tokens[0].connect(borrower).approve(helper.address, 100);
    await expect(helper.connect(borrower).repayToken(tokens[0].address, 100)).to.be.revertedWith(
      'REPAYMENT: not emergency admin'
    );
    expect(await pool.paused()).to.equal(true);
  });

  it('lets the controller pause and resume helper repayments', async () => {
    const { controller, borrower, provider, tokens, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await tokens[0].connect(borrower).approve(helper.address, 100);

    await expect(helper.connect(controller).setRepaymentsPaused(true))
      .to.emit(helper, 'RepaymentsPauseChanged')
      .withArgs(true, controller.address);
    await expect(helper.connect(borrower).repayToken(tokens[0].address, 100)).to.be.revertedWith(
      'REPAYMENT: repayments paused'
    );
    await helper.connect(controller).setRepaymentsPaused(false);
    await helper.connect(borrower).repayToken(tokens[0].address, 100);
  });

  it('reverts unpause, debt burn, and token transfer if the final pool pause fails', async () => {
    const { borrower, pool, configurator, provider, tokens, debtTokens, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await tokens[0].connect(borrower).approve(helper.address, 200);
    await configurator.setFailFinalPause(true);

    await expect(helper.connect(borrower).repayToken(tokens[0].address, 200)).to.be.revertedWith(
      'MOCK_REPAYMENT: final pause failed'
    );
    expect(await pool.paused()).to.equal(true);
    expect(await debtTokens[0].balanceOf(borrower.address)).to.equal(500);
    expect(await tokens[0].balanceOf(borrower.address)).to.equal(1_000);
    expect(await helper.totalRepaid(tokens[0].address)).to.equal(0);
  });

  it('supports controller-only LendingPool pause rescue', async () => {
    const { controller, other, pool, provider, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await pool.setPause(false);
    await expect(helper.connect(controller).pausePoolOnly()).to.emit(
      helper,
      'PoolPauseRescueExecuted'
    );
    expect(await pool.paused()).to.equal(true);
    await expect(helper.connect(other).pausePoolOnly()).to.be.revertedWith(
      'REPAYMENT: caller not controller'
    );
  });

  it('closes permanently and sweeps any token after close', async () => {
    const { controller, borrower, provider, tokens, unrelatedToken, helper } = await fixture();
    await provider.setEmergencyAdmin(helper.address);
    await expect(helper.connect(controller).close()).to.emit(helper, 'HelperClosed');
    expect(await helper.repaymentsPaused()).to.equal(true);
    await expect(helper.connect(controller).setRepaymentsPaused(false)).to.be.revertedWith(
      'REPAYMENT: helper closed'
    );
    await tokens[0].connect(borrower).approve(helper.address, 1);
    await expect(helper.connect(borrower).repayToken(tokens[0].address, 1)).to.be.revertedWith(
      'REPAYMENT: helper closed'
    );

    await unrelatedToken.mint(helper.address, 7);
    const controllerBefore = await unrelatedToken.balanceOf(controller.address);
    await helper.connect(controller).sweepAfterClose(unrelatedToken.address);
    expect(await unrelatedToken.balanceOf(controller.address)).to.equal(controllerBefore.add(7));
  });
});
