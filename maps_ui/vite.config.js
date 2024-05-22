import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** https://vitejs.dev/config/ */
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://0.0.0.0:3000',
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2020' }
  }
});
