-- Part 2 of the 2026-10-05 correction, between the function (part 1) and the
-- column drop (part 3). Drops v_gst_exceptions on its own, with the view
-- absent for the brief window until the view-recreate migration runs.
--
-- Why not DROP+CREATE in one step: the sale_entity CTE inside the view selects
-- s.* from sales, which Postgres dependency-tracks against every column of
-- `sales` AT THE MOMENT THE VIEW IS CREATED. Recreating the view immediately
-- (while gst_exclusion_* still exist on the table) would just re-establish the
-- same dependency and block the column drop again. Dropping the columns while
-- the view does not exist at all avoids that. Plain DROP, never CASCADE, so
-- this still fails loudly if anything else has come to depend on the view.
begin;
drop view if exists public.v_gst_exceptions;
commit;
