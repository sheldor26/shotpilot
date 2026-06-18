// Prueba local de remove.bg sobre una foto real.
// La clave se lee de la variable de entorno REMOVEBG_API_KEY (no se hardcodea
// ni se commitea). Uso:
//   REMOVEBG_API_KEY=tu_clave node scripts/test-removebg.mjs vestido-fiesta.png salida-blanco.png
//
// size:
//   'preview' = gratis (baja resolución, sirve para juzgar calidad)
//   'auto' / 'full' = alta resolución, CONSUME créditos de tu cuenta
import { readFileSync, writeFileSync } from 'node:fs';

const apiKey = process.env.REMOVEBG_API_KEY;
const input = process.argv[2] || 'vestido-fiesta.png';
const output = process.argv[3] || 'salida-blanco.png';
const size = process.env.RBG_SIZE || 'preview';

if (!apiKey) {
  console.error('Falta la clave. Corré:  REMOVEBG_API_KEY=tu_clave node scripts/test-removebg.mjs');
  process.exit(1);
}

const form = new FormData();
form.append('image_file', new Blob([readFileSync(input)]), input);
form.append('size', size);
form.append('bg_color', 'ffffff'); // fondo blanco directo (sin esto, da PNG transparente)
form.append('format', 'png');

const res = await fetch('https://api.remove.bg/v1.0/removebg', {
  method: 'POST',
  headers: { 'X-Api-Key': apiKey },
  body: form,
});

if (!res.ok) {
  console.error('Error', res.status, await res.text());
  process.exit(1);
}

writeFileSync(output, Buffer.from(await res.arrayBuffer()));
console.log(`Listo → ${output}  (size=${size})`);
console.log('Créditos restantes:', res.headers.get('x-credits-charged'), '| este request gastó:', res.headers.get('x-credits-charged') ?? '0 (preview)');
