// Función serverless (Vercel Edge) que recorta el producto con remove.bg.
// La API key vive SOLO acá (env REMOVEBG_API_KEY), nunca llega al navegador.
//
// Recibe: POST con la imagen como cuerpo binario (image/jpeg o image/png).
// Devuelve: PNG transparente del producto recortado (el navegador lo compone
// sobre fondo blanco a la medida exacta de cada plataforma).
export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const apiKey = process.env.REMOVEBG_API_KEY;
  if (!apiKey) return json({ error: 'missing_api_key' }, 500);

  let bytes;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return json({ error: 'bad_body' }, 400);
  }
  if (!bytes || bytes.byteLength === 0) return json({ error: 'no_image' }, 400);
  if (bytes.byteLength > 10 * 1024 * 1024) return json({ error: 'too_large' }, 413);

  // 'full' = máxima resolución (1 crédito). Si la cuenta no tiene créditos,
  // remove.bg responde 402 y abajo caemos a 'preview' (gratis, baja resolución).
  const wanted = process.env.RBG_SIZE || 'full';

  const call = (size) => {
    const form = new FormData();
    form.append('image_file', new Blob([bytes]), 'upload');
    form.append('size', size);
    // SIN crop: devolvemos el sujeto en su posición original (mismo encuadre que
    // la foto subida) para que el slider antes/después quede alineado. El recorte
    // y centrado a cuadrado los hace el navegador (bbox del canal alfa).
    form.append('format', 'png'); // transparente; el cliente lo pone sobre blanco
    return fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: form,
    });
  };

  let usedSize = wanted;
  let res = await call(wanted);
  // Sin créditos para alta resolución → caer a preview (gratis) para no romper el demo.
  if (!res.ok && res.status === 402 && wanted !== 'preview') {
    usedSize = 'preview';
    res = await call('preview');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: 'removebg_failed', status: res.status, detail }, 502);
  }

  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'X-Shotpilot-Size': usedSize,
    },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
