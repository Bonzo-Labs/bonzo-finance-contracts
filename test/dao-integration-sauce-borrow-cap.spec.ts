import { expect } from 'chai';
import {
  buildBorrowCapIntegrationArtifacts,
  BORROW_CAP_INTEGRATION_CONFIG,
} from '../scripts/dao/integration/sauceBorrowCap500k';
import { preflightSafeExecution } from '../scripts/dao/integration/sauceSupplyCapToOneMillion';

describe('borrow cap guardian integration helpers', () => {
  it('builds a guardian execution artifact from the manual top-of-file config', () => {
    const built = buildBorrowCapIntegrationArtifacts({
      now: new Date('2026-04-27T09:59:00.000Z'),
      safeAddress: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
    });

    expect(built.bundle.bipId).to.equal('INTEGRATION-HEDERA-TESTNET-SAUCE-BORROW-CAP-500K');
    expect(built.bundle.targetSafe).to.equal('guardian');
    expect(built.bundle.actions).to.deep.equal([
      {
        kind: 'setBorrowCap',
        args: {
          asset: '0x0000000000000000000000000000000000120f46',
          borrowCap: BORROW_CAP_INTEGRATION_CONFIG.borrowCap,
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
      /SAUCE-BORROW-CAP-500K\.2026-04-27_09-59-00\.hedera_testnet\.integration\.bundle\.json$/
    );
    expect(built.files.encodedFile).to.match(
      /SAUCE-BORROW-CAP-500K\.2026-04-27_09-59-00\.hedera_testnet\.integration\.encoded\.json$/
    );
    expect(built.files.logFile).to.match(
      /SAUCE-BORROW-CAP-500K\.2026-04-27_09-59-00\.hedera_testnet\.integration\.log$/
    );
  });

  it('can build a borrow-cap artifact for a different configured reserve and cap', () => {
    const built = buildBorrowCapIntegrationArtifacts({
      now: new Date('2026-04-27T09:59:00.000Z'),
      safeAddress: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
      config: { chainType: 'hedera_testnet', reserveSymbol: 'USDC', borrowCap: 1_000_000 },
    });

    expect(built.bundle.bipId).to.equal('INTEGRATION-HEDERA-TESTNET-USDC-BORROW-CAP-1M');
    expect(built.bundle.actions[0].args).to.deep.equal({
      asset: '0x0000000000000000000000000000000000001549',
      borrowCap: 1_000_000,
    });
    expect(built.encoded.integration.symbol).to.equal('USDC');
    expect(built.encoded.safeExecution.data).to.equal(built.encoded.actions[0].data);
  });

  it('preflights safeExecution with the Safe as msg.sender before approvals', async () => {
    const built = buildBorrowCapIntegrationArtifacts({
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
});
