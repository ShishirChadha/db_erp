---
slug: backup-audit
title: Backup & Audit Log
kind: module
audience: [owner]
routes: [/dashboard/settings/backup, /dashboard/settings/audit-log]
keywords: [backup, restore, audit log, audit trail, snapshot, who changed this, history]
sources:
  - apps/erp/lib/audit-log.ts
  - apps/erp/app/api/backup/**
updated: 2026-10-03
---

## Audit Log

Row-per-action trail across every module, written via `logAuditEvent()`
(`lib/audit-log.ts`) — distinct from the `activities` task system. References
`field_correction_ids` for update-type events rather than duplicating diff
storage. Every active user can see their own trail here; the API restricts
non-owners to their own rows.

## Backup

Owner-only. Snapshot-based (`backup_snapshots`), scheduled
(`backup_settings`), with a preview-then-apply restore flow
(`/api/backup/restore/preview` then `/apply`) — a preview is intentionally
computed fresh rather than trusting a stale cached value, since restoring the
wrong thing is unrecoverable without another backup.

## New action type: `blocked` (2026-10-03)

`audit_log.action_type` gained **`blocked`** — an action refused by policy, severity
*minor* (matching `login_failed`: it is an attempt, not a change). Its only use today is
a self-punch rejected by the attendance office-IP allowlist, where **no
`attendance_punches` row is written at all**, so the audit row is the only trace that
anyone tried. It records both the trusted IP the decision was made on and, separately
labelled, the untrusted observed IP — so a blocked attempt stays traceable even where
the trusted one is null. Never read `observed_ip_untrusted` as proof of origin.

`attendance` is also a new `module` value, covering punches, day overrides, punch voids,
leave decisions, roster/shift/network/holiday changes. Punch voids are logged as `void`,
which puts them in the **major** bucket — a corrected attendance record deserves that
visibility.

## Related

**business-rules**, **roles-permissions**, **attendance** (the `blocked` action and the
append-only punch ledger). Always back up before a schema migration — see `CLAUDE.md`'s
Autonomous Development Rules.
