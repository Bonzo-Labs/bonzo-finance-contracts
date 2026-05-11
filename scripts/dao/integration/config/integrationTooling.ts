import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

export type IntegrationLogger = {
  banner(message: string): void;
  step(title: string, detail?: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  raw(message: string): void;
  close(): void;
};

export const formatIntegrationPath = (file: string): string =>
  path.relative(REPO_ROOT, file).split(path.sep).join('/');

export const createIntegrationLogger = (
  logFile: string,
  sink: (line: string) => void = console.log
): IntegrationLogger => {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
  const emit = (line: string) => {
    sink(line);
    fs.appendFileSync(logFile, `${line}\n`);
  };

  return {
    banner(message) {
      emit('');
      emit(`🚀 ${message}`);
      emit('='.repeat([...message].length + 3));
    },
    step(title, detail) {
      emit(`🧭 ${title}${detail ? ` — ${detail}` : ''}`);
    },
    info(message) {
      emit(`🔎 ${message}`);
    },
    success(message) {
      emit(`✅ ${message}`);
    },
    warn(message) {
      emit(`⚠️ ${message}`);
    },
    error(message) {
      emit(`❌ ${message}`);
    },
    raw(message) {
      emit(message);
    },
    close() {
      // Writes are synchronous; close is kept for a uniform logger interface.
    },
  };
};

export const writeJson = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
