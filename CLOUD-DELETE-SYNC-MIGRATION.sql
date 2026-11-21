-- Run this one-time migration in Supabase SQL Editor.
-- It stores Admin deletions centrally so stale offline copies on other
-- devices cannot upload deleted records again.

begin;

create table if not exists public.cloud_deletions (
  entity_type text not null check (entity_type in ('student', 'attendance', 'leave')),
  record_key text not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references auth.users(id) on delete set null,
  primary key (entity_type, record_key)
);

alter table public.cloud_deletions enable row level security;

-- All authenticated portals may read the deletion ledger so every device
-- can remove deleted rows from its local IndexedDB before syncing.
drop policy if exists cloud_deletions_read_authenticated on public.cloud_deletions;
create policy cloud_deletions_read_authenticated
on public.cloud_deletions
for select
to authenticated
using (true);

-- Only the Admin profile may publish a deletion to the shared ledger.
drop policy if exists cloud_deletions_insert_admin on public.cloud_deletions;
create policy cloud_deletions_insert_admin
on public.cloud_deletions
for insert
to authenticated
with check ((select public.is_admin()));

-- No UPDATE or DELETE grants/policies are created: deletion history is append-only.
revoke all on public.cloud_deletions from anon;
revoke all on public.cloud_deletions from authenticated;
grant select, insert on public.cloud_deletions to authenticated;

commit;
