import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins:[react()], server:{ port:4674, strictPort:true, proxy:{ '/ops':{ target:'http://127.0.0.1:4675', changeOrigin:true } } } });
