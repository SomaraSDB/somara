import { db, nuevoId, sembrarSiVacio } from './db.js';
import {
  $, $$, esc, aviso, abrirModal, confirmar,
  isoDe, hoyISO, mayuscula, fechaDeISO, iniciales, fmtTelefono,
  textoDuracion, opcionesDuracion,
} from './ui.js';
import { montarCitas, pintarCitas } from './citas.js';
import { montarCopias, pintarCopias } from './copia.js';
import { iniciarPin, bloquear, cambiarPin } from './pin.js';
import { crearXlsx, descargarArchivo } from './excel.js';
import { montarInicio, pintarInicio } from './inicio.js';
import { DURACION_POR_DEFECTO } from './config.js';

// ---------- Utilidades ----------
const fmtEuro = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const euros = (cent) => fmtEuro.format(cent / 100);
const aCentimos = (txt) => {
  const n = parseFloat(String(txt).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const aTextoPrecio = (cent) => (cent / 100).toFixed(2).replace('.', ',');
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', bizum: 'Bizum' };

// ---------- Estado ----------
const estado = {
  categorias: [],
  articulos: [],
  tipo: 'tratamiento',
  categoriaId: null, // null = todas las del tipo
  busqueda: '',
  ticket: [], // { articuloId, nombre, precio, cantidad }
  descuentoPct: 0,
  clienteTicket: null, // id del cliente asignado al ticket (opcional)
  clientes: [],
};

async function cargarCatalogo() {
  estado.categorias = (await db.todos('categorias')).sort((a, b) => a.orden - b.orden);
  // Agrupados por categoría (en «Todas» salen por bloques) y, dentro, en su orden.
  const posCat = new Map(estado.categorias.map((c, i) => [c.id, i]));
  estado.articulos = (await db.todos('articulos'))
    .sort((a, b) => (posCat.get(a.categoriaId) ?? 999) - (posCat.get(b.categoriaId) ?? 999) || a.orden - b.orden);
}

async function cargarClientes() {
  estado.clientes = (await db.todos('clientes')).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
const clientePorId = (id) => estado.clientes.find((c) => c.id === id);

// ---------- Navegación ----------
function irA(vista) {
  $$('#nav button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
  $('#seccion-actual').textContent = $(`#nav [data-vista="${vista}"]`)?.textContent || '';
  $$('.vista').forEach((v) => v.classList.toggle('activa', v.id === `vista-${vista}`));
  if (vista === 'inicio') pintarInicio();
  if (vista === 'ventas') pintarVentas();
  if (vista === 'citas') pintarCitas();
  if (vista === 'historial') pintarHistorial();
  if (vista === 'clientes') pintarClientes();
  if (vista === 'catalogo') pintarCatalogo();
  if (vista === 'copias') pintarCopias();
}

// =====================================================================
// VENTAS
// =====================================================================
function pintarVentas() {
  pintarChips();
  pintarRejilla();
  pintarTicket();
}

function pintarChips() {
  $$('#filtro-tipo button').forEach((b) => b.classList.toggle('activo', b.dataset.tipo === estado.tipo));
  const cats = estado.categorias.filter((c) => c.tipo === estado.tipo);
  if (estado.categoriaId && !cats.some((c) => c.id === estado.categoriaId)) estado.categoriaId = null;
  $('#chips-categorias').innerHTML =
    `<button data-cat="" class="${estado.categoriaId ? '' : 'activo'}">Todas</button>` +
    cats.map((c) => `<button data-cat="${c.id}" class="${c.id === estado.categoriaId ? 'activo' : ''}">${esc(c.nombre)}</button>`).join('');
}

function pintarRejilla() {
  const idsCat = new Set(
    estado.categorias
      .filter((c) => c.tipo === estado.tipo && (!estado.categoriaId || c.id === estado.categoriaId))
      .map((c) => c.id)
  );
  const q = estado.busqueda.trim().toLowerCase();
  // Si se busca algo, se busca en todo el catálogo (tratamientos y productos).
  const lista = estado.articulos.filter((a) =>
    a.activo && (q ? a.nombre.toLowerCase().includes(q) : idsCat.has(a.categoriaId))
  );
  const enTicket = Object.fromEntries(estado.ticket.map((l) => [l.articuloId, l.cantidad]));
  $('#rejilla-articulos').innerHTML = lista.length
    ? lista.map((a) => `
        <button class="articulo" data-id="${a.id}">
          ${enTicket[a.id] ? `<span class="contador">${enTicket[a.id]}</span>` : ''}
          <span class="nombre">${esc(a.nombre)}</span>
          <span class="precio">${euros(a.precio)}</span>
        </button>`).join('')
    : `<div class="vacio-rejilla">${q ? 'No hay resultados.' : 'No hay artículos en esta categoría. Añádelos desde «Catálogo».'}</div>`;
}

function calcularTotales() {
  const subtotal = estado.ticket.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const descuento = Math.round((subtotal * estado.descuentoPct) / 100);
  return { subtotal, descuento, total: subtotal - descuento };
}

function pintarTicket() {
  const ul = $('#ticket-lineas');
  ul.innerHTML = estado.ticket.map((l, i) => `
    <li class="linea">
      <span class="nombre">${esc(l.nombre)}</span>
      <span class="importe">${euros(l.precio * l.cantidad)}</span>
      <span class="unitario">${euros(l.precio)} / ud.</span>
      <span class="cantidad">
        <button type="button" data-menos="${i}" aria-label="Quitar uno">−</button>
        <span>${l.cantidad}</span>
        <button type="button" data-mas="${i}" aria-label="Añadir uno">+</button>
      </span>
    </li>`).join('');
  pintarClienteTicket();
  const vacio = estado.ticket.length === 0;
  $('#ticket-vacio').style.display = vacio ? '' : 'none';
  ul.style.display = vacio ? 'none' : '';
  $$('#descuentos button').forEach((b) => b.classList.toggle('activo', Number(b.dataset.desc) === estado.descuentoPct));

  const { subtotal, total } = calcularTotales();
  $('#t-subtotal').textContent = euros(subtotal);
  $('#t-total').textContent = euros(total);
  $('#btn-cobrar').disabled = vacio;
  $('#btn-cobrar').textContent = vacio ? 'Cobrar' : `Cobrar ${euros(total)}`;

  const uds = estado.ticket.reduce((s, l) => s + l.cantidad, 0);
  $('#ticket-resumen-txt').textContent = vacio ? 'Ticket vacío' : `Ticket · ${uds} ${uds === 1 ? 'artículo' : 'artículos'}`;
  $('#ticket-resumen-total').textContent = euros(total);
}

function anadirAlTicket(articulo) {
  const linea = estado.ticket.find((l) => l.articuloId === articulo.id);
  if (linea) linea.cantidad++;
  else estado.ticket.push({ articuloId: articulo.id, nombre: articulo.nombre, precio: articulo.precio, cantidad: 1 });
  pintarTicket();
  pintarRejilla();
}

function pintarClienteTicket() {
  const c = estado.clienteTicket && clientePorId(estado.clienteTicket);
  $('#ticket-cliente').innerHTML = c
    ? `<div class="btn-cliente asignado" role="button" id="elegir-cliente">
         <span class="avatar">${iniciales(c.nombre)}</span>
         <span class="nom">${esc(c.nombre)}</span>
         <button type="button" class="quitar" id="quitar-cliente" aria-label="Quitar cliente">×</button>
       </div>`
    : `<button type="button" class="btn-cliente" id="elegir-cliente">
         <span class="avatar">+</span><span class="nom">Asignar cliente (opcional)</span>
       </button>`;
}

// Desde una cita: lleva sus tratamientos y su cliente al ticket para cobrar.
async function cobrarCita(cita) {
  if (estado.ticket.length && !(await confirmar('Hay un ticket sin cobrar en Ventas. ¿Sustituirlo por los tratamientos de esta cita?', 'Sustituir'))) return;
  estado.ticket = [];
  estado.descuentoPct = 0;
  const noEncontrados = [];
  cita.tratamientos.forEach((nombre, i) => {
    const a = estado.articulos.find((x) => x.id === cita.tratamientoIds?.[i])
      || estado.articulos.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
    if (!a) { noEncontrados.push(nombre); return; }
    const linea = estado.ticket.find((l) => l.articuloId === a.id);
    if (linea) linea.cantidad++;
    else estado.ticket.push({ articuloId: a.id, nombre: a.nombre, precio: a.precio, cantidad: 1 });
  });
  estado.clienteTicket = cita.clienteId && clientePorId(cita.clienteId) ? cita.clienteId : null;
  irA('ventas');
  aviso(noEncontrados.length ? `No están en el catálogo: ${noEncontrados.join(', ')}` : 'Cita pasada al ticket');
}

function vaciarTicket() {
  estado.ticket = [];
  estado.descuentoPct = 0;
  estado.clienteTicket = null;
  pintarTicket();
  pintarRejilla();
}

function abrirCobro() {
  const { subtotal, descuento, total } = calcularTotales();
  const cliente = estado.clienteTicket && clientePorId(estado.clienteTicket);
  let metodo = 'tarjeta';
  abrirModal(`
    <h2>Cobrar</h2>
    <div class="total-grande">${euros(total)}</div>
    ${cliente ? `<div class="ayuda" style="margin:-8px 0 0;text-align:center">Cliente: ${esc(cliente.nombre)}</div>` : ''}
    <div class="metodos" id="m-metodos">
      ${Object.entries(METODOS).map(([k, v]) => `<button type="button" data-metodo="${k}">${v}</button>`).join('')}
    </div>
    <div id="m-efectivo" style="display:none;gap:10px">
      <label>Importe entregado
        <input type="text" inputmode="decimal" id="m-entregado" placeholder="${aTextoPrecio(total)}">
      </label>
      <div class="billetes">
        <button type="button" data-bill="exacto">Exacto</button>
        ${[5, 10, 20, 50, 100].filter((b) => b * 100 >= total).map((b) => `<button type="button" data-bill="${b}">${b} €</button>`).join('')}
      </div>
      <div class="cambio" id="m-cambio">Cambio: 0,00 €</div>
    </div>
    <div class="modal-acciones">
      <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
      <button type="button" class="btn-principal" id="m-confirmar">Confirmar cobro</button>
    </div>`, (f, cerrar) => {
    const entregado = $('#m-entregado', f);
    const actualizarCambio = () => {
      const e = aCentimos(entregado.value);
      const el = $('#m-cambio', f);
      if (!entregado.value) el.textContent = 'Cambio: 0,00 €';
      else if (Number.isNaN(e) || e < total) el.textContent = 'Importe insuficiente';
      else el.textContent = `Cambio: ${euros(e - total)}`;
    };
    const elegir = (m) => {
      metodo = m;
      $$('[data-metodo]', f).forEach((b) => b.classList.toggle('activo', b.dataset.metodo === m));
      $('#m-efectivo', f).style.display = m === 'efectivo' ? 'grid' : 'none';
      if (m === 'efectivo') setTimeout(() => entregado.focus(), 50);
    };
    $$('[data-metodo]', f).forEach((b) => (b.onclick = () => elegir(b.dataset.metodo)));
    $$('[data-bill]', f).forEach((b) => (b.onclick = () => {
      entregado.value = b.dataset.bill === 'exacto' ? aTextoPrecio(total) : b.dataset.bill;
      actualizarCambio();
    }));
    entregado.oninput = actualizarCambio;
    elegir(metodo);

    $('#m-confirmar', f).onclick = async () => {
      let cantidadEntregada = null;
      if (metodo === 'efectivo' && entregado.value) {
        cantidadEntregada = aCentimos(entregado.value);
        if (Number.isNaN(cantidadEntregada) || cantidadEntregada < total) {
          aviso('El importe entregado es menor que el total');
          return;
        }
      }
      const venta = {
        id: nuevoId(),
        numero: await db.siguienteNumeroTicket(),
        fecha: new Date().toISOString(),
        lineas: estado.ticket.map((l) => ({ ...l })),
        subtotal, descuentoPct: estado.descuentoPct, descuento, total,
        metodo, entregado: cantidadEntregada,
        anulada: false,
      };
      if (cliente) { venta.clienteId = cliente.id; venta.clienteNombre = cliente.nombre; }
      await db.guardar('ventas', venta);
      cerrar();
      vaciarTicket();
      $('#ticket').classList.remove('abierto');
      aviso(`Ticket nº ${venta.numero} cobrado · ${euros(total)}`);
    };
  });
}

function montarVentas() {
  $('#filtro-tipo').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.tipo = b.dataset.tipo; estado.categoriaId = null;
    pintarChips(); pintarRejilla();
  };
  $('#chips-categorias').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.categoriaId = b.dataset.cat || null;
    pintarChips(); pintarRejilla();
  };
  $('#buscar').oninput = (e) => { estado.busqueda = e.target.value; pintarRejilla(); };
  $('#rejilla-articulos').onclick = (e) => {
    const b = e.target.closest('.articulo'); if (!b) return;
    const a = estado.articulos.find((x) => x.id === b.dataset.id);
    if (a) anadirAlTicket(a);
  };
  $('#ticket-lineas').onclick = (e) => {
    const mas = e.target.closest('[data-mas]');
    const menos = e.target.closest('[data-menos]');
    if (mas) estado.ticket[mas.dataset.mas].cantidad++;
    if (menos) {
      const i = Number(menos.dataset.menos);
      if (--estado.ticket[i].cantidad <= 0) estado.ticket.splice(i, 1);
    }
    if (mas || menos) { pintarTicket(); pintarRejilla(); }
  };
  $('#descuentos').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.descuentoPct = Number(b.dataset.desc);
    pintarTicket();
  };
  $('#vaciar-ticket').onclick = async () => {
    if (estado.ticket.length && await confirmar('¿Vaciar el ticket actual?', 'Vaciar')) vaciarTicket();
  };
  $('#btn-cobrar').onclick = abrirCobro;
  $('#ticket-cliente').onclick = (e) => {
    if (e.target.closest('#quitar-cliente')) {
      estado.clienteTicket = null; pintarClienteTicket(); return;
    }
    if (e.target.closest('#elegir-cliente')) {
      elegirCliente((c) => { estado.clienteTicket = c.id; pintarClienteTicket(); });
    }
  };
  $('#ticket-resumen').onclick = () => $('#ticket').classList.toggle('abierto');
}

// =====================================================================
// HISTORIAL
// =====================================================================
// Rangos rápidos: devuelven [desde, hasta] en formato AAAA-MM-DD.
function rangoRapido(tipo) {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
  switch (tipo) {
    case 'ayer': { const a = isoDe(new Date(y, m, d - 1)); return [a, a]; }
    case 'semana': { const lunes = d - ((hoy.getDay() + 6) % 7); return [isoDe(new Date(y, m, lunes)), hoyISO()]; }
    case 'mes': return [isoDe(new Date(y, m, 1)), hoyISO()];
    case 'mes-anterior': return [isoDe(new Date(y, m - 1, 1)), isoDe(new Date(y, m, 0))];
    default: return [hoyISO(), hoyISO()];
  }
}

function marcarAtajo() {
  const actual = [$('#fecha-desde').value, $('#fecha-hasta').value].join();
  $$('#atajos-fecha button').forEach((b) => b.classList.toggle('activo', rangoRapido(b.dataset.rango).join() === actual));
}

async function pintarHistorial() {
  const inDesde = $('#fecha-desde');
  const inHasta = $('#fecha-hasta');
  if (!inDesde.value) inDesde.value = hoyISO();
  if (!inHasta.value) inHasta.value = inDesde.value;
  // Si se ponen al revés, se intercambian.
  if (inDesde.value > inHasta.value) [inDesde.value, inHasta.value] = [inHasta.value, inDesde.value];
  marcarAtajo();

  const unSoloDia = inDesde.value === inHasta.value;
  const fDesde = fechaDeISO(inDesde.value);
  const fHasta = fechaDeISO(inHasta.value);
  const desde = fDesde.toISOString();
  const hasta = new Date(fHasta.getFullYear(), fHasta.getMonth(), fHasta.getDate(), 23, 59, 59, 999).toISOString();
  const opcLarga = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const opcCorta = { day: 'numeric', month: 'short', year: 'numeric' };
  const dias = Math.round((fHasta - fDesde) / 86400000) + 1;
  $('#texto-rango').textContent = unSoloDia
    ? mayuscula(fDesde.toLocaleDateString('es-ES', opcLarga))
    : `Del ${fDesde.toLocaleDateString('es-ES', opcCorta)} al ${fHasta.toLocaleDateString('es-ES', opcCorta)} · ${dias} días`;

  const ventas = (await db.ventasEntre(desde, hasta)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const validas = ventas.filter((v) => !v.anulada);
  const suma = (f) => validas.filter(f).reduce((s, v) => s + v.total, 0);

  $('#resumen-dia').innerHTML = [
    ['Total cobrado', euros(suma(() => true))],
    ['Tickets', String(validas.length)],
    ...Object.entries(METODOS).map(([k, v]) => [v, euros(suma((x) => x.metodo === k))]),
  ].map(([e, v]) => `<div class="tarjeta-dato"><div class="etq">${e}</div><div class="val">${v}</div></div>`).join('');

  const fila = (v) => `
      <li><button class="venta ${v.anulada ? 'anulada' : ''}" data-id="${v.id}">
        <span class="num">nº ${v.numero}<br>${new Date(v.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="det">${esc(v.lineas.map((l) => (l.cantidad > 1 ? `${l.cantidad}× ` : '') + l.nombre).join(', '))}
          <small>${v.clienteId ? esc(nombreClienteVenta(v)) + ' · ' : ''}${METODOS[v.metodo]}${v.descuentoPct ? ` · ${v.descuentoPct}% dto.` : ''}${v.anulada ? ' · <span class="etiqueta">Anulado</span>' : ''}</small></span>
        <span class="imp">${euros(v.total)}</span>
      </button></li>`;

  let html = '';
  if (unSoloDia) {
    html = ventas.map(fila).join('');
  } else {
    // Varios días: se agrupan por día, con el total cobrado de cada uno.
    const porDia = new Map();
    for (const v of ventas) {
      const k = isoDe(new Date(v.fecha));
      if (!porDia.has(k)) porDia.set(k, []);
      porDia.get(k).push(v);
    }
    for (const [k, lista] of porDia) {
      const totalDia = lista.filter((v) => !v.anulada).reduce((s, v) => s + v.total, 0);
      html += `<li class="dia-separador"><span>${mayuscula(fechaDeISO(k).toLocaleDateString('es-ES', opcLarga))}</span><span>${euros(totalDia)}</span></li>`;
      html += lista.map(fila).join('');
    }
  }
  $('#lista-ventas').innerHTML = html || `<p class="ayuda">No hay ventas ${unSoloDia ? 'este día' : 'en estas fechas'}.</p>`;
}

function abrirDetalleVenta(v) {
  abrirModal(`
    <h2>Ticket nº ${v.numero}</h2>
    <div class="ayuda" style="margin:0">${new Date(v.fecha).toLocaleString('es-ES')} · ${METODOS[v.metodo]}</div>
    <div class="fila">
      <span>Cliente: <strong>${v.clienteId ? esc(nombreClienteVenta(v)) : 'sin asignar'}</strong></span>
      ${v.anulada ? '' : `<button type="button" class="btn-texto" id="m-cliente">${v.clienteId ? 'Cambiar' : 'Asignar'}</button>`}
    </div>
    <ul class="detalle-lineas">
      ${v.lineas.map((l) => `<li><span>${l.cantidad} × ${esc(l.nombre)}</span><span>${euros(l.precio * l.cantidad)}</span></li>`).join('')}
    </ul>
    <div class="fila"><span>Subtotal</span><span>${euros(v.subtotal)}</span></div>
    ${v.descuento ? `<div class="fila"><span>Descuento ${v.descuentoPct}%</span><span>−${euros(v.descuento)}</span></div>` : ''}
    <div class="fila total"><span>Total</span><span>${euros(v.total)}</span></div>
    ${v.entregado != null ? `<div class="fila"><span>Entregado / cambio</span><span>${euros(v.entregado)} / ${euros(v.entregado - v.total)}</span></div>` : ''}
    <div class="modal-acciones">
      ${v.anulada
        ? '<span class="etiqueta">Ticket anulado</span><button type="button" class="btn-texto izq" id="m-desanular">Restablecer ticket</button>'
        : '<button type="button" class="btn-peligro izq" id="m-anular">Anular ticket</button>'}
      <button type="button" class="btn-principal" data-cerrar>Cerrar</button>
    </div>`, (f) => {
    const bc = $('#m-cliente', f);
    if (bc) bc.onclick = () => elegirCliente(async (c) => {
      const act = { ...v, clienteId: c.id, clienteNombre: c.nombre };
      await db.guardar('ventas', act);
      aviso(`Ticket nº ${v.numero} asignado a ${c.nombre}`);
      pintarHistorial();
      abrirDetalleVenta(act);
    });
    const b = $('#m-anular', f);
    if (b) b.onclick = async () => {
      if (!(await confirmar(`¿Anular el ticket nº ${v.numero}? Dejará de contar en los totales.`, 'Anular'))) return;
      await db.guardar('ventas', { ...v, anulada: true, fechaAnulacion: new Date().toISOString() });
      aviso(`Ticket nº ${v.numero} anulado`);
      pintarHistorial();
    };
    const bd = $('#m-desanular', f);
    if (bd) bd.onclick = async () => {
      if (!(await confirmar(`¿Restablecer el ticket nº ${v.numero}? Volverá a contar en los totales y en el gasto del cliente.`, 'Restablecer'))) return;
      const { fechaAnulacion, ...resto } = v;
      const act = { ...resto, anulada: false };
      await db.guardar('ventas', act);
      aviso(`Ticket nº ${v.numero} recuperado`);
      pintarHistorial();
      abrirDetalleVenta(act);
    };
  });
}

// ---------- Exportar a Excel: gasto por cliente entre dos fechas ----------
function abrirExportarExcel() {
  abrirModal(`
    <h2>Exportar datos en Excel</h2>
    <p class="ayuda" style="margin:0">Se creará un Excel con lo que ha gastado cada cliente entre estas fechas (ambas incluidas), el método de pago, el total y los totales por método de pago. Los tickets anulados no cuentan.</p>
    <div class="f-fila" style="grid-template-columns:1fr 1fr">
      <label>Desde <input type="date" id="x-desde" value="${$('#fecha-desde').value || hoyISO()}"></label>
      <label>Hasta <input type="date" id="x-hasta" value="${$('#fecha-hasta').value || hoyISO()}"></label>
    </div>
    <div class="atajos-fecha" id="x-atajos" style="margin:0;flex-wrap:wrap">
      <button type="button" data-rango="hoy">Hoy</button>
      <button type="button" data-rango="semana">Esta semana</button>
      <button type="button" data-rango="mes">Este mes</button>
      <button type="button" data-rango="mes-anterior">Mes anterior</button>
    </div>
    <div class="f-error" id="x-error"></div>
    <div class="modal-acciones">
      <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
      <button type="button" class="btn-principal" id="x-exportar">Exportar</button>
    </div>`, (f, cerrar) => {
    $('#x-atajos', f).onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      [$('#x-desde', f).value, $('#x-hasta', f).value] = rangoRapido(b.dataset.rango);
    };
    $('#x-exportar', f).onclick = async () => {
      let desde = $('#x-desde', f).value;
      let hasta = $('#x-hasta', f).value;
      if (!desde || !hasta) { $('#x-error', f).textContent = 'Elige las dos fechas.'; return; }
      if (desde > hasta) [desde, hasta] = [hasta, desde];
      const hecho = await exportarGastoClientes(desde, hasta);
      if (!hecho) { $('#x-error', f).textContent = 'No hay ventas en esas fechas.'; return; }
      cerrar();
      aviso('Excel descargado en la carpeta «Descargas»');
    };
  });
}

async function exportarGastoClientes(desdeISO, hastaISO) {
  const fD = fechaDeISO(desdeISO);
  const fH = fechaDeISO(hastaISO);
  const ventas = (await db.ventasEntre(
    fD.toISOString(),
    new Date(fH.getFullYear(), fH.getMonth(), fH.getDate(), 23, 59, 59, 999).toISOString(),
  )).filter((v) => !v.anulada);
  if (!ventas.length) return false;

  // Suma por cliente y por método de pago (en céntimos para no arrastrar decimales).
  const porCliente = new Map();
  const sinCliente = { nombre: 'Ventas sin cliente asignado', gasto: 0, metodos: new Set() };
  const porMetodo = Object.fromEntries(Object.keys(METODOS).map((k) => [k, 0]));
  for (const v of ventas) {
    porMetodo[v.metodo] = (porMetodo[v.metodo] || 0) + v.total;
    let fila = sinCliente;
    if (v.clienteId) {
      fila = porCliente.get(v.clienteId) || { nombre: nombreClienteVenta(v), gasto: 0, metodos: new Set() };
      porCliente.set(v.clienteId, fila);
    }
    fila.gasto += v.total;
    fila.metodos.add(v.metodo);
  }
  const lineas = [...porCliente.values()].sort((a, b) => b.gasto - a.gasto || a.nombre.localeCompare(b.nombre, 'es'));
  if (sinCliente.gasto) lineas.push(sinCliente);
  const total = lineas.reduce((s, l) => s + l.gasto, 0);

  // «Efectivo», «Efectivo y Tarjeta», «Efectivo, Tarjeta y Bizum»…
  const textoMetodos = (set) => {
    const n = Object.keys(METODOS).filter((k) => set.has(k)).map((k) => METODOS[k]);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n.at(-1)}` : n[0] || '';
  };

  const opc = { day: 'numeric', month: 'long', year: 'numeric' };
  const periodo = desdeISO === hastaISO
    ? `Día ${fD.toLocaleDateString('es-ES', opc)}`
    : `Del ${fD.toLocaleDateString('es-ES', opc)} al ${fH.toLocaleDateString('es-ES', opc)}`;
  const primera = 5; // fila donde empiezan los clientes
  const ultima = primera + lineas.length - 1;
  const filaTotal = ultima + 1;
  // Segunda tabla: totales por método de pago, dos filas por debajo de la primera.
  const primeraMetodo = filaTotal + 4;
  const metodos = Object.keys(METODOS);
  const ultimaMetodo = primeraMetodo + metodos.length - 1;
  const filas = [
    [{ v: 'Somara · Gasto por cliente', s: 'titulo' }],
    [{ v: periodo, s: 'subtitulo' }],
    [],
    [{ v: 'Cliente', s: 'cabecera' }, { v: 'Método de pago', s: 'cabecera' }, { v: 'Gasto', s: 'cabecera' }],
    ...lineas.map((l) => [l.nombre, textoMetodos(l.metodos), { v: l.gasto / 100, s: 'euros' }]),
    [{ v: 'TOTAL', s: 'total' }, { v: '', s: 'total' }, { f: `SUM(C${primera}:C${ultima})`, v: total / 100, s: 'totalEuros' }],
    [],
    [{ v: 'Totales por método de pago', s: 'subtitulo' }],
    [{ v: 'Método de pago', s: 'cabecera' }, { v: 'Total', s: 'cabecera' }],
    ...metodos.map((k) => [METODOS[k], { v: porMetodo[k] / 100, s: 'euros' }]),
    [{ v: 'TOTAL', s: 'total' }, { f: `SUM(B${primeraMetodo}:B${ultimaMetodo})`, v: total / 100, s: 'totalEuros' }],
  ];
  const blob = crearXlsx({ hoja: 'Gasto por cliente', anchos: [42, 26, 16], filas });
  const nombre = desdeISO === hastaISO
    ? `Somara gasto por cliente ${desdeISO}.xlsx`
    : `Somara gasto por cliente ${desdeISO} a ${hastaISO}.xlsx`;
  descargarArchivo(blob, nombre);
  return { blob, nombre, lineas, total };
}

function montarHistorial() {
  $('#exportar-excel').onclick = abrirExportarExcel;
  $('#fecha-desde').onchange = pintarHistorial;
  $('#fecha-hasta').onchange = pintarHistorial;
  $('#atajos-fecha').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [$('#fecha-desde').value, $('#fecha-hasta').value] = rangoRapido(b.dataset.rango);
    pintarHistorial();
  };
  $('#lista-ventas').onclick = async (e) => {
    const b = e.target.closest('.venta'); if (!b) return;
    abrirDetalleVenta(await db.obtener('ventas', b.dataset.id));
  };
}

// =====================================================================
// CLIENTES
// =====================================================================
// Si el cliente se ha borrado, se usa el nombre guardado en el ticket.
const nombreClienteVenta = (v) => clientePorId(v.clienteId)?.nombre || v.clienteNombre || 'Cliente eliminado';

function fechaLarga(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
function edad(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const hoy = new Date();
  let e = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--;
  return e;
}
function avisoCumple(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  const hoy = new Date();
  if (hoy.getMonth() + 1 === m && hoy.getDate() === d) return '<span class="cumple">Cumple hoy</span>';
  if (hoy.getMonth() + 1 === m) return '<span class="cumple">Cumple este mes</span>';
  return '';
}

// Gasto total, visitas y última visita de cada cliente (tickets no anulados).
async function estadisticasClientes() {
  const stats = {};
  for (const v of await db.todos('ventas')) {
    if (!v.clienteId || v.anulada) continue;
    const s = (stats[v.clienteId] ||= { gasto: 0, visitas: 0, ultima: '' });
    s.gasto += v.total; s.visitas++;
    if (v.fecha > s.ultima) s.ultima = v.fecha;
  }
  return stats;
}

async function pintarClientes() {
  await cargarClientes();
  const stats = await estadisticasClientes();
  const q = $('#buscar-cliente').value.trim().toLowerCase();
  const qNum = q.replace(/\D/g, '');
  let lista = estado.clientes.filter((c) =>
    !q || c.nombre.toLowerCase().includes(q) || (qNum && (c.telefono || '').replace(/\D/g, '').includes(qNum))
  );
  const orden = $('#orden-clientes').value;
  const st = (c) => stats[c.id] || { gasto: 0, visitas: 0, ultima: '' };
  if (orden === 'gasto') lista.sort((a, b) => st(b).gasto - st(a).gasto);
  if (orden === 'visita') lista.sort((a, b) => st(b).ultima.localeCompare(st(a).ultima));

  $('#lista-clientes').innerHTML = lista.length
    ? lista.map((c) => {
      const s = st(c);
      return `<li><button class="cliente" data-id="${c.id}">
        <span class="avatar">${iniciales(c.nombre)}</span>
        <span class="det">${esc(c.nombre)} ${avisoCumple(c.nacimiento)}
          <small>${esc(fmtTelefono(c.telefono)) || 'Sin teléfono'}${c.nacimiento ? ` · ${edad(c.nacimiento)} años` : ''}</small></span>
        <span class="gasto">${euros(s.gasto)}<small>${s.visitas} ${s.visitas === 1 ? 'visita' : 'visitas'}</small></span>
      </button></li>`;
    }).join('')
    : `<p class="ayuda">${q ? 'No hay clientes que coincidan.' : 'Todavía no hay clientes. Pulsa «+ Cliente» para añadir el primero.'}</p>`;
}

// Formulario de alta/edición. `alGuardar(cliente)` se llama tras guardar.
function abrirEditorCliente(cliente, alGuardar) {
  const nuevo = !cliente;
  cliente = cliente || { id: nuevoId(), nombre: '', nacimiento: '', telefono: '', creado: new Date().toISOString() };
  abrirModal(`
    <h2>${nuevo ? 'Nuevo cliente' : 'Editar cliente'}</h2>
    <label>Nombre y apellidos <input type="text" id="m-nombre" value="${esc(cliente.nombre)}" autocomplete="off"></label>
    <label>Fecha de nacimiento <input type="date" id="m-nacimiento" value="${esc(cliente.nacimiento || '')}" max="${hoyISO()}"></label>
    <label>Teléfono móvil <input type="tel" id="m-telefono" value="${esc(cliente.telefono || '')}" inputmode="tel" placeholder="600 000 000" autocomplete="off"></label>
    <label class="casilla">
      <input type="checkbox" id="m-whatsapp" ${cliente.aceptaWhatsapp === false ? '' : 'checked'}> Acepta recibir recordatorios de citas por WhatsApp
    </label>
    <div class="modal-acciones">
      ${nuevo ? '' : '<button type="button" class="btn-peligro izq" id="m-borrar">Eliminar</button>'}
      <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
      <button type="button" class="btn-principal" id="m-guardar">Guardar</button>
    </div>`, (f, cerrar) => {
    $('#m-guardar', f).onclick = async () => {
      const nombre = $('#m-nombre', f).value.trim().replace(/\s+/g, ' ');
      const telefono = $('#m-telefono', f).value.trim();
      const nacimiento = $('#m-nacimiento', f).value;
      if (!nombre) return aviso('Escribe el nombre');
      const digitos = telefono.replace(/\D/g, '');
      if (telefono && (digitos.length < 9 || /[^\d\s+\-().]/.test(telefono))) return aviso('Teléfono no válido');
      if (digitos && estado.clientes.some((c) => c.id !== cliente.id && (c.telefono || '').replace(/\D/g, '') === digitos)) {
        return aviso('Ya hay un cliente con ese teléfono');
      }
      const guardado = { ...cliente, nombre, telefono, nacimiento, aceptaWhatsapp: $('#m-whatsapp', f).checked };
      await db.guardar('clientes', guardado);
      await cargarClientes();
      cerrar();
      aviso(nuevo ? 'Cliente creado' : 'Cliente guardado');
      alGuardar?.(guardado);
    };
    const borrar = $('#m-borrar', f);
    if (borrar) borrar.onclick = async () => {
      if (!(await confirmar(`¿Eliminar a «${cliente.nombre}»? Sus tickets se conservan con su nombre.`, 'Eliminar'))) return;
      await db.borrar('clientes', cliente.id);
      if (estado.clienteTicket === cliente.id) estado.clienteTicket = null;
      await cargarClientes();
      aviso('Cliente eliminado');
      pintarClientes(); pintarClienteTicket();
    };
    setTimeout(() => $('#m-nombre', f).focus(), 50);
  });
}

async function abrirFichaCliente(id) {
  const c = clientePorId(id);
  if (!c) return;
  const ventas = (await db.ventasDeCliente(id)).filter((v) => !v.anulada).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const gasto = ventas.reduce((s, v) => s + v.total, 0);
  abrirModal(`
    <div style="display:flex;align-items:center;gap:12px">
      <span class="avatar">${iniciales(c.nombre)}</span>
      <div style="flex:1"><h2>${esc(c.nombre)}</h2>
        <div class="ayuda" style="margin:0">${esc(fmtTelefono(c.telefono)) || 'Sin teléfono'}${c.nacimiento ? ` · ${fechaLarga(c.nacimiento)} (${edad(c.nacimiento)} años)` : ''} ${avisoCumple(c.nacimiento)}</div>
      </div>
    </div>
    <div class="ficha-datos">
      <div class="tarjeta-dato"><div class="etq">Gasto total</div><div class="val">${euros(gasto)}</div></div>
      <div class="tarjeta-dato"><div class="etq">Visitas</div><div class="val">${ventas.length}</div></div>
      <div class="tarjeta-dato"><div class="etq">Ticket medio</div><div class="val">${euros(ventas.length ? Math.round(gasto / ventas.length) : 0)}</div></div>
    </div>
    <ul class="ficha-historial">
      ${ventas.length ? ventas.map((v) => `<li>
        <span>${new Date(v.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} · nº ${v.numero}
          <small>${esc(v.lineas.map((l) => (l.cantidad > 1 ? `${l.cantidad}× ` : '') + l.nombre).join(', '))}</small></span>
        <strong>${euros(v.total)}</strong></li>`).join('')
      : '<li class="ayuda">Aún no tiene tickets.</li>'}
    </ul>
    <div class="modal-acciones">
      <button type="button" class="btn-texto izq" id="m-editar">Editar datos</button>
      <button type="button" class="btn-principal" data-cerrar>Cerrar</button>
    </div>`, (f) => {
    $('#m-editar', f).onclick = () => abrirEditorCliente(c, () => { pintarClientes(); abrirFichaCliente(id); });
  });
}

// Selector de cliente para un ticket. `alElegir(cliente)` recibe el elegido.
function elegirCliente(alElegir) {
  abrirModal(`
    <h2>Asignar cliente</h2>
    <input type="search" id="m-buscar" placeholder="Buscar por nombre o teléfono…" autocomplete="off">
    <ul class="selector-lista" id="m-lista"></ul>
    <div class="modal-acciones">
      <button type="button" class="btn-texto izq" id="m-nuevo">+ Nuevo cliente</button>
      <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
    </div>`, (f, cerrar) => {
    const pintar = () => {
      const q = $('#m-buscar', f).value.trim().toLowerCase();
      const qNum = q.replace(/\D/g, '');
      const lista = estado.clientes.filter((c) =>
        !q || c.nombre.toLowerCase().includes(q) || (qNum && (c.telefono || '').replace(/\D/g, '').includes(qNum)));
      $('#m-lista', f).innerHTML = lista.length
        ? lista.map((c) => `<li><button type="button" data-id="${c.id}">
            <span class="avatar">${iniciales(c.nombre)}</span>
            <span>${esc(c.nombre)} ${avisoCumple(c.nacimiento)}<small>${esc(fmtTelefono(c.telefono)) || 'Sin teléfono'}</small></span>
          </button></li>`).join('')
        : `<li class="ayuda">${q ? 'Sin resultados.' : 'No hay clientes todavía.'}</li>`;
    };
    $('#m-buscar', f).oninput = pintar;
    $('#m-lista', f).onclick = (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      cerrar(); alElegir(clientePorId(b.dataset.id));
    };
    $('#m-nuevo', f).onclick = () => {
      const texto = $('#m-buscar', f).value.trim();
      const borrador = /\d/.test(texto) ? { telefono: texto } : { nombre: texto };
      cerrar();
      abrirEditorCliente(null, alElegir);
      // Rellena el formulario con lo que se había buscado.
      if (borrador.nombre) $('#m-nombre').value = borrador.nombre;
      if (borrador.telefono) $('#m-telefono').value = borrador.telefono;
    };
    pintar();
    setTimeout(() => $('#m-buscar', f).focus(), 50);
  });
}

function montarClientes() {
  $('#nuevo-cliente').onclick = () => abrirEditorCliente(null, () => pintarClientes());
  $('#buscar-cliente').oninput = pintarClientes;
  $('#orden-clientes').onchange = pintarClientes;
  $('#lista-clientes').onclick = (e) => {
    const b = e.target.closest('.cliente'); if (b) abrirFichaCliente(b.dataset.id);
  };
}

// =====================================================================
// CATÁLOGO
// =====================================================================
function pintarCatalogo() {
  const bloques = ['tratamiento', 'producto'].map((tipo) => {
    const cats = estado.categorias.filter((c) => c.tipo === tipo);
    return `<h2 style="margin:22px 0 10px">${tipo === 'tratamiento' ? 'Tratamientos' : 'Productos'}</h2>` +
      (cats.length ? cats.map((c) => {
        const arts = estado.articulos.filter((a) => a.categoriaId === c.id);
        return `
        <div class="cat-bloque">
          <div class="cat-cab">
            <h2>${esc(c.nombre)}</h2>
            <button class="btn-texto" data-editar-cat="${c.id}">Editar</button>
          </div>
          ${arts.map((a) => `
            <div class="cat-art ${a.activo ? '' : 'inactivo'}">
              <span class="n">${esc(a.nombre)}${a.activo ? '' : ' <span class="etiqueta">Oculto</span>'}</span>
              ${tipo === 'tratamiento' ? `<span class="dur">${textoDuracion(a.duracion || DURACION_POR_DEFECTO)}</span>` : ''}
              <span class="p">${euros(a.precio)}</span>
              <button class="btn-texto" data-editar-art="${a.id}">Editar</button>
            </div>`).join('')}
          <div class="cat-pie"><button class="btn-texto" data-nuevo-art="${c.id}">+ Añadir ${tipo === 'tratamiento' ? 'tratamiento' : 'producto'}</button></div>
        </div>`;
      }).join('') : '<p class="ayuda">Sin categorías todavía.</p>');
  });
  $('#lista-catalogo').innerHTML = bloques.join('');
}

function abrirEditorCategoria(cat) {
  const nueva = !cat;
  cat = cat || { id: nuevoId(), nombre: '', tipo: estado.tipo, orden: estado.categorias.length };
  abrirModal(`
    <h2>${nueva ? 'Nueva categoría' : 'Editar categoría'}</h2>
    <label>Nombre <input type="text" id="m-nombre" value="${esc(cat.nombre)}" required></label>
    <label>Tipo
      <select id="m-tipo">
        <option value="tratamiento" ${cat.tipo === 'tratamiento' ? 'selected' : ''}>Tratamientos</option>
        <option value="producto" ${cat.tipo === 'producto' ? 'selected' : ''}>Productos</option>
      </select>
    </label>
    <div class="modal-acciones">
      ${nueva ? '' : '<button type="button" class="btn-peligro izq" id="m-borrar">Eliminar</button>'}
      <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
      <button type="button" class="btn-principal" id="m-guardar">Guardar</button>
    </div>`, (f, cerrar) => {
    $('#m-guardar', f).onclick = async () => {
      const nombre = $('#m-nombre', f).value.trim();
      if (!nombre) return aviso('Escribe un nombre');
      await db.guardar('categorias', { ...cat, nombre, tipo: $('#m-tipo', f).value });
      cerrar(); await refrescarCatalogo(); aviso('Categoría guardada');
    };
    const borrar = $('#m-borrar', f);
    if (borrar) borrar.onclick = async () => {
      const arts = estado.articulos.filter((a) => a.categoriaId === cat.id);
      const msg = arts.length
        ? `¿Eliminar «${cat.nombre}» y sus ${arts.length} artículos? Los tickets ya cobrados no se modifican.`
        : `¿Eliminar la categoría «${cat.nombre}»?`;
      if (!(await confirmar(msg, 'Eliminar'))) return;
      for (const a of arts) await db.borrar('articulos', a.id);
      await db.borrar('categorias', cat.id);
      await refrescarCatalogo(); aviso('Categoría eliminada');
    };
    setTimeout(() => $('#m-nombre', f).focus(), 50);
  });
}

function abrirEditorArticulo(art, categoriaId) {
  const nuevo = !art;
  art = art || {
    id: nuevoId(), categoriaId, nombre: '', precio: 0, activo: true,
    orden: estado.articulos.filter((a) => a.categoriaId === categoriaId).length,
  };
  abrirModal(`
    <h2>${nuevo ? 'Nuevo artículo' : 'Editar artículo'}</h2>
    <label>Nombre <input type="text" id="m-nombre" value="${esc(art.nombre)}"></label>
    <label>Precio (€) <input type="text" inputmode="decimal" id="m-precio" value="${nuevo ? '' : aTextoPrecio(art.precio)}" placeholder="0,00"></label>
    <label>Categoría
      <select id="m-cat">
        ${estado.categorias.map((c) => `<option value="${c.id}" ${c.id === art.categoriaId ? 'selected' : ''}>${esc(c.nombre)} (${c.tipo === 'tratamiento' ? 'tratamiento' : 'producto'})</option>`).join('')}
      </select>
    </label>
    <label id="m-dur-wrap">Duración de la cita
      <select id="m-dur">
        ${opcionesDuracion(art.duracion || DURACION_POR_DEFECTO)}
      </select>
    </label>
    <label style="flex-direction:row;display:flex;align-items:center;gap:10px;color:var(--texto);font-size:16px">
      <input type="checkbox" id="m-activo" ${art.activo ? 'checked' : ''} style="width:22px;height:22px"> Visible en ventas
    </label>
    <div class="modal-acciones">
      ${nuevo ? '' : '<button type="button" class="btn-peligro izq" id="m-borrar">Eliminar</button>'}
      <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
      <button type="button" class="btn-principal" id="m-guardar">Guardar</button>
    </div>`, (f, cerrar) => {
    // La duración solo tiene sentido para tratamientos.
    const esTratamiento = () => estado.categorias.find((c) => c.id === $('#m-cat', f).value)?.tipo === 'tratamiento';
    const toggleDur = () => { $('#m-dur-wrap', f).style.display = esTratamiento() ? '' : 'none'; };
    $('#m-cat', f).onchange = toggleDur;
    toggleDur();
    $('#m-guardar', f).onclick = async () => {
      const nombre = $('#m-nombre', f).value.trim();
      const precio = aCentimos($('#m-precio', f).value);
      if (!nombre) return aviso('Escribe un nombre');
      if (Number.isNaN(precio) || precio < 0) return aviso('Precio no válido');
      const datos = { nombre, precio, categoriaId: $('#m-cat', f).value, activo: $('#m-activo', f).checked };
      if (esTratamiento()) datos.duracion = Number($('#m-dur', f).value);
      await db.guardar('articulos', { ...art, ...datos });
      cerrar(); await refrescarCatalogo(); aviso('Guardado');
    };
    const borrar = $('#m-borrar', f);
    if (borrar) borrar.onclick = async () => {
      if (!(await confirmar(`¿Eliminar «${art.nombre}»? Los tickets ya cobrados no se modifican.`, 'Eliminar'))) return;
      await db.borrar('articulos', art.id);
      await refrescarCatalogo(); aviso('Eliminado');
    };
    setTimeout(() => $('#m-nombre', f).focus(), 50);
  });
}

async function refrescarCatalogo() {
  await cargarCatalogo();
  pintarCatalogo();
}

function montarCatalogo() {
  $('#nueva-categoria').onclick = () => abrirEditorCategoria(null);
  $('#lista-catalogo').onclick = (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.editarCat) abrirEditorCategoria(estado.categorias.find((c) => c.id === t.dataset.editarCat));
    if (t.dataset.editarArt) abrirEditorArticulo(estado.articulos.find((a) => a.id === t.dataset.editarArt));
    if (t.dataset.nuevoArt) abrirEditorArticulo(null, t.dataset.nuevoArt);
  };
}

// ---------- Menú desplegable de la cabecera ----------
function montarMenu() {
  const boton = $('#btn-menu');
  const nav = $('#nav');
  const abrir = (si) => {
    nav.hidden = !si;
    boton.setAttribute('aria-expanded', String(si));
    boton.setAttribute('aria-label', si ? 'Cerrar menú' : 'Abrir menú');
  };
  boton.onclick = (e) => { e.stopPropagation(); abrir(nav.hidden); };
  nav.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    abrir(false);
    if (b.dataset.vista) irA(b.dataset.vista);
    else if (b.dataset.accion === 'bloquear') bloquear();
    else if (b.dataset.accion === 'cambiar-pin') cambiarPin();
  };
  // El título «SOMARA» lleva a la página principal.
  const marca = $('#ir-inicio');
  marca.onclick = () => { abrir(false); irA('inicio'); };
  marca.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); marca.click(); } };
  // Se cierra al tocar fuera o al pulsar Escape.
  document.addEventListener('click', (e) => { if (!nav.hidden && !e.target.closest('#menu')) abrir(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !nav.hidden) { abrir(false); boton.focus(); } });
}

// ---------- Arranque ----------
function reloj() {
  $('#reloj').textContent = new Date().toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

async function iniciar() {
  // Lo primero, la pantalla del PIN: la app no se ve hasta desbloquearla.
  iniciarPin();
  // Pide al navegador que no borre los datos de la app aunque falte espacio.
  navigator.storage?.persist?.();
  await sembrarSiVacio();
  await cargarCatalogo();
  await cargarClientes();
  montarVentas(); montarHistorial(); montarClientes(); montarCatalogo();
  montarCitas({ estado, clientePorId, abrirEditorCliente, cobrarCita });
  montarCopias();
  montarInicio({ estado, irA, euros });
  montarMenu();
  reloj(); setInterval(reloj, 30000);
  irA('inicio');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
