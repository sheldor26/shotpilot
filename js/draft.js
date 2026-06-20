// Borrador local del trabajo en progreso (IndexedDB).
// Value-first: un anónimo arma su galería, toca "login" (que redirige y recarga la
// página) y al volver NO pierde nada. Guarda blobs (recorte + original) + estado.
// Reusable por todas las pantallas. Cuando exista la tabla `galleries` (Prompt 3),
// este borrador local se sube a la cuenta al loguearse.

const DB_NAME = 'shotpilot', STORE = 'draft', KEY = 'current', VERSION = 1;

function openDB(){
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveDraft(data){
  try {
    const db = await openDB();
    await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(data, KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { console.warn('saveDraft', e); }
}

export async function loadDraft(){
  try {
    const db = await openDB();
    return await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get(KEY); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); });
  } catch (e) { return null; }
}

export async function clearDraft(){
  try {
    const db = await openDB();
    await new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(KEY); tx.oncomplete = res; tx.onerror = res; });
  } catch (e) {}
}
