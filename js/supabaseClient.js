// Cliente Supabase compartido (auth + DB) — reusable por editor.html y las pantallas nuevas.
// Requiere que la página haya cargado antes el CDN de supabase-js (window.supabase).
// Extraído de editor.html (Prompt 1, refactor base). No cambia comportamiento.

export const SB_URL = 'https://ntybvdfyxesxpoukyqpf.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50eWJ2ZGZ5eGVzeHBvdWt5cXBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTk5NzcsImV4cCI6MjA5NzM3NTk3N30.txWMTF34NaN_NDVtcbgx_69kDSX4Bm9mBfJYf7PIvAw';
const STORAGE_KEY = 'sb-ntybvdfyxesxpoukyqpf-auth-token';

// Cliente único por página (singleton): evita "Multiple GoTrueClient instances"
// y el doble refresh de token cuando nav.js y el script de la página lo piden.
let _client = null;
export function createSupabase(){
  if (_client) return _client;
  if (!window.supabase){ console.error('supabase-js no cargado (falta el <script> del CDN)'); return null; }
  _client = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: STORAGE_KEY },
  });
  return _client;
}
