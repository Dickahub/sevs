-- Roles enum
create type public.app_role as enum ('admin', 'voter');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  student_id text,
  full_name text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id);

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create policy "Users can view their own roles"
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id);

-- has_role security definer function
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, student_id, full_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'student_id',
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Elections
create table public.elections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  organisation text not null,
  status text not null default 'draft',
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  eligible_voters integer not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.elections to authenticated;
grant all on public.elections to service_role;
alter table public.elections enable row level security;

create policy "Authenticated users can view elections"
  on public.elections for select to authenticated
  using (true);
create policy "Admins can manage elections"
  on public.elections for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Positions
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid references public.elections(id) on delete cascade not null,
  title text not null,
  seats integer not null default 1,
  sort_order integer not null default 0
);
grant select, insert, update, delete on public.positions to authenticated;
grant all on public.positions to service_role;
alter table public.positions enable row level security;

create policy "Authenticated users can view positions"
  on public.positions for select to authenticated
  using (true);
create policy "Admins can manage positions"
  on public.positions for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Candidates
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references public.positions(id) on delete cascade not null,
  name text not null,
  programme text,
  statement text,
  sort_order integer not null default 0
);
grant select, insert, update, delete on public.candidates to authenticated;
grant all on public.candidates to service_role;
alter table public.candidates enable row level security;

create policy "Authenticated users can view candidates"
  on public.candidates for select to authenticated
  using (true);
create policy "Admins can manage candidates"
  on public.candidates for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Ballot receipts: tracks WHO voted (enforces one-vote) + receipt hash.
-- Deliberately separate from votes so identity is never linked to choices.
create table public.ballot_receipts (
  id uuid primary key default gen_random_uuid(),
  election_id uuid references public.elections(id) on delete cascade not null,
  voter_id uuid references auth.users(id) on delete cascade not null,
  ballot_hash text not null,
  cast_at timestamptz not null default now(),
  unique (election_id, voter_id)
);
grant select on public.ballot_receipts to authenticated;
grant all on public.ballot_receipts to service_role;
alter table public.ballot_receipts enable row level security;

create policy "Voters can view their own receipts"
  on public.ballot_receipts for select to authenticated
  using (auth.uid() = voter_id);

-- Votes: anonymous tally records, NO voter_id (ballot secrecy).
-- Only service_role (server functions) may read/write these.
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid references public.elections(id) on delete cascade not null,
  position_id uuid references public.positions(id) on delete cascade not null,
  candidate_id uuid references public.candidates(id) on delete cascade not null,
  created_at timestamptz not null default now()
);
grant all on public.votes to service_role;
alter table public.votes enable row level security;
-- No policies for authenticated: votes are only accessible via server functions.

-- Audit log: SHA-256 hash chained, append-only.
create table public.audit_log (
  seq bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor text not null,
  action text not null,
  election_id uuid,
  prev_hash text not null,
  hash text not null
);
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;

create policy "Authenticated users can view audit log"
  on public.audit_log for select to authenticated
  using (true);