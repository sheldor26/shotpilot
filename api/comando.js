// Función serverless (Vercel Edge): interpreta un comando en lenguaje natural
// del "Modo experto" del editor y lo traduce a una ACCIÓN estructurada que el
// navegador aplica sobre la placa (cambios de datos/plantilla) o que dispara una
// escena del motor. Usa Claude Haiku. Key en env ANTHROPIC_API_KEY (ya existe).
//
// Recibe: POST { command, context?:{ bg, size, placas } }
// Devuelve: { ok, action, ...params, reply }
export const config = { runtime: 'edge' };

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = `Sos el intérprete de comandos de un editor de imágenes de producto para Mercado Libre (Argentina).
El usuario pide UN cambio en una frase. Devolvés SOLO un JSON (sin texto extra, sin markdown) con la acción.

Acciones posibles (elegí UNA):
- {"action":"bg_color","value":"#RRGGBB"}  // cambiar el color de fondo. Convertí el color a hex (gris=#9AA0A6, gris claro=#E5E7EB, blanco=#FFFFFF, negro=#141414, crema=#F4ECE2, celeste=#DCECFA).
- {"action":"product_size","value":"bigger"}  // o "smaller". Agrandar/achicar el producto.
- {"action":"shadow","value":true}  // o false. Sombra del producto.
- {"action":"reflect","value":true}  // o false. Reflejo de estudio.
- {"action":"placa","kind":"medidas","on":true}  // kind: medidas|caracteristicas|incluye|banner. on: true para sumar la placa, false para sacarla.
- {"action":"add_feature","text":"Garantía oficial 12 meses"}  // sumar un beneficio/característica (ej: garantía). Redactá un texto corto y vendedor en español rioplatense, máx 40 caracteres.
- {"action":"scene","prompt":"product on a modern kitchen counter, soft light"}  // poner el producto en una escena/ambiente. prompt EN INGLÉS, corto.
- {"action":"none","reply":"..."}  // si no entendés o no se puede, explicá en una frase amable qué sí podés hacer.

Siempre incluí un campo "reply": una confirmación corta en español rioplatense (voseo), ej "Listo, agrandé la portada.".
Devolvé SOLO el JSON.`;

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ ok: false, error: 'missing_api_key' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_body' }, 400); }
  const command = (body.command || '').toString().slice(0, 240).trim();
  if (!command) return json({ ok: false, error: 'no_command' }, 400);
  const ctx = body.context || {};
  const ctxLine = `Estado actual → fondo: ${ctx.bg || '?'}, tamaño producto: ${ctx.size || '?'}, placas activas: ${(Array.isArray(ctx.placas) ? ctx.placas.join(', ') : '') || 'ninguna'}.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || MODEL,
        max_tokens: 160,
        system: SYSTEM,
        messages: [{ role: 'user', content: `${ctxLine}\n\nComando: "${command}"\n\nDevolvé el JSON de la acción.` }],
      }),
    });
    if (!res.ok) { const d = await res.text().catch(() => ''); return json({ ok: false, error: 'llm_failed', status: res.status, detail: d.slice(0, 140) }, 502); }
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || '').join('').trim();
    const parsed = extractJson(text);
    if (!parsed || !parsed.action) return json({ ok: true, action: 'none', reply: 'No te entendí. Probá con "cambiá el fondo a gris" o "agrandá la portada".' }, 200);
    return json({ ok: true, ...parsed }, 200);
  } catch (e) {
    return json({ ok: false, error: 'fetch_failed', detail: String(e).slice(0, 120) }, 502);
  }
}

function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
