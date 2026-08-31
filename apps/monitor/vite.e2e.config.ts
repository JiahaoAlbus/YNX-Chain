import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 24674,
    strictPort: true,
    proxy: {
      '/ops': {
        target: 'http://127.0.0.1:24675',
        changeOrigin: true,
      },
    },
  },
});
