-- ============================================================================
-- Aflah Daycare portals: database schema for Supabase
--
-- Run this once in your Supabase project: SQL Editor → New query → paste this
-- whole file → Run. It is safe to run again; it only creates what is missing
-- and replaces the functions and access rules.
--
-- Who can do what (enforced by the database itself, not just the website):
--   admin   everything: children, staff, attendance, hours, incidents, payments
--   staff   read children, take attendance, sign themselves in and out,
--           write and read their own incident reports (no payments)
--   pending a new sign-up waiting for an admin to approve them: no access
--
-- Staff can only sign in and out (their own shifts and the children's
-- timesheet) while their phone or tablet is at the daycare. The admin sets the
-- daycare's location in the admin portal under Settings.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- People and roles
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.app_role as enum ('pending', 'staff', 'admin');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  position text,
  role public.app_role not null default 'pending',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.app_user_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_user_role() = 'admin', false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_user_role() in ('staff', 'admin'), false)
$$;

-- Every new sign-up gets a profile with the "pending" role.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only an admin can change someone's role, access or email. Changes made
-- directly in the Supabase dashboard (no signed-in user) are allowed, which is
-- how the first admin is created.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
    new.role is distinct from old.role
    or new.active is distinct from old.active
    or new.email is distinct from old.email
  ) then
    raise exception 'Only an admin can change roles, access or email addresses';
  end if;
  return new;
end $$;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------------------------------------------------------------------------
-- Children
-- ---------------------------------------------------------------------------

create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null default '',
  date_of_birth date,
  program text not null default 'Seedlings'
    check (program in ('Seedlings', 'Sprouts', 'Saplings', 'Branches')),
  room text,
  status text not null default 'enrolled'
    check (status in ('enrolled', 'waitlist', 'withdrawn')),
  start_date date,
  monthly_fee numeric(10, 2) not null default 0 check (monthly_fee >= 0),
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  emergency_contact text,
  allergies text,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sign in only at the daycare
--
-- The staff portal sends the device's location to verify_location() just
-- before a sign in or sign out. If it is within the radius of the daycare, the
-- staff member gets a short "on site" pass, and only with that pass can they
-- change shifts or the children's timesheet. Admins are exempt so they can
-- correct records from anywhere.
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  site_lat double precision check (site_lat between -90 and 90),
  site_lng double precision check (site_lng between -180 and 180),
  site_radius_m integer not null default 150 check (site_radius_m between 25 and 2000),
  require_on_site boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

create or replace function public.stamp_settings() returns trigger
language plpgsql as $$
begin
  new.id := 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists stamp_settings on public.settings;
create trigger stamp_settings
  before update on public.settings
  for each row execute function public.stamp_settings();

-- Only the time a pass runs out is kept, not where anyone was
create table if not exists public.site_passes (
  staff_id uuid primary key references public.profiles (id) on delete cascade,
  valid_until timestamptz not null
);

-- Distance in metres between two points (haversine)
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = public as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- Checks a location against the daycare's and, when it is close enough, gives
-- the signed-in staff member an on-site pass for 5 minutes. The reported GPS
-- accuracy is allowed for, up to 100 m.
create or replace function public.verify_location(lat double precision, lng double precision, accuracy double precision default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.settings;
  d double precision;
  here boolean;
begin
  if not public.is_staff() then
    raise exception 'permission denied';
  end if;
  select * into s from public.settings where id = 1;
  if s.require_on_site is false then
    return json_build_object('required', false, 'on_site', true);
  end if;
  if s.site_lat is null or s.site_lng is null then
    raise exception 'site_not_set';
  end if;
  if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 then
    raise exception 'location_required';
  end if;
  d := public.distance_m(lat, lng, s.site_lat, s.site_lng);
  here := d - least(greatest(coalesce(accuracy, 0), 0), 100) <= s.site_radius_m;
  if here then
    insert into public.site_passes (staff_id, valid_until)
    values (auth.uid(), now() + interval '5 minutes')
    on conflict (staff_id) do update set valid_until = excluded.valid_until;
  else
    delete from public.site_passes where staff_id = auth.uid();
  end if;
  return json_build_object('required', true, 'on_site', here, 'distance_m', round(d), 'radius_m', s.site_radius_m);
end $$;

-- True when the signed-in person may sign in or out right now
create or replace function public.on_site() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or coalesce((select not require_on_site from public.settings where id = 1), false)
    or exists (select 1 from public.site_passes where staff_id = auth.uid() and valid_until > now())
$$;

-- ---------------------------------------------------------------------------
-- Children's timesheet: one row per child per day, like the paper sheet:
-- two sign-in / sign-out pairs (e.g. before and after school) or absent.
-- ---------------------------------------------------------------------------

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  day date not null default current_date,
  sign_in_1 timestamptz,
  sign_out_1 timestamptz,
  sign_in_2 timestamptz,
  sign_out_2 timestamptz,
  absent boolean not null default false,
  note text,
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (child_id, day)
);

create or replace function public.stamp_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists stamp_attendance on public.attendance;
create trigger stamp_attendance
  before insert or update on public.attendance
  for each row execute function public.stamp_attendance();

-- Staff can only change the timesheet while at the daycare
create or replace function public.enforce_on_site() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.on_site() then
    raise exception 'not_on_site';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists enforce_on_site on public.attendance;
create trigger enforce_on_site
  before insert or update or delete on public.attendance
  for each row execute function public.enforce_on_site();

-- ---------------------------------------------------------------------------
-- Staff shifts (sign in / sign out)
-- ---------------------------------------------------------------------------

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text,
  check (clock_out is null or clock_out >= clock_in)
);

create unique index if not exists one_open_shift_per_staff
  on public.shifts (staff_id) where clock_out is null;

-- Staff sign in and sign out only at the daycare, and the times always use
-- the server clock. Admins can correct times afterwards.
create or replace function public.stamp_shift() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.uid() is null then
    return new;
  end if;
  if not public.on_site() then
    raise exception 'not_on_site';
  end if;
  if tg_op = 'INSERT' then
    new.clock_in := now();
    new.clock_out := null;
  else
    new.clock_in := old.clock_in;
    new.staff_id := old.staff_id;
    if old.clock_out is null and new.clock_out is not null then
      new.clock_out := now();
    else
      new.clock_out := old.clock_out;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists stamp_shift on public.shifts;
create trigger stamp_shift
  before insert or update on public.shifts
  for each row execute function public.stamp_shift();

-- ---------------------------------------------------------------------------
-- Incident reports
-- ---------------------------------------------------------------------------

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  child_id uuid references public.children (id) on delete set null,
  occurred_at timestamptz not null default now(),
  location text,
  category text not null default 'injury'
    check (category in ('injury', 'illness', 'behaviour', 'allergy', 'other')),
  description text not null,
  action_taken text,
  witnesses text,
  parent_notified boolean not null default false,
  parent_notified_at timestamptz,
  reported_by uuid default auth.uid() references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  admin_notes text,
  created_at timestamptz not null default now()
);

-- Staff can edit their own report until an admin has reviewed it, but only
-- an admin can review it or add admin notes.
create or replace function public.protect_incident() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.reported_by := auth.uid();
    else
      new.reported_by := old.reported_by;
    end if;
    new.status := coalesce(case when tg_op = 'UPDATE' then old.status end, 'open');
    new.admin_notes := case when tg_op = 'UPDATE' then old.admin_notes end;
  end if;
  return new;
end $$;

drop trigger if exists protect_incident on public.incidents;
create trigger protect_incident
  before insert or update on public.incidents
  for each row execute function public.protect_incident();

-- ---------------------------------------------------------------------------
-- Money: charges (what is owed) and payments (what was paid)
-- ---------------------------------------------------------------------------

create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  description text not null,
  amount numeric(10, 2) not null check (amount > 0),
  due_date date not null default current_date,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'e-transfer'
    check (method in ('cash', 'e-transfer', 'cheque', 'card', 'subsidy', 'other')),
  reference text,
  note text,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security: who can see and change what
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.children enable row level security;
alter table public.attendance enable row level security;
alter table public.shifts enable row level security;
alter table public.incidents enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.settings enable row level security;
alter table public.site_passes enable row level security;

-- profiles
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
drop policy if exists "profiles: update" on public.profiles;
create policy "profiles: update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- children
drop policy if exists "children: read" on public.children;
create policy "children: read" on public.children for select to authenticated
  using (public.is_staff());
drop policy if exists "children: admin writes" on public.children;
create policy "children: admin writes" on public.children for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- attendance
drop policy if exists "attendance: staff" on public.attendance;
create policy "attendance: staff" on public.attendance for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- shifts
drop policy if exists "shifts: read" on public.shifts;
create policy "shifts: read" on public.shifts for select to authenticated
  using ((staff_id = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists "shifts: sign in" on public.shifts;
create policy "shifts: sign in" on public.shifts for insert to authenticated
  with check ((staff_id = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists "shifts: sign out" on public.shifts;
create policy "shifts: sign out" on public.shifts for update to authenticated
  using ((staff_id = auth.uid() and public.is_staff()) or public.is_admin())
  with check ((staff_id = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists "shifts: admin deletes" on public.shifts;
create policy "shifts: admin deletes" on public.shifts for delete to authenticated
  using (public.is_admin());

-- incidents
drop policy if exists "incidents: read" on public.incidents;
create policy "incidents: read" on public.incidents for select to authenticated
  using ((reported_by = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists "incidents: write" on public.incidents;
create policy "incidents: write" on public.incidents for insert to authenticated
  with check (public.is_staff());
drop policy if exists "incidents: edit" on public.incidents;
create policy "incidents: edit" on public.incidents for update to authenticated
  using ((reported_by = auth.uid() and public.is_staff() and status = 'open') or public.is_admin())
  with check ((reported_by = auth.uid() and public.is_staff()) or public.is_admin());
drop policy if exists "incidents: admin deletes" on public.incidents;
create policy "incidents: admin deletes" on public.incidents for delete to authenticated
  using (public.is_admin());

-- settings: everyone approved can read them (the staff portal needs to know
-- whether to check the location); only admins change them
drop policy if exists "settings: read" on public.settings;
create policy "settings: read" on public.settings for select to authenticated
  using (public.is_staff());
drop policy if exists "settings: admin updates" on public.settings;
create policy "settings: admin updates" on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- site_passes: no policies, so only verify_location() can write them

-- charges and payments: admins only
drop policy if exists "charges: admin" on public.charges;
create policy "charges: admin" on public.charges for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "payments: admin" on public.payments;
create policy "payments: admin" on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Table access: signed-in users only (row-level security above decides the rest)
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.children, public.attendance, public.shifts,
  public.incidents, public.charges, public.payments, public.settings, public.site_passes from anon;
revoke all on public.site_passes from authenticated;
revoke all on public.settings from authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.children, public.attendance,
  public.shifts, public.incidents, public.charges, public.payments to authenticated;
grant select, update on public.settings to authenticated;
revoke execute on function public.verify_location(double precision, double precision, double precision) from public, anon;
grant execute on function public.app_user_role(), public.is_admin(), public.is_staff(), public.on_site(),
  public.verify_location(double precision, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- After you sign up in the admin portal, make yourself the first admin by
-- running this (with your own email) in a new SQL Editor query:
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- Then set the daycare's location in the admin portal under Settings. Until
-- it is set, staff can't sign in or out.
-- ---------------------------------------------------------------------------
