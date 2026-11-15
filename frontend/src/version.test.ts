import { appVersion, versionLabel } from './version';

describe('versionLabel', () => {
  it('writes a version like the git tag', () => {
    expect(versionLabel('0.4.1')).toBe('v0.4.1');
    expect(versionLabel('12.0.31')).toBe('v12.0.31');
  });

  it('leaves anything else as it is', () => {
    expect(versionLabel('dev')).toBe('dev');
  });
});

describe('appVersion', () => {
  it('is "dev" outside a build of main', () => {
    expect(appVersion).toBe('dev');
  });
});
