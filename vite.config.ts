import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Use relative paths in production build so Electron can load via file://
  base: command === 'build' ? './' : '/',
  server: {
    port: 7000,
    proxy: {
      '/api': {
        target: 'http://localhost:7099',
        changeOrigin: true,
      },
    },
  },
}));
