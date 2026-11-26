// Configuración del salón. Para cambiar empleadas, horario o el texto del
// recordatorio, basta con editar este archivo.

// ---------- Google Calendar ----------
export const GOOGLE_CLIENT_ID = '161907359486-uphvbhm2ps1h630guogvf615u4a6ahur.apps.googleusercontent.com';
export const GOOGLE_CUENTA = 'somarasdb@gmail.com';
export const NOMBRE_CALENDARIO = 'Citas Somara'; // calendario propio dentro de esa cuenta
export const ZONA_HORARIA = 'Europe/Madrid';

// ---------- Empleadas ----------
// `colorId` es el color de evento de Google Calendar (3 = «Uva», 7 = «Pavo real»).
// Si en Google Calendar se cambia el color de una cita a uno de estos, cambia también
// la empleada que la atiende en la app.
export const EMPLEADAS = [
  { id: 'yaiza', nombre: 'Yaiza', colorId: '3', color: '#8e24aa' },
  { id: 'nines', nombre: 'Nines', colorId: '7', color: '#039be5' },
];

// ---------- Horario ----------
// Tramos de apertura en minutos desde medianoche: 10:00–13:30 y 16:00–20:00.
export const HORARIO = [[10 * 60, 13 * 60 + 30], [16 * 60, 20 * 60]];
// Horas que se muestran en la agenda (un poco más amplias que el horario).
export const AGENDA_DESDE = 9 * 60;
export const AGENDA_HASTA = 21 * 60;
// Duración que se usa si un tratamiento no tiene una propia.
export const DURACION_POR_DEFECTO = 30;

// ---------- PIN de acceso ----------
export const MINUTOS_BLOQUEO = 15;            // sin tocar la app durante este tiempo, se bloquea sola
export const PIN_MIN = 4;
export const PIN_MAX = 6;

// ---------- Copias de seguridad en Google Drive ----------
export const HORA_COPIA = 20 * 60;            // a partir de las 20:00, una copia al día
export const COPIAS_A_CONSERVAR = 30;         // las más antiguas se borran solas
export const NOMBRE_CARPETA_COPIAS = 'Copias Somara';

// ---------- Recordatorio por WhatsApp ----------
export function mensajeRecordatorio({ hora, tratamiento }) {
  return `¡Buenas!
Le recordamos que mañana a las ${hora} tiene hora reservada para ${tratamiento}.
Si no pudiera asistir, o deseara modificar su cita, póngase en contacto por teléfono o Whats App.`;
}
