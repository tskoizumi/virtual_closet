import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@imgly/background-removal'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { proxy: { '/api': 'http://127.0.0.1:8788' } },
});
