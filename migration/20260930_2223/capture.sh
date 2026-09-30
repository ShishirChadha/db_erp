#!/usr/bin/env bash
# Phase 0 extraction from the hosted Supabase project.
# Usage:  export SRC="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres"
#         ./capture.sh
#
# Dumps are taken in small, individually-retryable pieces on purpose: the source
# project is resource-exhausted, and one large dump is likely to fail partway.
# Re-running is safe -- each step overwrites only its own file.

set -uo pipefail
PGD="/opt/homebrew/opt/postgresql@17/bin"
: "${SRC:?Set SRC to the session-pooler connection string (port 5432, NOT 6543)}"

run() {  # run <outfile> <label> <cmd...>
  local out="$1" label="$2"; shift 2
  printf '%-34s' "$label"
  if "$@" > "$out" 2>/tmp/capture_err.txt; then
    printf 'OK   (%s)\n' "$(du -h "$out" | cut -f1)"
  else
    printf 'FAIL -- %s\n' "$(head -c 200 /tmp/capture_err.txt | tr '\n' ' ')"
    return 1
  fi
}

echo "=== Phase 0 extraction -> $(pwd) ==="
run 01_globals.sql            "01 globals (roles/grants)"   "$PGD/pg_dumpall" -d "$SRC" --globals-only --no-role-passwords
run 02_schema_public.sql      "02 schema: public"           "$PGD/pg_dump" -d "$SRC" --schema-only -n public
run 03_schema_auth_storage.sql "03 schema: auth+storage"    "$PGD/pg_dump" -d "$SRC" --schema-only -n auth -n storage
run 04_schema_cron_ext.sql    "04 schema: cron+extensions"  "$PGD/pg_dump" -d "$SRC" --schema-only -n cron -n extensions
run 05_data_public.dump       "05 data: public (-Fc)"       "$PGD/pg_dump" -d "$SRC" --data-only -Fc -n public
run 06_data_auth_storage.dump "06 data: auth+storage (-Fc)" "$PGD/pg_dump" -d "$SRC" --data-only -Fc -n auth -n storage
run 07_extras.txt             "07 cron/vault/buckets/tz"    "$PGD/psql" -d "$SRC" -f capture_extras.sql
run 08_baseline_counts.txt    "08 baseline counts"          "$PGD/psql" -d "$SRC" -f reconcile.sql

echo ""
echo "=== summary ==="
ls -la . | grep -v '^total\|^d'
echo ""
echo "NOTE: 07_extras.txt may contain Vault secrets -- it is gitignored. Keep it"
echo "      in your password manager / offsite backup, not in the repo."
