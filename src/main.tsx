import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/panels.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
