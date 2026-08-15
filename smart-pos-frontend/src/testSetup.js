import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// `globals: false` in vite.config.js means @testing-library/react's
// automatic cleanup (which hooks a global `afterEach`) never registers
// itself — without this, one test's rendered DOM leaks into the next.
afterEach(() => {
  cleanup();
});
