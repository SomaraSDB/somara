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

// Catálogo de ejemplo para el primer arranque. Precios y duraciones orientativos:
// se cambian en "Catálogo". Formato: [nombre, precio €, duración en minutos].
const EJEMPLO = [
  { nombre: 'Peluquería', tipo: 'tratamiento', articulos: [
    ['Corte mujer', 25, 45], ['Corte hombre', 15, 30], ['Lavar y peinar', 18, 30],
    ['Tinte raíz', 32, 90], ['Mechas', 55, 120], ['Recogido', 40, 60],
  ]},
  { nombre: 'Estética facial', tipo: 'tratamiento', articulos: [
    ['Limpieza facial', 45, 60], ['Higiene facial express', 30, 30],
    ['Diseño de cejas', 12, 15], ['Lifting de pestañas', 38, 60],
  ]},
  { nombre: 'Manos y pies', tipo: 'tratamiento', articulos: [
    ['Manicura', 15, 30], ['Manicura semipermanente', 22, 45],
    ['Pedicura', 25, 45], ['Retirar semipermanente', 8, 15],
  ]},
  { nombre: 'Depilación', tipo: 'tratamiento', articulos: [
    ['Labio superior', 5, 15], ['Axilas', 9, 15], ['Medias piernas', 15, 30], ['Piernas completas', 25, 45],
  ]},
  { nombre: 'Cuidado capilar', tipo: 'producto', articulos: [
    ['Champú hidratante', 14.5], ['Mascarilla reparadora', 18], ['Aceite capilar', 22],
  ]},
  { nombre: 'Cosmética', tipo: 'producto', articulos: [
    ['Crema facial día', 29], ['Sérum vitamina C', 34], ['Esmalte de uñas', 9.9],
  ]},
];

export async function sembrarSiVacio() {
  const cats = await db.todos('categorias');
  if (cats.length) return;
  let orden = 0;
  for (const c of EJEMPLO) {
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
}
