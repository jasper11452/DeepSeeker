import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

import { queryClient } from './lib/queryClient';

// 全局错误捕获
window.onerror = function(message, source, lineno, colno, error) {
  const errorDiv = document.createElement('div');
  errorDiv.style.position = 'fixed';
  errorDiv.style.top = '0';
  errorDiv.style.left = '0';
  errorDiv.style.width = '100%';
  errorDiv.style.backgroundColor = '#fee2e2';
  errorDiv.style.color = '#991b1b';
  errorDiv.style.padding = '20px';
  errorDiv.style.zIndex = '9999';
  errorDiv.style.borderBottom = '1px solid #f87171';
  errorDiv.style.fontFamily = 'monospace';
  errorDiv.innerHTML = `
    <strong>Global Error:</strong><br>
    ${message}<br>
    <small>${source}:${lineno}:${colno}</small><br>
    <pre>${error?.stack || ''}</pre>
  `;
  document.body.appendChild(errorDiv);
  return false;
};

window.onunhandledrejection = function(event) {
  const errorDiv = document.createElement('div');
  errorDiv.style.position = 'fixed';
  errorDiv.style.bottom = '0';
  errorDiv.style.left = '0';
  errorDiv.style.width = '100%';
  errorDiv.style.backgroundColor = '#fef3c7';
  errorDiv.style.color = '#92400e';
  errorDiv.style.padding = '20px';
  errorDiv.style.zIndex = '9999';
  errorDiv.style.borderTop = '1px solid #fcd34d';
  errorDiv.style.fontFamily = 'monospace';
  errorDiv.innerHTML = `
    <strong>Unhandled Rejection:</strong><br>
    ${event.reason}<br>
  `;
  document.body.appendChild(errorDiv);
};

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Root element 'root' not found");
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
} catch (e) {
  console.error("Render Error:", e);
  const errorDiv = document.createElement('div');
  errorDiv.innerHTML = `<h1>Render Error</h1><pre>${e instanceof Error ? e.stack : JSON.stringify(e)}</pre>`;
  document.body.appendChild(errorDiv);
}
