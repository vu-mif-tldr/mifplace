<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getSession, signOut, type Session } from './auth';
import { clearRoute, parseRoute, sameRoute, type Route } from './route';
import CanvasPage from './CanvasPage.vue';
import AuthScreen from './components/AuthScreen.vue';
import LoadState from './components/LoadState.vue';

// The page: asks the server who is signed in, then shows the canvas to a signed-in visitor
// and the sign-in screens to everybody else (FR-3 is cancelled: no canvas without sign-in).
// On a server without accounts (the session is 'off') the canvas is shown to everyone.

const session = ref<Session | 'loading' | 'failed'>('loading');

// A link from one of our emails (/#/verify/..., /#/reset/...), or home
const route = ref<Route>(parseRoute(window.location.hash));
// Counts the links opened in this tab, so a new one starts the sign-in screens afresh
const linkNumber = ref(0);

const user = computed(() => (typeof session.value === 'object' ? session.value : null));

// A link is for the sign-in screens even when somebody is signed in: it asks for an action
const showAuth = computed(
  () => session.value === 'anonymous' || (user.value !== null && route.value.name !== 'home')
);

async function loadSession() {
  session.value = 'loading';
  try {
    session.value = await getSession();
  } catch (error) {
    console.error(error);
    session.value = 'failed';
  }
}

function onHashChange() {
  const next = parseRoute(window.location.hash);
  // Only another link starts the screens afresh, not the same address reported once more
  if (sameRoute(next, route.value)) return;
  route.value = next;
  linkNumber.value++;
}

// The link was used or left: its token goes out of the address. A new password signs every
// browser out, so the server is asked again who is signed in.
async function onLinkDone() {
  clearRoute();
  route.value = { name: 'home' };
  try {
    session.value = await getSession();
  } catch (error) {
    // The screen in front of the visitor stays; the next request will tell
    console.error(error);
  }
}

async function onSignOut() {
  const result = await signOut();
  if (result.ok) session.value = 'anonymous';
}

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  void loadSession();
});
onUnmounted(() => window.removeEventListener('hashchange', onHashChange));
</script>

<template>
  <div v-if="session === 'loading' || session === 'failed'" class="wait">
    <LoadState :failed="session === 'failed'" @retry="loadSession" />
  </div>
  <AuthScreen
    v-else-if="showAuth"
    :key="linkNumber"
    :link="route"
    @signed-in="session = $event"
    @link-done="onLinkDone"
  />
  <CanvasPage v-else :user="user" @sign-out="onSignOut" />
</template>

<style scoped>
/* LoadState fills its parent */
.wait {
  position: relative;
  height: 100dvh;
}
</style>
