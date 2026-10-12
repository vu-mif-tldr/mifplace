import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { envInt, loadDotEnv } from './env.js';

describe('loadDotEnv', () => {
  it('fills only unset variables and ignores a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mifplace-env-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'ENV_TEST_FROM_FILE=file\nENV_TEST_BOTH=file\n');
    process.env.ENV_TEST_BOTH = 'shell';
    delete process.env.ENV_TEST_FROM_FILE;
    try {
      loadDotEnv(file);
      assert.equal(process.env.ENV_TEST_FROM_FILE, 'file');
      assert.equal(process.env.ENV_TEST_BOTH, 'shell');
      assert.doesNotThrow(() => loadDotEnv(path.join(dir, 'missing.env')));
    } finally {
      delete process.env.ENV_TEST_FROM_FILE;
      delete process.env.ENV_TEST_BOTH;
      fs.rmSync(dir, { recursive: true });
    }
  });
});

describe('envInt', () => {
  it('returns the default when unset or empty, the value when valid', () => {
    try {
      delete process.env.ENV_TEST_INT;
      assert.equal(envInt('ENV_TEST_INT', 7, 0, 10), 7);
      process.env.ENV_TEST_INT = '';
      assert.equal(envInt('ENV_TEST_INT', 7, 0, 10), 7);
      process.env.ENV_TEST_INT = '10';
      assert.equal(envInt('ENV_TEST_INT', 7, 0, 10), 10);
    } finally {
      delete process.env.ENV_TEST_INT;
    }
  });

  it('refuses anything but digits within the range', () => {
    try {
      for (const raw of ['11', '-1', '1.5', '1e1', ' 5', 'x']) {
        process.env.ENV_TEST_INT = raw;
        assert.throws(() => envInt('ENV_TEST_INT', 7, 0, 10), /ENV_TEST_INT must be an integer/);
      }
    } finally {
      delete process.env.ENV_TEST_INT;
    }
  });
});
