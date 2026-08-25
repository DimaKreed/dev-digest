import { defineConfig } from 'vitest/config';

// No `resolve.alias` on purpose. This package declares its own narrow response
// schemas instead of borrowing the server's vendored contracts, so there is no
// tsconfig path to mirror here. If that decision is ever reversed, this file and
// tsconfig.json change together — the repo treats an unmirrored alias as a
// blocking review finding.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
