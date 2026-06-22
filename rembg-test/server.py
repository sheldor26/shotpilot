"""
Servidor de prueba para rembg (quitar fondo localmente, gratis, full-res)
+ auto-enhance suave (balance de blancos, contraste, saturacion, nitidez).
Levantar:  ./venv/bin/python -m uvicorn server:app --port 8000 --reload
Abrir:     http://localhost:8000
"""
import io
import json
import time

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import Response, FileResponse
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
from rembg import remove, new_session

app = FastAPI()

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


@app.get("/")
def index():
    return FileResponse("test.html")


@app.get("/logo-shotpilot.png")
def logo():
    # el logo vive en la raiz del repo (un nivel arriba de rembg-test)
    return FileResponse("../logo-shotpilot.png")


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
