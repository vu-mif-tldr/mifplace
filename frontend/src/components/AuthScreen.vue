<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  AccountEmailSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type AuthUser,
} from '@mifplace/shared';
import {
  forgotPassword,
  register,
  resetPassword,
  signIn,
  verifyEmail,
  type AuthResult,
} from '../auth';
import type { Route } from '../route';
import { authError, authTexts as t } from '../texts';
import AuthField from './AuthField.vue';
import BrandMark from './BrandMark.vue';

// What a visitor without a session sees instead of the canvas: sign-in, registration,
// "forgot password", and the two pages the links in our emails open (confirm the address,
// set a new password). One screen at a time; `mode` says which.
const props = defineProps<{
  // The link the page was opened with, if any: it decides the first screen
  link: Route;
}>();
const emit = defineEmits<{
  signedIn: [user: AuthUser];
  // The link was used, or the message that it no longer works was left: the page takes the
  // token out of the address and shows what it would without a link
  linkDone: [];
}>();

type Mode =
  | 'signIn'
  | 'register'
  | 'registered'
  | 'forgot'
  | 'forgotSent'
  | 'verify'
  | 'verifyExpired'
  | 'reset'
  | 'resetExpired';

const mode = ref<Mode>(
  props.link.name === 'verify' ? 'verify' : props.link.name === 'reset' ? 'reset' : 'signIn'
);
const token = props.link.name === 'home' ? '' : props.link.token;

const email = ref('');
const password = ref('');
const emailError = ref('');
const passwordError = ref('');
// The answer of the server to the last request: what went wrong, or what worked
const error = ref('');
const notice = ref('');
const busy = ref(false);

type Field = 'email' | 'password' | 'newPassword';

interface View {
  title: string;
  lead?: string;
  // A second, quieter line under the lead
  note?: string;
  fields: Field[];
  // The button and what it does; a screen that only informs has none
  submit?: { label: string; action: () => Promise<void> };
  // Where else the visitor can go from here
  links: { to: Mode; label: string }[];
}

// What a screen consists of
function viewOf(screen: Mode): View {
  switch (screen) {
    case 'signIn':
      return {
        title: t.signInTitle,
        fields: ['email', 'password'],
        submit: { label: t.signIn, action: onSignIn },
        links: [
          { to: 'register', label: t.toRegister },
          { to: 'forgot', label: t.forgot },
        ],
      };
    case 'register':
      return {
        title: t.registerTitle,
        fields: ['email', 'newPassword'],
        submit: { label: t.register, action: onRegister },
        links: [{ to: 'signIn', label: t.toSignIn }],
      };
    case 'registered':
      return {
        title: t.checkEmailTitle,
        lead: t.registeredLead(email.value),
        note: t.noEmail,
        fields: [],
        links: [{ to: 'signIn', label: t.backToSignIn }],
      };
    case 'forgot':
      return {
        title: t.forgotTitle,
        lead: t.forgotLead,
        fields: ['email'],
        submit: { label: t.sendLink, action: onForgot },
        links: [{ to: 'signIn', label: t.backToSignIn }],
      };
    case 'forgotSent':
      return {
        title: t.checkEmailTitle,
        lead: t.forgotSentLead(email.value),
        note: t.noEmail,
        fields: [],
        links: [{ to: 'signIn', label: t.backToSignIn }],
      };
    // Opening the link does nothing by itself: mail scanners open every link in an email,
    // so the address is confirmed only by the button.
    case 'verify':
      return {
        title: t.verifyTitle,
        lead: t.verifyLead,
        fields: [],
        submit: { label: t.verify, action: onVerify },
        links: [],
      };
    case 'verifyExpired':
      return {
        title: t.verifyTitle,
        lead: t.verifyExpired,
        fields: [],
        links: [
          { to: 'register', label: t.register },
          { to: 'signIn', label: t.backToSignIn },
        ],
      };
    case 'reset':
      return {
        title: t.resetTitle,
        fields: ['newPassword'],
        submit: { label: t.savePassword, action: onReset },
        links: [],
      };
    case 'resetExpired':
      return {
        title: t.resetTitle,
        lead: t.resetExpired,
        fields: [],
        links: [
          { to: 'forgot', label: t.sendLink },
          { to: 'signIn', label: t.backToSignIn },
        ],
      };
  }
}

const view = computed(() => viewOf(mode.value));

// Another screen: the address stays typed in, the password and the messages do not
function go(to: Mode) {
  // A link that no longer works is done with once its message was read and left
  if (mode.value === 'verifyExpired' || mode.value === 'resetExpired') emit('linkDone');
  mode.value = to;
  password.value = '';
  emailError.value = '';
  passwordError.value = '';
  error.value = '';
  notice.value = '';
}

// The same checks as on the server (shared schemas), to answer without a request. Whether the
// address is a VU one only the server knows.
function checkEmail(): boolean {
  const parsed = AccountEmailSchema.safeParse(email.value);
  emailError.value = parsed.success ? '' : t.invalidEmail;
  if (parsed.success) email.value = parsed.data;
  return parsed.success;
}

function checkNewPassword(): boolean {
  const length = password.value.length;
  passwordError.value =
    length < PASSWORD_MIN_LENGTH
      ? t.shortPassword
      : length > PASSWORD_MAX_LENGTH
        ? t.longPassword
        : '';
  return passwordError.value === '';
}

function checkPassword(): boolean {
  passwordError.value = password.value === '' ? t.noPassword : '';
  return passwordError.value === '';
}

// Runs one request: the ring turns meanwhile, a failure is told in words. Returns the
// successful answer, or the code of the failure.
async function send<T>(request: () => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await request();
    if (!result.ok && result.code !== 'invalid_token') error.value = authError(result.code);
    return result;
  } finally {
    busy.value = false;
  }
}

async function onSignIn() {
  // Both checked, so both fields show what is missing
  const valid = [checkEmail(), checkPassword()].every(Boolean);
  if (!valid) return;
  const result = await send(() => signIn(email.value, password.value));
  if (result.ok) emit('signedIn', result.value);
}

async function onRegister() {
  const valid = [checkEmail(), checkNewPassword()].every(Boolean);
  if (!valid) return;
  const result = await send(() => register(email.value, password.value));
  if (result.ok) go('registered');
}

async function onForgot() {
  if (!checkEmail()) return;
  const result = await send(() => forgotPassword(email.value));
  if (result.ok) go('forgotSent');
}

async function onVerify() {
  const result = await send(() => verifyEmail(token));
  if (result.ok) {
    emit('linkDone');
    go('signIn');
    notice.value = t.verified;
  } else if (result.code === 'invalid_token') {
    go('verifyExpired');
  }
}

async function onReset() {
  if (!checkNewPassword()) return;
  const result = await send(() => resetPassword(token, password.value));
  if (result.ok) {
    emit('linkDone');
    go('signIn');
    notice.value = t.resetDone;
  } else if (result.code === 'invalid_token') {
    go('resetExpired');
  }
}

function submit() {
  if (!busy.value) void view.value.submit?.action();
}
</script>

<template>
  <div class="auth">
    <div class="column">
      <header class="intro">
        <!-- The ring of the canvas around the logo; it turns while a request is on its way -->
        <span class="ring" :class="{ busy }">
          <BrandMark :size="36" :name="false" />
        </span>
        <h1>VU/place</h1>
        <p class="about">{{ t.about }}</p>
      </header>

      <form class="form" novalidate @submit.prevent="submit">
        <h2>{{ view.title }}</h2>
        <p v-if="view.lead" class="lead">{{ view.lead }}</p>
        <p v-if="view.note" class="note">{{ view.note }}</p>

        <AuthField
          v-if="view.fields.includes('email')"
          v-model="email"
          type="email"
          autocomplete="username"
          :label="t.email"
          :placeholder="t.emailExample"
          :error="emailError"
        />
        <AuthField
          v-if="view.fields.includes('password')"
          v-model="password"
          type="password"
          autocomplete="current-password"
          :label="t.password"
          :error="passwordError"
        />
        <AuthField
          v-if="view.fields.includes('newPassword')"
          v-model="password"
          type="password"
          autocomplete="new-password"
          :label="mode === 'reset' ? t.newPassword : t.password"
          :hint="t.passwordHint"
          :error="passwordError"
        />

        <p v-if="error" class="message error">{{ error }}</p>
        <p v-if="notice" class="message notice">{{ notice }}</p>

        <button v-if="view.submit" type="submit" class="submit" :disabled="busy">
          {{ view.submit.label }}
        </button>

        <nav v-if="view.links.length > 0" class="links">
          <button
            v-for="link in view.links"
            :key="link.to"
            type="button"
            class="link"
            @click="go(link.to)"
          >
            {{ link.label }}
          </button>
        </nav>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* The same bordo as the canvas page, lit from below in the neutral light: nobody holds a
   colour yet. The canvas itself is not shown before sign-in. */
.auth {
  min-height: 100dvh;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  padding: 40px 24px;
  background:
    radial-gradient(
      70% 55% at 50% 100%,
      color-mix(in srgb, var(--glow) 30%, transparent),
      transparent
    ),
    var(--stage);
}

.column {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 36px;
}

.intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* The ring of the canvas (SelectionRing, ConfirmButton), here around the logo. Whole while
   the page waits for the visitor, a turning arc while it waits for the server. */
.ring {
  position: relative;
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  margin-bottom: 24px;
}

.ring::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--glow);
  mask: radial-gradient(circle closest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
}

.ring.busy::before {
  background: conic-gradient(var(--glow) 0 28%, rgb(255 255 255 / 16%) 0);
  animation: turn 1.1s linear infinite;
}

@keyframes turn {
  to {
    transform: rotate(360deg);
  }
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 44px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.about {
  margin: 14px 0 0;
  font-size: 16px;
  line-height: 1.5;
  color: var(--muted);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

p {
  margin: 0;
}

.lead {
  font-size: 15px;
  line-height: 1.5;
  /* A long address in the text wraps instead of widening the page */
  overflow-wrap: anywhere;
}

.note,
.message {
  font-size: 14px;
  line-height: 1.45;
}

.note {
  color: var(--muted);
}

.message.error {
  color: var(--error);
}

.message.notice {
  color: var(--ok);
}

/* The white pill of the page (LoadState, the confirm button on a phone) */
.submit {
  height: 52px;
  margin-top: 4px;
  border: 0;
  border-radius: 26px;
  background: #ffffff;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.55;
  cursor: default;
}

.links {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.link {
  padding: 8px 0;
  border: 0;
  background: none;
  color: var(--text);
  font-size: 15px;
  text-decoration: underline;
  text-decoration-color: rgb(255 255 255 / 35%);
  text-underline-offset: 4px;
  cursor: pointer;
}

.link:hover {
  text-decoration-color: #ffffff;
}
</style>
