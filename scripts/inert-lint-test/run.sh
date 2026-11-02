#!/bin/bash
# Runs the flag-off-behavior lint rule over the labeled test repo and compares the result
# with what each branch should get. Needs ANTHROPIC_API_KEY (the model behind the stand-in
# System One server). Usage: scripts/inert-lint-test/run.sh [--reason-first] [--rule <file>]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
RULE="$ROOT/docs/examples/lint/flag-off-behavior.md"
REASON_FIRST=0
while [ $# -gt 0 ]; do
  case $1 in
    --reason-first) REASON_FIRST=1 ;;
    --rule) RULE=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "Set ANTHROPIC_API_KEY (the model behind the stand-in server)." >&2; exit 2; }
WORK=$(mktemp -d)
PORT=${PORT:-8787}
trap 'kill $SERVER 2>/dev/null || true; wait $SERVER 2>/dev/null || true; rm -rf "$WORK"' EXIT

"$HERE/make-repo.sh" "$WORK/shop" "$RULE"
REASON_FIRST=$REASON_FIRST PORT=$PORT node "$HERE/claude-systemone.mjs" > "$WORK/answers.log" 2>&1 &
SERVER=$!
sleep 1

cd "$WORK/shop"
wrong=0
for b in $(git for-each-ref --format='%(refname:short)' refs/heads | grep -v '^main$'); do
  git checkout -q "$b"
  # Every branch is linted with the rule from main, the way PullUp reads rules on a pull request.
  out=$(PULLUP_SYSTEMONE_URL=http://127.0.0.1:$PORT PULLUP_SYSTEMONE_MODEL=claude-test \
    "$ROOT/node_modules/.bin/tsx" "$ROOT/packages/cli/src/index.ts" lint --base main --repo test/shop \
    --model systemone --rules-from base --no-fail 2>&1 || true)
  failing=$(echo "$out" | grep -o '[0-9]* failing' | cut -d' ' -f1)
  # A file the model could not check is an error, never a pass.
  if echo "$out" | grep -q 'could not be checked'; then failing=""; fi
  if [[ $b == inert-* ]]; then want=pass; else want=fail; fi
  if [ "${failing:-x}" = 0 ]; then got=pass; elif [ -n "$failing" ]; then got=fail; else got=error; fi
  mark=ok; [ "$got" = "$want" ] || { mark=WRONG; wrong=$((wrong + 1)); }
  printf '%-28s expected %-4s got %-5s %s\n' "$b" "$want" "$got" "$mark"
  [ "$got" = error ] && echo "$out" | tail -5
done
git checkout -q main
echo
echo "Per-file answers (probability and the model's reason):"
grep '^{' "$WORK/answers.log" | sed 's/"id":"[^"]*",//'
echo
echo "$wrong wrong"
exit $([ $wrong = 0 ] && echo 0 || echo 1)
