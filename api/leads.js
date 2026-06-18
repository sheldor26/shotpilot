// Devuelve los leads guardados, SOLO si se pasa el token de admin correcto.
// Lo usa la página /admin.html. Los secretos viven en env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → para leer la tabla
//   ADMIN_TOKEN                              → la contraseña del panel (la elegís vos)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!url || !key || !adminToken) return json({ error: 'not_configured' }, 500);

  // El token llega en el header Authorization: Bearer <token>.
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== adminToken) return json({ error: 'unauthorized' }, 401);

  const res = await fetch(`${url}/rest/v1/leads?select=*&order=created_at.desc`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: 'query_failed', status: res.status, detail }, 502);
  }
  const leads = await res.json();
  return json({ ok: true, leads }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
