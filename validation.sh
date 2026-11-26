#!/usr/bin/env bash
# Runs every check the CI pipeline runs (.github/workflows/ci.yml calls this
# script), so a green local run means a green pull request.
#
#   ./validation.sh
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step 'Install dependencies (npm ci)'
npm ci

step 'Typecheck, lint, unit tests'
npm test

step 'Install Chromium for webview tests'
if [[ -n "${CI:-}" ]]; then
	npx playwright install --with-deps chromium
else
	npx playwright install chromium
fi

step 'Webview tests'
npm run test:webview

step 'VS Code integration tests'
# On Linux without a display, VS Code needs a virtual one.
if [[ "$(uname)" == Linux && -z "${DISPLAY:-}" ]]; then
	xvfb-run -a npm run test:integration
else
	npm run test:integration
fi

printf '\n\033[1;32mAll checks passed.\033[0m\n'
