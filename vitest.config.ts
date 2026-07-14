import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Scoped to the pure/testable layers: shared domain types, the pure
      // engine cores, the single Redis-touching Store, the I2 serialize
      // boundary, the compiled case registry, and the Hono routes (all
      // mockable via RedisLike/@devvit/web/server stubs, no live platform
      // needed). src/client/** (React/DOM rendering) and src/server/index.ts
      // (process bootstrap — calls createServer(...).listen(...) at import
      // time) are excluded on purpose: they need a real browser/runtime to
      // exercise meaningfully.
      include: [
        'src/shared/**/*.ts',
        'src/server/core/**/*.ts',
        'src/server/routes/**/*.ts',
        'src/server/cases/**/*.ts',
        'src/server/store.ts',
        'src/server/serialize.ts',
        'src/server/keys.ts',
        'src/server/viewer.ts',
        'src/server/postComment.ts',
        'src/server/redisLike.ts',
      ],
      // src/server/redisLike.ts + src/server/cases/types.ts: pure
      // `export type`-only files (zero runtime statements). Every import of
      // them is `import type` (erased at build time), so they never load
      // into V8 and there's nothing to exercise — the html reporter's 0/0
      // division otherwise renders a misleading "0%" for a file with no
      // code to cover.
      exclude: [
        'src/client/**',
        'src/server/index.ts',
        'src/server/redisLike.ts',
        'src/server/cases/types.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
