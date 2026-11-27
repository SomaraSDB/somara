// Base de datos local (IndexedDB). Todo se guarda en la propia tablet.
// Los importes se guardan en céntimos (enteros) para evitar errores de redondeo.

const DB_NOMBRE = 'somara';
const DB_VERSION = 3;

let _db = null;

function abrirDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('categorias')) {
        db.createObjectStore('categorias', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('articulos')) {
        const s = db.createObjectStore('articulos', { keyPath: 'id' });
        s.createIndex('categoriaId', 'categoriaId');
      }
      if (!db.objectStoreNames.contains('ventas')) {
        const s = db.createObjectStore('ventas', { keyPath: 'id' });
        s.createIndex('fecha', 'fecha');
      }
      if (!db.objectStoreNames.contains('ajustes')) {
        db.createObjectStore('ajustes', { keyPath: 'clave' });
      }
      // Versión 2: clientes y relación ticket → cliente.
      if (!db.objectStoreNames.contains('clientes')) {
        db.createObjectStore('clientes', { keyPath: 'id' });
      }
      const ventas = req.transaction.objectStore('ventas');
      if (!ventas.indexNames.contains('clienteId')) {
        ventas.createIndex('clienteId', 'clienteId');
      }
      // Versión 3: copia local de las citas de Google Calendar (para verlas sin conexión).
      if (!db.objectStoreNames.contains('citas')) {
        const s = db.createObjectStore('citas', { keyPath: 'id' });
        s.createIndex('inicio', 'inicio');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function prom(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, modo = 'readonly') {
  const db = await abrirDB();
  return db.transaction(store, modo).objectStore(store);
}

export function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const db = {
  async todos(store) { return prom((await tx(store)).getAll()); },
  async obtener(store, id) { return prom((await tx(store)).get(id)); },
  async guardar(store, obj) { return prom((await tx(store, 'readwrite')).put(obj)); },
  async borrar(store, id) { return prom((await tx(store, 'readwrite')).delete(id)); },

  async ventasEntre(desde, hasta) {
    const s = await tx('ventas');
    return prom(s.index('fecha').getAll(IDBKeyRange.bound(desde, hasta)));
  },

  async entre(store, indice, desde, hasta) {
    const s = await tx(store);
    return prom(s.index(indice).getAll(IDBKeyRange.bound(desde, hasta)));
  },

  async ajuste(clave) {
    return (await prom((await tx('ajustes')).get(clave)))?.valor;
  },
  async guardarAjuste(clave, valor) {
    return prom((await tx('ajustes', 'readwrite')).put({ clave, valor }));
  },

  // Lee varias colecciones completas de una vez (para la copia de seguridad).
  async exportar(stores) {
    const t = (await abrirDB()).transaction(stores);
    const datos = {};
    await Promise.all(stores.map(async (s) => { datos[s] = await prom(t.objectStore(s).getAll()); }));
    return datos;
  },

  // Sustituye por completo las colecciones incluidas en `datos` (restaurar copia).
  // Los ajustes de `conservarAjustes` se mantienen con su valor actual.
  async importar(datos, conservarAjustes = []) {
    const base = await abrirDB();
    const stores = Object.keys(datos).filter((s) => base.objectStoreNames.contains(s));
    const guardados = {};
    for (const k of conservarAjustes) guardados[k] = await db.ajuste(k);
    await new Promise((res, rej) => {
      const t = base.transaction(stores, 'readwrite');
      for (const s of stores) {
        const os = t.objectStore(s);
        os.clear();
        for (const obj of datos[s]) os.put(obj);
      }
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('No se pudo restaurar'));
    });
    for (const [k, v] of Object.entries(guardados)) if (v !== undefined) await db.guardarAjuste(k, v);
  },

  async ventasDeCliente(clienteId) {
    const s = await tx('ventas');
    return prom(s.index('clienteId').getAll(clienteId));
  },

  async siguienteNumeroTicket() {
    const s = await tx('ajustes', 'readwrite');
    const actual = (await prom(s.get('contadorTicket')))?.valor || 0;
    const siguiente = actual + 1;
    await prom(s.put({ clave: 'contadorTicket', valor: siguiente }));
    return siguiente;
  },
};

// Catálogo real de Somara (noviembre 2026). Se cambia después en "Catálogo".
// Formato: [nombre, precio €, duración en minutos]. Sin duración = DURACION_POR_DEFECTO.
const CATALOGO_VERSION = 'somara-2026-11';
const CATALOGO = [
  { nombre: 'Depilación', tipo: 'tratamiento', articulos: [
    ['Axilas hombre', 6.5], ['Axilas mujer', 5], ['Brazos', 9], ['Brazos hombre', 12],
    ['Diseño cejas', 6], ['Eléctrica', 3.5], ['Espalda', 12], ['Glúteo hombre', 7],
    ['Glúteo mujer', 5.5], ['Ingle brasileña', 9], ['Ingle completa', 14], ['Ingle normal', 5.5],
    ['Ingle o axila y labio o cejas', 8.5], ['Ingle, axilas, labio o cejas', 13.5],
    ['Ingle, axilas, labio y cejas', 15.5], ['Ingles o axilas, labio y cejas', 9.5],
    ['Labio superior', 4], ['Labio y cejas', 7.5], ['Labio y cejas y mentón', 8.5],
    ['Labio y mentón', 5], ['Medias piernas', 9], ['Muslos', 10], ['Muslos y ingles', 13],
    ['Pecho', 12.5], ['Perineo', 6], ['Piernas enteras', 16.5], ['Piernas enteras hombre', 21],
  ]},
  { nombre: 'Decoloración', tipo: 'tratamiento', articulos: [
    ['Decoloración brazos', 7.5], ['Decoloración cara', 5], ['Decoloración glúteo', 5],
    ['Decoloración piernas', 9], ['Decoloración tripa', 5],
  ]},
  { nombre: 'Facial', tipo: 'tratamiento', articulos: [
    ['Casmara Basic', 45], ['Casmara Advance / Infinity / Retinol', 55], ['Higiene facial', 23],
    ['Masaje', 10], ['Mascarilla Casmara', 12], ['Mascarilla Postquam', 6], ['Peeling', 6],
  ]},
  { nombre: 'Manicura', tipo: 'tratamiento', articulos: [
    ['Acrílico', 28], ['Cortar uñas', 6], ['Decoración completa uñas', 2], ['Decoración uña', 0.5],
    ['Esmalte permanente refuerzo', 20.5], ['Esmaltado permanente', 18],
    ['Esmalte permanente y labio o cejas', 21], ['Esmalte permanente y labio y cejas', 23.5],
    ['Limar y pintar', 8], ['Manicura completa', 9.5],
    ['Manicura semipermanente decoración todas las uñas', 24.5], ['Manicura solo refuerzo', 12],
    ['Manicura y labio o cejas', 11.5], ['Manicura y labio y cejas', 12.5], ['Refuerzo', 3],
    ['Reparación uña rota', 1], ['Retirada acrílico o gel', 10], ['Retirada esmalte permanente', 5],
    ['Semi refuerzo y labio y cejas', 25.5], ['Semi refuerzo y labio', 23.5], ['Sesión parafina', 6],
  ]},
  { nombre: 'Maquillaje', tipo: 'tratamiento', articulos: [
    ['Maquillaje completo', 24], ['Maquillaje y prueba', 42],
  ]},
  { nombre: 'Microblading', tipo: 'tratamiento', articulos: [
    ['Microblading sesión suelta', 100], ['Microblading sesión y repaso', 190],
  ]},
  { nombre: 'Mirada', tipo: 'tratamiento', articulos: [
    ['Lifting cejas', 30], ['Lifting pestañas', 23.5], ['Tinte cejas y cejas', 7],
    ['Tinte cejas, cejas y labio', 8], ['Tinte pestañas', 5],
  ]},
  { nombre: 'Pedicura', tipo: 'tratamiento', articulos: [
    ['Cortar uñas pies', 7], ['Cortar uñas y pintar normal', 8], ['Esmaltado permanente pies', 18],
    ['Pedicura básica', 10], ['Pedicura completa', 17.5], ['Pedicura y esmaltado permanente', 32],
    ['Pies y labio y cejas', 20], ['Pintar normal', 3],
  ]},
  { nombre: 'Presoterapia', tipo: 'tratamiento', articulos: [
    ['Presoterapia bono 10 sesiones (30 min)', 40, 30], ['Presoterapia bono 10 sesiones (45 min)', 60, 45],
    ['Presoterapia sesión suelta', 6, 30],
  ]},
  { nombre: 'Productos', tipo: 'producto', articulos: [
    ['Ampolla flash', 3], ['Cofre 50 años (Casmara)', 59.9], ['Cofre Retinol (Casmara)', 83.5],
    ['Crema de día lighting (Casmara)', 59], ['Esmalte', 3.5], ['Secante uñas', 6],
    ['Serum de noche lighting (Casmara)', 55],
  ]},
];

// Primer arranque: carga el catálogo. Si la tablet aún tiene el catálogo de ejemplo
// de las primeras versiones (categoría «Peluquería»), lo cambia por el real.
// Nunca toca un catálogo que ya se haya personalizado, ni ventas ni clientes.
export async function sembrarSiVacio() {
  if ((await db.ajuste('catalogo')) === CATALOGO_VERSION) return;
  const cats = await db.todos('categorias');
  const esEjemplo = cats.some((c) => c.nombre === 'Peluquería');
  if (cats.length && !esEjemplo) {
    await db.guardarAjuste('catalogo', CATALOGO_VERSION);
    return;
  }
  for (const c of cats) await db.borrar('categorias', c.id);
  for (const a of await db.todos('articulos')) await db.borrar('articulos', a.id);
  let orden = 0;
  for (const c of CATALOGO) {
    const cat = { id: nuevoId(), nombre: c.nombre, tipo: c.tipo, orden: orden++ };
    await db.guardar('categorias', cat);
    let o = 0;
    for (const [nombre, precio, duracion] of c.articulos) {
      const art = {
        id: nuevoId(), categoriaId: cat.id, nombre,
        precio: Math.round(precio * 100), orden: o++, activo: true,
      };
      if (duracion) art.duracion = duracion;
      await db.guardar('articulos', art);
    }
  }
  await db.guardarAjuste('catalogo', CATALOGO_VERSION);
}
