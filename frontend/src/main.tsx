import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import './styles/index.css';

const root = document.querySelector('#root');

if (!root) throw new Error('React root is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
