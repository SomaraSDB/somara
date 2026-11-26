// Utilidades de interfaz compartidas por todos los apartados.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function aviso(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.add('visible');
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => el.classList.remove('visible'), 2600);
}

// Abre el modal con el HTML dado. `montar(form, cerrar)` engancha los eventos.
export function abrirModal(html, montar) {
  const dlg = $('#modal');
  const form = $('#modal-form');
  form.innerHTML = html;
  const cerrar = () => dlg.close();
  form.onsubmit = (e) => e.preventDefault();
  $$('[data-cerrar]', form).forEach((b) => (b.onclick = cerrar));
  montar?.(form, cerrar);
  if (!dlg.open) dlg.showModal();
}

export function confirmar(mensaje, textoBoton = 'Sí, continuar') {
  return new Promise((resolve) => {
    let resultado = false;
    abrirModal(`
      <p style="font-size:18px;margin:0">${esc(mensaje)}</p>
      <div class="modal-acciones">
        <button type="button" class="btn-secundario" data-cerrar>Cancelar</button>
        <button type="button" class="btn-principal" id="m-ok">${esc(textoBoton)}</button>
      </div>`, (f, cerrar) => {
      $('#m-ok', f).onclick = () => { resultado = true; cerrar(); };
    });
    $('#modal').addEventListener('close', () => resolve(resultado), { once: true });
  });
}

// ---------- Fechas ----------
export const isoDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const hoyISO = () => isoDe(new Date());
export const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const fechaDeISO = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

// ---------- Duraciones (en minutos) ----------
export function textoDuracion(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
// Opciones de 15 en 15 minutos, hasta 8 horas.
export function opcionesDuracion(seleccion) {
  let html = '';
  for (let m = 15; m <= 480; m += 15) html += `<option value="${m}" ${m === seleccion ? 'selected' : ''}>${textoDuracion(m)}</option>`;
  if (seleccion % 15 || seleccion > 480) html = `<option value="${seleccion}" selected>${textoDuracion(seleccion)}</option>` + html;
  return html;
}
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// ---------- Clientes ----------
export function iniciales(nombre) {
  return esc(String(nombre || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join(''));
}
export const fmtTelefono = (t) => (t || '').replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3') || t || '';
