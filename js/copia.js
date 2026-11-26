// Copias de seguridad en Google Drive.
//
// Cada día, a partir de HORA_COPIA (20:00), la primera vez que la app esté
// abierta se sube sola una copia a la carpeta «Copias Somara» de Google Drive.
// Si ese día no se pudo (sin internet o sin sesión de Google), queda pendiente y
// se muestra un aviso para hacerla con un toque. Se conservan las últimas 30.
//
// Incluye ventas, clientes, catálogo y ajustes. Las citas no, porque ya viven
// en Google Calendar.

import { db } from './db.js';
import * as G from './google.js';
import { HORA_COPIA, COPIAS_A_CONSERVAR, NOMBRE_CARPETA_COPIAS } from './config.js';
import { $, esc, aviso, confirmar, isoDe, hhmm, mayuscula } from './ui.js';

const COLECCIONES = ['categorias', 'articulos', 'clientes', 'ventas', 'ajustes'];
// Ajustes propios de esta tablet que no se copian ni se sobrescriben al restaurar.
const AJUSTES_LOCALES = ['ultimaCopia', 'carpetaCopias', 'calendarId', 'pin', 'pinIntentos'];

let carpetaId = null;
let enCurso = null;
let ultimoError = '';

// ---------- Cuándo toca copia ----------
// El último momento «de copia» ya pasado: hoy a las 20:00 o, si aún no son, ayer a las 20:00.
function momentoDebido(ahora = new Date()) {
  const m = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, HORA_COPIA);
  if (ahora < m) m.setDate(m.getDate() - 1);
  return m;
}
async function copiaPendiente() {
  const ultima = await db.ajuste('ultimaCopia');
  return !ultima || new Date(ultima) < momentoDebido();
}

// ---------- Generar, subir y restaurar ----------
async function generarCopia() {
  const datos = await db.exportar(COLECCIONES);
  datos.ajustes = datos.ajustes.filter((a) => !AJUSTES_LOCALES.includes(a.clave));
  return { app: 'somara', version: 1, fecha: new Date().toISOString(), datos };
}

function nombreArchivo(d = new Date()) {
  return `Somara copia ${isoDe(d)} ${hhmm(d.getHours() * 60 + d.getMinutes()).replace(':', 'h')}.json`;
}

async function carpeta() {
  if (carpetaId) return carpetaId;
  carpetaId = (await db.ajuste('carpetaCopias')) || await G.carpetaDrive(NOMBRE_CARPETA_COPIAS);
  await db.guardarAjuste('carpetaCopias', carpetaId);
  return carpetaId;
}
async function olvidarCarpeta() { carpetaId = null; await db.guardarAjuste('carpetaCopias', null); }

// Sube una copia a Drive y borra las que sobran. Requiere estar conectado.
export function hacerCopia() {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    const texto = JSON.stringify(await generarCopia());
    let archivo;
    try {
      archivo = await G.subirArchivoJSON(await carpeta(), nombreArchivo(), texto);
    } catch (e) {
      if (e.status !== 404) throw e;
      await olvidarCarpeta(); // la carpeta se borró desde Drive: se crea otra
      archivo = await G.subirArchivoJSON(await carpeta(), nombreArchivo(), texto);
    }
    await db.guardarAjuste('ultimaCopia', new Date().toISOString());
    ultimoError = '';
    try {
      const sobran = (await G.listarArchivos(await carpeta())).slice(COPIAS_A_CONSERVAR);
      for (const f of sobran) await G.borrarArchivo(f.id);
    } catch { /* limpiar es secundario */ }
    return archivo;
  })().finally(() => { enCurso = null; });
  return enCurso;
}

function esCopiaValida(c) {
  return c && c.app === 'somara' && c.datos && COLECCIONES.every((k) => Array.isArray(c.datos[k]));
}

async function restaurar(copia) {
  if (!esCopiaValida(copia)) throw new Error('El archivo no es una copia de seguridad de Somara.');
  await db.importar(copia.datos, AJUSTES_LOCALES);
  location.reload();
}

// ---------- Comprobación automática ----------
export async function comprobarCopia() {
  if (!(await copiaPendiente())) { pintarBanner(false); return; }
  if (G.conectado()) {
    try {
      await hacerCopia();
      pintarBanner(false);
      aviso('Copia de seguridad guardada en Google Drive');
      if (vistaAbierta()) pintarCopias();
      return;
    } catch (e) {
      ultimoError = e instanceof G.ErrorConexion ? '' : e.message;
    }
  }
  pintarBanner(true);
}

function pintarBanner(visible) {
  const b = $('#banner-copia');
  b.hidden = !visible;
  if (!visible) return;
  $('#banner-copia-texto').textContent = ultimoError
    ? `No se pudo hacer la copia de seguridad: ${ultimoError}`
    : 'Copia de seguridad de hoy pendiente.';
}

// Botón del aviso: conecta si hace falta (abre la ventana de Google) y hace la copia.
async function copiaManual(boton) {
  const texto = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    await G.conectar();
    await hacerCopia();
    pintarBanner(false);
    aviso('Copia de seguridad guardada en Google Drive');
  } catch (e) {
    ultimoError = e.message;
    if (!$('#banner-copia').hidden) pintarBanner(true);
    aviso(e.message);
  }
  boton.disabled = false;
  boton.textContent = texto;
  if (vistaAbierta()) pintarCopias();
}

// =====================================================================
// Apartado «Copias de seguridad»
// =====================================================================
const vistaAbierta = () => $('#vista-copias').classList.contains('activa');
const fechaHora = (iso) => new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const tamano = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function textoProxima() {
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, HORA_COPIA);
  return ahora < hoy ? `Hoy a partir de las ${hhmm(HORA_COPIA)}` : `Mañana a partir de las ${hhmm(HORA_COPIA)}`;
}

export async function pintarCopias() {
  const ultima = await db.ajuste('ultimaCopia');
  const pendiente = await copiaPendiente();
  $('#copias-estado').innerHTML = [
    ['Última copia', ultima ? mayuscula(fechaHora(ultima)) : 'Todavía ninguna'],
    ['Próxima copia automática', pendiente ? 'Pendiente (pulsa «Hacer copia ahora»)' : textoProxima()],
    ['Google Drive', G.conectado() ? 'Conectado' : 'Sin conectar'],
  ].map(([e, v]) => `<div class="tarjeta-dato"><div class="etq">${e}</div><div class="val val-texto">${esc(v)}</div></div>`).join('');

  const lista = $('#lista-copias');
  if (!G.conectado()) {
    lista.innerHTML = `<li class="ayuda">Para ver las copias guardadas en Google Drive hay que conectar con Google.
      <button type="button" class="btn-secundario" data-acc="conectar" style="margin-left:8px">Conectar con Google</button></li>`;
    return;
  }
  lista.innerHTML = '<li class="ayuda">Cargando copias…</li>';
  try {
    const archivos = await G.listarArchivos(await carpeta());
    lista.innerHTML = archivos.length ? archivos.map((f) => `
      <li class="copia">
        <span class="det"><strong>${esc(mayuscula(fechaHora(f.createdTime)))}</strong>
          <small>${esc(f.name)}${f.size ? ` · ${tamano(Number(f.size))}` : ''}</small></span>
        <button type="button" class="btn-secundario" data-restaurar="${esc(f.id)}" data-fecha="${esc(fechaHora(f.createdTime))}">Restaurar</button>
      </li>`).join('') : '<li class="ayuda">Todavía no hay copias en Google Drive.</li>';
  } catch (e) {
    if (e.status === 404) { await olvidarCarpeta(); return pintarCopias(); }
    lista.innerHTML = `<li class="ayuda error-estado">${esc(e instanceof G.ErrorConexion ? 'La conexión con Google ha caducado.' : e.message)}</li>`;
  }
}

function descargarCopiaLocal(copia) {
  const blob = new Blob([JSON.stringify(copia, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const AVISO_RESTAURAR = 'Se sustituirán las ventas, los clientes y el catálogo de esta tablet por los de la copia. Las citas no se tocan.';

export function montarCopias() {
  $('#banner-copia-btn').onclick = (e) => copiaManual(e.currentTarget);
  $('#copia-ahora').onclick = (e) => copiaManual(e.currentTarget);

  $('#lista-copias').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.acc === 'conectar') {
      try { await G.conectar(); } catch (err) { aviso(err.message); }
      pintarCopias();
      return;
    }
    if (b.dataset.restaurar) {
      if (!(await confirmar(`¿Restaurar la copia del ${b.dataset.fecha}? ${AVISO_RESTAURAR} Antes se guardará una copia del estado actual, por si acaso.`, 'Restaurar'))) return;
      try {
        aviso('Guardando el estado actual y restaurando…');
        await hacerCopia(); // copia de seguridad «por si acaso» antes de restaurar
        await restaurar(await G.descargarArchivoJSON(b.dataset.restaurar));
      } catch (err) { aviso(err.message); }
    }
  };

  $('#copia-descargar').onclick = async () => {
    descargarCopiaLocal(await generarCopia());
    aviso('Copia descargada en la carpeta «Descargas» de la tablet');
  };
  $('#copia-archivo').onchange = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    let copia;
    try { copia = JSON.parse(await archivo.text()); } catch { return aviso('El archivo no se puede leer.'); }
    if (!esCopiaValida(copia)) return aviso('El archivo no es una copia de seguridad de Somara.');
    const fecha = fechaHora(copia.fecha);
    if (!(await confirmar(`¿Restaurar la copia del ${fecha}? ${AVISO_RESTAURAR}`, 'Restaurar'))) return;
    try {
      descargarCopiaLocal(await generarCopia()); // por si acaso, se descarga antes el estado actual
      await restaurar(copia);
    } catch (err) { aviso(err.message); }
  };

  // Comprobaciones automáticas: al abrir, cada 5 minutos, al volver a la app y al conectar con Google.
  comprobarCopia();
  setInterval(comprobarCopia, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') comprobarCopia(); });
  window.addEventListener('google-conectado', () => comprobarCopia());
}
