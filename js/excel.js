// Generador mínimo de archivos Excel (.xlsx) sin librerías externas.
// Un .xlsx es un ZIP con varios XML dentro; aquí se crea ese ZIP (sin comprimir).
//
// Uso:
//   const blob = crearXlsx({
//     hoja: 'Gasto por cliente',
//     anchos: [40, 16],
//     filas: [
//       [{ v: 'Título', s: 'titulo' }],
//       [{ v: 'Cliente', s: 'cabecera' }, { v: 'Gasto', s: 'cabecera' }],
//       ['Laura', { v: 27.5, s: 'euros' }],
//       [{ v: 'TOTAL', s: 'total' }, { f: 'SUM(B3:B3)', v: 27.5, s: 'totalEuros' }],
//     ],
//   });
// Una celda puede ser texto, número o { v, s, f } (valor, estilo, fórmula).

// Índices de estilo definidos en styles.xml (más abajo).
const ESTILOS = { normal: 0, titulo: 1, cabecera: 2, euros: 3, total: 4, totalEuros: 5, subtitulo: 6 };

const escXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
  // caracteres de control no válidos en XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const letraColumna = (i) => {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

function celdaXml(celda, ref) {
  if (celda == null || celda === '') return '';
  const c = typeof celda === 'object' ? celda : { v: celda };
  const s = ESTILOS[c.s || 'normal'] ?? 0;
  const estilo = s ? ` s="${s}"` : '';
  if ((c.v == null || c.v === '') && !c.f) return s ? `<c r="${ref}"${estilo}/>` : ''; // celda vacía con estilo (p. ej. borde)
  if (c.f) return `<c r="${ref}"${estilo}><f>${escXml(c.f)}</f>${c.v != null ? `<v>${Number(c.v)}</v>` : ''}</c>`;
  if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${estilo}><v>${c.v}</v></c>`;
  return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escXml(c.v ?? '')}</t></is></c>`;
}

function hojaXml(filas, anchos) {
  const cols = anchos?.length
    ? `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = filas.map((fila, r) => {
    const celdas = (fila || []).map((c, i) => celdaXml(c, `${letraColumna(i)}${r + 1}`)).join('');
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><name val="Calibri"/></font>
<font><i/><sz val="11"/><color rgb="FF7A6B72"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFECDFE5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="medium"><color auto="1"/></top><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function archivosXlsx(hoja, filas, anchos) {
  const nombreHoja = escXml(String(hoja || 'Hoja1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${nombreHoja}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    'xl/styles.xml': ESTILOS_XML,
    'xl/worksheets/sheet1.xml': hojaXml(filas, anchos),
  };
}

// ---------- ZIP sin compresión ----------
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function crearZip(archivos) {
  const enc = new TextEncoder();
  const ahora = new Date();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | Math.floor(ahora.getSeconds() / 2);
  const fecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
  const partes = [];
  const central = [];
  let desplazamiento = 0;

  for (const [nombre, contenido] of Object.entries(archivos)) {
    const n = enc.encode(nombre);
    const datos = enc.encode(contenido);
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // versión necesaria
    local.setUint16(6, 0x0800, true);   // nombres en UTF-8
    local.setUint16(8, 0, true);        // sin compresión
    local.setUint16(10, hora, true);
    local.setUint16(12, fecha, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, n.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), n, datos);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, hora, true);
    cd.setUint16(14, fecha, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, datos.length, true);
    cd.setUint32(24, datos.length, true);
    cd.setUint16(28, n.length, true);
    cd.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(cd.buffer), n);

    desplazamiento += 30 + n.length + datos.length;
  }

  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  const total = Object.keys(archivos).length;
  fin.setUint16(8, total, true);
  fin.setUint16(10, total, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, desplazamiento, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function crearXlsx({ hoja, filas, anchos }) {
  return crearZip(archivosXlsx(hoja, filas, anchos));
}

export function descargarArchivo(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
