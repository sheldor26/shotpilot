-- Galerías, placas, brand kits y assets. Extiende el esquema (cuentas/créditos intactos).
-- RLS: dueño = user_id; assets 'oficial' legibles por todos.

-- Galerías: 1 fila = 1 publicación que el vendedor está armando.
create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_name text,
  category text,
  source_url text,
  platform text,
  status text not null default 'draft' check (status in ('draft','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.galleries enable row level security;
drop policy if exists galleries_owner_all on public.galleries;
create policy galleries_owner_all on public.galleries
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists galleries_user_idx on public.galleries(user_id);

-- Placas: cada imagen/ficha de la galería (portada, medidas, características, etc.).
create table if not exists public.placas (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  image_url text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.placas enable row level security;
drop policy if exists placas_owner_all on public.placas;
create policy placas_owner_all on public.placas
  for all to authenticated
  using (exists (select 1 from public.galleries g where g.id = placas.gallery_id and g.user_id = auth.uid()))
  with check (exists (select 1 from public.galleries g where g.id = placas.gallery_id and g.user_id = auth.uid()));
create index if not exists placas_gallery_idx on public.placas(gallery_id);

-- Brand kit: la marca del vendedor (logo, colores, fuente).
create table if not exists public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  logo_url text,
  color_primary text,
  color_secondary text,
  font text,
  created_at timestamptz not null default now()
);
alter table public.brand_kits enable row level security;
drop policy if exists brand_kits_owner_all on public.brand_kits;
create policy brand_kits_owner_all on public.brand_kits
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists brand_kits_user_idx on public.brand_kits(user_id);

-- Assets: biblioteca de sellos/iconos/badges. 'oficial' = de ShotPilot (todos), 'user' = del vendedor.
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('oficial','user')),
  user_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('sello','icono','badge')),
  name text,
  file_url text,
  rubros text[] not null default '{}',
  requires_declaration boolean not null default false,
  created_at timestamptz not null default now(),
  constraint assets_scope_owner check ((scope = 'oficial' and user_id is null) or (scope = 'user' and user_id is not null))
);
alter table public.assets enable row level security;
drop policy if exists assets_read on public.assets;
create policy assets_read on public.assets
  for select to anon, authenticated
  using (scope = 'oficial' or auth.uid() = user_id);
drop policy if exists assets_user_insert on public.assets;
create policy assets_user_insert on public.assets
  for insert to authenticated with check (scope = 'user' and auth.uid() = user_id);
drop policy if exists assets_user_update on public.assets;
create policy assets_user_update on public.assets
  for update to authenticated using (scope = 'user' and auth.uid() = user_id) with check (scope = 'user' and auth.uid() = user_id);
drop policy if exists assets_user_delete on public.assets;
create policy assets_user_delete on public.assets
  for delete to authenticated using (scope = 'user' and auth.uid() = user_id);
create index if not exists assets_scope_kind_idx on public.assets(scope, kind);
