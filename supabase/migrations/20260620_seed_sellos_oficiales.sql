-- Catálogo inicial de sellos oficiales AR (plantillas genéricas recoloreables, SVG en /seals/).
-- NO son réplicas exactas de marcas oficiales; el vendedor declara que cuenta con la certificación
-- (seal_declarations) antes de usarlas.
insert into public.assets (scope, kind, name, file_url, rubros, requires_declaration) values
 ('oficial','sello','Seguridad Eléctrica','/seals/seguridad-electrica.svg', array['electro'], true),
 ('oficial','sello','Marcado de Conformidad','/seals/conformidad-qr.svg', array['electro'], true),
 ('oficial','sello','Sin TACC','/seals/sin-tacc.svg', array['alimentos'], true),
 ('oficial','sello','ANMAT','/seals/anmat.svg', array['belleza','alimentos'], true),
 ('oficial','sello','SENASA','/seals/senasa.svg', array['alimentos'], true),
 ('oficial','sello','Orgánico','/seals/organico.svg', array['alimentos'], true),
 ('oficial','sello','IRAM · INTI','/seals/iram-inti.svg', array['electro','hogar','general'], true),
 ('oficial','sello','Industria Argentina','/seals/industria-argentina.svg', array['general'], false)
on conflict do nothing;
