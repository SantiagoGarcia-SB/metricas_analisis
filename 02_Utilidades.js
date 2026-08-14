/**
 * 02_Utilidades.js — Helpers de Parseo y Formateo
 *
 * Funciones compartidas de parseo de fechas, normalización y clasificación.
 * Reemplaza: parseFechaDDMMYYYY, _parsearFechaFlexible, parseDatetimeStr,
 * y las closures inline (_fechaParte, _fechaISO, _fechaNorm, etc.)
 */

// ============================================================================
// PARSEO DE FECHAS — Función unificada
// ============================================================================

/**
 * Parsea una cadena de fecha en múltiples formatos soportados.
 *
 * Formatos reconocidos:
 *   - dd/MM/yyyy
 *   - dd-MM-yyyy
 *   - yyyy-MM-dd
 *   - YYYYMMDD (8 dígitos compactos)
 *   - dd/MM/yyyy HH:mm:ss (o HH:mm)
 *
 * Regla de desambiguación con separador "-":
 *   Si el primer segmento tiene 4 dígitos → yyyy-MM-dd
 *   En caso contrario → dd-MM-yyyy
 *
 * Validación: Verifica que los componentes del Date resultante coincidan con
 * los valores parseados (detecta fechas inválidas como 30/02/2024).
 *
 * @param {string|null|undefined} str - Cadena a parsear
 * @returns {Date|null} Objeto Date válido o null si no se pudo parsear
 */
function parsearFecha(str) {
  if (str == null || typeof str !== 'string' || str.trim() === '') return null;

  var s = str.trim();

  // --- Formato compacto YYYYMMDD (exactamente 8 dígitos) ---
  if (/^\d{8}$/.test(s)) {
    var y = parseInt(s.substring(0, 4), 10);
    var m = parseInt(s.substring(4, 6), 10) - 1;
    var d = parseInt(s.substring(6, 8), 10);
    return _validarYCrearFecha(y, m, d);
  }

  // --- Formato con hora: "dd/MM/yyyy HH:mm:ss" o "dd/MM/yyyy HH:mm" ---
  if (s.indexOf(' ') > -1) {
    var partes = s.split(' ');
    var fechaBase = parsearFecha(partes[0]); // recursión para la parte de fecha
    if (fechaBase == null) return null;

    var horaParts = partes[1].split(':');
    if (horaParts.length < 2) return null;

    var h = parseInt(horaParts[0], 10);
    var mi = parseInt(horaParts[1], 10);
    var sec = horaParts.length >= 3 ? parseInt(horaParts[2], 10) : 0;

    if (isNaN(h) || isNaN(mi) || isNaN(sec)) return null;
    if (h < 0 || h > 23 || mi < 0 || mi > 59 || sec < 0 || sec > 59) return null;

    fechaBase.setHours(h, mi, sec, 0);
    return fechaBase;
  }

  // --- Separador "/" → dd/MM/yyyy ---
  if (s.indexOf('/') > -1) {
    var p = s.split('/');
    if (p.length !== 3) return null;
    var dia = parseInt(p[0], 10);
    var mes = parseInt(p[1], 10) - 1;
    var anio = parseInt(p[2], 10);
    if (isNaN(dia) || isNaN(mes) || isNaN(anio)) return null;
    return _validarYCrearFecha(anio, mes, dia);
  }

  // --- Separador "-" → yyyy-MM-dd o dd-MM-yyyy ---
  if (s.indexOf('-') > -1) {
    var p2 = s.split('-');
    if (p2.length !== 3) return null;

    var dia2, mes2, anio2;
    if (p2[0].length === 4) {
      // yyyy-MM-dd
      anio2 = parseInt(p2[0], 10);
      mes2 = parseInt(p2[1], 10) - 1;
      dia2 = parseInt(p2[2], 10);
    } else {
      // dd-MM-yyyy
      dia2 = parseInt(p2[0], 10);
      mes2 = parseInt(p2[1], 10) - 1;
      anio2 = parseInt(p2[2], 10);
    }

    if (isNaN(dia2) || isNaN(mes2) || isNaN(anio2)) return null;
    return _validarYCrearFecha(anio2, mes2, dia2);
  }

  // --- No reconocido ---
  return null;
}

/**
 * Crea un Date y valida que los componentes coincidan con los valores proporcionados.
 * Esto detecta fechas inválidas como 31/02/2024 (que JavaScript desplaza a Marzo).
 *
 * @param {number} anio - Año (ej. 2024)
 * @param {number} mes - Mes 0-indexed (0=Enero, 11=Diciembre)
 * @param {number} dia - Día del mes (1-31)
 * @returns {Date|null} Date válido o null si los componentes no coinciden
 * @private
 */
function _validarYCrearFecha(anio, mes, dia) {
  if (mes < 0 || mes > 11 || dia < 1 || dia > 31) return null;
  var fecha = new Date(anio, mes, dia);
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes || fecha.getDate() !== dia) {
    return null;
  }
  return fecha;
}

// ============================================================================
// NORMALIZACIÓN Y HELPERS AUXILIARES
// ============================================================================

/**
 * Convierte una fecha en formato dd/MM/yyyy a yyyy-MM-dd para ordenamiento y
 * comparación. Reemplaza closures inline _fechaParte/_fechaISO/_fechaNorm y
 * sus duplicados _fechaParteD/_fechaISOD/_fechaNormD.
 *
 * @param {string} fechaDDMMYYYY - Fecha en formato dd/MM/yyyy
 * @returns {string} Fecha en formato yyyy-MM-dd, o cadena vacía si la entrada es inválida
 */
function normalizarFechaISO(fechaDDMMYYYY) {
  if (!fechaDDMMYYYY || typeof fechaDDMMYYYY !== 'string') return '';
  var partes = fechaDDMMYYYY.trim().split('/');
  if (partes.length !== 3) return '';
  var dia = partes[0];
  var mes = partes[1];
  var anio = partes[2];
  if (!dia || !mes || !anio) return '';
  // Asegurar formato de 2 dígitos para día y mes
  if (dia.length === 1) dia = '0' + dia;
  if (mes.length === 1) mes = '0' + mes;
  return anio + '-' + mes + '-' + dia;
}

/**
 * Clasifica el estado de una gestión en categorías estándar.
 * Lógica:
 *   - Contiene "APROB" y NO contiene "PENDIENTE" → 'APROBADO'
 *   - Contiene "NEGAD" o "RECHAZ" → 'RECHAZADO'
 *   - Contiene "APLAZ" → 'APLAZADO'
 *   - Cualquier otro caso → 'OTRO'
 *
 * @param {string} estadoRaw - Estado sin normalizar
 * @returns {'APROBADO'|'RECHAZADO'|'APLAZADO'|'OTRO'}
 */
function clasificarEstado(estadoRaw) {
  if (!estadoRaw || typeof estadoRaw !== 'string') return 'OTRO';
  var s = estadoRaw.toUpperCase();
  if (s.indexOf('APROB') >= 0 && s.indexOf('PENDIENTE') < 0) return 'APROBADO';
  if (s.indexOf('NEGAD') >= 0 || s.indexOf('RECHAZ') >= 0) return 'RECHAZADO';
  if (s.indexOf('APLAZ') >= 0) return 'APLAZADO';
  return 'OTRO';
}

/**
 * Parsea un valor de tiempo en minutos desde una cadena con coma o punto decimal.
 * Maneja cadenas con coma como separador decimal (ej. "12,5" → 12.5).
 *
 * @param {string} raw - Valor crudo de la celda
 * @returns {number} Valor numérico en minutos, o NaN si no es parseable
 */
function parsearTiempoMinutos(raw) {
  if (raw == null || typeof raw !== 'string' || raw.trim() === '') return NaN;
  var s = raw.trim().replace(',', '.');
  return parseFloat(s);
}

/**
 * Determina si una fecha cae dentro de un rango [desde, hasta] (inclusive en ambos extremos).
 * El parámetro 'hasta' debería tener 23:59:59 configurado por el llamador para
 * cubrir todo el día final.
 *
 * @param {Date} fecha - Fecha a evaluar
 * @param {Date} desde - Inicio del rango (inclusive)
 * @param {Date} hasta - Fin del rango (inclusive)
 * @returns {boolean} true si la fecha está dentro del rango
 */
function fechaEnRango(fecha, desde, hasta) {
  if (!(fecha instanceof Date) || !(desde instanceof Date) || !(hasta instanceof Date)) return false;
  if (isNaN(fecha.getTime()) || isNaN(desde.getTime()) || isNaN(hasta.getTime())) return false;
  return fecha >= desde && fecha <= hasta;
}

/**
 * Normaliza texto para matching de tipo asignado.
 * Convierte a mayúsculas, elimina tildes, y mapea a los valores estándar:
 *   DIGITAL → 'Digital', UAR → 'UAR', REESTUDIO → 'Reestudio',
 *   BIOMETRIA → 'Biometría', INDUCCION → 'Inducción'
 *
 * @param {string} valor - Valor crudo del tipo asignado
 * @returns {string} Valor normalizado
 */
function normalizarTipoAsignado(valor) {
  var v = String(valor || '').trim();
  if (!v) return v;
  var sinTilde = v.toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
    return { 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U' }[c] || c;
  });
  if (sinTilde === 'DIGITAL') return 'Digital';
  if (sinTilde === 'UAR') return 'UAR';
  if (sinTilde === 'REESTUDIO') return 'Reestudio';
  if (sinTilde === 'BIOMETRIA') return 'Biometría';
  if (sinTilde === 'INDUCCION') return 'Inducción';
  return v;
}

/**
 * Normaliza una cadena de hora a formato HH:mm:ss con ceros iniciales
 * para permitir comparación lexicográfica correcta.
 * Ejemplo: "9:6:20" → "09:06:20", "14:18" → "14:18:00"
 *
 * @param {string} horaStr - Cadena de hora (ej. "9:06:20", "14:18:40", "8:5")
 * @returns {string} Hora normalizada "HH:mm:ss" o cadena vacía si inválida
 */
function normalizarHora(horaStr) {
  if (!horaStr || typeof horaStr !== 'string') return '';
  var partes = horaStr.trim().split(':');
  if (partes.length < 2) return '';
  var h = String(parseInt(partes[0], 10)).padStart(2, '0');
  var m = String(parseInt(partes[1], 10)).padStart(2, '0');
  var s = partes.length >= 3 ? String(parseInt(partes[2], 10)).padStart(2, '0') : '00';
  return h + ':' + m + ':' + s;
}

/**
 * Determina la sucursal/ciudad basándose en el número de póliza.
 * Rangos:
 *   0 → "Operador Inmobiliario"
 *   1-9999 → "Bogotá"
 *   10000-10999 → "Cali"
 *   11000-11999 → "Bucaramanga"
 *   12000-12999 → "Eje Cafetero"
 *   13000-13999 → "Medellín"
 *   14000-14999 → "Barranquilla"
 *   15000-15999 → "Cartagena"
 *   16000-16999 → "Eje Cafetero"
 *   Otro → "Sin clasificar"
 *
 * @param {string} polizaStr - Número de póliza como cadena
 * @returns {string} Nombre de la sucursal/ciudad
 */
function obtenerSucursalPorPoliza(polizaStr) {
  var num = parseInt(String(polizaStr).trim(), 10);
  if (isNaN(num)) return 'Sin clasificar';
  if (num === 0) return 'Operador Inmobiliario';
  if (num >= 1 && num <= 9999) return 'Bogotá';
  if (num >= 10000 && num <= 10999) return 'Cali';
  if (num >= 11000 && num <= 11999) return 'Bucaramanga';
  if (num >= 12000 && num <= 12999) return 'Eje Cafetero';
  if (num >= 13000 && num <= 13999) return 'Medellín';
  if (num >= 14000 && num <= 14999) return 'Barranquilla';
  if (num >= 15000 && num <= 15999) return 'Cartagena';
  if (num >= 16000 && num <= 16999) return 'Eje Cafetero';
  return 'Sin clasificar';
}

/**
 * Normaliza el segmento a las categorías estándar:
 *   VIP, Medianas, Pequeñas, Desarrollo, Sin Categoría.
 * Si no coincide con ninguna, retorna el valor original.
 *
 * @param {string} seg - Segmento crudo
 * @returns {string} Segmento normalizado
 */
function normalizarSegmento(seg) {
  if (!seg) return 'Sin Categoría';
  var s = seg.toUpperCase().trim();
  if (s.indexOf('VIP') >= 0) return 'VIP';
  if (s.indexOf('MEDIAN') >= 0) return 'Medianas';
  if (s.indexOf('PEQUEÑ') >= 0 || s.indexOf('PEQUE') >= 0) return 'Pequeñas';
  if (s.indexOf('DESARR') >= 0) return 'Desarrollo';
  if (s === '') return 'Sin Categoría';
  return seg;
}

/**
 * Obtiene segmento e inmobiliaria para una póliza usando el diccionario score.
 * Retorna valores por defecto si la póliza no se encuentra en el mapa.
 *
 * @param {string} polizaStr - Número de póliza
 * @param {Object} scoreMap - Diccionario {poliza: {inmobiliaria, segmento}}
 * @returns {{inmobiliaria: string, segmento: string}}
 */
function obtenerSegmentoInmobiliaria(polizaStr, scoreMap) {
  var poliza = String(polizaStr || '').trim();
  if (scoreMap && scoreMap[poliza]) {
    return scoreMap[poliza];
  }
  return { inmobiliaria: 'Sin Nombre', segmento: 'Sin Categoría' };
}
