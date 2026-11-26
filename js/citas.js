// Apartado «Citas»: agenda diaria sincronizada con Google Calendar,
// formulario de citas y recordatorios por WhatsApp para el día siguiente.
//
// Google Calendar es el lugar donde «viven» las citas. La app guarda una copia
// en la tablet para poder verlas sin conexión, pero crear, mover o borrar una
// cita necesita internet (así nunca hay dos versiones distintas).

import { db } from './db.js';
import * as G from './google.js';
import {
  EMPLEADAS, HORARIO, AGENDA_DESDE, AGENDA_HASTA, DURACION_POR_DEFECTO, ZONA_HORARIA,
  GOOGLE_CUENTA, mensajeRecordatorio,
} from './config.js';
import {
  $, esc, aviso, abrirModal, confirmar, isoDe, hoyISO, mayuscula, fechaDeISO,
  iniciales, fmtTelefono, textoDuracion, opcionesDuracion, hhmm,
} from './ui.js';

const PX = 1.6; // píxeles por minuto en la agenda (15 min = 24 px)
const SIN_ASIGNAR = { id: '', nombre: 'Sin asignar', color: '#8a7d84' };

let ctx = null; // { estado, clientePorId, abrirEditorCliente, cobrarCita }
const st = { dia: hoyISO(), calId: null, ultimaSync: null, error: '', sincronizando: false, scrollHecho: '' };

// ---------- Utilidades de fecha ----------
const minDe = (d) => d.getHours() * 60 + d.getMinutes();
const fechaConMin = (iso, min) => { const d = fechaDeISO(iso); d.setMinutes(min); return d; };
const sumarDias = (iso, n) => { const d = fechaDeISO(iso); d.setDate(d.getDate() + n); return isoDe(d); };
const opcFechaLarga = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
const textoHorario = () => HORARIO.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(' y ');
const dentroDeHorario = (ini, fin) => HORARIO.some(([a, b]) => ini >= a && fin <= b);
const empleada = (id) => EMPLEADAS.find((e) => e.id === id) || SIN_ASIGNAR;

const nombreCliente = (c) => (c.clienteId && ctx.clientePorId(c.clienteId)?.nombre) || c.clienteNombre || c.titulo;
const telefonoCliente = (c) => (c.clienteId && ctx.clientePorId(c.clienteId)?.telefono) || c.telefono || '';

function articuloPor(id, nombre) {
  const arts = ctx.estado.articulos;
  return (id && arts.find((a) => a.id === id)) || arts.find((a) => a.nombre.toLowerCase() === String(nombre).toLowerCase());
}

// =====================================================================
// Conversión entre evento de Google Calendar y cita de la app
// =====================================================================
function clientePorTitulo(titulo) {
  const t = titulo.toLowerCase();
  return ctx.estado.clientes
    .filter((c) => t.startsWith(c.nombre.toLowerCase()))
    .sort((a, b) => b.nombre.length - a.nombre.length)[0];
}

function eventoACita(ev) {
  const p = ev.extendedProperties?.private || {};
  const todoElDia = !!ev.start?.date;
  const inicio = todoElDia ? fechaDeISO(ev.start.date) : new Date(ev.start.dateTime);
  const fin = todoElDia ? fechaDeISO(ev.end.date) : new Date(ev.end.dateTime);
  const titulo = ev.summary || '(Sin título)';

  // La empleada sale del color del evento (así se puede cambiar desde Google Calendar).
  const porColor = EMPLEADAS.find((e) => e.colorId === ev.colorId);
  const emp = porColor || EMPLEADAS.find((e) => e.id === p.empleada);

  // Cliente: el guardado por la app o, si la cita se creó en Google, por el título.
  let clienteId = p.clienteId || null;
  if (!clienteId && !p.somara) clienteId = clientePorTitulo(titulo)?.id || null;

  const [parteNombre, ...resto] = titulo.split(/\s+[-–·]\s+/);
  let tratamientos = [];
  let tratamientoIds = [];
  try { tratamientos = JSON.parse(p.tratamientos || '[]'); tratamientoIds = JSON.parse(p.tratamientoIds || '[]'); } catch { /* datos antiguos */ }
  if (!p.somara && resto.length) tratamientos = resto.join(' - ').split(/\s*,\s*/).filter(Boolean);

  const telDescripcion = (ev.description || '').match(/(\+?\d[\d\s]{7,}\d)/)?.[1] || '';
  return {
    id: ev.id,
    inicio: inicio.toISOString(),
    fin: fin.toISOString(),
    todoElDia,
    titulo,
    empleada: emp?.id || '',
    clienteId,
    clienteNombre: p.clienteNombre || parteNombre,
    telefono: p.telefono || telDescripcion,
    tratamientos,
    tratamientoIds,
    notas: p.somara ? (p.notas || '') : (ev.description || ''),
    recordatorio: p.recordatorio || '',
    deSomara: !!p.somara,
    enlace: ev.htmlLink || '',
  };
}

function citaAEvento(c) {
  const emp = EMPLEADAS.find((e) => e.id === c.empleada);
  const trat = c.tratamientos.join(', ');
  return {
    summary: `${c.clienteNombre} - ${trat}`,
    description: [
      `Cliente: ${c.clienteNombre}`,
      c.telefono && `Teléfono: ${c.telefono}`,
      `Tratamiento: ${trat}`,
      emp && `Atiende: ${emp.nombre}`,
      c.notas && `Notas: ${c.notas}`,
    ].filter(Boolean).join('\n'),
    start: { dateTime: c.inicio, timeZone: ZONA_HORARIA },
    end: { dateTime: c.fin, timeZone: ZONA_HORARIA },
    colorId: emp?.colorId,
    extendedProperties: {
      private: {
        somara: '1',
        clienteId: c.clienteId || '',
        clienteNombre: c.clienteNombre,
        telefono: c.telefono || '',
        tratamientos: JSON.stringify(c.tratamientos),
        tratamientoIds: JSON.stringify(c.tratamientoIds || []),
        empleada: c.empleada || '',
        notas: c.notas || '',
        recordatorio: c.recordatorio || '',
      },
    },
  };
}

// =====================================================================
// Copia local y sincronización
// =====================================================================
async function citasEntre(desdeIso, hastaIsoExclusivo) {
  const desde = fechaDeISO(desdeIso).toISOString();
  const hasta = new Date(+fechaDeISO(hastaIsoExclusivo) - 1).toISOString();
  return (await db.entre('citas', 'inicio', desde, hasta)).sort((a, b) => a.inicio.localeCompare(b.inicio));
}
const citasDelDia = (iso) => citasEntre(iso, sumarDias(iso, 1));

async function asegurarCalendario() {
  if (st.calId) return st.calId;
  st.calId = await G.calendarioSomara(await db.ajuste('calendarId'));
  await db.guardarAjuste('calendarId', st.calId);
  return st.calId;
}

// Debe llamarse desde un toque (puede abrir la ventana de Google).
async function asegurarConexion() {
  if (!G.conectado()) await G.conectar();
  await asegurarCalendario();
}

// Trae de Google las citas entre dos días (el segundo no incluido) y actualiza la copia local.
async function sincronizar(desdeIso, hastaIsoExclusivo) {
  if (!G.conectado()) return false;
  const cal = await asegurarCalendario();
  const desde = fechaDeISO(desdeIso).toISOString();
  const hasta = fechaDeISO(hastaIsoExclusivo).toISOString();
  const eventos = await G.listarEventos(cal, desde, hasta);
  for (const c of await citasEntre(desdeIso, hastaIsoExclusivo)) await db.borrar('citas', c.id);
  for (const ev of eventos) await db.guardar('citas', eventoACita(ev));
  st.ultimaSync = new Date();
  st.error = '';
  return true;
}

function manejarError(e) {
  st.error = e instanceof G.ErrorConexion ? '' : e.message;
}

// =====================================================================
// Pintado de la vista
// =====================================================================
export async function pintarCitas({ sync = true } = {}) {
  G.precargar().catch(() => {});
  $('#cita-fecha').value = st.dia;
  $('#cita-titulo').textContent = mayuscula(fechaDeISO(st.dia).toLocaleDateString('es-ES', opcFechaLarga));
  $('#cita-hoy').classList.toggle('activo', st.dia === hoyISO());
  await pintarAgenda();
  pintarEstado();
  actualizarBadge();

  if (sync && G.conectado() && !st.sincronizando) {
    st.sincronizando = true;
    pintarEstado();
    try {
      const manana = sumarDias(hoyISO(), 1);
      await sincronizar(st.dia, sumarDias(st.dia, 2)); // el día visto y el siguiente
      if (st.dia !== hoyISO() && st.dia !== manana) await sincronizar(manana, sumarDias(manana, 1)); // para los recordatorios
    } catch (e) {
      manejarError(e);
    }
    st.sincronizando = false;
    await pintarAgenda();
    pintarEstado();
    actualizarBadge();
  }
}

function pintarEstado() {
  const el = $('#citas-estado');
  let html;
  if (st.sincronizando) {
    html = '<span class="punto-estado sync"></span><span>Sincronizando con Google Calendar…</span>';
  } else if (G.conectado()) {
    const hora = st.ultimaSync ? ` · actualizado a las ${hhmm(minDe(st.ultimaSync))}` : '';
    html = `<span class="punto-estado ok"></span><span>Conectado con Google Calendar (${esc(GOOGLE_CUENTA)})${hora}</span>
      <button type="button" class="btn-texto" data-acc="actualizar">Actualizar</button>
      <button type="button" class="btn-texto suave" data-acc="desconectar">Desconectar</button>`;
  } else {
    html = `<span class="punto-estado no"></span>
      <span>${G.autorizadoAntes() ? 'La conexión con Google Calendar ha caducado.' : 'No conectado con Google Calendar.'} Se muestran las citas guardadas en la tablet.</span>
      <button type="button" class="btn-secundario" data-acc="conectar">${G.autorizadoAntes() ? 'Reconectar' : 'Conectar con Google'}</button>`;
  }
  if (st.error) html += `<div class="error-estado">${esc(st.error)}</div>`;
  el.innerHTML = html;
  el.classList.toggle('desconectado', !G.conectado() && !st.sincronizando);
}

// Reparte en «carriles» las citas que se solapan dentro de una misma columna.
function carriles(lista) {
  const res = new Map();
  let grupo = [];
  let finGrupo = -1;
  const cerrarGrupo = () => {
    const finCarril = [];
    for (const c of grupo) {
      let i = finCarril.findIndex((f) => f <= c._ini);
      if (i < 0) { i = finCarril.length; finCarril.push(0); }
      finCarril[i] = c._fin;
      res.set(c.id, { i });
    }
    for (const c of grupo) res.get(c.id).n = finCarril.length;
    grupo = [];
  };
  for (const c of lista) {
    if (grupo.length && c._ini >= finGrupo) cerrarGrupo();
    grupo.push(c);
    finGrupo = Math.max(grupo.length === 1 ? c._fin : finGrupo, c._fin);
  }
  if (grupo.length) cerrarGrupo();
  return res;
}

async function pintarAgenda() {
  const citas = await citasDelDia(st.dia);
  const base = fechaDeISO(st.dia);
  const conHora = citas.filter((c) => !c.todoElDia).map((c) => ({
    ...c,
    _ini: Math.round((new Date(c.inicio) - base) / 60000),
    _fin: Math.min(24 * 60, Math.round((new Date(c.fin) - base) / 60000)),
  }));
  const todoDia = citas.filter((c) => c.todoElDia);

  const td = $('#citas-todo-dia');
  td.innerHTML = todoDia.map((c) => `<button type="button" class="todo-dia" data-id="${esc(c.id)}">Todo el día · ${esc(c.titulo)}</button>`).join('');
  td.style.display = todoDia.length ? '' : 'none';

  const cols = [...EMPLEADAS];
  if (conHora.some((c) => !c.empleada)) cols.push(SIN_ASIGNAR);
  const alto = (AGENDA_HASTA - AGENDA_DESDE) * PX;
  const y = (min) => (min - AGENDA_DESDE) * PX;

  // Franjas cerradas (fuera del horario de apertura), sombreadas.
  const cerrados = [];
  let cursor = AGENDA_DESDE;
  for (const [a, b] of HORARIO) { if (a > cursor) cerrados.push([cursor, a]); cursor = Math.max(cursor, b); }
  if (cursor < AGENDA_HASTA) cerrados.push([cursor, AGENDA_HASTA]);
  const htmlCerrado = cerrados.map(([a, b]) => `<div class="cerrado" style="top:${y(a)}px;height:${(b - a) * PX}px"></div>`).join('');

  let horas = '';
  for (let m = AGENDA_DESDE; m < AGENDA_HASTA; m += 60) horas += `<div class="hora" style="top:${y(m)}px">${hhmm(m)}</div>`;

  const columnas = cols.map((emp) => {
    const suyas = conHora.filter((c) => c.empleada === emp.id);
    const lanes = carriles(suyas);
    const bloques = suyas.map((c) => {
      const { i, n } = lanes.get(c.id);
      const ini = Math.max(c._ini, AGENDA_DESDE);
      const fin = Math.min(Math.max(c._fin, ini + 15), AGENDA_HASTA);
      if (fin <= AGENDA_DESDE || ini >= AGENDA_HASTA) return '';
      const corta = fin - ini < 40;
      return `<button type="button" class="cita-bloque ${corta ? 'corta' : ''}" data-id="${esc(c.id)}"
          style="--c:${emp.color};top:${y(ini)}px;height:${(fin - ini) * PX - 2}px;left:calc(${(i / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)">
          <span class="h">${hhmm(c._ini)}–${hhmm(c._fin)}</span>
          <strong>${esc(nombreCliente(c))}</strong>
          <span class="t">${esc(c.tratamientos.join(', '))}</span>
        </button>`;
    }).join('');
    return `<div class="col" data-emp="${emp.id}" style="height:${alto}px">${htmlCerrado}${bloques}</div>`;
  }).join('');

  let ahora = '';
  if (st.dia === hoyISO()) {
    const m = minDe(new Date());
    if (m >= AGENDA_DESDE && m <= AGENDA_HASTA) ahora = `<div class="ahora" style="top:${y(m)}px"></div>`;
  }

  const ag = $('#agenda');
  ag.style.setProperty('--n', cols.length);
  ag.innerHTML = `
    <div class="agenda-cab">
      <div></div>
      ${cols.map((e) => {
        const n = conHora.filter((c) => c.empleada === e.id).length;
        return `<div class="col-cab"><span class="punto" style="background:${e.color}"></span>${esc(e.nombre)}<small>${n ? `${n} ${n === 1 ? 'cita' : 'citas'}` : 'libre'}</small></div>`;
      }).join('')}
    </div>
    <div class="agenda-cuerpo">
      <div class="horas" style="height:${alto}px">${horas}</div>
      ${columnas}
      ${ahora}
    </div>`;

  // Al cambiar de día, se coloca la agenda a la hora actual (hoy) o a la apertura.
  if (st.scrollHecho !== st.dia) {
    st.scrollHecho = st.dia;
    const objetivo = st.dia === hoyISO() ? Math.max(minDe(new Date()) - 60, HORARIO[0][0] - 30) : HORARIO[0][0] - 30;
    ag.scrollTop = Math.max(0, y(objetivo));
  }
}

// ---------- Recordatorios ----------
function aceptaWhatsapp(c) {
  const cli = c.clienteId && ctx.clientePorId(c.clienteId);
  return cli ? cli.aceptaWhatsapp !== false : true;
}

async function citasConRecordatorio() {
  const manana = sumarDias(hoyISO(), 1);
  return (await citasDelDia(manana)).filter((c) => !c.todoElDia);
}

async function actualizarBadge() {
  const pendientes = (await citasConRecordatorio())
    .filter((c) => !c.recordatorio && telefonoCliente(c) && aceptaWhatsapp(c)).length;
  const b = $('#badge-rec');
  b.textContent = pendientes || '';
  b.style.display = pendientes ? '' : 'none';
  const nav = $('#nav [data-vista="citas"]');
  if (nav) nav.dataset.badge = pendientes || '';
}

function listaTratamientos(arr) {
  const t = arr.map((x) => x.charAt(0).toLocaleLowerCase('es') + x.slice(1));
  if (!t.length) return 'su tratamiento';
  return t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} y ${t.at(-1)}`;
}

function enlaceWhatsApp(c) {
  const tel = telefonoCliente(c).trim();
  let dig = tel.replace(/\D/g, '');
  if (dig.startsWith('00')) dig = dig.slice(2);
  else if (!tel.startsWith('+') && dig.length === 9) dig = '34' + dig; // móvil español sin prefijo
  const msg = mensajeRecordatorio({ hora: hhmm(minDe(new Date(c.inicio))), tratamiento: listaTratamientos(c.tratamientos) });
  return `https://wa.me/${dig}?text=${encodeURIComponent(msg)}`;
}

async function marcarEnviado(id) {
  const c = await db.obtener('citas', id);
  if (!c) return;
  c.recordatorio = new Date().toISOString();
  await db.guardar('citas', c);
  actualizarBadge();
  // Se anota también en Google Calendar, para que conste aunque se cambie de tablet.
  if (G.conectado() && st.calId && c.deSomara) {
    G.actualizarEvento(st.calId, id, { extendedProperties: citaAEvento({ ...c, clienteNombre: nombreCliente(c), telefono: telefonoCliente(c) }).extendedProperties }).catch(() => {});
  }
}

async function pintarListaRecordatorios(f) {
  const lista = await citasConRecordatorio();
  $('#r-lista', f).innerHTML = lista.length ? lista.map((c) => {
    const tel = telefonoCliente(c);
    let accion;
    if (!tel) accion = '<span class="etiqueta">Sin teléfono</span>';
    else if (!aceptaWhatsapp(c)) accion = '<span class="etiqueta">No acepta WhatsApp</span>';
    else accion = `<a class="btn-wa ${c.recordatorio ? 'enviado' : ''}" href="${esc(enlaceWhatsApp(c))}" target="_blank" rel="noopener" data-id="${esc(c.id)}">
        ${c.recordatorio ? 'Enviado · reenviar' : 'Enviar WhatsApp'}</a>`;
    return `<li class="recordatorio">
      <span class="r-hora">${hhmm(minDe(new Date(c.inicio)))}</span>
      <span class="r-det"><strong>${esc(nombreCliente(c))}</strong>
        <small>${esc(c.tratamientos.join(', ') || c.titulo)} · ${esc(empleada(c.empleada).nombre)}</small>
        <small>${esc(fmtTelefono(tel))}</small></span>
      ${accion}
    </li>`;
  }).join('') : '<li class="ayuda">No hay citas para mañana.</li>';
}

async function abrirRecordatorios() {
  const manana = sumarDias(hoyISO(), 1);
  abrirModal(`
    <h2>Recordatorios para mañana</h2>
    <div class="ayuda" style="margin:0">${mayuscula(fechaDeISO(manana).toLocaleDateString('es-ES', opcFechaLarga))}.
      Al pulsar «Enviar WhatsApp» se abre WhatsApp con el mensaje ya escrito; solo falta darle a enviar.</div>
    <ul class="lista-recordatorios" id="r-lista"><li class="ayuda">Cargando…</li></ul>
    <div class="modal-acciones"><button type="button" class="btn-principal" data-cerrar>Cerrar</button></div>`, (f) => {
    $('#r-lista', f).onclick = (e) => {
      const a = e.target.closest('.btn-wa');
      if (!a) return;
      // El enlace se abre solo; aquí solo se marca como enviado.
      setTimeout(async () => { await marcarEnviado(a.dataset.id); pintarListaRecordatorios(f); }, 300);
    };
  });
  const f = $('#modal-form');
  await pintarListaRecordatorios(f);
  if (G.conectado()) {
    try { await sincronizar(manana, sumarDias(manana, 1)); } catch (e) { manejarError(e); }
    if ($('#modal').open && $('#r-lista', f)) pintarListaRecordatorios(f);
    actualizarBadge();
  }
}

// =====================================================================
// Formulario de cita
// =====================================================================
function estadoNuevo(fecha, hora, emp) {
  return {
    id: null, cita: null, clienteId: null, clienteNombre: '', telefono: '',
    tratamientos: [], fecha, hora, duracion: DURACION_POR_DEFECTO, durManual: false,
    empleada: emp, notas: '',
  };
}

function estadoDesdeCita(c) {
  const ini = new Date(c.inicio);
  const fin = new Date(c.fin);
  const cli = c.clienteId && ctx.clientePorId(c.clienteId);
  const tratamientos = c.tratamientos.map((nombre, i) => {
    const a = articuloPor(c.tratamientoIds?.[i], nombre);
    return { id: a?.id || '', nombre: a?.nombre || nombre, duracion: a?.duracion || DURACION_POR_DEFECTO };
  });
  const duracion = Math.max(15, Math.round((fin - ini) / 60000));
  return {
    id: c.id, cita: c,
    clienteId: cli?.id || null, clienteNombre: cli?.nombre || c.clienteNombre || '', telefono: cli?.telefono || c.telefono || '',
    tratamientos, fecha: isoDe(ini), hora: minDe(ini), duracion,
    durManual: duracion !== tratamientos.reduce((s, t) => s + t.duracion, 0),
    empleada: c.empleada || EMPLEADAS[0].id, notas: c.notas || '',
  };
}

function opcionesHora(sel) {
  let html = '';
  const lista = [];
  for (let m = AGENDA_DESDE; m < AGENDA_HASTA; m += 15) lista.push(m);
  if (!lista.includes(sel)) lista.push(sel);
  lista.sort((a, b) => a - b);
  for (const m of lista) {
    const abierto = HORARIO.some(([a, b]) => m >= a && m < b);
    html += `<option value="${m}" ${m === sel ? 'selected' : ''}>${hhmm(m)}${abierto ? '' : ' · cerrado'}</option>`;
  }
  return html;
}

function opcionesTratamientos() {
  const { categorias, articulos } = ctx.estado;
  return categorias.filter((c) => c.tipo === 'tratamiento').map((c) => {
    const arts = articulos.filter((a) => a.categoriaId === c.id && a.activo);
    if (!arts.length) return '';
    return `<optgroup label="${esc(c.nombre)}">${arts.map((a) =>
      `<option value="${a.id}">${esc(a.nombre)} · ${textoDuracion(a.duracion || DURACION_POR_DEFECTO)}</option>`).join('')}</optgroup>`;
  }).join('');
}

function abrirFormCita(s) {
  const editando = !!s.id;
  abrirModal(`
    <h2>${editando ? 'Editar cita' : 'Nueva cita'}</h2>
    <div class="campo"><span class="etq">Cliente</span><div id="f-cliente"></div></div>
    <div class="campo"><span class="etq">Tratamientos</span>
      <ul class="f-trats" id="f-trats"></ul>
      <select id="f-add-trat"><option value="">+ Añadir tratamiento…</option>${opcionesTratamientos()}</select>
    </div>
    <div class="f-fila">
      <label>Día <input type="date" id="f-fecha" value="${s.fecha}"></label>
      <label>Hora <select id="f-hora">${opcionesHora(s.hora)}</select></label>
      <label>Duración <select id="f-dur">${opcionesDuracion(s.duracion)}</select></label>
    </div>
    <div class="ayuda" id="f-fin" style="margin:-6px 0 0"></div>
    <div class="campo"><span class="etq">Atiende</span>
      <div class="empleadas" id="f-emp">
        ${EMPLEADAS.map((e) => `<button type="button" data-emp="${e.id}" style="--c:${e.color}"><span class="punto"></span>${esc(e.nombre)}</button>`).join('')}
      </div>
    </div>
    <label>Notas (opcional) <input type="text" id="f-notas" value="${esc(s.notas)}" autocomplete="off"></label>
    <div class="f-avisos" id="f-avisos"></div>
    <div class="f-error" id="f-error"></div>
    <div class="modal-acciones">
      ${editando ? `<button type="button" class="btn-peligro" id="f-borrar">Eliminar</button>
        <button type="button" class="btn-texto izq" id="f-cobrar">Cobrar</button>` : ''}
      <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
      <button type="button" class="btn-principal" id="f-guardar">Guardar</button>
    </div>`, (f, cerrar) => {
    const error = (t) => { $('#f-error', f).textContent = t || ''; };

    // ----- Cliente -----
    const pintarCliente = () => {
      const el = $('#f-cliente', f);
      const cli = s.clienteId && ctx.clientePorId(s.clienteId);
      if (cli) {
        el.innerHTML = `<div class="btn-cliente asignado">
            <span class="avatar">${iniciales(cli.nombre)}</span>
            <span class="nom">${esc(cli.nombre)}<small>${esc(fmtTelefono(cli.telefono)) || 'Sin teléfono'}</small></span>
            <button type="button" class="quitar" id="f-quitar-cli" aria-label="Cambiar cliente">×</button>
          </div>`;
        $('#f-quitar-cli', f).onclick = () => { s.clienteId = null; s.clienteNombre = ''; s.telefono = ''; pintarCliente(); };
        return;
      }
      el.innerHTML = `
        ${s.clienteNombre ? `<div class="ayuda" style="margin:0 0 6px">En Google Calendar figura «${esc(s.clienteNombre)}», sin vincular a ningún cliente.</div>` : ''}
        <input type="search" id="f-buscar-cli" placeholder="Buscar cliente por nombre o teléfono…" autocomplete="off">
        <ul class="selector-lista corta" id="f-sugerencias"></ul>`;
      const input = $('#f-buscar-cli', f);
      const sugerir = () => {
        const q = input.value.trim().toLowerCase();
        const qNum = q.replace(/\D/g, '');
        const lista = q ? ctx.estado.clientes.filter((c) =>
          c.nombre.toLowerCase().includes(q) || (qNum && (c.telefono || '').replace(/\D/g, '').includes(qNum))).slice(0, 6) : [];
        $('#f-sugerencias', f).innerHTML = lista.map((c) => `<li><button type="button" data-cli="${c.id}">
            <span class="avatar">${iniciales(c.nombre)}</span>
            <span>${esc(c.nombre)}<small>${esc(fmtTelefono(c.telefono)) || 'Sin teléfono'}</small></span></button></li>`).join('')
          + (q ? `<li><button type="button" data-nuevo-cli><span class="avatar">+</span><span>Crear cliente nuevo «${esc(input.value.trim())}»</span></button></li>` : '');
      };
      input.oninput = sugerir;
      $('#f-sugerencias', f).onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.cli) {
          const c = ctx.clientePorId(b.dataset.cli);
          s.clienteId = c.id; s.clienteNombre = c.nombre; s.telefono = c.telefono || '';
          pintarCliente();
        } else {
          const texto = input.value.trim();
          ctx.abrirEditorCliente(null, (c) => {
            s.clienteId = c.id; s.clienteNombre = c.nombre; s.telefono = c.telefono || '';
            abrirFormCita(s);
          });
          if (/\d/.test(texto)) $('#m-telefono').value = texto; else $('#m-nombre').value = texto;
        }
      };
      if (s.clienteNombre) { input.value = s.clienteNombre; sugerir(); }
    };

    // ----- Tratamientos y duración -----
    const recalcular = () => {
      if (!s.durManual && s.tratamientos.length) {
        s.duracion = Math.max(15, s.tratamientos.reduce((t, x) => t + x.duracion, 0));
        $('#f-dur', f).innerHTML = opcionesDuracion(s.duracion);
      }
      $('#f-fin', f).textContent = `Termina a las ${hhmm(s.hora + s.duracion)}`;
      comprobar();
    };
    const pintarTratamientos = () => {
      $('#f-trats', f).innerHTML = s.tratamientos.map((t, i) => `<li>
          <span>${esc(t.nombre)}</span><small>${textoDuracion(t.duracion)}</small>
          <button type="button" class="quitar" data-quitar="${i}" aria-label="Quitar">×</button></li>`).join('');
    };
    $('#f-trats', f).onclick = (e) => {
      const b = e.target.closest('[data-quitar]'); if (!b) return;
      s.tratamientos.splice(Number(b.dataset.quitar), 1);
      pintarTratamientos(); recalcular();
    };
    $('#f-add-trat', f).onchange = (e) => {
      const a = ctx.estado.articulos.find((x) => x.id === e.target.value);
      e.target.value = '';
      if (!a) return;
      s.tratamientos.push({ id: a.id, nombre: a.nombre, duracion: a.duracion || DURACION_POR_DEFECTO });
      pintarTratamientos(); recalcular();
    };
    $('#f-dur', f).onchange = (e) => { s.duracion = Number(e.target.value); s.durManual = true; recalcular(); };
    $('#f-hora', f).onchange = (e) => { s.hora = Number(e.target.value); recalcular(); };
    $('#f-fecha', f).onchange = (e) => { s.fecha = e.target.value; comprobar(); };
    $('#f-notas', f).oninput = (e) => { s.notas = e.target.value; };

    // ----- Empleada -----
    const pintarEmp = () => {
      for (const b of f.querySelectorAll('#f-emp button')) b.classList.toggle('activo', b.dataset.emp === s.empleada);
    };
    $('#f-emp', f).onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      s.empleada = b.dataset.emp; pintarEmp(); comprobar();
    };

    // ----- Avisos (no bloquean el guardado) -----
    let turno = 0;
    async function comprobar() {
      const mio = ++turno;
      const avisos = [];
      const ini = s.hora, fin = s.hora + s.duracion;
      if (!dentroDeHorario(ini, fin)) avisos.push(`Está fuera del horario de apertura (${textoHorario()}).`);
      if (s.fecha) {
        const base = fechaDeISO(s.fecha);
        for (const c of await citasDelDia(s.fecha)) {
          if (c.id === s.id || c.todoElDia || c.empleada !== s.empleada) continue;
          const a = (new Date(c.inicio) - base) / 60000, b = (new Date(c.fin) - base) / 60000;
          if (a < fin && b > ini) avisos.push(`${empleada(s.empleada).nombre} ya tiene cita de ${hhmm(a)} a ${hhmm(b)} con ${nombreCliente(c)}.`);
        }
      }
      if (mio !== turno) return;
      $('#f-avisos', f).innerHTML = avisos.map((t) => `<div>${esc(t)}</div>`).join('');
    }

    // ----- Guardar -----
    $('#f-guardar', f).onclick = async (e) => {
      error('');
      if (!s.clienteId && !s.clienteNombre) return error('Elige un cliente.');
      if (!s.tratamientos.length) return error('Añade al menos un tratamiento.');
      if (!s.empleada) return error('Elige quién atiende la cita.');
      if (!s.fecha) return error('Elige el día.');
      const ini = fechaConMin(s.fecha, s.hora);
      const fin = fechaConMin(s.fecha, s.hora + s.duracion);
      const cli = s.clienteId && ctx.clientePorId(s.clienteId);
      const anterior = s.cita;
      const cita = {
        id: s.id,
        clienteId: s.clienteId,
        clienteNombre: cli?.nombre || s.clienteNombre,
        telefono: cli?.telefono || s.telefono || '',
        tratamientos: s.tratamientos.map((t) => t.nombre),
        tratamientoIds: s.tratamientos.map((t) => t.id),
        inicio: ini.toISOString(),
        fin: fin.toISOString(),
        empleada: s.empleada,
        notas: s.notas.trim(),
        // Si cambia el día u hora, el recordatorio vuelve a quedar pendiente.
        recordatorio: anterior && anterior.inicio === ini.toISOString() ? anterior.recordatorio : '',
      };
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await asegurarConexion();
        const ev = s.id
          ? await G.actualizarEvento(st.calId, s.id, citaAEvento(cita))
          : await G.crearEvento(st.calId, citaAEvento(cita));
        await db.guardar('citas', eventoACita(ev));
        cerrar();
        aviso(s.id ? 'Cita actualizada' : 'Cita guardada en Google Calendar');
        st.dia = s.fecha;
        pintarCitas({ sync: false });
      } catch (err) {
        if (err.status === 404 && s.id) {
          await db.borrar('citas', s.id);
          error('Esta cita ya no existe en Google Calendar (se borró desde allí).');
          pintarCitas({ sync: false });
        } else {
          error(err instanceof G.ErrorConexion ? 'No hay conexión con Google. Pulsa «Guardar» otra vez para conectar.' : err.message);
        }
        btn.disabled = false; btn.textContent = 'Guardar';
      }
    };

    // ----- Eliminar (pide un segundo toque para confirmar) -----
    const bBorrar = $('#f-borrar', f);
    if (bBorrar) {
      let seguro = false;
      bBorrar.onclick = async () => {
        if (!seguro) { seguro = true; bBorrar.textContent = '¿Seguro? Pulsa otra vez'; return; }
        bBorrar.disabled = true;
        try {
          await asegurarConexion();
          await G.borrarEvento(st.calId, s.id);
          await db.borrar('citas', s.id);
          cerrar();
          aviso('Cita eliminada');
          pintarCitas({ sync: false });
        } catch (err) {
          error(err instanceof G.ErrorConexion ? 'No hay conexión con Google. Pulsa «Eliminar» otra vez para conectar.' : err.message);
          bBorrar.disabled = false; seguro = false; bBorrar.textContent = 'Eliminar';
        }
      };
    }

    // ----- Cobrar: pasa los tratamientos y el cliente al ticket de Ventas -----
    const bCobrar = $('#f-cobrar', f);
    if (bCobrar) bCobrar.onclick = () => {
      cerrar();
      ctx.cobrarCita({ clienteId: s.clienteId, tratamientos: s.tratamientos.map((t) => t.nombre), tratamientoIds: s.tratamientos.map((t) => t.id) });
    };

    pintarCliente();
    pintarTratamientos();
    pintarEmp();
    recalcular();
  });
}

function abrirTodoElDia(c) {
  abrirModal(`
    <h2>${esc(c.titulo)}</h2>
    <div class="ayuda" style="margin:0">Evento de día completo creado en Google Calendar. Se edita desde allí.</div>
    ${c.notas ? `<p>${esc(c.notas)}</p>` : ''}
    <div class="modal-acciones">
      ${c.enlace ? `<a class="btn-texto izq" href="${esc(c.enlace)}" target="_blank" rel="noopener">Abrir en Google Calendar</a>` : ''}
      <button type="button" class="btn-principal" data-cerrar>Cerrar</button>
    </div>`);
}

// Primera hora libre razonable para una cita nueva.
function horaSugerida() {
  if (st.dia !== hoyISO()) return HORARIO[0][0];
  const m = Math.ceil(minDe(new Date()) / 15) * 15;
  return Math.min(Math.max(m, HORARIO[0][0]), AGENDA_HASTA - 15);
}

// =====================================================================
// Montaje
// =====================================================================
export function montarCitas(contexto) {
  ctx = contexto;
  const irDia = (iso) => { st.dia = iso; pintarCitas(); };
  $('#cita-ant').onclick = () => irDia(sumarDias(st.dia, -1));
  $('#cita-sig').onclick = () => irDia(sumarDias(st.dia, 1));
  $('#cita-hoy').onclick = () => irDia(hoyISO());
  $('#cita-fecha').onchange = (e) => { if (e.target.value) irDia(e.target.value); };
  $('#nueva-cita').onclick = () => abrirFormCita(estadoNuevo(st.dia, horaSugerida(), EMPLEADAS[0].id));
  $('#btn-recordatorios').onclick = abrirRecordatorios;

  $('#citas-estado').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.acc === 'conectar') {
      try {
        await G.conectar();
        await asegurarCalendario();
        aviso('Conectado con Google Calendar');
      } catch (err) { st.error = err.message; }
      pintarCitas();
    }
    if (b.dataset.acc === 'actualizar') pintarCitas();
    if (b.dataset.acc === 'desconectar') {
      if (!(await confirmar('¿Desconectar la app de Google Calendar? Las citas seguirán en Google; para volver a verlas aquí habrá que conectar de nuevo.', 'Desconectar'))) return;
      G.desconectar();
      st.calId = null;
      pintarCitas({ sync: false });
    }
  };

  $('#agenda').onclick = async (e) => {
    const bloque = e.target.closest('.cita-bloque');
    if (bloque) {
      const c = await db.obtener('citas', bloque.dataset.id);
      if (c) abrirFormCita(estadoDesdeCita(c));
      return;
    }
    const col = e.target.closest('.col');
    if (!col) return;
    const yPx = e.clientY - col.getBoundingClientRect().top;
    const min = AGENDA_DESDE + Math.floor(yPx / PX / 15) * 15;
    abrirFormCita(estadoNuevo(st.dia, Math.min(min, AGENDA_HASTA - 15), col.dataset.emp || EMPLEADAS[0].id));
  };
  $('#citas-todo-dia').onclick = async (e) => {
    const b = e.target.closest('.todo-dia'); if (!b) return;
    const c = await db.obtener('citas', b.dataset.id);
    if (c) abrirTodoElDia(c);
  };

  // Mientras la vista esté abierta, se traen los cambios hechos en Google Calendar.
  const vistaAbierta = () => $('#vista-citas').classList.contains('activa') && document.visibilityState === 'visible';
  setInterval(() => { if (vistaAbierta() && G.conectado()) pintarCitas(); }, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (vistaAbierta()) pintarCitas(); });

  actualizarBadge();
}
