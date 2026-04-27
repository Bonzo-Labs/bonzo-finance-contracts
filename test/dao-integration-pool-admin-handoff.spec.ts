import { expect } from 'chai';
import { utils } from 'ethers';
import {
  ACCOUNT2_ADMIN,
  buildDirectPoolAdminHandoff,
  buildGuardianPoolAdminReturnArtifact,
  preflightPoolAdmin,
} from '../scripts/dao/integration/poolAdminHandoff';
import { ILendingPoolAddressesProvider } from '../scripts/dao/actions/_interfaces';

describe('pool admin handoff integration helpers', () => {
  const guardianSafe = '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f';

  it('builds direct ACCOUNT2 -> Guardian setPoolAdmin calldata', () => {
    const built = buildDirectPoolAdminHandoff({
      now: new Date('2026-04-27T12:59:00.000Z'),
      guardianSafe,
    });

    expect(built.payload.bipId).to.equal('INTEGRATION-HEDERA-TESTNET-POOL-ADMIN-TO-GUARDIAN');
    expect(built.payload.from).to.equal(ACCOUNT2_ADMIN.evmAddress);
    expect(built.payload.to).to.equal('0x74CF16e88Ec986CC12aFC9E3C9F028C3C8c5b526');
    expect(built.payload.value).to.equal('0');
    expect(built.payload.accountId).to.equal('0.0.3642525');

    const decoded = ILendingPoolAddressesProvider.decodeFunctionData(
      'setPoolAdmin',
      built.payload.data
    );
    expect(utils.getAddress(decoded[0])).to.equal(guardianSafe);
    expect(built.files.payloadFile).to.match(
      /INTEGRATION-HEDERA-TESTNET-POOL-ADMIN-TO-GUARDIAN\.payload\.json$/
    );
  });

  it('builds Guardian -> ACCOUNT2 multisig return artifact', () => {
    const built = buildGuardianPoolAdminReturnArtifact({
      now: new Date('2026-04-27T12:59:00.000Z'),
      guardianSafe,
    });

    expect(built.bundle.bipId).to.equal('INTEGRATION-HEDERA-TESTNET-POOL-ADMIN-BACK-TO-ACCOUNT2');
    expect(built.bundle.targetSafe).to.equal('guardian');
    expect(built.encoded.safeAddress).to.equal(guardianSafe);
    expect(built.encoded.safeExecution.to).to.equal('0x74CF16e88Ec986CC12aFC9E3C9F028C3C8c5b526');
    expect(built.encoded.safeExecution.value).to.equal('0');
    expect(built.encoded.safeExecution.operation).to.equal(0);

    const decoded = ILendingPoolAddressesProvider.decodeFunctionData(
      'setPoolAdmin',
      built.encoded.safeExecution.data
    );
    expect(utils.getAddress(decoded[0])).to.equal(ACCOUNT2_ADMIN.evmAddress);
    expect(built.files.encodedFile).to.match(
      /INTEGRATION-HEDERA-TESTNET-POOL-ADMIN-BACK-TO-ACCOUNT2\.hedera_testnet\.encoded\.json$/
    );
  });

  it('preflights the current Pool Admin against an expected address', async () => {
    const calls: any[] = [];
    const provider = {
      call: async (tx: any) => {
        calls.push(tx);
        return utils.defaultAbiCoder.encode(['address'], [ACCOUNT2_ADMIN.evmAddress]);
      },
    };

    const result = await preflightPoolAdmin(provider, ACCOUNT2_ADMIN.evmAddress, 'ACCOUNT2');

    expect(result).to.deep.equal({
      ok: true,
      poolAdmin: ACCOUNT2_ADMIN.evmAddress,
      expectedAdmin: ACCOUNT2_ADMIN.evmAddress,
      expectedLabel: 'ACCOUNT2',
    });
    expect(calls[0].to).to.equal('0x74CF16e88Ec986CC12aFC9E3C9F028C3C8c5b526');
  });

  it('returns an exact reason when the current Pool Admin is unexpected', async () => {
    const provider = {
      call: async () => utils.defaultAbiCoder.encode(['address'], [guardianSafe]),
    };

    const result = await preflightPoolAdmin(provider, ACCOUNT2_ADMIN.evmAddress, 'ACCOUNT2');

    expect(result).to.deep.equal({
      ok: false,
      poolAdmin: guardianSafe,
      expectedAdmin: ACCOUNT2_ADMIN.evmAddress,
      expectedLabel: 'ACCOUNT2',
      error:
        'Current Pool Admin is not ACCOUNT2. Current Pool Admin: 0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f; expected ACCOUNT2: 0xbe058ee0884696653E01cfC6F34678f2762d84db.',
    });
  });
});
