// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'renders/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already resolves every identifier against its lib types.
      'no-undef': 'off',
      // The renderer deliberately uses non-null assertions with
      // noUncheckedIndexedAccess in hot typed-array loops.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Covered more precisely by tsc's noUnusedLocals / noUnusedParameters.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
