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
updated: 2026-08-29
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

## Related

**business-rules**, **roles-permissions**. Always back up before a schema
migration — see `CLAUDE.md`'s Autonomous Development Rules.
