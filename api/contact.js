// Recibe el formulario de contacto y manda el lead por email vía Resend.
// La API key y el destino viven en env vars (no en el repo):
//   RESEND_API_KEY  → tu clave de Resend
//   LEAD_TO         → tu email (en modo test de Resend, debe ser el de tu cuenta)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_TO;
  if (!key || !to) return json({ error: 'not_configured' }, 500);

  let data;
  try { data = await req.json(); } catch { return json({ error: 'bad_body' }, 400); }

  // Honeypot: si un bot completó el campo oculto "website", fingimos éxito y no mandamos nada.
  if (data && String(data.website || '').trim() !== '') return json({ ok: true }, 200);

  const clean = (v, n) => (v == null ? '' : String(v)).slice(0, n);
  const name = clean(data.name, 200);
  const email = clean(data.email, 200);
  const sells = clean(data.sells, 200);
  const msg = clean(data.msg, 2000);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'bad_email' }, 400);

  const text =
    `Nuevo lead de shotpilot\n\n` +
    `Nombre: ${name || '-'}\n` +
    `Email: ${email}\n` +
    `Vende: ${sells || '-'}\n` +
    `Mensaje: ${msg || '-'}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'shotpilot <onboarding@resend.dev>',
      to: [to],
      reply_to: email,
      subject: `Lead shotpilot: ${name || email}`,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: 'send_failed', status: res.status, detail }, 502);
  }
  return json({ ok: true }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
