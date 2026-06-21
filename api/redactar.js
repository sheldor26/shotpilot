// Función serverless (Vercel Edge): redacta el texto de un campo de la ficha
// a partir de los datos que ya cargó el usuario. Botón "✨ Redactalo por mí".
//
// Usa la API de Anthropic (Claude Haiku: rápido y barato para copy corto). La
// key vive SOLO acá (env ANTHROPIC_API_KEY). El usuario después edita el texto.
//
// Recibe: POST { field, fieldLabel, rubro, context:{ name, answers, features } }
// Devuelve: { ok, text }
export const config = { runtime: 'edge' };

const MODEL = 'claude-haiku-4-5-20251001';

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ ok: false, error: 'missing_api_key' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_body' }, 400); }

  const fieldLabel = (body.fieldLabel || body.field || '').toString().slice(0, 60);
  const rubro = (body.rubro || 'general').toString().slice(0, 30);
  const ctx = body.context || {};
  const name = (ctx.name || '').toString().slice(0, 120);
  const answers = ctx.answers && typeof ctx.answers === 'object' ? ctx.answers : {};
  const features = Array.isArray(ctx.features) ? ctx.features.slice(0, 8) : [];
  if (!fieldLabel) return json({ ok: false, error: 'no_field' }, 400);

  // contexto compacto de lo que ya se sabe del producto
  const known = [];
  if (name) known.push(`Producto: ${name}`);
  if (rubro) known.push(`Rubro: ${rubro}`);
  for (const [k, v] of Object.entries(answers)) {
    if (v && String(v).trim()) known.push(`${k}: ${String(v).trim().slice(0, 140)}`);
  }
  if (features.length) known.push(`Características: ${features.map(f => String(f)).join('; ').slice(0, 300)}`);

  const system = 'Sos redactor de fichas de producto para Mercado Libre Argentina. '
    + 'Escribís en español rioplatense (voseo), claro, concreto y vendedor, sin exagerar ni inventar datos que no te dieron. '
    + 'Devolvés SOLO el texto pedido para ese campo, sin comillas, sin títulos y sin preámbulo. '
    + 'Máximo 2 oraciones cortas o una lista breve separada por comas. Si te faltan datos, escribí algo genérico pero útil, nunca inventes números ni marcas.';

  const user = `Redactá el campo "${fieldLabel}" de esta publicación.\n\nDatos que tengo:\n${known.length ? known.join('\n') : '(pocos datos)'}\n\nDevolvé solo el texto del campo "${fieldLabel}".`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || MODEL,
        max_tokens: 180,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json({ ok: false, error: 'llm_failed', status: res.status, detail: detail.slice(0, 160) }, 502);
    }
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || '').join('').trim();
    if (!text) return json({ ok: false, error: 'empty' }, 502);
    return json({ ok: true, text: text.slice(0, 400) }, 200);
  } catch (e) {
    return json({ ok: false, error: 'fetch_failed', detail: String(e).slice(0, 120) }, 502);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
