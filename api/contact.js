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
  // .trim() saca espacios/saltos de línea que se cuelan al pegar la clave en Vercel.
  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) return; // sin clave, no mandamos nada (el lead ya está guardado)

  const fromEmail = (process.env.MAIL_FROM_EMAIL || 'hola@shotpilot.app').trim();
  const fromName = (process.env.MAIL_FROM_NAME || 'shotpilot').trim();
  const replyTo = (process.env.MAIL_REPLY_TO || '').trim() || undefined;
  const firstName = (name || '').split(' ')[0];
  const copy = welcomeCopy(lang, firstName);

  const body = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email, name: name || undefined }],
    subject: copy.subject,
    htmlContent: copy.html,
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
    const editorUrl = 'https://shotpilot.app/editor.html?lang=en';
    return {
      subject: 'Your 5 free photos are ready — shotpilot',
      text:
        `${hi}\n\n` +
        `You're in. Filling out the form is all it takes — your first 5 photos are free, no card needed.\n\n` +
        `Redeem them here:\n` +
        `${editorUrl}\n\n` +
        `Snap the photo with your phone and we send it back on a clean white background, ` +
        `sized for wherever you sell. You never open an editor.\n\n` +
        `Any questions, just reply to this email.\n\n` +
        `Cheers,\nJuan — shotpilot`,
      html: emailHtml({
        greeting: hi,
        heading: 'Your 5 free photos are ready',
        lead: `You're in. Filling out the form is all it takes — your first <strong style="color:#1A1614;">5 photos are free</strong>, no card needed.`,
        cta: 'Upload my first photo',
        editorUrl,
        body: `Snap the photo with your phone and we send it back on a clean white background, sized for wherever you sell. You never open an editor.`,
        reply: 'Any questions, just reply to this email.',
        signoff: 'Cheers,',
        tagline: 'Product photos on autopilot',
      }),
    };
  }
  const hola = firstName ? `Hola ${firstName},` : 'Hola,';
  const editorUrl = 'https://shotpilot.app/editor.html';
  return {
    subject: 'Tus 5 fotos gratis ya están listas — shotpilot',
    text:
      `${hola}\n\n` +
      `Listo, quedaste registrado. Con completar el formulario ya tenés tus primeras 5 fotos gratis, sin tarjeta.\n\n` +
      `Usalas acá:\n` +
      `${editorUrl}\n\n` +
      `Sacás la foto con el celular y te la devolvemos con fondo blanco, en la medida exacta ` +
      `de donde vendas. Vos no tocás ningún editor.\n\n` +
      `Cualquier duda, respondé este mail.\n\n` +
      `Abrazo,\nJuan — shotpilot`,
    html: emailHtml({
      greeting: hola,
      heading: 'Tus 5 fotos gratis ya están listas',
      lead: `Listo, quedaste registrado. Con completar el formulario ya tenés tus primeras <strong style="color:#1A1614;">5 fotos gratis</strong>, sin tarjeta.`,
      cta: 'Subir mi primera foto',
      editorUrl,
      body: `Sacás la foto con el celular y te la devolvemos con fondo blanco, en la medida exacta de donde vendas. Vos no tocás ningún editor.`,
      reply: 'Cualquier duda, respondé este mail.',
      signoff: 'Un abrazo,',
      tagline: 'Fotos de producto en piloto automático',
    }),
  };
}

// Plantilla HTML del mail (tablas + estilos inline = compatible con Gmail/Outlook).
function emailHtml(c) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="x-ua-compatible" content="ie=edge"></head>
<body style="margin:0;padding:0;background:#FBF7F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7F2;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E9DFD3;border-radius:16px;">
<tr><td style="padding:28px 32px 0 32px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:20px;font-weight:800;color:#1A1614;letter-spacing:-0.02em;">shotpilot<span style="color:#F4513C;">.</span></td></tr>
<tr><td style="padding:20px 32px 4px 32px;font-family:'Helvetica Neue',Arial,sans-serif;">
<h1 style="margin:0 0 18px 0;font-size:24px;line-height:1.25;color:#1A1614;font-weight:800;letter-spacing:-0.02em;">${c.heading}</h1>
<p style="margin:0 0 14px 0;font-size:16px;line-height:1.6;color:#5C524B;">${c.greeting}</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#5C524B;">${c.lead}</p>
</td></tr>
<tr><td style="padding:0 32px 24px 32px;" align="left">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#F4513C;">
<a href="${c.editorUrl}" style="display:inline-block;padding:14px 30px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">${c.cta}&nbsp;&rarr;</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 8px 32px;font-family:'Helvetica Neue',Arial,sans-serif;">
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.6;color:#5C524B;">${c.body}</p>
<p style="margin:0 0 26px 0;font-size:16px;line-height:1.6;color:#5C524B;">${c.reply}</p>
<p style="margin:0;font-size:16px;line-height:1.6;color:#1A1614;">${c.signoff}<br><strong>Juan</strong> &mdash; shotpilot</p>
</td></tr>
<tr><td style="padding:24px 32px;border-top:1px solid #E9DFD3;font-family:'Helvetica Neue',Arial,sans-serif;">
<p style="margin:0;font-size:13px;line-height:1.5;color:#8A7F77;">shotpilot &middot; ${c.tagline}<br><a href="https://shotpilot.app" style="color:#D8381F;text-decoration:none;">shotpilot.app</a></p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
