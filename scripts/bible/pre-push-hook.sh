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

exit 0
