import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@smartpos/receipt-engine/react': path.resolve(
        __dirname,
        '../packages/receipt-engine/src/react/index.tsx'
      ),
      '@smartpos/receipt-engine': path.resolve(
        __dirname,
        '../packages/receipt-engine/src/index.ts'
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: [path.resolve(__dirname, 'src/testSetup.js')],
  },
});
