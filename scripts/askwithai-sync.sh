#!/bin/sh
# Repack AskWithAI's SDK and web kit from a checkout and copy the tarballs
# into vendor/ (decision D5: vendored tarballs until the packages are on npm).
# Usage: ASKWITHAI_REPO=/path/to/ask-with-ai pnpm askwithai:sync
set -eu
if [ -z "${ASKWITHAI_REPO:-}" ]; then
  echo "Set ASKWITHAI_REPO to an AskWithAI checkout." >&2
  exit 1
fi
(cd "$ASKWITHAI_REPO" && sh scripts/pack-sdk.sh)
cp "$ASKWITHAI_REPO"/dist-packages/askwithai-sdk-*.tgz "$ASKWITHAI_REPO"/dist-packages/askwithai-react-*.tgz vendor/
pnpm install --force
echo "vendor/ now holds:"; ls vendor
