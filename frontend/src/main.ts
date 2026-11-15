import { createApp } from 'vue';
import App from './App.vue';
// The font of the ticker, served with the app (only the subsets a page needs are loaded)
import '@fontsource/saira-semi-condensed/500.css';
import './style.css';

createApp(App).mount('#app');
