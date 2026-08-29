#!/bin/sh
# .git/hooks/** is never cloned or tracked by git, so each clone/checkout needs to run
# this once to wire up the Bible drift warning on push. Safe to re-run any time.
set -e
ROOT="$(git rev-parse --show-toplevel)"
cp "$ROOT/scripts/bible/pre-push-hook.sh" "$ROOT/.git/hooks/pre-push"
chmod +x "$ROOT/.git/hooks/pre-push"
echo "Installed Bible drift check as .git/hooks/pre-push."
