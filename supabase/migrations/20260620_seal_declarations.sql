-- Consentimiento legal: el vendedor declara que cuenta con la certificación antes de usar un sello.
create table if not exists public.seal_declarations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);
alter table public.seal_declarations enable row level security;
drop policy if exists seal_declarations_owner_all on public.seal_declarations;
create policy seal_declarations_owner_all on public.seal_declarations
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
