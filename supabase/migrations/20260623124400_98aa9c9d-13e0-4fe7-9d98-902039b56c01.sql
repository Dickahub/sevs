-- ============================================================
-- SEVS admin feature schema
-- ============================================================

-- 1. profiles: voter account fields (email, active flag, uniqueness)
alter table public.profiles
  add column if not exists email text,
  add column if not exists is_active boolean not null default true;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

create unique index if not exists profiles_student_id_key
  on public.profiles (student_id) where student_id is not null;
create unique index if not exists profiles_email_key
  on public.profiles (lower(email)) where email is not null;

-- keep new-user trigger in sync with the new email column
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, student_id, full_name, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'student_id',
    new.raw_user_meta_data ->> 'full_name',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 2. elections: description + RSA public key
alter table public.elections
  add column if not exists description text,
  add column if not exists public_key text;

-- 3. candidates: link to an existing voter + optional biography (<= 500 chars)
alter table public.candidates
  add column if not exists voter_id uuid,
  add column if not exists bio text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'candidates_bio_len') then
    alter table public.candidates
      add constraint candidates_bio_len check (bio is null or char_length(bio) <= 500);
  end if;
end $$;

-- one voter may stand only once per position per election
create unique index if not exists candidates_position_voter_key
  on public.candidates (position_id, voter_id) where voter_id is not null;

-- 4. election eligibility list (voter <-> election)
create table if not exists public.election_eligibility (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  voter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (election_id, voter_id)
);

grant select, insert, update, delete on public.election_eligibility to authenticated;
grant all on public.election_eligibility to service_role;

alter table public.election_eligibility enable row level security;

create policy "View own eligibility or admin"
  on public.election_eligibility for select to authenticated
  using (auth.uid() = voter_id or public.has_role(auth.uid(), 'admin'));

create policy "Admins manage eligibility"
  on public.election_eligibility for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 5. encrypted RSA private keys, stored separately (service role only)
create table if not exists public.election_keys (
  election_id uuid primary key references public.elections(id) on delete cascade,
  encrypted_private_key text not null,
  key_algorithm text not null default 'RSA-2048',
  created_at timestamptz not null default now()
);

grant all on public.election_keys to service_role;
alter table public.election_keys enable row level security;
-- intentionally no policies: only the service role (RLS-bypassing) may read/write

-- 6. one-time voter setup tokens (48h), service role only
create table if not exists public.voter_setup_tokens (
  id uuid primary key default gen_random_uuid(),
  voter_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

grant all on public.voter_setup_tokens to service_role;
alter table public.voter_setup_tokens enable row level security;
-- intentionally no policies: validated server-side via the service role