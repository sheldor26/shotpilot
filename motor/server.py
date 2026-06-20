"""
Motor de imagenes de ShotPilot (produccion).
- /remove  : quita el fondo (rembg full-res via mascara sobre original) + opciones
             (main_only, enhance, wb) y sugerencia de cotas (X-Dims).
- /inpaint : rellena lo marcado (OpenCV) para sacar logos/marcas.
- /health  : healthcheck.
Levantar local:  uvicorn server:app --port 8000
"""
import base64
import io
import json
import os
import time
import urllib.error
import urllib.request

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
from rembg import remove, new_session

app = FastAPI()

# CORS: dominios del frontend que pueden llamar al motor. Configurable por env
# ALLOWED_ORIGINS="https://shotpilot.vercel.app,https://shotpilot.com.ar" (coma-separado).
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Dims", "X-Out-Size", "X-Elapsed-Ms", "X-Enhance-Ms", "X-Model"],
)

# Cargamos la sesion una sola vez (el modelo se descarga la primera vez).
# isnet-general-use suele dar mejores bordes que el default u2net.
_sessions = {}


def get_session(model: str):
    if model not in _sessions:
        _sessions[model] = new_session(model)
    return _sessions[model]


def gray_world_wb(img_rgba: Image.Image) -> Image.Image:
    """Balance de blancos gray-world. OJO: en productos de un color dominante
    desvia el tono (un vestido bordo se va a verde). Por eso queda opcional y
    apagado por default. Sirve para fotos con tinte de luz parejo (madera/papel)."""
    arr = np.array(img_rgba).astype(np.float32)
    rgb = arr[..., :3]
    mask = arr[..., 3] > 16
    if mask.sum() > 100:
        means = [rgb[..., c][mask].mean() for c in range(3)]
        gray = sum(means) / 3.0
        for c in range(3):
            if means[c] > 1e-3:
                # correccion atenuada (no full gray-world) para no exagerar
                factor = (gray / means[c]) ** 0.5
                rgb[..., c] *= factor
        arr[..., :3] = np.clip(rgb, 0, 255)
    return Image.fromarray(arr.astype("uint8"), "RGBA")


def keep_main_object(img_rgba: Image.Image) -> Image.Image:
    """Se queda solo con el objeto mas grande del recorte y tira los pedazos
    sueltos (props: platitos, flores separadas, etc.). Lo que toca al producto
    queda; lo que esta separado se va."""
    arr = np.array(img_rgba)
    alpha = arr[..., 3]
    binary = (alpha > 30).astype("uint8")
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if n <= 2:  # 0 = fondo, 1 = un solo objeto -> no hay nada que limpiar
        return img_rgba
    areas = stats[1:, cv2.CC_STAT_AREA]
    biggest = 1 + int(np.argmax(areas))
    keep = labels == biggest
    arr[..., 3] = np.where(keep, alpha, 0).astype("uint8")
    return Image.fromarray(arr, "RGBA")


def detect_dims(img_rgba: Image.Image):
    """Mira la silueta del recorte y sugiere dónde van las cotas.
    Distingue producto PLANO (de frente -> alto+ancho) de uno EN ÁNGULO
    (caja en perspectiva -> alto+ancho+profundidad). Devuelve los extremos
    de cada línea en fracciones del bounding-box del producto (0..1; pueden
    salirse un poco para el margen). El cliente las mapea al lienzo."""
    alpha = np.array(img_rgba.getchannel("A"))
    colmax = alpha.max(axis=0)
    rowmax = alpha.max(axis=1)
    cols_any = np.where(colmax > 30)[0]
    rows_any = np.where(rowmax > 30)[0]
    if len(cols_any) == 0 or len(rows_any) == 0:
        return None
    minx, maxx = int(cols_any.min()), int(cols_any.max())
    miny, maxy = int(rows_any.min()), int(rows_any.max())
    bw, bh = max(1, maxx - minx), max(1, maxy - miny)

    ox, oy = 0.07 * bw, 0.05 * bh

    def rel(px, py):
        return [round((px - minx) / bw, 4), round((py - miny) / bh, 4)]

    # fill ratio: si el producto NO llena su recuadro, no es una caja (anteojos, ropa,
    # objetos finos/irregulares) -> solo medidas totales (alto + ancho), sin profundidad.
    fill = float((alpha > 30).sum()) / (bw * bh)
    if fill < 0.70:
        return {
            "angled": False,
            "conf": "alta",
            "alto": [rel(minx - ox, miny), rel(minx - ox, maxy)],
            "ancho": [rel(minx, maxy + oy), rel(maxx, maxy + oy)],
            "prof": None,
        }

    # perfil del fondo: por cada columna, el pixel opaco mas bajo -> "V" si esta en angulo
    botY = {}
    for cx in range(minx, maxx + 1):
        col = np.where(alpha[:, cx] > 30)[0]
        if len(col):
            botY[cx] = int(col.max())
    cols = sorted(botY)
    if len(cols) < 4:
        return None
    front_x = max(cols, key=lambda k: botY[k])   # esquina de adelante (punto mas bajo)
    front_y = botY[front_x]
    nE = max(1, len(cols) // 12)
    endL, endR = cols[:nE], cols[-nE:]
    leftX, leftY = int(np.mean(endL)), int(np.median([botY[k] for k in endL]))
    rightX, rightY = int(np.mean(endR)), int(np.median([botY[k] for k in endR]))
    riseL, riseR = front_y - leftY, front_y - rightY
    angled = bool(max(riseL, riseR) > 0.05 * bh)
    if riseL >= riseR:
        depthEnd, widthEnd = (leftX, leftY), (rightX, rightY)
    else:
        depthEnd, widthEnd = (rightX, rightY), (leftX, leftY)

    if angled:
        # confianza: que tan marcada es la "V" (strength) y que tan claro recede un lado
        strength = max(riseL, riseR) / bh
        conf = "alta" if strength > 0.12 else "media"   # angulo suave -> tentativo
        out = {
            "angled": True,
            "conf": conf,
            "alto": [rel(minx - ox, miny), rel(minx - ox, maxy)],
            "ancho": [rel(front_x, front_y + oy), rel(widthEnd[0], widthEnd[1] + oy)],
            "prof": [rel(front_x, front_y + oy), rel(depthEnd[0], depthEnd[1] + oy)],
        }
    else:
        out = {
            "angled": False,
            "conf": "alta",
            "alto": [rel(minx - ox, miny), rel(minx - ox, maxy)],
            "ancho": [rel(minx, maxy + oy), rel(maxx, maxy + oy)],
            "prof": None,
        }
    return out


def auto_enhance(img_rgba: Image.Image) -> Image.Image:
    """Mejora suave que RESPETA el color del producto: solo toca luz, contraste
    y nitidez. El tono (hue) no se mueve -> el producto no cambia de color."""
    r, g, b, a = img_rgba.split()
    rgb = Image.merge("RGB", (r, g, b))

    # 1) Contraste/luz SOLO en la luminancia (canal L de LAB). Hue intacto.
    lab = rgb.convert("LAB")
    L, A, B = lab.split()
    L = ImageOps.autocontrast(L, cutoff=1)
    rgb = Image.merge("LAB", (L, A, B)).convert("RGB")

    # 2) Saturacion apenas (que no falsee el color).
    rgb = ImageEnhance.Color(rgb).enhance(1.08)
    # 3) Nitidez controlada (importante despues de redimensionar).
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=3))

    r2, g2, b2 = rgb.split()
    return Image.merge("RGBA", (r2, g2, b2, a))


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/remove")
async def remove_bg(
    image: UploadFile = File(...),
    model: str = Form("isnet-general-use"),
    white_bg: str = Form("false"),
    enhance: str = Form("false"),
    wb: str = Form("false"),
    main_only: str = Form("false"),
):
    raw = await image.read()
    src = Image.open(io.BytesIO(raw)).convert("RGBA")  # original full-res

    # rembg saca el mejor recorte a ~1600px. Para no perder resolución:
    # corremos rembg en una copia reducida (mascara limpia) y aplicamos esa
    # mascara (alfa) sobre el ORIGINAL en alta. Resultado: recorte limpio + full-res.
    REMBG_MAX = 1600
    w, h = src.size
    if max(w, h) > REMBG_MAX:
        s = REMBG_MAX / max(w, h)
        small = src.resize((round(w * s), round(h * s)), Image.LANCZOS)
    else:
        small = src

    t0 = time.time()
    session = get_session(model)
    cut_small = remove(small, session=session)  # RGBA a tamaño reducido
    rembg_ms = int((time.time() - t0) * 1000)

    alpha = cut_small.getchannel("A").resize(src.size, Image.LANCZOS)  # subir la mascara a full-res
    cutout = src.copy()
    cutout.putalpha(alpha)  # RGB original en alta + alfa de rembg

    if main_only == "true":
        cutout = keep_main_object(cutout)

    enhance_ms = 0
    if wb == "true":
        cutout = gray_world_wb(cutout)
    if enhance == "true":
        te = time.time()
        cutout = auto_enhance(cutout)
        enhance_ms = int((time.time() - te) * 1000)

    # sugerencia de cotas (sobre el recorte con alfa, antes de poner fondo blanco)
    try:
        dims = detect_dims(cutout if cutout.mode == "RGBA" else cutout.convert("RGBA"))
    except Exception:
        dims = None

    if white_bg == "true":
        bg = Image.new("RGBA", cutout.size, (255, 255, 255, 255))
        bg.paste(cutout, (0, 0), cutout)
        cutout = bg.convert("RGB")

    out = io.BytesIO()
    cutout.save(out, format="PNG")
    out.seek(0)

    return Response(
        content=out.read(),
        media_type="image/png",
        headers={
            "X-Elapsed-Ms": str(rembg_ms),
            "X-Enhance-Ms": str(enhance_ms),
            "X-Out-Size": f"{cutout.size[0]}x{cutout.size[1]}",
            "X-Model": model,
            "X-Dims": json.dumps(dims) if dims else "",
        },
    )


BRIA_LIFESTYLE_URL = "https://engine.prod.bria-api.com/v1/product/lifestyle_shot_by_text"

# --- Cuentas + créditos (Supabase). El motor es la ÚNICA autoridad que muta saldos. ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

# --- Pagos (MercadoPago Checkout Pro). El precio vive en el SERVIDOR: el cliente
# solo manda el id del pack, nunca el monto -> no se puede falsear el precio. ---
MP_ACCESS_TOKEN = os.environ.get("MP_ACCESS_TOKEN", "").strip()
# MP_SANDBOX=true mientras testeás (usa el checkout de prueba explícito). Sacalo en producción.
MP_SANDBOX = os.environ.get("MP_SANDBOX", "").strip().lower() in ("1", "true", "yes")
MP_API = "https://api.mercadopago.com"
SITE_URL = os.environ.get("SITE_URL", "https://shotpilot.app").rstrip("/")
MOTOR_PUBLIC_URL = os.environ.get("MOTOR_PUBLIC_URL", "https://shotpilot-production.up.railway.app").rstrip("/")

# Packs: créditos + precio en ARS. AJUSTAR los ARS al dólar del día (ver nota).
PACKS = {
    "probe":    {"credits": 20,  "ars": 7990,  "title": "ShotPilot · 20 créditos"},
    "vendedor": {"credits": 60,  "ars": 17990, "title": "ShotPilot · 60 créditos"},
    "tienda":   {"credits": 200, "ars": 44990, "title": "ShotPilot · 200 créditos"},
}


def _bearer(headers) -> str:
    auth = headers.get("authorization") or ""
    return auth[7:].strip() if auth[:7].lower() == "bearer " else ""


def _supabase_user(token: str):
    """Verifica el token del usuario contra Supabase y devuelve su id (o None)."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY and token):
        return None
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_SERVICE_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
            return data if data.get("id") else None
    except Exception:
        return None


def _spend_credit(user_id: str, kind: str) -> dict:
    """Llama la función atómica spend_credit en Supabase con la service key."""
    payload = json.dumps({"p_user": user_id, "p_kind": kind}).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/spend_credit",
        data=payload, method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def _profile(user_id: str):
    """Lee el saldo del usuario (para el pre-chequeo, sin descontar)."""
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{user_id}&select=free_scenes_used,credits",
        headers={"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.loads(r.read().decode("utf-8"))
            return rows[0] if rows else None
    except Exception:
        return None


@app.post("/spend")
def spend(request: Request, kind: str = Form(...)):
    """Descuenta 1 crédito (kind='photo') o 3 (kind='scene') de la cuenta del usuario.
    Verifica la sesión de Supabase. El cliente NUNCA puede mutar su saldo."""
    user = _supabase_user(_bearer(request.headers))
    if not user:
        return Response(json.dumps({"ok": False, "reason": "auth"}), status_code=401, media_type="application/json")
    if kind not in ("photo", "scene"):
        return Response(json.dumps({"ok": False, "reason": "bad_kind"}), status_code=400, media_type="application/json")
    try:
        result = _spend_credit(user["id"], kind)
    except Exception as e:
        return Response(json.dumps({"ok": False, "reason": f"db:{e}"}), status_code=502, media_type="application/json")
    return Response(json.dumps(result), media_type="application/json")


def _grant_credits(user_id: str, amount: int, reason: str, ext_ref: str) -> dict:
    """Suma créditos pagos (idempotente por ext_ref = id de pago)."""
    payload = json.dumps({"p_user": user_id, "p_amount": amount, "p_reason": reason, "p_ext_ref": ext_ref}).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/grant_credits", data=payload, method="POST",
        headers={"Content-Type": "application/json", "apikey": SUPABASE_SERVICE_KEY,
                 "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


@app.get("/packs")
def packs():
    """Catálogo de packs (precio único, fuente de verdad). Lo lee el editor para mostrar los botones."""
    out = [{"id": k, "credits": v["credits"], "ars": v["ars"]} for k, v in PACKS.items()]
    return Response(json.dumps({"packs": out}), media_type="application/json")


@app.post("/checkout")
def checkout(request: Request, pack: str = Form(...)):
    """Crea una preferencia de Checkout Pro para el pack elegido y devuelve el link de pago.
    Verifica la sesión; el precio lo pone el servidor (no el cliente)."""
    user = _supabase_user(_bearer(request.headers))
    if not user:
        return Response(json.dumps({"error": "auth"}), status_code=401, media_type="application/json")
    p = PACKS.get(pack)
    if not p:
        return Response(json.dumps({"error": "bad_pack"}), status_code=400, media_type="application/json")
    if not MP_ACCESS_TOKEN:
        return Response(json.dumps({"error": "MP_ACCESS_TOKEN no configurado"}), status_code=500, media_type="application/json")

    pref = {
        "items": [{"title": p["title"], "quantity": 1, "unit_price": p["ars"], "currency_id": "ARS"}],
        "metadata": {"user_id": user["id"], "pack": pack, "credits": p["credits"]},
        "external_reference": f"{user['id']}:{pack}",
        "back_urls": {
            "success": f"{SITE_URL}/editor?pago=ok",
            "failure": f"{SITE_URL}/editor?pago=fail",
            "pending": f"{SITE_URL}/editor?pago=pending",
        },
        "auto_return": "approved",
        "notification_url": f"{MOTOR_PUBLIC_URL}/mp-webhook",
        "statement_descriptor": "SHOTPILOT",
    }
    data = json.dumps(pref).encode("utf-8")
    req = urllib.request.Request(
        f"{MP_API}/checkout/preferences", data=data, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {MP_ACCESS_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return Response(json.dumps({"error": f"MP {e.code}: {e.read().decode('utf-8', 'ignore')[:300]}"}),
                        status_code=502, media_type="application/json")
    except Exception as e:
        return Response(json.dumps({"error": f"MP: {e}"}), status_code=502, media_type="application/json")
    # En modo sandbox usamos el checkout de prueba explícito; en producción, el real.
    if MP_SANDBOX:
        init_point = resp.get("sandbox_init_point") or resp.get("init_point")
    else:
        init_point = resp.get("init_point") or resp.get("sandbox_init_point")
    return Response(json.dumps({"init_point": init_point, "sandbox": MP_SANDBOX}), media_type="application/json")


@app.post("/mp-webhook")
def mp_webhook(request: Request):
    """MercadoPago avisa cuando hay un pago. Verificamos contra MP que esté 'approved'
    y acreditamos los créditos a la cuenta (idempotente por id de pago)."""
    qp = request.query_params
    topic = qp.get("type") or qp.get("topic") or ""
    payment_id = qp.get("data.id") or qp.get("id")
    if topic and topic != "payment":
        return Response("ignored", status_code=200)
    if not payment_id or not MP_ACCESS_TOKEN:
        return Response("no id", status_code=200)

    req = urllib.request.Request(f"{MP_API}/v1/payments/{payment_id}",
                                 headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            pay = json.loads(r.read().decode("utf-8"))
    except Exception:
        return Response("payment fetch failed", status_code=200)   # 200 = que MP no reintente para siempre

    if pay.get("status") != "approved":
        return Response("not approved", status_code=200)
    meta = pay.get("metadata") or {}
    user_id = meta.get("user_id")
    credits = meta.get("credits")
    if not user_id or not credits:
        return Response("no meta", status_code=200)
    try:
        _grant_credits(str(user_id), int(credits), f"pago_mp_{meta.get('pack', '')}", str(payment_id))
    except Exception as e:
        return Response(f"grant failed: {e}", status_code=500)
    return Response("ok", status_code=200)


@app.post("/lifestyle")
def lifestyle(
    request: Request,
    image: UploadFile = File(...),
    scene: str = Form(...),
    num_results: int = Form(4),
):
    """Coloca el producto (recorte) en una escena realista (perfume en el baño,
    heladera en la cocina, etc.) via la API de Bria. La key vive SOLO en el
    servidor (env BRIA_API_TOKEN), nunca en el frontend. Devuelve JSON con las
    URLs de las variantes generadas: {"images": [url, ...]}.
    Requiere sesión y consume 1 escena (gratis) o 3 créditos."""
    user = _supabase_user(_bearer(request.headers))
    if not user:
        return Response(
            content=json.dumps({"error": "auth", "msg": "Iniciá sesión para generar escenas"}),
            status_code=401, media_type="application/json",
        )
    # pre-chequeo de saldo: no llamamos (ni pagamos) a Bria si no le alcanza
    prof = _profile(user["id"]) or {}
    can = prof.get("free_scenes_used", 1) < 1 or prof.get("credits", 0) >= 3
    if not can:
        return Response(
            content=json.dumps({"error": "no_credits", "credits": prof.get("credits", 0)}),
            status_code=402, media_type="application/json",
        )

    token = os.environ.get("BRIA_API_TOKEN", "").strip()
    if not token:
        return Response(
            content=json.dumps({"error": "BRIA_API_TOKEN no configurado en el servidor"}),
            status_code=500, media_type="application/json",
        )

    raw = image.file.read()
    b64 = base64.b64encode(raw).decode("ascii")
    n = max(1, min(4, int(num_results)))
    payload = json.dumps({
        "file": b64,
        "scene_description": scene,
        "placement_type": "automatic",
        "num_results": n,
        "sync": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        BRIA_LIFESTYLE_URL, data=payload, method="POST",
        headers={"Content-Type": "application/json", "api_token": token},
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        return Response(
            content=json.dumps({"error": f"Bria {e.code}: {body[:300]}"}),
            status_code=502, media_type="application/json",
        )
    except Exception as e:  # red, timeout, etc.
        return Response(
            content=json.dumps({"error": f"Fallo al llamar a Bria: {e}"}),
            status_code=502, media_type="application/json",
        )

    elapsed_ms = int((time.time() - t0) * 1000)
    # Bria devuelve {"result": [[url, seed, filename], ...]}
    result = data.get("result") or []
    urls = [row[0] for row in result if isinstance(row, list) and row][:n]
    if not urls:
        return Response(content=json.dumps({"error": "Bria no devolvió imágenes"}),
                        status_code=502, media_type="application/json")
    # recién al tener imágenes, descontamos (1 escena gratis o 3 créditos)
    try:
        balance = _spend_credit(user["id"], "scene")
    except Exception:
        balance = None
    return Response(
        content=json.dumps({"images": urls, "elapsed_ms": elapsed_ms, "balance": balance}),
        media_type="application/json",
    )


@app.post("/inpaint")
async def inpaint(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    radius: int = Form(4),
):
    """Rellena la zona marcada (logo / marca de agua) con la textura de alrededor.
    image: PNG RGBA (el recorte actual). mask: PNG, lo pintado = zona a rellenar.
    Devuelve PNG RGBA con el RGB rellenado y el alfa original intacto."""
    src = Image.open(io.BytesIO(await image.read())).convert("RGBA")
    m = Image.open(io.BytesIO(await mask.read())).convert("L").resize(src.size)

    arr = np.array(src)
    bgr = cv2.cvtColor(arr[..., :3], cv2.COLOR_RGB2BGR)
    alpha = arr[..., 3]
    mask_np = (np.array(m) > 10).astype("uint8") * 255

    t0 = time.time()
    filled_bgr = cv2.inpaint(bgr, mask_np, max(1, radius), cv2.INPAINT_TELEA)
    elapsed_ms = int((time.time() - t0) * 1000)

    rgb = cv2.cvtColor(filled_bgr, cv2.COLOR_BGR2RGB)
    result = np.dstack([rgb, alpha])
    im = Image.fromarray(result, "RGBA")

    out = io.BytesIO()
    im.save(out, format="PNG")
    out.seek(0)
    return Response(
        content=out.read(),
        media_type="image/png",
        headers={"X-Elapsed-Ms": str(elapsed_ms), "X-Out-Size": f"{im.size[0]}x{im.size[1]}"},
    )
