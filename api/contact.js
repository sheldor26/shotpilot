// Recibe el formulario de contacto y guarda el lead en Supabase.
// Los secretos viven en env vars (no en el repo):
//   SUPABASE_URL               → https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  → service_role key (Supabase → Settings → API)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json({ error: 'not_configured' }, 500);

  let data;
  try { data = await req.json(); } catch { return json({ error: 'bad_body' }, 400); }

  // Honeypot: si un bot completó el campo oculto "website", fingimos éxito y no guardamos nada.
  if (data && String(data.website || '').trim() !== '') return json({ ok: true }, 200);

  const clean = (v, n) => (v == null ? '' : String(v)).slice(0, n);
  const name = clean(data.name, 200);
  const email = clean(data.email, 200);
  const sells = clean(data.sells, 200);
  const msg = clean(data.msg, 2000);
  const lang = clean(data.lang, 10);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'bad_email' }, 400);

  // Insert vía la API REST de Supabase con la service_role key (saltea RLS).
  const res = await fetch(`${url}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ name, email, sells, msg, lang, source: 'landing' }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: 'insert_failed', status: res.status, detail }, 502);
  }
  return json({ ok: true }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
