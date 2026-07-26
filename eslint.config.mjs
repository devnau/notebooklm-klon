import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.tsbuildinfo',
      'apps/web/next-env.d.ts',
      // Generiert aus dem DB-Schema — Formatierung und Union-Stil kommen vom
      // Generator, nicht von uns.
      'apps/web/src/lib/supabase/types.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Konfigurationsdateien liegen außerhalb der tsconfig-Includes und
          // brauchen daher das Default-Projekt, sonst kann ESLint sie nicht parsen.
          allowDefaultProject: [
            '*.mjs',
            '*.ts',
            'apps/*/*.mjs',
            'apps/*/*.ts',
            'packages/*/*.mjs',
            'packages/*/*.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Ungenutzte Variablen sind ein Fehler, außer sie beginnen mit _.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Nicht abgewartete Promises sind in Route Handlers eine echte Fehlerquelle.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Explizites any erlaubt nur mit Begründung.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Typ-Importe konsistent halten (nötig wegen verbatimModuleSyntax).
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // .mjs-Konfigurationsdateien haben keine Typinformationen für ihre Importe;
  // typbasierte Regeln würden dort nur Rauschen produzieren.
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Skripte und Konfigurationsdateien laufen in Node: dort sind process,
  // console und Buffer legitime Globals, und Ausgabe ist der Zweck.
  {
    files: ['scripts/**/*.{mjs,ts}', '**/*.config.{ts,mjs,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Tests dürfen lockerer sein.
  {
    files: ['**/*.{test,spec}.ts', '**/*.{test,spec}.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },

  // Muss zuletzt stehen: schaltet Regeln ab, die mit Prettier kollidieren.
  prettier,
);
