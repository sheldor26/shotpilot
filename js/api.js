// js/api.js — llamadas al motor FastAPI (Railway). Reusable por todas las pantallas.
// Wrapper fino: centraliza URL + método + Authorization. El manejo de la respuesta
// (leer blob, headers, .json(), status) queda en quien llama, igual que en editor.html.
// `base` = la URL del motor (editor.html la calcula con ?motor= para testear).

export function motorFetch(base, path, { method = 'POST', body = null, token = null } = {}){
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(base + path, { method, headers, body });
}

// Helpers por endpoint — mismos parámetros que hoy:
export const removeBg  = (base, fd)        => motorFetch(base, '/remove',    { body: fd });
export const spend     = (base, token, fd) => motorFetch(base, '/spend',     { token, body: fd });
export const inpaint   = (base, fd)        => motorFetch(base, '/inpaint',   { body: fd });
export const lifestyle = (base, token, fd) => motorFetch(base, '/lifestyle', { token, body: fd });
export const getPacks  = (base)            => motorFetch(base, '/packs',     { method: 'GET' });
export const checkout  = (base, token, fd) => motorFetch(base, '/checkout',  { token, body: fd });
