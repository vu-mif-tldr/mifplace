import {
  forgotPassword,
  getSession,
  register,
  resetPassword,
  signIn,
  signOut,
  verifyEmail,
} from './auth';

const user = { email: 'ona@vu.lt', role: 'user' as const };
const token = 'A'.repeat(43);

describe('auth', () => {
  const fetchMock = vi.fn();
  const answer = (status: number, body?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  });
  // The request the function under test sent: its address, and the body as an object
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('getSession', () => {
    it('returns the signed-in user', async () => {
      fetchMock.mockResolvedValue(answer(200, { success: true, user }));
      await expect(getSession()).resolves.toEqual(user);
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/me');
    });

    it('is anonymous without a session', async () => {
      fetchMock.mockResolvedValue(answer(401, { success: false, code: 'unauthenticated' }));
      await expect(getSession()).resolves.toBe('anonymous');
    });

    it('throws when the server fails or answers something else', async () => {
      fetchMock.mockResolvedValue(answer(500));
      await expect(getSession()).rejects.toThrow('Could not load the session');
      fetchMock.mockResolvedValue(answer(404));
      await expect(getSession()).rejects.toThrow('Could not load the session');
      fetchMock.mockResolvedValue(answer(200, { success: true, user: { email: 'a@vu.lt' } }));
      await expect(getSession()).rejects.toThrow('invalid');
      fetchMock.mockRejectedValue(new TypeError('offline'));
      await expect(getSession()).rejects.toThrow('offline');
    });
  });

  it('signs in with a JSON body and returns the user', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, user }));
    await expect(signIn('ona@vu.lt', 'a password')).resolves.toEqual({ ok: true, value: user });
    expect(sent().url).toBe('/api/auth/login');
    expect(sent().init.method).toBe('POST');
    expect(sent().init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(sent().body).toEqual({ email: 'ona@vu.lt', password: 'a password' });
  });

  it.each([
    [
      'register',
      () => register('ona@vu.lt', 'a password'),
      { email: 'ona@vu.lt', password: 'a password' },
    ],
    ['verify', () => verifyEmail(token), { token }],
    ['password/forgot', () => forgotPassword('ona@vu.lt'), { email: 'ona@vu.lt' }],
    ['password/reset', () => resetPassword(token, 'a password'), { token, password: 'a password' }],
    ['logout', () => signOut(), undefined],
  ])('posts to /api/auth/%s', async (path, call, body) => {
    fetchMock.mockResolvedValue(answer(202, { success: true }));
    await expect(call()).resolves.toEqual({ ok: true, value: undefined });
    expect(sent().url).toBe(`/api/auth/${path}`);
    expect(sent().body).toEqual(body);
  });

  it('tells why a request failed by the code of the answer', async () => {
    fetchMock.mockResolvedValue(
      answer(401, {
        success: false,
        code: 'invalid_credentials',
        error: 'Wrong email or password.',
      })
    );
    await expect(signIn('ona@vu.lt', 'wrong')).resolves.toEqual({
      ok: false,
      code: 'invalid_credentials',
    });
  });

  it('names the failures the server gives no code for', async () => {
    // The per-IP limit
    fetchMock.mockResolvedValue(answer(429, { success: false, error: 'Too many requests' }));
    await expect(signIn('ona@vu.lt', 'x')).resolves.toEqual({ ok: false, code: 'rate_limited' });
    // An answer that is not ours: a proxy page, an unknown code
    fetchMock.mockResolvedValue(answer(502));
    await expect(signIn('ona@vu.lt', 'x')).resolves.toEqual({ ok: false, code: 'internal' });
    fetchMock.mockResolvedValue(answer(400, { success: false, code: 'new_code', error: '?' }));
    await expect(signIn('ona@vu.lt', 'x')).resolves.toEqual({ ok: false, code: 'internal' });
    // No answer at all
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(signIn('ona@vu.lt', 'x')).resolves.toEqual({ ok: false, code: 'network' });
  });
});
