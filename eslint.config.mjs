import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**'] },
	...tseslint.configs.recommended,
	{
		rules: {
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
		},
	},
);
