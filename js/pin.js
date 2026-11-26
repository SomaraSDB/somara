// PIN de acceso a la app.
//
// - La primera vez se crea un PIN de 4 a 6 cifras (se elige la longitud).
// - Se pide al abrir la app y tras MINUTOS_BLOQUEO sin tocarla (también si se
//   ha estado en otra app ese tiempo). Desde el menú: «Bloquear» y «Cambiar PIN».
// - El PIN se guarda cifrado (PBKDF2 + sal), nunca tal cual.
// - Tras 5 fallos seguidos hay que esperar 1 minuto, y el tiempo se duplica con
//   cada nuevo fallo (máximo 30 minutos).
// - «¿Has olvidado el PIN?»: se inicia sesión con la cuenta de Google del salón
//   y, si es esa cuenta, se puede crear un PIN nuevo.

import { db } from './db.js';
import * as G from './google.js';
import { GOOGLE_CUENTA, MINUTOS_BLOQUEO, PIN_MIN, PIN_MAX } from './config.js';
import { $, aviso } from './ui.js';

const ITERACIONES = 150000;
const FALLOS_PERMITIDOS = 5;

let bloqueado = true;
let ultimaActividad = Date.now();
// Modos: 'desbloquear' | 'crear' | 'repetir' | 'actual' (paso previo a cambiar el PIN)
let modo = 'desbloquear';
let entrada = '';
let primerPin = '';
let longitudGuardada = null;
let cambiando = false; // true si se viene de «Cambiar PIN» (se puede cancelar)
let temporizador = null;

// ---------- Cifrado ----------
const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const deHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

async function derivar(pin, sal, iteraciones) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return aHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, clave, 256));
}

async function guardarPin(pin) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  await db.guardarAjuste('pin', { sal: aHex(sal), hash: await derivar(pin, sal, ITERACIONES), longitud: pin.length, iteraciones: ITERACIONES });
  await db.guardarAjuste('pinIntentos', null);
  longitudGuardada = pin.length;
}

async function pinCorrecto(pin) {
  const p = await db.ajuste('pin');
  return !!p && (await derivar(pin, deHex(p.sal), p.iteraciones)) === p.hash;
}

// ---------- Intentos fallidos ----------
async function esperaRestante() {
  const i = await db.ajuste('pinIntentos');
  return i?.hasta ? Math.max(0, i.hasta - Date.now()) : 0;
}
async function registrarFallo() {
  const i = (await db.ajuste('pinIntentos')) || { fallos: 0 };
  i.fallos++;
  if (i.fallos >= FALLOS_PERMITIDOS) {
    const minutos = Math.min(30, 2 ** (i.fallos - FALLOS_PERMITIDOS));
    i.hasta = Date.now() + minutos * 60000;
  }
  await db.guardarAjuste('pinIntentos', i);
  return i;
}
const textoEspera = (ms) => {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
};

// ---------- Pantalla de bloqueo ----------
const TEXTOS = {
  desbloquear: ['Introduce el PIN', ''],
  actual: ['Escribe tu PIN actual', 'Para cambiarlo, primero confirma el actual.'],
  crear: ['Crea un PIN de acceso', `Elige de ${PIN_MIN} a ${PIN_MAX} cifras. Se pedirá al abrir la app y tras ${MINUTOS_BLOQUEO} minutos sin usarla.`],
  repetir: ['Repite el PIN', 'Escríbelo otra vez para confirmarlo.'],
};

function pintar() {
  const [titulo, sub] = TEXTOS[modo];
  $('#bloqueo-titulo').textContent = titulo;
  $('#bloqueo-sub').textContent = sub;
  // En «desbloquear» se ven tantos puntos como cifras tiene el PIN; al crearlo, hasta 6.
  const huecos = (modo === 'desbloquear' || modo === 'actual') && longitudGuardada ? longitudGuardada : Math.max(PIN_MIN, Math.min(PIN_MAX, entrada.length + 1));
  $('#pin-puntos').innerHTML = Array.from({ length: huecos }, (_, i) => `<span class="${i < entrada.length ? 'lleno' : ''}"></span>`).join('');
  const necesitaOk = modo === 'crear' || modo === 'repetir';
  const okBtn = $('#teclado [data-t="ok"]');
  okBtn.style.visibility = necesitaOk ? 'visible' : 'hidden';
  okBtn.disabled = entrada.length < PIN_MIN;
  $('#pin-olvidado').hidden = !(modo === 'desbloquear' || modo === 'actual');
  $('#pin-cancelar').hidden = !cambiando;
}

function error(texto) {
  const el = $('#pin-error');
  el.textContent = texto || '';
  if (texto) {
    const p = $('#pin-puntos');
    p.classList.remove('temblor');
    void p.offsetWidth; // reinicia la animación
    p.classList.add('temblor');
  }
}

function irAModo(nuevo, textoError = '') {
  modo = nuevo;
  entrada = '';
  pintar();
  error(textoError);
}

function mostrar() {
  bloqueado = true;
  document.body.classList.add('bloqueado');
  $('#bloqueo').hidden = false;
  // Un formulario abierto dejaría la pantalla de bloqueo sin poder tocarse.
  if ($('#modal').open) $('#modal').close();
  $('#nav').hidden = true;
}

function ocultar() {
  bloqueado = false;
  cambiando = false;
  ultimaActividad = Date.now();
  document.body.classList.remove('bloqueado');
  $('#bloqueo').hidden = true;
  entrada = '';
  error('');
}

export function bloquear() {
  if (!longitudGuardada) return;
  cambiando = false;
  mostrar();
  irAModo('desbloquear');
}

export function cambiarPin() {
  cambiando = true;
  mostrar();
  irAModo('actual');
}

// ---------- Teclado ----------
let comprobando = false;
async function pulsar(t) {
  if (comprobando) return;
  if (t === 'borrar') { entrada = entrada.slice(0, -1); error(''); pintar(); return; }
  if (t === 'ok') return confirmar();
  if (!/^\d$/.test(t) || entrada.length >= PIN_MAX) return;
  entrada += t;
  error('');
  pintar();
  // Al desbloquear, se comprueba solo al llegar a la longitud del PIN.
  if ((modo === 'desbloquear' || modo === 'actual') && entrada.length === longitudGuardada) confirmar();
}

async function confirmar() {
  if (entrada.length < PIN_MIN) return;
  comprobando = true;
  try {
    if (modo === 'desbloquear' || modo === 'actual') {
      const espera = await esperaRestante();
      if (espera) { irAModo(modo, `Demasiados intentos. Espera ${textoEspera(espera)}.`); return; }
      if (await pinCorrecto(entrada)) {
        await db.guardarAjuste('pinIntentos', null);
        if (modo === 'actual') irAModo('crear');
        else ocultar();
      } else {
        const i = await registrarFallo();
        const quedan = FALLOS_PERMITIDOS - i.fallos;
        irAModo(modo, i.hasta
          ? `PIN incorrecto. Espera ${textoEspera(i.hasta - Date.now())} para volver a intentarlo.`
          : `PIN incorrecto.${quedan === 1 ? ' Queda 1 intento.' : quedan === 2 ? ' Quedan 2 intentos.' : ''}`);
      }
    } else if (modo === 'crear') {
      primerPin = entrada;
      irAModo('repetir');
    } else if (modo === 'repetir') {
      if (entrada !== primerPin) { irAModo('crear', 'Los PIN no coinciden. Vuelve a empezar.'); return; }
      await guardarPin(entrada);
      ocultar();
      aviso('PIN guardado');
    }
  } finally {
    comprobando = false;
  }
}

// ---------- Recuperar con la cuenta de Google ----------
async function recuperar() {
  const boton = $('#pin-olvidado');
  boton.disabled = true;
  error('');
  try {
    await G.conectar({ forzar: true });
    const correo = await G.correoCuenta();
    if (String(correo).toLowerCase() !== GOOGLE_CUENTA.toLowerCase()) {
      error(`La cuenta ${correo} no es la del salón. Usa ${GOOGLE_CUENTA}.`);
      return;
    }
    await db.guardarAjuste('pinIntentos', null);
    irAModo('crear');
    $('#bloqueo-sub').textContent = `Cuenta ${GOOGLE_CUENTA} comprobada. Elige un PIN nuevo de ${PIN_MIN} a ${PIN_MAX} cifras.`;
  } catch (e) {
    error(e.message);
  } finally {
    boton.disabled = false;
  }
}

// ---------- Arranque ----------
function comprobarInactividad() {
  if (!bloqueado && longitudGuardada && Date.now() - ultimaActividad > MINUTOS_BLOQUEO * 60000) bloquear();
}

export async function iniciarPin() {
  $('#teclado').onclick = (e) => { const b = e.target.closest('button'); if (b) pulsar(b.dataset.t); };
  $('#pin-olvidado').onclick = recuperar;
  $('#pin-cancelar').onclick = () => { if (cambiando) ocultar(); };
  document.addEventListener('keydown', (e) => {
    if ($('#bloqueo').hidden) return;
    if (/^\d$/.test(e.key)) pulsar(e.key);
    else if (e.key === 'Backspace') pulsar('borrar');
    else if (e.key === 'Enter') pulsar('ok');
    else return;
    e.preventDefault();
  });

  // Cualquier toque o tecla cuenta como actividad.
  const actividad = () => { if (!bloqueado) ultimaActividad = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, actividad, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') comprobarInactividad(); });
  clearInterval(temporizador);
  temporizador = setInterval(comprobarInactividad, 20000);

  const p = await db.ajuste('pin');
  longitudGuardada = p?.longitud || null;
  mostrar();
  irAModo(longitudGuardada ? 'desbloquear' : 'crear');
}
