#!/bin/sh
# Bible drift check -- warns (does not block) when a push touches a file that a Bible
# chapter's frontmatter `sources` glob points at, but the chapter's `updated` date
# wasn't bumped. Installed into .git/hooks/pre-push by `npm run bible:install-hook`
# (hooks live in .git/hooks, which git never tracks/clones, so each clone installs it
# once). Warn-only, not blocking: a real fix might legitimately land in a later commit,
# and nobody should be stuck unable to push over documentation.

cd "$(git rev-parse --show-toplevel)" || exit 0

if ! command -v npx >/dev/null 2>&1; then
  exit 0
fi

npx tsx scripts/bible/check.ts
if [ $? -ne 0 ]; then
  echo ""
  echo "^ Bible drift warning (see above) -- push is continuing anyway. Run \`npm run bible:check\` or \`/bible\` to fix it before or after."
  echo ""
fi

# Push the chapters into kb_chapters, which is what the in-app DB Guide reads.
# Without this the guide drifts from the repo with nothing to indicate it -- on
# 2026-10-01 it was found to be two weeks stale, so ten chapters had been wrong
# in the app while correct in git.
#
# Skipped silently when there are no credentials (a clone without
# apps/erp/.env.local), and never blocks a push: documentation must not stop
# code shipping.
if [ -f apps/erp/.env.local ]; then
  npx tsx scripts/bible/sync.ts >/tmp/bible-sync.log 2>&1
  if [ $? -ne 0 ]; then
    echo ""
    echo "^ Bible sync to the DB Guide failed -- push continuing. See /tmp/bible-sync.log"
    echo ""
  else
    tail -1 /tmp/bible-sync.log
  fi
fi

exit 0
