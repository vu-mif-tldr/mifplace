import { describe, expect, it } from 'vitest';
import { FIRST_VERSION, bumpFor, latestTag, nextVersion, parseTag } from './release-version.js';

describe('parseTag', () => {
  it('reads vX.Y.Z', () => {
    expect(parseTag('v0.4.0')).toEqual([0, 4, 0]);
    expect(parseTag('v12.0.31')).toEqual([12, 0, 31]);
  });

  it('skips other tags', () => {
    for (const tag of ['0.4.0', 'v0.4', 'v0.4.0-rc.1', 'v01.2.3', 'release', '']) {
      expect(parseTag(tag)).toBeNull();
    }
  });
});

describe('latestTag', () => {
  it('compares numbers, not strings', () => {
    expect(latestTag(['v1.9.3', 'v1.10.0', 'v1.2.30'])).toBe('v1.10.0');
  });

  it('ignores tags that are not versions', () => {
    expect(latestTag(['demo', 'v0.4.1', 'v9'])).toBe('v0.4.1');
    expect(latestTag(['demo'])).toBeNull();
    expect(latestTag([])).toBeNull();
  });
});

describe('bumpFor', () => {
  it('raises Z without a label', () => {
    expect(bumpFor([])).toBe('patch');
    expect(bumpFor(['documentation'])).toBe('patch');
  });

  it('takes the biggest step any merged pull request asks for', () => {
    expect(bumpFor(['minor'])).toBe('minor');
    expect(bumpFor(['minor', 'major', 'minor'])).toBe('major');
  });
});

describe('nextVersion', () => {
  it('starts at FIRST_VERSION', () => {
    expect(nextVersion(null, 'major')).toBe(FIRST_VERSION);
    expect(FIRST_VERSION).toBe('0.4.0');
  });

  it('raises Z, or Y with Z back to 0, or X with Y and Z back to 0', () => {
    expect(nextVersion('v0.4.9', 'patch')).toBe('0.4.10');
    expect(nextVersion('v0.4.9', 'minor')).toBe('0.5.0');
    expect(nextVersion('v0.4.9', 'major')).toBe('1.0.0');
  });
});
