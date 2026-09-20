import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


const isLocalDevelopment =
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.hostname === '[::1]';

if ('serviceWorker' in navigator && !isLocalDevelopment) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is optional and must not block gameplay.
    });
  });
}
