import { defineConfig } from 'vitest/config';

// Webview tests drive dev/harness.html in headless Chromium (see test/webview).
// Run with `npm run test:webview`, which builds dist/ first.
export default defineConfig({
	test: {
		include: ['test/webview/**/*.test.ts'],
		testTimeout: 20000,
		hookTimeout: 30000,
	},
});
