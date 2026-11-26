// Conexión con Google (Calendar y Drive) desde el navegador, sin servidor propio.
// Usa Google Identity Services: el usuario autoriza una vez y Google da un
// permiso temporal (1 hora) que se renueva con un toque cuando caduca.

import { GOOGLE_CLIENT_ID, GOOGLE_CUENTA, NOMBRE_CALENDARIO, ZONA_HORARIA } from './config.js';

// Permisos: el calendario, y en Drive SOLO los archivos que cree la propia app.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
];
const SCOPE = SCOPES.join(' ');
const API = 'https://www.googleapis.com/calendar/v3';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
const CLAVE = 'somara.google';

export class ErrorConexion extends Error {
  constructor() { super('Hay que conectar con Google'); this.name = 'ErrorConexion'; }
}

// ---------- Sesión (permiso temporal) ----------
const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

let sesion = (() => { try { return JSON.parse(leer(CLAVE)) || null; } catch { return null; } })();
function guardarSesion(s) { sesion = s; escribir(CLAVE, s ? JSON.stringify(s) : null); }

// Conectado = permiso vigente y con todos los permisos actuales (si se añade uno nuevo, hay que reconectar).
export const conectado = () => !!sesion?.token && Date.now() < sesion.caduca - 60_000
  && SCOPES.every((s) => String(sesion.scope || '').split(' ').includes(s));
// ¿Se autorizó alguna vez en esta tablet? (Entonces reconectar es un solo toque.)
export const autorizadoAntes = () => leer(CLAVE + '.ok') === '1';

let promesaGIS = null;
export function precargar() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return (promesaGIS ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = res;
    s.onerror = () => { promesaGIS = null; rej(new Error('No se pudo contactar con Google. ¿Hay conexión a internet?')); };
    document.head.appendChild(s);
  }));
}

let enCurso = null;
// Debe llamarse desde un toque del usuario (Google abre una ventana).
// `forzar`: pide elegir cuenta de nuevo aunque ya haya un permiso vigente (recuperar el PIN).
export function conectar({ forzar = false } = {}) {
  if (conectado() && !forzar) return Promise.resolve();
  if (enCurso) return enCurso;
  enCurso = precargar().then(() => new Promise((res, rej) => {
    const cliente = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      login_hint: GOOGLE_CUENTA,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error_description || 'Google no dio permiso'));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES)) {
          return rej(new Error('Hay que marcar todos los permisos (calendario y archivos de Google Drive)'));
        }
        guardarSesion({ token: r.access_token, caduca: Date.now() + Number(r.expires_in) * 1000, scope: SCOPE });
        escribir(CLAVE + '.ok', '1');
        res();
        window.dispatchEvent(new Event('google-conectado'));
      },
      error_callback: (e) => rej(new Error(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google' : 'No se pudo abrir la ventana de Google')),
    });
    cliente.requestAccessToken({ prompt: forzar ? 'select_account' : (autorizadoAntes() ? '' : 'consent') });
  })).finally(() => { enCurso = null; });
  return enCurso;
}

export function desconectar() {
  if (sesion?.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(sesion.token, () => {});
  guardarSesion(null);
  escribir(CLAVE + '.ok', null);
}

// ---------- Llamadas a la API ----------
// `ruta` puede ser relativa a la API de Calendar o una dirección completa (Drive).
// `crudo` + `tipo` envían un cuerpo ya preparado (subida de archivos).
async function api(metodo, ruta, { query, cuerpo, crudo, tipo } = {}) {
  if (!conectado()) throw new ErrorConexion();
  const url = new URL(ruta.startsWith('https://') ? ruta : API + ruta);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
  const servicio = url.pathname.includes('/drive/') ? 'Google Drive' : 'Google Calendar';
  const headers = { Authorization: `Bearer ${sesion.token}` };
  if (cuerpo) headers['Content-Type'] = 'application/json';
  if (crudo) headers['Content-Type'] = tipo;
  let r;
  try {
    r = await fetch(url, { method: metodo, headers, body: crudo ?? (cuerpo ? JSON.stringify(cuerpo) : undefined) });
  } catch {
    throw new Error('Sin conexión a internet');
  }
  if (r.status === 401) { guardarSesion(null); throw new ErrorConexion(); }
  if (!r.ok) {
    let detalle = '';
    try { detalle = (await r.json()).error?.message || ''; } catch { /* sin cuerpo */ }
    const e = new Error(`Error de ${servicio} (${r.status})${detalle ? ': ' + detalle : ''}`);
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.json();
}

// Correo de la cuenta de Google conectada (el calendario principal se llama como la cuenta).
export async function correoCuenta() {
  return (await api('GET', '/calendars/primary')).id;
}

const ruta = (calId, evId) => `/calendars/${encodeURIComponent(calId)}/events${evId ? '/' + encodeURIComponent(evId) : ''}`;

// Devuelve el id del calendario «Citas Somara»; lo crea si no existe.
export async function calendarioSomara(idGuardado) {
  if (idGuardado) {
    try { await api('GET', `/calendars/${encodeURIComponent(idGuardado)}`); return idGuardado; }
    catch (e) { if (e.status !== 404 && e.status !== 403) throw e; }
  }
  let pageToken;
  do {
    const r = await api('GET', '/users/me/calendarList', { query: { minAccessRole: 'owner', pageToken } });
    const c = (r.items || []).find((x) => x.summary === NOMBRE_CALENDARIO);
    if (c) return c.id;
    pageToken = r.nextPageToken;
  } while (pageToken);
  const nuevo = await api('POST', '/calendars', { cuerpo: { summary: NOMBRE_CALENDARIO, timeZone: ZONA_HORARIA } });
  return nuevo.id;
}

export async function listarEventos(calId, desdeISO, hastaISO) {
  const items = [];
  let pageToken;
  do {
    const r = await api('GET', ruta(calId), {
      query: { timeMin: desdeISO, timeMax: hastaISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', pageToken },
    });
    items.push(...(r.items || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return items;
}

export const crearEvento = (calId, ev) => api('POST', ruta(calId), { cuerpo: ev });
export const actualizarEvento = (calId, id, ev) => api('PATCH', ruta(calId, id), { cuerpo: ev });
export async function borrarEvento(calId, id) {
  try { await api('DELETE', ruta(calId, id)); }
  catch (e) { if (e.status !== 404 && e.status !== 410) throw e; } // ya estaba borrado
}

// =====================================================================
// Google Drive (copias de seguridad)
// Con el permiso «drive.file» la app solo ve los archivos que ella misma crea.
// =====================================================================
const comillas = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Devuelve el id de la carpeta con ese nombre; la crea si no existe.
export async function carpetaDrive(nombre) {
  const q = `name='${comillas(nombre)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await api('GET', `${DRIVE}/files`, { query: { q, fields: 'files(id,name)', spaces: 'drive' } });
  if (r.files?.length) return r.files[0].id;
  const c = await api('POST', `${DRIVE}/files`, {
    query: { fields: 'id' },
    cuerpo: { name: nombre, mimeType: 'application/vnd.google-apps.folder' },
  });
  return c.id;
}

export function subirArchivoJSON(carpetaId, nombre, texto) {
  const limite = 'somara-' + Date.now().toString(36);
  const crudo = [
    `--${limite}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: nombre, parents: [carpetaId], mimeType: 'application/json' }),
    `--${limite}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    texto,
    `--${limite}--`,
  ].join('\r\n');
  return api('POST', `${DRIVE_SUBIDA}/files`, {
    query: { uploadType: 'multipart', fields: 'id,name,createdTime,size' },
    crudo, tipo: `multipart/related; boundary=${limite}`,
  });
}

// Archivos de una carpeta, del más reciente al más antiguo.
export async function listarArchivos(carpetaId) {
  const archivos = [];
  let pageToken;
  do {
    const r = await api('GET', `${DRIVE}/files`, {
      query: {
        q: `'${comillas(carpetaId)}' in parents and trashed=false`,
        orderBy: 'createdTime desc', fields: 'nextPageToken,files(id,name,createdTime,size)', pageSize: '100', pageToken,
      },
    });
    archivos.push(...(r.files || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return archivos;
}

export const descargarArchivoJSON = (id) => api('GET', `${DRIVE}/files/${encodeURIComponent(id)}`, { query: { alt: 'media' } });

export async function borrarArchivo(id) {
  try { await api('DELETE', `${DRIVE}/files/${encodeURIComponent(id)}`); }
  catch (e) { if (e.status !== 404) throw e; }
}
