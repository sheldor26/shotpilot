# Motor de imágenes — ShotPilot

API de procesamiento de imágenes (quitar fondo, inpaint, sugerencia de cotas).
Es lo que reemplaza a remove.bg: corre con **rembg** (gratis, sin créditos, full-res).

## Endpoints

- `POST /remove` — quita el fondo. Campos (form-data):
  - `image` (archivo, requerido)
  - `model` — `isnet-general-use` (default) · `birefnet-general` · `u2net`
  - `white_bg` — `"true"` para fondo blanco, `"false"` para PNG transparente
  - `enhance` · `wb` · `main_only` — `"true"`/`"false"`
  - Devuelve PNG. Headers: `X-Dims` (cotas sugeridas, JSON), `X-Out-Size`, `X-Elapsed-Ms`, `X-Model`.
- `POST /inpaint` — rellena lo marcado. Campos: `image`, `mask` (PNG, blanco = a rellenar), `radius`.
- `GET /health` — `{ "ok": true }`.

## Correr local

```bash
python -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn server:app --port 8000
```

## Deploy a Railway

1. Crear cuenta en https://railway.app y un proyecto nuevo → **Deploy from GitHub repo** (o subir esta carpeta `motor/` como repo).
2. Railway detecta el `Dockerfile` y buildea solo. El modelo isnet queda precargado en la imagen.
3. En **Settings → Networking** generar un dominio público (ej. `motor-shotpilot.up.railway.app`).
4. (Opcional, recomendado) En **Variables** agregar `ALLOWED_ORIGINS` con los dominios del frontend, coma-separado:
   `https://shotpilot.vercel.app,https://shotpilot.com.ar`
   Si no se setea, acepta cualquier origen (`*`).
5. Probar: `GET https://<tu-dominio>/health` → `{"ok":true}`.

La primera build tarda (instala onnxruntime + opencv + baja el modelo). Después, cada request de recorte ~1-3 s en CPU.

## Notas

- 1 worker: cada modelo vive en RAM por proceso. Para más tráfico, escalar instancias (no workers).
- birefnet (Calidad Ultra) y u2net se descargan la primera vez que se usan (one-time).
- El motor NO compone medidas/banners: eso lo hace el frontend. El motor solo recorta / inpaint.
