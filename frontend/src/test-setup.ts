import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest is not running with `globals`, so Testing Library's automatic cleanup is
// not registered. Without this, rendered trees leak between tests.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
