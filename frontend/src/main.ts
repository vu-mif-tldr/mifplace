import { createApp } from 'vue';
import App from './App.vue';
// The fonts of the page, served with the app (only the subsets a page needs are loaded)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/700.css';
import './style.css';

createApp(App).mount('#app');
