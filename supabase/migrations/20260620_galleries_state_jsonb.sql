-- Estado del editor (snapshot serializable: placas/banner/medidas/preset, sin blobs) para
-- poder retomar el borrador, + miniatura. El recorte (imagen) sigue local/Storage.
alter table public.galleries add column if not exists state jsonb;
alter table public.galleries add column if not exists thumb_url text;
