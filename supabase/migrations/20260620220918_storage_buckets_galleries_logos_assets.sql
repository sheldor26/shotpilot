-- Storage: buckets para imágenes (galerías, logos, sellos) con políticas.
-- Convención de path: el primer segmento de la ruta = user_id del dueño (ej. "{uid}/portada.png").

insert into storage.buckets (id, name, public) values ('galleries','galleries', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('logos','logos', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('assets','assets', true) on conflict (id) do nothing;

-- galleries: solo el dueño lee/escribe su carpeta
drop policy if exists galleries_owner_rw on storage.objects;
create policy galleries_owner_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'galleries' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'galleries' and (storage.foldername(name))[1] = auth.uid()::text);

-- logos: idem
drop policy if exists logos_owner_rw on storage.objects;
create policy logos_owner_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- assets: lectura pública (sellos oficiales para todos); escritura solo en la carpeta propia del usuario.
-- Los oficiales (carpeta "oficial/...") los sube service_role/admin, que bypassa RLS.
drop policy if exists assets_public_read on storage.objects;
create policy assets_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'assets');
drop policy if exists assets_user_write on storage.objects;
create policy assets_user_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists assets_user_update on storage.objects;
create policy assets_user_update on storage.objects
  for update to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists assets_user_delete on storage.objects;
create policy assets_user_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);
