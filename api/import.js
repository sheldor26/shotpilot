// Función serverless (Vercel Edge) que autocompleta el wizard desde un link de
// Mercado Libre. Trae título, categoría, fotos y atributos (medidas si están).
//
// Usa la API OFICIAL de ML con OAuth client_credentials (server-to-server). El
// secreto vive SOLO acá (env ML_APP_ID / ML_SECRET), nunca llega al navegador.
// Nota: /items/{id} y /sites/search dan 403 (PolicyAgent) SIN token; con token
// client_credentials sí responden. Por eso esto va por el servidor y no por el
// cliente. No scrapeamos HTML.
//
// Recibe: POST { url } (link o id de ML).
// Devuelve: { ok, source, id, title, category, images:[url...], specs:{...} }
export const config = { runtime: 'edge' };

const ML = 'https://api.mercadolibre.com';

// Cache del token en memoria del worker (se reusa entre invocaciones del mismo
// instance; ML lo da por 6h). Si el worker se recicla, se pide de nuevo.
let _tok = { value: null, exp: 0 };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_body' }, 400); }
  const raw = (body && body.url ? String(body.url) : '').trim();
  if (!raw) return json({ ok: false, error: 'no_url' }, 400);

  if (!process.env.ML_APP_ID || !process.env.ML_SECRET) {
    return json({ ok: false, error: 'missing_credentials' }, 500);
  }

  // 1) resolver el link a un id (siguiendo redirects de links cortos meli.la)
  let ref;
  try { ref = await resolveRef(raw); } catch { ref = null; }
  if (!ref) return json({ ok: false, error: 'unrecognized_link' }, 422);

  // 2) token OAuth
  let token;
  try { token = await getToken(); } catch (e) { return json({ ok: false, error: 'auth_failed', detail: String(e).slice(0, 120) }, 502); }
  const h = { Authorization: `Bearer ${token}` };

  // 3) traer datos según el tipo de link
  try {
    const data = ref.type === 'product'
      ? await fromProduct(ref.id, h)
      : await fromItem(ref.id, h);
    if (!data) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, ...data }, 200);
  } catch (e) {
    return json({ ok: false, error: 'fetch_failed', detail: String(e).slice(0, 120) }, 502);
  }
}

// ---------- resolución del link → { type:'item'|'product', id } ----------
async function resolveRef(raw) {
  const direct = parseRef(raw);
  if (direct) return direct;
  // link corto o URL "linda" sin id visible → seguir redirect y reparsear
  let url;
  try { url = new URL(raw); } catch { return null; }
  const res = await fetch(url.toString(), { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
  return parseRef(res.url) || parseRef(await res.text().catch(() => ''));
}

function parseRef(s) {
  if (!s) return null;
  const txt = String(s);
  // catálogo: /p/MLA12345678
  const pm = txt.match(/\/p\/(ML[A-Z]\d+)/i);
  if (pm) return { type: 'product', id: pm[1].toUpperCase() };
  // publicación: MLA-1234567890 (con o sin guion)
  const im = txt.match(/\b(ML[A-Z])-?(\d{6,})\b/i);
  if (im) return { type: 'item', id: (im[1] + im[2]).toUpperCase() };
  return null;
}

// ---------- token client_credentials (cacheado) ----------
async function getToken() {
  const now = Date.now();
  if (_tok.value && now < _tok.exp) return _tok.value;
  const res = await fetch(`${ML}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(process.env.ML_APP_ID)}&client_secret=${encodeURIComponent(process.env.ML_SECRET)}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('no_token');
  // renovamos 5 min antes de que expire por las dudas
  _tok = { value: j.access_token, exp: now + ((j.expires_in || 21600) - 300) * 1000 };
  return _tok.value;
}

// ---------- publicación individual (/items/{id}) ----------
async function fromItem(id, h) {
  const res = await fetch(`${ML}/items/${id}`, { headers: h });
  if (!res.ok) return null;
  const it = await res.json();
  const images = (it.pictures || []).map(p => bigImg(p.secure_url || p.url)).filter(Boolean);
  return {
    source: 'item',
    id,
    title: it.title || '',
    category: it.category_id || '',
    permalink: it.permalink || '',
    images,
    specs: mapSpecs(it.attributes || []),
  };
}

// ---------- producto de catálogo (/products/{id}) ----------
async function fromProduct(id, h) {
  const res = await fetch(`${ML}/products/${id}`, { headers: h });
  if (!res.ok) return null;
  const p = await res.json();
  const images = (p.pictures || []).map(x => bigImg(x.secure_url || x.url)).filter(Boolean);
  return {
    source: 'product',
    id,
    title: p.name || '',
    category: p.domain_id || '',
    permalink: p.permalink || `https://www.mercadolibre.com.ar/p/${id}`,
    images,
    specs: mapSpecs(p.attributes || []),
  };
}

// pasar la url de la foto a alta resolución (-F.jpg en vez de -O/-V/-I)
function bigImg(u) {
  if (!u) return '';
  return u.replace(/-[OVIJSWNFD]\.(jpg|jpeg|png|webp)/i, '-F.$1');
}

// ---------- atributos ML → campos internos ----------
function mapSpecs(attrs) {
  const by = {};
  for (const a of attrs) by[a.id] = a;
  const num = (id) => {
    const a = by[id];
    if (!a || !a.value_name) return null;
    const m = String(a.value_name).match(/([\d.,]+)\s*([a-zµ"']*)/i);
    if (!m) return null;
    return { value: m[1].replace(',', '.'), unit: (m[2] || '').toLowerCase() };
  };
  const txt = (id) => (by[id] && by[id].value_name) ? String(by[id].value_name) : null;

  const alto = num('HEIGHT') || num('PACKAGE_HEIGHT');
  const ancho = num('WIDTH') || num('DIAMETER') || num('PACKAGE_WIDTH');
  const prof = num('DEPTH') || num('LENGTH') || num('PACKAGE_LENGTH');
  const weight = num('WEIGHT') || num('PACKAGE_WEIGHT');

  // unidad común para las 3 medidas (la primera que aparezca)
  const unit = (alto || ancho || prof || {}).unit || 'cm';

  return {
    brand: txt('BRAND'),
    model: txt('MODEL'),
    color: txt('COLOR') || txt('MAIN_COLOR'),
    alto: alto ? alto.value : null,
    ancho: ancho ? ancho.value : null,
    prof: prof ? prof.value : null,
    unit: normUnit(unit),
    weight: weight ? { value: weight.value, unit: weight.unit || 'kg' } : null,
  };
}

function normUnit(u) {
  const x = (u || '').toLowerCase();
  if (x === 'mm' || x === 'cm' || x === 'm' || x === 'in' || x === 'ft') return x;
  if (x === '"' || x === "''" || x === 'pulg') return 'in';
  return 'cm';
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
