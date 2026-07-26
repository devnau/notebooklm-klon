import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Projekte statt einer flachen Glob-Liste: die Security-Suite braucht eine
    // echte Datenbank und darf nicht versehentlich im Standardlauf mitlaufen.
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts', 'tests/unit/**/*.{test,spec}.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/*.config.{ts,mjs}',
        '**/*.d.ts',
      ],
    },
  },
});
