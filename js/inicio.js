// Página principal: panel del día.
// Saludo y fecha, caja de hoy, citas de hoy, recordatorios pendientes,
// próximas citas, cumpleaños de la semana y accesos rápidos a Ventas y Citas.

import { db } from './db.js';
import { datosHoy, sincronizarHoy, abrirRecordatorios } from './citas.js';
import { $, esc, mayuscula, iniciales } from './ui.js';

let ctx = null; // { estado, irA, euros }
const DIAS_CUMPLES = 7;

const activa = () => $('#vista-inicio').classList.contains('activa');

function saludo(h) {
  if (h < 6) return 'Buenas noches';
  if (h < 14) return 'Buenos días';
  if (h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

async function cajaDeHoy() {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString();
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999).toISOString();
  const ventas = (await db.ventasEntre(desde, hasta)).filter((v) => !v.anulada);
  return { total: ventas.reduce((s, v) => s + v.total, 0), tickets: ventas.length };
}

// Cumpleaños de hoy y de los próximos días.
function proximosCumples() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return ctx.estado.clientes
    .filter((c) => c.nacimiento)
    .map((c) => {
      const [y, m, d] = c.nacimiento.split('-').map(Number);
      let fecha = new Date(hoy.getFullYear(), m - 1, d);
      if (fecha < hoy) fecha = new Date(hoy.getFullYear() + 1, m - 1, d);
      return { cliente: c, fecha, dias: Math.round((fecha - hoy) / 86400000), edad: fecha.getFullYear() - y };
    })
    .filter((x) => x.dias <= DIAS_CUMPLES)
    .sort((a, b) => a.dias - b.dias || a.cliente.nombre.localeCompare(b.cliente.nombre, 'es'));
}

function textoCumple({ dias, fecha, edad }) {
  if (dias === 0) return `Hoy cumple ${edad} años`;
  if (dias === 1) return `Mañana · ${edad} años`;
  return `${mayuscula(fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }))} · ${edad} años`;
}

export async function pintarInicio(sincronizar = true) {
  const ahora = new Date();
  const [caja, hoy] = await Promise.all([cajaDeHoy(), datosHoy()]);
  const cumples = proximosCumples();

  const restantes = hoy.citas.filter((c) => new Date(c.fin) > ahora);
  const proximas = restantes.slice(0, 6);
  const enCurso = (c) => new Date(c.inicio) <= ahora && new Date(c.fin) > ahora;

  const listaCitas = proximas.length
    ? `<ul class="inicio-lista">${proximas.map((c) => `
        <li class="${enCurso(c) ? 'en-curso' : ''}">
          <span class="ini-hora">${enCurso(c) ? 'Ahora' : c.hora}</span>
          <span class="det"><strong>${esc(c.cliente)}</strong><small>${esc(c.tratamientos)}</small></span>
          <span class="emp" style="--c:${c.empleada.color}">${esc(c.empleada.nombre)}</span>
        </li>`).join('')}</ul>
        ${restantes.length > proximas.length ? `<p class="inicio-mas">Y ${restantes.length - proximas.length} más…</p>` : ''}`
    : `<p class="inicio-vacio">${hoy.citas.length ? 'Ya no quedan citas hoy.' : 'No hay citas para hoy.'}</p>`;

  const listaCumples = cumples.length
    ? `<ul class="inicio-lista">${cumples.map((x) => `
        <li class="${x.dias === 0 ? 'cumple-hoy' : ''}">
          <span class="avatar">${iniciales(x.cliente.nombre)}</span>
          <span class="det"><strong>${esc(x.cliente.nombre)}</strong><small>${esc(textoCumple(x))}</small></span>
        </li>`).join('')}</ul>`
    : `<p class="inicio-vacio">Ningún cumpleaños esta semana.</p>`;

  $('#inicio').innerHTML = `
    <div class="inicio-cab">
      <h1 class="saludo">${saludo(ahora.getHours())}</h1>
      <p class="inicio-fecha">${mayuscula(ahora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p>
    </div>

    <div class="inicio-kpis">
      <button type="button" class="kpi" data-ir="historial">
        <span class="etq">Caja de hoy</span>
        <span class="val">${ctx.euros(caja.total)}</span>
        <span class="sub">${caja.tickets} ${caja.tickets === 1 ? 'ticket' : 'tickets'}</span>
      </button>
      <button type="button" class="kpi" data-ir="citas">
        <span class="etq">Citas de hoy</span>
        <span class="val">${hoy.citas.length}</span>
        <span class="sub">${restantes.length === hoy.citas.length ? 'todas pendientes' : `${restantes.length} pendientes`}</span>
      </button>
      <button type="button" class="kpi ${hoy.pendientes ? 'destacado' : ''}" data-ir="recordatorios">
        <span class="etq">Recordatorios de mañana</span>
        <span class="val">${hoy.pendientes}</span>
        <span class="sub">${hoy.pendientes ? 'por enviar por WhatsApp' : 'todo enviado'}</span>
      </button>
    </div>

    <div class="inicio-cols">
      <section class="panel-inicio">
        <h2>Próximas citas</h2>
        ${listaCitas}
        ${hoy.conectado ? '' : '<p class="inicio-nota">Sin conexión con Google: se muestran las citas guardadas en la tablet.</p>'}
      </section>
      <section class="panel-inicio">
        <h2>Cumpleaños</h2>
        ${listaCumples}
      </section>
    </div>

    <div class="inicio-accesos">
      <button type="button" class="acceso oro" data-ir="ventas">Ir a Ventas</button>
      <button type="button" class="acceso negro" data-ir="citas">Ir a Citas</button>
    </div>`;

  // Trae las citas de Google en segundo plano y vuelve a pintar con los datos al día.
  if (sincronizar && await sincronizarHoy() && activa()) pintarInicio(false);
}

export function montarInicio(contexto) {
  ctx = contexto;
  $('#inicio').onclick = (e) => {
    const b = e.target.closest('[data-ir]');
    if (!b) return;
    if (b.dataset.ir === 'recordatorios') { ctx.irA('citas'); abrirRecordatorios(); }
    else ctx.irA(b.dataset.ir);
  };
  // Cada minuto se actualizan el saludo, las citas en curso, etc.
  setInterval(() => { if (activa() && document.visibilityState === 'visible') pintarInicio(false); }, 60 * 1000);
}
