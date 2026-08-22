import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initTheme } from './hooks/useTheme';
import { startPwa } from './services/pwa';
import './index.css';
import './components.css';

// Apply the saved theme before the first paint so there is no flash.
initTheme();

// Listen for the install prompt straight away — Chrome fires it early, and a
// listener added after the fact never sees it. The service worker itself is
// registered on window load, and only in production builds.
startPwa();

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Remove the pre-hydration splash now that React owns the screen.
document.getElementById('boot')?.remove();
