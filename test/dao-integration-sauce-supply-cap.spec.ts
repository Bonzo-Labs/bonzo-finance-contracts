import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect } from 'chai';
import { utils } from 'ethers';
import {
  buildMultisigExecCommand,
  buildGuardianHbarSmokeIntegrationArtifacts,
  buildSupplyCapIntegrationArtifacts,
  GUARDIAN_HBAR_SMOKE_CONFIG,
  preflightSafeExecution,
  SUPPLY_CAP_INTEGRATION_CONFIG,
} from '../scripts/dao/integration/sauceSupplyCapToOneMillion';
import {
  createIntegrationLogger,
  formatIntegrationPath,
} from '../scripts/dao/integration/config/integrationTooling';
import { preflightGuardianPoolAdmin } from '../scripts/dao/integration/admin/poolAdminHandoff';

describe('supply cap guardian integration helpers', () => {
  it('builds a guardian execution artifact from the manual top-of-file config', () => {
    const built = buildSupplyCapIntegrationArtifacts({
      now: new Date('2026-04-27T09:59:00.000Z'),
      safeAddress: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
    });

    expect(built.bundle.bipId).to.equal('INTEGRATION-HEDERA-TESTNET-SAUCE-SUPPLY-CAP-1000001');
    expect(built.bundle.targetSafe).to.equal('guardian');
    expect(built.bundle.actions).to.deep.equal([
      {
        kind: 'setSupplyCap',
        args: {
          asset: '0x0000000000000000000000000000000000120f46',
          supplyCap: SUPPLY_CAP_INTEGRATION_CONFIG.supplyCap,
        },
      },
    ]);

    expect(built.encoded.chainType).to.equal('hedera_testnet');
    expect(built.encoded.targetSafe).to.equal('guardian');
    expect(built.encoded.safeAddress).to.equal('0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f');
    expect(built.encoded.safeExecution).to.deep.include({
      to: built.encoded.actions[0].to,
      value: '0',
      data: built.encoded.actions[0].data,
      operation: 0,
    });
    expect(built.encoded.actions[0].description).to.match(/guardian integration override/);
    expect(built.files.bundleFile).to.match(
      /SAUCE-SUPPLY-CAP-1000001\.2026-04-27_09-59-00\.hedera_testnet\.integration\.bundle\.json$/
    );
    expect(built.files.encodedFile).to.match(
      /SAUCE-SUPPLY-CAP-1000001\.2026-04-27_09-59-00\.hedera_testnet\.integration\.encoded\.json$/
    );
    expect(built.files.logFile).to.match(
      /SAUCE-SUPPLY-CAP-1000001\.2026-04-27_09-59-00\.hedera_testnet\.integration\.log$/
    );
  });

  it('can build a supply-cap artifact for a different configured reserve and cap', () => {
    const built = buildSupplyCapIntegrationArtifacts({
      now: new Date('2026-04-27T09:59:00.000Z'),
      safeAddress: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
      config: { chainType: 'hedera_testnet', reserveSymbol: 'USDC', supplyCap: 2_500_000 },
    });

    expect(built.bundle.bipId).to.equal('INTEGRATION-HEDERA-TESTNET-USDC-SUPPLY-CAP-2500000');
    expect(built.bundle.actions[0].args).to.deep.equal({
      asset: '0x0000000000000000000000000000000000001549',
      supplyCap: 2_500_000,
    });
    expect(built.encoded.integration.symbol).to.equal('USDC');
    expect(built.encoded.safeExecution.data).to.equal(built.encoded.actions[0].data);
  });

  it('tees integration log lines into a per-run file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonzo-integration-log-'));
    const logFile = path.join(tmp, 'run.log');
    const lines: string[] = [];

    const logger = createIntegrationLogger(logFile, (line) => lines.push(line));
    logger.step('Create payload', 'Writing guardian bundle JSON');
    logger.success('Payload written');
    logger.close();

    const content = fs.readFileSync(logFile, 'utf8');
    expect(lines).to.deep.equal([
      '🧭 Create payload — Writing guardian bundle JSON',
      '✅ Payload written',
    ]);
    expect(content).to.equal(`${lines.join('\n')}\n`);
  });

  it('formats integration paths relative to the repository root', () => {
    const absolute = path.resolve(
      __dirname,
      '../scripts/dao/integration/output/SAUCE-SUPPLY-CAP-1000001.2026-04-27_09-59-00.hedera_testnet.integration.bundle.json'
    );

    expect(formatIntegrationPath(absolute)).to.equal(
      'scripts/dao/integration/output/SAUCE-SUPPLY-CAP-1000001.2026-04-27_09-59-00.hedera_testnet.integration.bundle.json'
    );
  });

  it('runs the multisig executor without nesting another hardhat process', () => {
    const command = buildMultisigExecCommand();

    expect(command.bin).to.equal('npx');
    expect(command.args).to.include('ts-node');
    expect(command.args).to.not.include('hardhat');
    expect(command.args).to.not.include('run');
    expect(command.args).to.include('scripts/multisig/execDaoEncoded.ts');
  });

  it('builds a guardian HBAR transfer smoke artifact', () => {
    const built = buildGuardianHbarSmokeIntegrationArtifacts({
      now: new Date('2026-04-27T09:59:00.000Z'),
      safeAddress: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
    });

    expect(built.bundle.bipId).to.equal('INTEGRATION-HEDERA-TESTNET-GUARDIAN-HBAR-SMOKE');
    expect(built.bundle.targetSafe).to.equal('guardian');
    expect(built.bundle.actions).to.deep.equal([
      {
        kind: 'guardianHbarTransferSmoke',
        args: {
          receiver: GUARDIAN_HBAR_SMOKE_CONFIG.receiver,
          amountTinybar: GUARDIAN_HBAR_SMOKE_CONFIG.amountTinybar,
        },
      },
    ]);
    expect(built.encoded.integration.name).to.equal('guardianHbarTransferSmoke');
    expect(built.encoded.integration.symbol).to.equal('HBAR');
    expect(built.encoded.safeExecution).to.deep.equal({
      to: '0xbe058ee0884696653E01cfC6F34678f2762d84db',
      value: '10000000',
      data: '0x',
      operation: 0,
    });
    expect(built.files.encodedFile).to.match(
      /GUARDIAN-HBAR-SMOKE\.2026-04-27_09-59-00\.hedera_testnet\.integration\.encoded\.json$/
    );
  });

  it('preflights safeExecution with the Safe as msg.sender before approvals', async () => {
    const built = buildSupplyCapIntegrationArtifacts({
      now: new Date('2026-04-27T09:59:00.000Z'),
      safeAddress: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
    });
    const calls: any[] = [];
    const provider = {
      call: async (tx: any) => {
        calls.push(tx);
        return '0x';
      },
    };

    const result = await preflightSafeExecution(provider, built.encoded);

    expect(result).to.deep.equal({ ok: true, ret: '0x' });
    expect(calls).to.deep.equal([
      {
        from: built.encoded.safeAddress,
        to: built.encoded.safeExecution.to,
        data: built.encoded.safeExecution.data,
        value: built.encoded.safeExecution.value,
      },
    ]);
  });

  it('returns the revert reason when preflight safeExecution fails', async () => {
    const built = buildSupplyCapIntegrationArtifacts({
      now: new Date('2026-04-27T09:59:00.000Z'),
      safeAddress: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
    });
    const provider = {
      call: async () => {
        throw { reason: 'GS013' };
      },
    };

    const result = await preflightSafeExecution(provider, built.encoded);

    expect(result).to.deep.equal({ ok: false, error: 'GS013' });
  });

  it('preflights that the Guardian Safe is the current Pool Admin', async () => {
    const guardian = '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f';
    const calls: any[] = [];
    const provider = {
      call: async (tx: any) => {
        calls.push(tx);
        return utils.defaultAbiCoder.encode(['address'], [guardian]);
      },
    };

    const result = await preflightGuardianPoolAdmin(provider, guardian);

    expect(result).to.deep.equal({
      ok: true,
      poolAdmin: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
      guardianSafe: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
    });
    expect(calls[0].to).to.equal('0x74CF16e88Ec986CC12aFC9E3C9F028C3C8c5b526');
    expect(calls[0].data).to.match(/^0x/);
  });

  it('returns the exact admin mismatch reason when Guardian is not Pool Admin', async () => {
    const guardian = '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f';
    const actualAdmin = '0x0000000000000000000000000000000000000001';
    const provider = {
      call: async () => utils.defaultAbiCoder.encode(['address'], [actualAdmin]),
    };

    const result = await preflightGuardianPoolAdmin(provider, guardian);

    expect(result).to.deep.equal({
      ok: false,
      poolAdmin: '0x0000000000000000000000000000000000000001',
      guardianSafe: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
      error:
        'Guardian Safe is not the LendingPoolConfigurator Pool Admin. Current Pool Admin: 0x0000000000000000000000000000000000000001; Guardian Safe: 0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f.',
    });
  });
});
