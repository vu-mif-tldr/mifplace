// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { forgotPassword, register, resetPassword, signIn, verifyEmail } from '../auth';
import type { Route } from '../route';
import { authError, authTexts as t } from '../texts';
import AuthScreen from './AuthScreen.vue';

// The screens against a fake server: the account requests are mocked
vi.mock('../auth', () => ({
  signIn: vi.fn(),
  register: vi.fn(),
  verifyEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

const user = { email: 'ona@mif.stud.vu.lt', role: 'user' as const };
const token = 'A'.repeat(43);
const ok = { ok: true as const, value: undefined };

afterEach(() => vi.clearAllMocks());

function screen(link: Route = { name: 'home' }) {
  return mount(AuthScreen, { props: { link } });
}

const title = (wrapper: VueWrapper) => wrapper.get('h2').text();

// Clicks the link under the form that leads to another screen
async function follow(wrapper: VueWrapper, label: string) {
  const link = wrapper.findAll('.link').find((button) => button.text() === label);
  expect(link, label).toBeDefined();
  await link!.trigger('click');
}

async function fill(wrapper: VueWrapper, values: { email?: string; password?: string }) {
  if (values.email !== undefined) await wrapper.get('input[type=email]').setValue(values.email);
  if (values.password !== undefined) {
    await wrapper.get('input[type=password]').setValue(values.password);
  }
}

async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('sign-in', () => {
  it('is the first screen, with the name and what the page is', () => {
    const wrapper = screen();
    expect(wrapper.get('h1').text()).toBe('vu.place');
    expect(wrapper.get('.about').text()).toBe(t.about);
    expect(title(wrapper)).toBe(t.signInTitle);
    expect(wrapper.get('.submit').text()).toBe(t.signIn);
    // Password managers fill these in
    expect(wrapper.get('input[type=email]').attributes('autocomplete')).toBe('username');
    expect(wrapper.get('input[type=password]').attributes('autocomplete')).toBe('current-password');
  });

  it('signs in and hands the user to the page', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, value: user });
    const wrapper = screen();
    await fill(wrapper, { email: ' Ona@MIF.stud.vu.lt ', password: 'a good password' });
    await submit(wrapper);
    // The address goes out as the server stores it
    expect(signIn).toHaveBeenCalledWith('ona@mif.stud.vu.lt', 'a good password');
    expect(wrapper.emitted('signedIn')).toEqual([[user]]);
  });

  it('says what is missing without asking the server', async () => {
    const wrapper = screen();
    await fill(wrapper, { email: 'not an address' });
    await submit(wrapper);
    expect(signIn).not.toHaveBeenCalled();
    const errors = wrapper.findAll('.field .error').map((error) => error.text());
    expect(errors).toEqual([t.invalidEmail, t.noPassword]);
  });

  it.each(['invalid_credentials', 'email_not_verified', 'banned', 'too_many_attempts', 'network'])(
    'tells a failure in words: %s',
    async (code) => {
      vi.mocked(signIn).mockResolvedValue({ ok: false, code: code as 'banned' });
      const wrapper = screen();
      await fill(wrapper, { email: 'ona@vu.lt', password: 'wrong password' });
      await submit(wrapper);
      expect(wrapper.get('.message.error').text()).toBe(authError(code));
      expect(wrapper.emitted('signedIn')).toBeUndefined();
      // The form can be sent again
      expect(wrapper.get('.submit').attributes('disabled')).toBeUndefined();
    }
  );

  it('turns the ring and takes no second request while one is on its way', async () => {
    let answer!: (result: { ok: true; value: typeof user }) => void;
    vi.mocked(signIn).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const wrapper = screen();
    await fill(wrapper, { email: 'ona@vu.lt', password: 'a good password' });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('.ring').classes()).toContain('busy');
    expect(wrapper.get('.submit').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(signIn).toHaveBeenCalledTimes(1);
    answer({ ok: true, value: user });
    await flushPromises();
    expect(wrapper.get('.ring').classes()).not.toContain('busy');
  });

  it('shows the password on request', async () => {
    const wrapper = screen();
    await fill(wrapper, { password: 'a good password' });
    const reveal = wrapper.get('.reveal');
    expect(reveal.text()).toBe(t.show);
    await reveal.trigger('click');
    expect(wrapper.get('.field input[autocomplete=current-password]').attributes('type')).toBe(
      'text'
    );
    expect(reveal.text()).toBe(t.hide);
  });
});

describe('registration', () => {
  it('registers and says to check the email', async () => {
    vi.mocked(register).mockResolvedValue(ok);
    const wrapper = screen();
    await follow(wrapper, t.toRegister);
    expect(title(wrapper)).toBe(t.registerTitle);
    expect(wrapper.get('input[type=password]').attributes('autocomplete')).toBe('new-password');
    expect(wrapper.get('.hint').text()).toBe(t.passwordHint);

    await fill(wrapper, { email: 'ona@mif.stud.vu.lt', password: 'a good password' });
    await submit(wrapper);
    expect(register).toHaveBeenCalledWith('ona@mif.stud.vu.lt', 'a good password');
    expect(title(wrapper)).toBe(t.checkEmailTitle);
    expect(wrapper.get('.lead').text()).toBe(t.registeredLead('ona@mif.stud.vu.lt'));
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('.submit').exists()).toBe(false);
  });

  it('checks the length of the password before asking the server', async () => {
    const wrapper = screen();
    await follow(wrapper, t.toRegister);
    await fill(wrapper, { email: 'ona@vu.lt', password: 'too short' });
    await submit(wrapper);
    expect(wrapper.get('.field .error').text()).toBe(t.shortPassword);
    await fill(wrapper, { password: 'a'.repeat(129) });
    await submit(wrapper);
    expect(wrapper.get('.field .error').text()).toBe(t.longPassword);
    expect(register).not.toHaveBeenCalled();
  });

  it('says when the address is not a VU one, and keeps the form', async () => {
    vi.mocked(register).mockResolvedValue({ ok: false, code: 'email_not_allowed' });
    const wrapper = screen();
    await follow(wrapper, t.toRegister);
    await fill(wrapper, { email: 'ona@gmail.com', password: 'a good password' });
    await submit(wrapper);
    expect(wrapper.get('.message.error').text()).toBe(authError('email_not_allowed'));
    expect(title(wrapper)).toBe(t.registerTitle);
  });

  it('keeps the address and drops the password and the messages between screens', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, code: 'invalid_credentials' });
    const wrapper = screen();
    await fill(wrapper, { email: 'ona@vu.lt', password: 'wrong password' });
    await submit(wrapper);
    await follow(wrapper, t.toRegister);
    expect((wrapper.get('input[type=email]').element as HTMLInputElement).value).toBe('ona@vu.lt');
    expect((wrapper.get('input[type=password]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('.message').exists()).toBe(false);
  });
});

describe('forgot password', () => {
  it('asks for a link and says to check the email', async () => {
    vi.mocked(forgotPassword).mockResolvedValue(ok);
    const wrapper = screen();
    await follow(wrapper, t.forgot);
    expect(title(wrapper)).toBe(t.forgotTitle);
    expect(wrapper.find('input[type=password]').exists()).toBe(false);
    await fill(wrapper, { email: 'ona@vu.lt' });
    await submit(wrapper);
    expect(forgotPassword).toHaveBeenCalledWith('ona@vu.lt');
    expect(wrapper.get('.lead').text()).toBe(t.forgotSentLead('ona@vu.lt'));
    await follow(wrapper, t.backToSignIn);
    expect(title(wrapper)).toBe(t.signInTitle);
  });

  it('tells when the email cannot be sent', async () => {
    vi.mocked(forgotPassword).mockResolvedValue({ ok: false, code: 'mail_unavailable' });
    const wrapper = screen();
    await follow(wrapper, t.forgot);
    await fill(wrapper, { email: 'ona@vu.lt' });
    await submit(wrapper);
    expect(wrapper.get('.message.error').text()).toBe(authError('mail_unavailable'));
    expect(title(wrapper)).toBe(t.forgotTitle);
  });
});

describe('the link of the registration email', () => {
  const link: Route = { name: 'verify', token };

  it('does nothing until the button is pressed, then leads to sign-in', async () => {
    vi.mocked(verifyEmail).mockResolvedValue(ok);
    const wrapper = screen(link);
    expect(title(wrapper)).toBe(t.verifyTitle);
    await flushPromises();
    // A mail scanner that opens the page must not confirm the address
    expect(verifyEmail).not.toHaveBeenCalled();

    await submit(wrapper);
    expect(verifyEmail).toHaveBeenCalledWith(token);
    expect(wrapper.emitted('linkDone')).toHaveLength(1);
    expect(wrapper.emitted('signedIn')).toBeUndefined();
    expect(title(wrapper)).toBe(t.signInTitle);
    expect(wrapper.get('.message.notice').text()).toBe(t.verified);
  });

  it('offers to register again when the link no longer works', async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ ok: false, code: 'invalid_token' });
    const wrapper = screen(link);
    await submit(wrapper);
    expect(wrapper.get('.lead').text()).toBe(t.verifyExpired);
    expect(wrapper.find('.submit').exists()).toBe(false);
    // The message stays until it is left, also for a signed-in visitor (App.vue)
    expect(wrapper.emitted('linkDone')).toBeUndefined();
    await follow(wrapper, t.register);
    expect(wrapper.emitted('linkDone')).toHaveLength(1);
    expect(title(wrapper)).toBe(t.registerTitle);
  });

  it('keeps the link when the server could not be reached', async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ ok: false, code: 'network' });
    const wrapper = screen(link);
    await submit(wrapper);
    expect(wrapper.get('.message.error').text()).toBe(authError('network'));
    expect(title(wrapper)).toBe(t.verifyTitle);
    expect(wrapper.emitted('linkDone')).toBeUndefined();
  });
});

describe('the link of the "forgot password" email', () => {
  const link: Route = { name: 'reset', token };

  it('sets the new password and leads to sign-in', async () => {
    vi.mocked(resetPassword).mockResolvedValue(ok);
    const wrapper = screen(link);
    expect(title(wrapper)).toBe(t.resetTitle);
    expect(wrapper.find('input[type=email]').exists()).toBe(false);

    await fill(wrapper, { password: 'short' });
    await submit(wrapper);
    expect(resetPassword).not.toHaveBeenCalled();
    expect(wrapper.get('.field .error').text()).toBe(t.shortPassword);

    await fill(wrapper, { password: 'a brand new password' });
    await submit(wrapper);
    expect(resetPassword).toHaveBeenCalledWith(token, 'a brand new password');
    expect(wrapper.emitted('linkDone')).toHaveLength(1);
    expect(title(wrapper)).toBe(t.signInTitle);
    expect(wrapper.get('.message.notice').text()).toBe(t.resetDone);
    // The new password is not left in the sign-in form
    expect((wrapper.get('input[type=password]').element as HTMLInputElement).value).toBe('');
  });

  it('offers a new link when this one no longer works', async () => {
    vi.mocked(resetPassword).mockResolvedValue({ ok: false, code: 'invalid_token' });
    const wrapper = screen(link);
    await fill(wrapper, { password: 'a brand new password' });
    await submit(wrapper);
    expect(wrapper.get('.lead').text()).toBe(t.resetExpired);
    expect(wrapper.emitted('linkDone')).toBeUndefined();
    await follow(wrapper, t.sendLink);
    expect(wrapper.emitted('linkDone')).toHaveLength(1);
    expect(title(wrapper)).toBe(t.forgotTitle);
  });
});
