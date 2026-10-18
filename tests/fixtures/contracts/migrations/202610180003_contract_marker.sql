-- Fictitious third migration for the S0.2 loader fixture only.
-- Purpose: prove the migration loader applies EVERY .sql file in sorted order
-- and does NOT hard-code/skip to the first two migrations. The marker table
-- below must exist after the loader runs; if the loader ignored the third file
-- this assertion would fail.
--
-- NOT part of the working supabase/migrations scheme (never added there).
create table public._contract_load_marker(value text not null);
insert into public._contract_load_marker values('third-migration-applied');
