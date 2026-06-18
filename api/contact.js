// Recibe el formulario de contacto: guarda el lead en Supabase y le manda
// el mail de bienvenida en su idioma (vía Brevo). Los secretos van en env vars:
//   SUPABASE_URL               → https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  → service_role key (Supabase → Settings → API)
//   BREVO_API_KEY              → clave de Brevo (Brevo → SMTP & API → API Keys)
//   MAIL_FROM_EMAIL (opcional) → remitente; default "hola@shotpilot.app"
//   MAIL_FROM_NAME  (opcional) → nombre del remitente; default "shotpilot"
//   MAIL_REPLY_TO   (opcional) → a dónde van las respuestas del lead (tu mail real)
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
  const lang = clean(data.lang, 10) === 'en' ? 'en' : 'es';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'bad_email' }, 400);

  // 1) Guardar el lead (esto es lo crítico: si falla, devolvemos error).
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

  // 2) Mail de bienvenida (best-effort: si falla, el lead igual quedó guardado).
  await sendWelcome({ name, email, lang }).catch((e) =>
    console.warn('shotpilot: lead guardado pero el mail de bienvenida falló:', e && e.message)
  );

  return json({ ok: true }, 200);
}

async function sendWelcome({ name, email, lang }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return; // sin clave, no mandamos nada (el lead ya está guardado)

  const fromEmail = process.env.MAIL_FROM_EMAIL || 'hola@shotpilot.app';
  const fromName = process.env.MAIL_FROM_NAME || 'shotpilot';
  const replyTo = process.env.MAIL_REPLY_TO || undefined;
  const firstName = (name || '').split(' ')[0];
  const copy = welcomeCopy(lang, firstName);

  const body = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email, name: name || undefined }],
    subject: copy.subject,
    textContent: copy.text,
  };
  if (replyTo) body.replyTo = { email: replyTo };

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`brevo ${r.status} ${detail}`);
  }
}

function welcomeCopy(lang, firstName) {
  if (lang === 'en') {
    const hi = firstName ? `Hi ${firstName},` : 'Hi,';
    return {
      subject: 'Your 5 free photos are ready — shotpilot',
      text:
        `${hi}\n\n` +
        `You're in. Filling out the form is all it takes — your first 5 photos are free, no card needed.\n\n` +
        `Redeem them here:\n` +
        `https://shotpilot.app/editor.html?lang=en\n\n` +
        `Snap the photo with your phone and we send it back on a clean white background, ` +
        `sized for wherever you sell. You never open an editor.\n\n` +
        `Any questions, just reply to this email.\n\n` +
        `Cheers,\nJuan — shotpilot`,
    };
  }
  const hola = firstName ? `Hola ${firstName},` : 'Hola,';
  return {
    subject: 'Tus 5 fotos gratis ya están listas — shotpilot',
    text:
      `${hola}\n\n` +
      `Listo, quedaste registrado. Con completar el formulario ya tenés tus primeras 5 fotos gratis, sin tarjeta.\n\n` +
      `Usalas acá:\n` +
      `https://shotpilot.app/editor.html\n\n` +
      `Sacás la foto con el celular y te la devolvemos con fondo blanco, en la medida exacta ` +
      `de donde vendas. Vos no tocás ningún editor.\n\n` +
      `Cualquier duda, respondé este mail.\n\n` +
      `Abrazo,\nJuan — shotpilot`,
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
