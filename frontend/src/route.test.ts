// @vitest-environment happy-dom
import { clearRoute, parseRoute } from './route';

const token = 'aB3_-'.repeat(8) + 'xyz';

describe('parseRoute', () => {
  it('reads the links of the emails', () => {
    expect(token).toHaveLength(43);
    expect(parseRoute(`#/verify/${token}`)).toEqual({ name: 'verify', token });
    expect(parseRoute(`#/reset/${token}`)).toEqual({ name: 'reset', token });
  });

  it('is home for everything else', () => {
    for (const hash of [
      '',
      '#',
      '#/',
      '#/verify',
      '#/verify/',
      '#/verify/short',
      `#/verify/${token}/more`,
      `#/verify/${token}!`,
      `#/login/${token}`,
      `/verify/${token}`,
    ]) {
      expect(parseRoute(hash), hash).toEqual({ name: 'home' });
    }
  });
});

describe('clearRoute', () => {
  it('takes the token out of the address and keeps the rest', () => {
    history.replaceState(null, '', `/?from=email#/verify/${token}`);
    clearRoute();
    expect(location.hash).toBe('');
    expect(location.pathname + location.search).toBe('/?from=email');
  });
});
