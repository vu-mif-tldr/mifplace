// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import App from './App.vue';
import CanvasPage from './CanvasPage.vue';
import { getSession, signOut, verifyEmail } from './auth';
import { authTexts } from './texts';
import AuthScreen from './components/AuthScreen.vue';
import LoadState from './components/LoadState.vue';

// Who sees what: the account requests are mocked, the canvas page is a stub
vi.mock('./auth', () => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  signIn: vi.fn(),
  register: vi.fn(),
  verifyEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

const user = { email: 'ona@mif.stud.vu.lt', role: 'user' as const };
const token = 'A'.repeat(43);

beforeEach(() => {
  history.replaceState(null, '', '/');
  vi.mocked(getSession).mockResolvedValue('anonymous');
  vi.mocked(signOut).mockResolvedValue({ ok: true, value: undefined });
});
afterEach(() => vi.clearAllMocks());

async function page() {
  const wrapper = mount(App, { global: { stubs: { CanvasPage: true } } });
  await flushPromises();
  return wrapper;
}

describe('App', () => {
  it('shows only the sign-in screens to a visitor without a session', async () => {
    const wrapper = await page();
    expect(wrapper.findComponent(AuthScreen).exists()).toBe(true);
    expect(wrapper.findComponent(CanvasPage).exists()).toBe(false);
  });

  it('shows the canvas to a signed-in visitor, and the sign-in screens after sign-out', async () => {
    vi.mocked(getSession).mockResolvedValue(user);
    const wrapper = await page();
    const canvas = wrapper.getComponent(CanvasPage);
    expect(canvas.props('user')).toEqual(user);
    expect(wrapper.findComponent(AuthScreen).exists()).toBe(false);

    canvas.vm.$emit('signOut');
    await flushPromises();
    expect(signOut).toHaveBeenCalled();
    expect(wrapper.findComponent(CanvasPage).exists()).toBe(false);
    expect(wrapper.findComponent(AuthScreen).exists()).toBe(true);
  });

  it('stays on the canvas when signing out did not reach the server', async () => {
    vi.mocked(getSession).mockResolvedValue(user);
    vi.mocked(signOut).mockResolvedValue({ ok: false, code: 'network' });
    const wrapper = await page();
    wrapper.getComponent(CanvasPage).vm.$emit('signOut');
    await flushPromises();
    expect(wrapper.findComponent(CanvasPage).exists()).toBe(true);
  });

  it('shows the canvas once the visitor signs in', async () => {
    const wrapper = await page();
    wrapper.getComponent(AuthScreen).vm.$emit('signedIn', user);
    await flushPromises();
    expect(wrapper.getComponent(CanvasPage).props('user')).toEqual(user);
  });

  it('shows the canvas to everyone on a server without accounts', async () => {
    vi.mocked(getSession).mockResolvedValue('off');
    const wrapper = await page();
    expect(wrapper.getComponent(CanvasPage).props('user')).toBeNull();
  });

  it('waits for the session, and offers to try again when the server cannot be asked', async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mount(App, { global: { stubs: { CanvasPage: true } } });
    expect(wrapper.getComponent(LoadState).props('failed')).toBe(false);
    await flushPromises();
    expect(wrapper.getComponent(LoadState).props('failed')).toBe(true);

    wrapper.getComponent(LoadState).vm.$emit('retry');
    await flushPromises();
    expect(wrapper.findComponent(AuthScreen).exists()).toBe(true);
  });

  it('opens the link of an email, and takes its token out of the address once used', async () => {
    history.replaceState(null, '', `/#/verify/${token}`);
    vi.mocked(verifyEmail).mockResolvedValue({ ok: true, value: undefined });
    const wrapper = await page();
    expect(wrapper.getComponent(AuthScreen).props('link')).toEqual({ name: 'verify', token });

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(location.hash).toBe('');
    // The session is asked again: at start and after the link
    expect(getSession).toHaveBeenCalledTimes(2);
    // The same screen stays, now on sign-in with the good news
    expect(wrapper.get('.message.notice').text()).toBe(authTexts.verified);
  });

  it('shows a link to a signed-in visitor too, then the canvas again', async () => {
    history.replaceState(null, '', `/#/verify/${token}`);
    vi.mocked(getSession).mockResolvedValue(user);
    vi.mocked(verifyEmail).mockResolvedValue({ ok: true, value: undefined });
    const wrapper = await page();
    expect(wrapper.findComponent(AuthScreen).exists()).toBe(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.findComponent(CanvasPage).exists()).toBe(true);
  });

  it('starts the sign-in screens afresh when another link is opened in the tab', async () => {
    const wrapper = await page();
    expect(wrapper.get('h2').text()).toBe(authTexts.signInTitle);
    history.replaceState(null, '', `/#/reset/${token}`);
    window.dispatchEvent(new Event('hashchange'));
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe(authTexts.resetTitle);
    wrapper.unmount();
  });
});
