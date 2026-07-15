import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'YNX_');
  const explorer = env.YNX_EXPLORER_UPSTREAM || 'http://127.0.0.1:6427';
  const rpc = env.YNX_RPC_UPSTREAM || 'http://127.0.0.1:6420';
  const ai = env.YNX_AI_UPSTREAM || 'http://127.0.0.1:6429';
  return {
    plugins: [react()],
    server: {
      port: 4673,
      strictPort: true,
      proxy: {
        '/api': { target: explorer, changeOrigin: true },
        '/chain': { target: rpc, changeOrigin: true, rewrite: p => p.replace(/^\/chain/, '') },
        '/ai-gateway': { target: ai, changeOrigin: true, headers: env.YNX_EXPLORER_AI_KEY ? { 'X-YNX-AI-Key': env.YNX_EXPLORER_AI_KEY } : {}, rewrite: p => p.replace(/^\/ai-gateway/, '') }
      }
    }
  };
});
