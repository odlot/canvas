#!/usr/bin/env bash
# Package the Canvas extension into a .vsix.
#
#   ./package.sh                  # test, build, package → canvas-<version>.vsix
#   ./package.sh --skip-tests     # skip typecheck/lint/unit tests
#   ./package.sh --pre-release    # mark the package as a pre-release
#
# Install the result with:  code --install-extension canvas-<version>.vsix
set -euo pipefail

cd "$(dirname "$0")"

SKIP_TESTS=0
VSCE_ARGS=()
for arg in "$@"; do
	case "$arg" in
		--skip-tests) SKIP_TESTS=1 ;;
		--pre-release) VSCE_ARGS+=(--pre-release) ;;
		-h|--help) sed -n '2,9p' "$0"; exit 0 ;;
		*) echo "Unknown option: $arg" >&2; exit 2 ;;
	esac
done

pkg_field() { node -p "require('./package.json').$1 ?? ''"; }

NAME="$(pkg_field name)"
VERSION="$(pkg_field version)"
PUBLISHER="$(pkg_field publisher)"

if [[ -z "$PUBLISHER" ]]; then
	cat >&2 <<'EOF'
error: package.json has no "publisher" field.
  vsce requires one. Add your Marketplace publisher ID, e.g.:
    npm pkg set publisher=<your-publisher-id>
  (create a publisher at https://marketplace.visualstudio.com/manage)
EOF
	exit 1
fi

echo "==> Packaging $PUBLISHER.$NAME@$VERSION"

if [[ ! -d node_modules ]]; then
	echo "==> Installing dependencies"
	npm ci
fi

if [[ "$SKIP_TESTS" -eq 0 ]]; then
	echo "==> Running tests"
	npm test
fi

# Start from a clean dist/ so dev-only artifacts and source maps don't ship.
rm -rf dist
OUT="$NAME-$VERSION.vsix"

# vscode:prepublish runs the production esbuild bundle. Everything is bundled
# into dist/, so node_modules is not shipped (--no-dependencies).
LICENSE_ARGS=()
[[ -f LICENSE || -f LICENSE.md || -f LICENSE.txt ]] || LICENSE_ARGS+=(--skip-license)
REPO_ARGS=()
[[ -n "$(pkg_field repository)" ]] || REPO_ARGS+=(--allow-missing-repository)

echo "==> Building and packaging"
npx --no-install vsce package \
	--no-dependencies \
	--out "$OUT" \
	${LICENSE_ARGS[@]+"${LICENSE_ARGS[@]}"} \
	${REPO_ARGS[@]+"${REPO_ARGS[@]}"} \
	${VSCE_ARGS[@]+"${VSCE_ARGS[@]}"}

echo "==> Contents"
npx --no-install vsce ls --no-dependencies 2>/dev/null | sed 's/^/    /' || true

echo
echo "Created $OUT ($(du -h "$OUT" | cut -f1))"
echo "Install locally: code --install-extension $OUT"
