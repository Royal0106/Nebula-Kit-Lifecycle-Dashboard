import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3b4cca',
          colorInfo: '#3b4cca',
          colorBgLayout: '#f4f5f8',
          borderRadius: 8,
          fontFamily:
            '"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
