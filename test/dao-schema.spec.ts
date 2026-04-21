/**
 * Phase A §11.2 — §11.3: bundle schema validation.
 */
import fs from 'fs';
import path from 'path';
import { expect } from 'chai';
import { validateBundle, loadBundle } from '../scripts/dao/schema/validate';

const bundlesDir = path.resolve(__dirname, '../scripts/dao/fixtures/bundles');
const invalidDir = path.resolve(__dirname, '../scripts/dao/fixtures/invalid');

const listJson = (dir: string): string[] =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));

describe('DAO bundle schema', () => {
  it('accepts every fixture in fixtures/bundles', () => {
    for (const file of listJson(bundlesDir)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const res = validateBundle(raw);
      expect(res.valid, `${path.basename(file)}: ${res.errors.join(', ')}`).to.equal(true);
    }
  });

  it('accepts every inverse bundle', () => {
    const inverseDir = path.join(bundlesDir, 'inverse');
    for (const file of listJson(inverseDir)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const res = validateBundle(raw);
      expect(res.valid, `${path.basename(file)}: ${res.errors.join(', ')}`).to.equal(true);
    }
  });

  it('rejects every fixture in fixtures/invalid', () => {
    for (const file of listJson(invalidDir)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const res = validateBundle(raw);
      expect(res.valid, `${path.basename(file)} should be invalid`).to.equal(false);
      expect(res.errors.length).to.be.greaterThan(0);
    }
  });

  it('loadBundle throws on invalid JSON', () => {
    const file = path.join(invalidDir, 'missing-bip.json');
    expect(() => loadBundle(file)).to.throw();
  });
});
