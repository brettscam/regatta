-- Regatta's website: votes on the roadmap, feedback, and skippers' logbooks.
--
-- One row per signed-in person in each table, keyed by their auth id. `doc` is the document exactly as the game
-- writes it (the same shapes it writes to the claude.ai page's store):
--   votes     {"v": {"<roadmap item>": 1 | -1}}
--   feedback  {"items": [{"kind", "text", "at", "context"}], "updated"}
--   profiles  {"skipper", "boat", "boatName", "colour", "log": {...}, "updated"}
--
-- Rules, enforced by row-level security:
--   votes, profiles  anyone may read; a signed-in person may add and change only their own row
--   feedback         a signed-in person may read, add and change only their own row (the owner reads it in the dashboard)
-- Nobody may delete through the API. Deleting a user in the dashboard removes their rows.
--
-- Additive only: creates three tables, one function, three triggers and their policies. Drops nothing.

create table if not exists public.votes (
  uid uuid primary key references auth.users (id) on delete cascade,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint votes_doc_is_object check (jsonb_typeof(doc) = 'object'),
  constraint votes_doc_small check (octet_length(doc::text) <= 16384)
);

create table if not exists public.feedback (
  uid uuid primary key references auth.users (id) on delete cascade,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint feedback_doc_is_object check (jsonb_typeof(doc) = 'object'),
  constraint feedback_doc_small check (octet_length(doc::text) <= 1048576)
);

create table if not exists public.profiles (
  uid uuid primary key references auth.users (id) on delete cascade,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint profiles_doc_is_object check (jsonb_typeof(doc) = 'object'),
  constraint profiles_doc_small check (octet_length(doc::text) <= 8192)
);

comment on table public.votes is 'Regatta: each person''s votes on the roadmap. doc = {"v": {item: 1 | -1}}';
comment on table public.feedback is 'Regatta: notes sent from the feedback form. doc = {"items": [...], "updated"}. Readable only by the sender.';
comment on table public.profiles is 'Regatta: a skipper''s public logbook. doc = {"skipper", "boat", "boatName", "colour", "log", "updated"}';

-- The page asks every so often for rows changed since it last looked.
create index if not exists votes_updated_at on public.votes (updated_at);
create index if not exists profiles_updated_at on public.profiles (updated_at);

-- updated_at is the database's clock, whatever the page sends.
create or replace function public.regatta_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.regatta_touch() from public, anon, authenticated;

create or replace trigger votes_touch before insert or update on public.votes
  for each row execute function public.regatta_touch();
create or replace trigger feedback_touch before insert or update on public.feedback
  for each row execute function public.regatta_touch();
create or replace trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.regatta_touch();

alter table public.votes enable row level security;
alter table public.feedback enable row level security;
alter table public.profiles enable row level security;

-- What the API roles may do at all. Row-level security then narrows it to the right rows.
revoke all on table public.votes, public.feedback, public.profiles from anon, authenticated;
grant select on table public.votes, public.profiles to anon, authenticated;
grant insert, update on table public.votes, public.profiles to authenticated;
grant select, insert, update on table public.feedback to authenticated;

create policy "Anyone can read votes" on public.votes
  for select to anon, authenticated using (true);
create policy "A person adds their own votes" on public.votes
  for insert to authenticated with check ((select auth.uid()) = uid);
create policy "A person changes their own votes" on public.votes
  for update to authenticated using ((select auth.uid()) = uid) with check ((select auth.uid()) = uid);

create policy "Anyone can read profiles" on public.profiles
  for select to anon, authenticated using (true);
create policy "A person adds their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = uid);
create policy "A person changes their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = uid) with check ((select auth.uid()) = uid);

create policy "A person reads their own feedback" on public.feedback
  for select to authenticated using ((select auth.uid()) = uid);
create policy "A person adds their own feedback" on public.feedback
  for insert to authenticated with check ((select auth.uid()) = uid);
create policy "A person changes their own feedback" on public.feedback
  for update to authenticated using ((select auth.uid()) = uid) with check ((select auth.uid()) = uid);
