#!/usr/bin/env python3
"""Genera la imagen de social preview (1200x630) componiendo el antes/después."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 630
cream = (251, 247, 242); ink = (26, 22, 20); accent = (244, 81, 60)
soft = (92, 82, 75); line = (233, 223, 211); tint = (253, 231, 226); deep = (216, 56, 31)

img = Image.new("RGB", (W, H), cream)
d = ImageDraw.Draw(img)

def find_font(names):
    dirs = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental",
            "/Library/Fonts", os.path.expanduser("~/Library/Fonts")]
    for n in names:
        for dr in dirs:
            p = os.path.join(dr, n)
            if os.path.exists(p):
                return p
    return None

bold = find_font(["Arial Bold.ttf", "Arial.ttf", "Helvetica.ttc"])
reg = find_font(["Arial.ttf", "Helvetica.ttc"]) or bold

def F(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            return ImageFont.load_default()

f_brand = F(bold, 38); f_h1 = F(bold, 66); f_sub = F(reg, 28); f_tag = F(bold, 19)

def pill(text, font, x, y, bg, fg):
    tb = d.textbbox((0, 0), text, font=font); tw = tb[2] - tb[0]; th = tb[3] - tb[1]
    px, py = 12, 7
    d.rounded_rectangle([x, y, x + tw + px * 2, y + th + py * 2], radius=20, fill=bg)
    d.text((x + px, y + py - tb[1]), text, font=font, fill=fg)
    return tw + px * 2

# ---- right card: antes/después split ----
cx0, cy0, cx1, cy1 = 718, 66, 1132, 564
d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=28, fill=(255, 255, 255), outline=line, width=2)
pad = 14
ix0, iy0, ix1, iy1 = cx0 + pad, cy0 + pad, cx1 - pad, cy1 - pad
iw, ih = ix1 - ix0, iy1 - iy0
ihalf = iw // 2

def fit_crop(im, tw, th):
    return ImageOps.fit(im, (tw, th), Image.LANCZOS, centering=(0.5, 0.42))

before = Image.open(os.path.join(ROOT, "vestido-fiesta.png")).convert("RGB")
after = Image.open(os.path.join(ROOT, "vestido.webp")).convert("RGB")
inner = Image.new("RGB", (iw, ih), (255, 255, 255))
inner.paste(fit_crop(before, ihalf, ih), (0, 0))
inner.paste(fit_crop(after, iw - ihalf, ih), (ihalf, 0))
mask = Image.new("L", (iw, ih), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, iw, ih], radius=18, fill=255)
img.paste(inner, (ix0, iy0), mask)

# coral scan line + knob
lx = ix0 + ihalf; cyl = iy0 + ih // 2
d.line([(lx, iy0), (lx, iy1)], fill=accent, width=4)
d.ellipse([lx - 17, cyl - 17, lx + 17, cyl + 17], fill=(255, 255, 255), outline=accent, width=3)

# tags
pill("ANTES", f_tag, ix0 + 10, iy0 + 10, ink, (255, 255, 255))
dt = "DESPUÉS"
tb = d.textbbox((0, 0), dt, font=f_tag); dw = tb[2] - tb[0]
pill(dt, f_tag, ix1 - (dw + 24) - 10, iy0 + 10, accent, (255, 255, 255))

# ---- left text (una versión por idioma; la card de la derecha es la misma) ----
try:
    logo = Image.open(os.path.join(ROOT, "logo-shotpilot.png")).convert("RGBA").resize((48, 48), Image.LANCZOS)
except Exception:
    logo = None

VARIANTS = [
    ("og-image.png", "Subí la foto fea.", "Bajá la que vende.",
     "Fondo blanco, en la medida exacta de\nMercadoLibre, Tienda Nube e Instagram.", "Sin tocar un editor"),
    ("og-image-en.png", "Upload the ugly photo.", "Download the one that sells.",
     "White background, sized exactly for\nAmazon, Etsy and eBay.", "No editor needed"),
]

for fname, h1a, h1b, sub, tagtxt in VARIANTS:
    canvas = img.copy()
    dd = ImageDraw.Draw(canvas)
    tx = 72
    if logo is not None:
        canvas.paste(logo, (tx, 84), logo); bx = tx + 62
    else:
        dd.ellipse([tx, 86, tx + 44, 130], fill=accent); bx = tx + 58
    dd.text((bx, 90), "shotpilot", font=f_brand, fill=ink)
    # titular: achicar la tipografía hasta que ambas líneas entren en la columna izquierda
    maxw = cx0 - tx - 24
    hsize = 66
    while hsize > 40:
        fh = F(bold, hsize)
        w1 = dd.textbbox((0, 0), h1a, font=fh)[2]
        w2 = dd.textbbox((0, 0), h1b, font=fh)[2]
        if max(w1, w2) <= maxw:
            break
        hsize -= 2
    fh = F(bold, hsize)
    lh = int(hsize * 1.12)
    y_h = 250 - lh
    dd.text((tx, y_h), h1a, font=fh, fill=ink)
    dd.text((tx, y_h + lh), h1b, font=fh, fill=accent)
    dd.multiline_text((tx, 392), sub, font=f_sub, fill=soft, spacing=10)
    # pill (reusa la lógica pero sobre este canvas)
    tb = dd.textbbox((0, 0), tagtxt, font=f_tag); tw = tb[2] - tb[0]; th = tb[3] - tb[1]
    dd.rounded_rectangle([tx, 488, tx + tw + 24, 488 + th + 14], radius=20, fill=tint)
    dd.text((tx + 12, 488 + 7 - tb[1]), tagtxt, font=f_tag, fill=deep)
    canvas.save(os.path.join(ROOT, fname), "PNG")
    print("saved", fname, canvas.size)
