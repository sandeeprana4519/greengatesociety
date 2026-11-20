import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'apps/**/*',
      'functions/**/*',
      'scripts/**/*',
      'node_modules/**/*',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
