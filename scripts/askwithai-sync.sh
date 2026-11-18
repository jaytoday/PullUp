#!/bin/sh
# Repack AskWithAI's private web kit from a checkout and copy its tarball into
# vendor/. The SDK comes from npm, so only the kit is still vendored here.
# Usage: ASKWITHAI_REPO=/path/to/ask-with-ai pnpm askwithai:sync
set -eu
if [ -z "${ASKWITHAI_REPO:-}" ]; then
  echo "Set ASKWITHAI_REPO to an AskWithAI checkout." >&2
  exit 1
fi
(cd "$ASKWITHAI_REPO" && sh scripts/pack-react.sh)
cp "$ASKWITHAI_REPO"/dist-packages/askwithai-react-*.tgz vendor/
pnpm install --force
echo "vendor/ now holds:"; ls vendor
