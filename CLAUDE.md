# ShotPilot — guía para Claude Code

App web para vendedores de Mercado Libre / Tienda Nube / Instagram: a partir de los
datos que el vendedor carga (o importa por link), genera la **galería completa** de
una publicación — portada con fondo blanco, medidas, características, qué incluye,
banners, sellos. El vendedor **no diseña**: completa un formulario y baja las imágenes.

## Stack real (NO migrar)

- **Frontend: HTML estático** (sin framework). Páginas en la raíz: `editor.html` (el
  corazón), `app.html` (Home), `marca.html`, `score.html`, `galerias.html`,
  `cuenta.html`. Nav compartido en `js/ui/nav.js`, estilos base en `css/app.css`.
- **Auth/DB: Supabase** (`js/supabaseClient.js`, singleton). RLS por `user_id`.
- **Edge functions (Vercel)**: `api/*.js` (runtime edge). Hoy: `import.js` (trae
  publicación de ML por link, OAuth client_credentials), `redactar.js` y `comando.js`
  (Claude Haiku), `convert.js` (remove.bg), `contact.js`/`leads.js`.
- **Motor de imágenes: FastAPI en Railway** (`motor/server.py`): `/remove` (recorte),
  `/inpaint`, `/lifestyle` (escenas), y la facturación: `/packs`, `/checkout`,
  `/mp-webhook` (MercadoPago), `/spend` (descuenta créditos).
- **NO usar Next.js, NO usar Clerk.** Todo se monta sobre lo de arriba.

## Principios

1. **Incremental.** Un cambio = un commit chico, testeado, sin romper `editor.html`.
   Mostrar el diff y cómo probarlo. No auto-pushear (Juan pide "push").
2. **Reutilizar lo que ya existe**: el motor de placas (inline en `editor.html`:
   `compose`, `drawFeats`, `drawIncluye`, `makeZip`…), créditos, MercadoPago, auth,
   `api/import.js`. Las features nuevas se montan encima, no se reescriben.
3. **No agregar librerías nuevas sin preguntar.** CSV se parsea a mano; el ZIP es
   "store" hecho a mano; etc.
4. **Test del nene de 5 años**: ¿se entiende sin explicación? ¿una decisión por
   pantalla? ¿hay un default para no quedar en blanco? Mobile-first.
5. **Microcopy**: español rioplatense (voseo), orientado a vender, sin jerga
   ("placa" → "imagen/sello" en copy de usuario). Errores que no culpan y dan salida.
6. **Value-first**: el anónimo ve resultado con marca de agua; el registro/crédito
   recién al bajar limpio. No esconder valor detrás del login.

## Cómo verificar

- Preview local del editor con `?demo=1` (carga un producto sintético sin subir foto).
- Las edge functions y el motor no corren en el preview estático → mockear `fetch`
  para probar el flujo, o verificar contra prod después de deployar.
- i18n: el editor tiene `T.es`/`T.en`; mantener **paridad** (cada key en los dos).

## Claves/env (Vercel)

- `ML_APP_ID`, `ML_SECRET` (API de ML para import).
- `ANTHROPIC_API_KEY` (Haiku para redactar/comando).
- `REMOVEBG_API_KEY` (convert.js).
- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (en el motor).
- El motor (Railway) tiene su propia config; redeployar al tocar `motor/server.py`.

## Pendientes anotados

- Estampar sellos del brand kit sobre el canvas del editor.
- Excel (.xlsx) en la carga masiva (necesita librería → preguntar).
- Grilla literal Esenciales/Extras en el Paso 3.
- Sincronización de la barra de pasos en modo demo (cosmético).
