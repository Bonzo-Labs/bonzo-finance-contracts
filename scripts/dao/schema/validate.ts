/**
 * Lightweight bundle validator. Uses ajv if available; falls back to a tiny
 * in-repo validator that covers the structural invariants the registry relies
 * on (so unit tests never depend on a network install of ajv).
 */
import fs from 'fs';
import path from 'path';
import type { Bundle } from '../types';
import { REGISTRY } from '../actions/_registry';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const loadSchema = (name: string): any =>
  JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));

const tryLoadAjv = (): any => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Ajv = require('ajv');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const addFormats = (() => {
      try {
        return require('ajv-formats');
      } catch {
        return null;
      }
    })();
    const ajv = new Ajv({ allErrors: true, strict: false });
    if (addFormats) addFormats(ajv);
    ajv.addSchema(loadSchema('action.schema.json'), 'action.schema.json');
    return ajv.compile(loadSchema('bundle.schema.json'));
  } catch {
    return null;
  }
};

let cachedValidator: any | null | undefined;

const structuralFallback = (raw: any): ValidationResult => {
  const errors: string[] = [];
  const addr = /^0x[a-fA-F0-9]{40}$/;
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['bundle is not an object'] };
  }
  if (typeof raw.bipId !== 'string' || raw.bipId.length === 0) errors.push('bipId missing');
  if (raw.targetSafe !== 'executor' && raw.targetSafe !== 'guardian') {
    errors.push(`targetSafe must be 'executor' or 'guardian' (got ${raw.targetSafe})`);
  }
  if (!Array.isArray(raw.actions) || raw.actions.length === 0) {
    errors.push('actions must be a non-empty array');
    return { valid: errors.length === 0, errors };
  }
  raw.actions.forEach((a: any, i: number) => {
    if (!a || typeof a !== 'object') errors.push(`actions[${i}] not an object`);
    if (!a.kind || !REGISTRY[a.kind as keyof typeof REGISTRY]) {
      errors.push(`actions[${i}].kind ${a.kind} not in registry`);
    }
    if (!a.args || typeof a.args !== 'object') {
      errors.push(`actions[${i}].args must be an object`);
    }
    if (a.target !== undefined && !addr.test(a.target)) {
      errors.push(`actions[${i}].target is not an EVM address`);
    }
    // Cross-field: guardian bundles may only carry guardian-default actions
    if (raw.targetSafe === 'guardian') {
      const mod = a.kind ? REGISTRY[a.kind as keyof typeof REGISTRY] : undefined;
      if (mod && mod.defaultTargetSafe !== 'guardian') {
        errors.push(
          `actions[${i}] kind=${a.kind} is not a guardian action (defaultTargetSafe=${mod.defaultTargetSafe})`
        );
      }
    }
  });
  return { valid: errors.length === 0, errors };
};

export const validateBundle = (raw: unknown): ValidationResult => {
  if (cachedValidator === undefined) cachedValidator = tryLoadAjv();
  if (cachedValidator) {
    const ok = cachedValidator(raw);
    if (ok) return structuralFallback(raw); // always run cross-field guardian check
    const ajvErrors = (cachedValidator.errors || []).map(
      (e: any) => `${e.instancePath || '<root>'}: ${e.message}`
    );
    return { valid: false, errors: ajvErrors };
  }
  return structuralFallback(raw);
};

export const loadBundle = (filePath: string): Bundle => {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const res = validateBundle(raw);
  if (!res.valid) {
    throw new Error(`Bundle ${filePath} failed validation:\n  - ${res.errors.join('\n  - ')}`);
  }
  return raw as Bundle;
};
