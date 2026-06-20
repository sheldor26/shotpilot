// Navegación compartida de ShotPilot — mobile-first.
// Mobile: bottom-nav fija (5 slots, "Crear" central destacado) + topbar con créditos.
// Desktop (>=768px): sidebar izquierda con los mismos nombres + Score + créditos/cuenta abajo.
// Mismo markup/JS en todas las páginas-shell. Se monta con mountNav({active}).

import { createSupabase } from '../supabaseClient.js';

const ICON = {
  inicio:  '<path d="M3 10.7 12 3.3l9 7.4"/><path d="M5.2 9.4V20.7h13.6V9.4"/>',
  galerias:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  crear:   '<path d="M12 5v14M5 12h14"/>',
  marca:   '<path d="M12 3.2 4.5 6.5v5c0 4.7 3.2 7.2 7.5 8.6 4.3-1.4 7.5-3.9 7.5-8.6v-5z"/><path d="m9 11.8 2 2 4-4"/>',
  score:   '<path d="M12 13l3.5-2.6"/><path d="M4.7 16a8 8 0 1 1 14.6 0z"/>',
  cuenta:  '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-3.6 3.5-5.6 7.5-5.6s7.5 2 7.5 5.6"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ''}</svg>`;

const ITEMS = [
  { key: 'inicio',   label: 'Inicio',   href: '/app' },
  { key: 'galerias', label: 'Galerías', href: '/galerias' },
  { key: 'crear',    label: 'Crear',    href: '/editor', center: true },
  { key: 'marca',    label: 'Mi marca', href: '/marca' },
  { key: 'score',    label: 'Score',    href: '/score', desktopOnly: true },
  { key: 'cuenta',   label: 'Cuenta',   href: '/cuenta' },
];

const CSS = `
:root{ --sp-coral:#F4513C; --sp-ink:#1A1614; --sp-soft:#5C524B; --sp-line:#E9DFD3; --sp-cream:#FBF7F2; --sp-side:232px; --sp-bottom:64px; --sp-top:54px; }
.sp-nav *{ box-sizing:border-box; }
.sp-nav a{ text-decoration:none; color:inherit; }
.sp-sidebar,.sp-bottomnav,.sp-topbar{ font-family:Manrope,system-ui,sans-serif; }
/* ---- sidebar (desktop) ---- */
.sp-sidebar{ position:fixed; top:0; left:0; bottom:0; width:var(--sp-side); background:#fff; border-right:1px solid var(--sp-line); display:none; flex-direction:column; padding:1.1rem .8rem; z-index:50; }
.sp-logo{ display:flex; align-items:center; gap:.5rem; font-weight:800; font-size:1.15rem; color:var(--sp-ink); padding:.1rem .4rem 1rem; }
.sp-logo b{ color:var(--sp-coral); }
.sp-crear-btn{ display:flex; align-items:center; justify-content:center; gap:.5rem; background:var(--sp-coral); color:#fff; font-weight:700; font-size:.95rem; padding:.7rem; border-radius:12px; margin-bottom:1rem; }
.sp-crear-btn svg{ width:20px; height:20px; }
.sp-side-items{ display:flex; flex-direction:column; gap:.2rem; flex:1; }
.sp-side-item{ display:flex; align-items:center; gap:.7rem; padding:.6rem .7rem; border-radius:10px; color:var(--sp-soft); font-weight:600; font-size:.92rem; }
.sp-side-item svg{ width:21px; height:21px; }
.sp-side-item:hover{ background:var(--sp-cream); color:var(--sp-ink); }
.sp-side-item.active{ background:#FAECE7; color:var(--sp-coral); }
.sp-side-foot{ border-top:1px solid var(--sp-line); padding-top:.7rem; display:flex; flex-direction:column; gap:.2rem; }
.sp-cred{ display:flex; align-items:center; justify-content:space-between; padding:.55rem .7rem; border-radius:10px; background:var(--sp-cream); font-size:.85rem; font-weight:700; color:var(--sp-ink); }
.sp-cred span{ color:var(--sp-soft); font-weight:600; }
/* ---- bottom-nav (mobile) ---- */
.sp-bottomnav{ position:fixed; left:0; right:0; bottom:0; height:var(--sp-bottom); background:#fff; border-top:1px solid var(--sp-line); display:flex; align-items:center; justify-content:space-around; z-index:50; padding-bottom:env(safe-area-inset-bottom); }
.sp-tab{ flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; color:var(--sp-soft); font-size:.66rem; font-weight:600; padding:.3rem 0; }
.sp-tab svg{ width:23px; height:23px; }
.sp-tab.active{ color:var(--sp-coral); }
.sp-tab.center{ flex:0 0 auto; }
.sp-tab.center .sp-fab{ width:52px; height:52px; margin-top:-22px; border-radius:50%; background:var(--sp-coral); color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 20px rgba(244,81,60,.4); }
.sp-tab.center .sp-fab svg{ width:26px; height:26px; }
.sp-tab.center span{ color:var(--sp-coral); margin-top:2px; }
/* ---- topbar (mobile) ---- */
.sp-topbar{ position:fixed; top:0; left:0; right:0; height:var(--sp-top); background:rgba(255,255,255,.92); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); border-bottom:1px solid var(--sp-line); display:flex; align-items:center; justify-content:space-between; padding:0 1rem; z-index:49; }
.sp-topbar .sp-logo{ padding:0; font-size:1.05rem; }
.sp-chip{ font-size:.82rem; font-weight:700; color:var(--sp-ink); background:var(--sp-cream); border:1px solid var(--sp-line); border-radius:999px; padding:.35rem .7rem; }
/* ---- reservar espacio en el body ---- */
body{ padding-bottom:calc(var(--sp-bottom) + env(safe-area-inset-bottom)); padding-top:var(--sp-top); }
@media(min-width:768px){
  body{ padding-bottom:0; padding-top:0; padding-left:var(--sp-side); }
  .sp-sidebar{ display:flex; }
  .sp-bottomnav,.sp-topbar{ display:none; }
}
`;

function injectCss(){
  if (document.getElementById('sp-nav-css')) return;
  const s = document.createElement('style'); s.id = 'sp-nav-css'; s.textContent = CSS;
  document.head.appendChild(s);
}

function logo(){ return `<span class="sp-logo">shot<b>pilot</b></span>`; }

function buildSidebar(active){
  const crear = ITEMS.find(i => i.center);
  const mid = ITEMS.filter(i => !i.center && i.key !== 'cuenta');   // Inicio, Galerías, Marca, Score
  const items = mid.map(i =>
    `<a class="sp-side-item${i.key === active ? ' active' : ''}" href="${i.href}">${svg(i.key)}<span>${i.label}</span></a>`
  ).join('');
  const el = document.createElement('aside'); el.className = 'sp-nav sp-sidebar';
  el.innerHTML = `${logo()}
    <a class="sp-crear-btn" href="${crear.href}">${svg('crear')}<span>Crear</span></a>
    <nav class="sp-side-items">${items}</nav>
    <div class="sp-side-foot">
      <a class="sp-cred" href="/cuenta"><span>Créditos</span><b data-sp-credits>—</b></a>
      <a class="sp-side-item${active === 'cuenta' ? ' active' : ''}" href="/cuenta">${svg('cuenta')}<span data-sp-auth>Cuenta</span></a>
    </div>`;
  document.body.appendChild(el);
}

function buildBottomNav(active){
  const el = document.createElement('nav'); el.className = 'sp-nav sp-bottomnav';
  el.innerHTML = ITEMS.filter(i => !i.desktopOnly).map(i => {
    if (i.center) return `<a class="sp-tab center" href="${i.href}"><span class="sp-fab">${svg('crear')}</span><span>${i.label}</span></a>`;
    return `<a class="sp-tab${i.key === active ? ' active' : ''}" href="${i.href}">${svg(i.key)}<span>${i.label}</span></a>`;
  }).join('');
  document.body.appendChild(el);
}

function buildTopbar(){
  const el = document.createElement('header'); el.className = 'sp-nav sp-topbar';
  el.innerHTML = `${logo()}<a class="sp-chip" href="/cuenta" data-sp-credits>—</a>`;
  document.body.appendChild(el);
}

async function loadCredits(sb){
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session){
      document.querySelectorAll('[data-sp-credits]').forEach(e => { e.textContent = 'Entrar'; });
      document.querySelectorAll('[data-sp-auth]').forEach(e => { e.textContent = 'Entrar'; });
      return;
    }
    document.querySelectorAll('[data-sp-auth]').forEach(e => { e.textContent = (session.user.email || 'Cuenta').split('@')[0]; });
    const { data } = await sb.from('profiles').select('credits').eq('id', session.user.id).single();
    const c = data ? data.credits : 0;
    document.querySelectorAll('[data-sp-credits]').forEach(e => { e.textContent = c; });
  } catch (e) { /* sin sesión / sin red: dejamos los placeholders */ }
}

export async function mountNav({ active = '', supabase = null } = {}){
  injectCss();
  buildSidebar(active);
  buildBottomNav(active);
  buildTopbar();
  loadCredits(supabase || createSupabase());
}
