#!/usr/bin/env bash
# Tests this machine's platform twice: the source tree with the library from the PyPI wheel, then the packed npm
# packages installed into a fresh project, the way users get them.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
node scripts/fetch-native.js --only current
npm test
rm -rf dist
node scripts/pack.js --partial
mkdir -p dist/install-test
cd dist/install-test
npm init -y >/dev/null
npm install --no-audit --no-fund ../*.tgz
cd ../..
PDFPECKER_TEST_PACKAGE=dist/install-test/node_modules/pdfpecker npm test
