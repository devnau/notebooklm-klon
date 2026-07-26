/**
 * Conventional Commits. Scopes sind bewusst begrenzt, damit die Historie
 * lesbar bleibt und man am Prefix sieht, welcher Teil der App betroffen ist.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'db',
        'auth',
        'notebooks',
        'sources',
        'ingest',
        'rag',
        'chat',
        'notes',
        'studio',
        'audio',
        'share',
        'worker',
        'ui',
        'security',
        'ci',
        'docker',
        'deps',
        'docs',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
  },
};
