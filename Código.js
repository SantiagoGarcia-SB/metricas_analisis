/**
 * CONSTANTES DE CONEXIÓN DE BASE DE DATOS
 */
const TARGET_SOLICITUDES_SS_ID = "1x9groW5-I7Xg5ULh7DXfa2XGmS_RMdfqfW1iDWB8bJ0";
const SHEET_NAME_SOLICITUDES = "Historico_Gestiones";
const ID_HOJA_REESTUDIOS = "1slgykTgjoAtCd6KmlG7Lqiuw-nM1hSguQbi0XqeLu7U";
const NOMBRE_PESTANA_REESTUDIOS = "Historico_Gestiones";
const ID_HOJA_BIOMETRIA = "1gHW1RFMVd0h4HZr2xTrFnx-A5Pk_npJs-bAk8GOx2h0";
const TIMEZONE = "America/Bogota";
const HORA_INICIO_OPERACION = "08:00";
const HORA_FIN_TURNO = "17:00";
const BCC_REPORTES_AGENTE = "santiago.garcia@segurosbolivar.com";
const NOMBRE_REMITENTE_AGENTE = "Análisis · El Libertador";

// Columna 60 (índice 0-based) de Historico_Gestiones = tipo_asignado
function _normalizarTipoAsignado(valor) {
  var v = String(valor || "").trim();
  if (!v) return v;
  var sinTilde = v.toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
    return { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U" }[c] || c;
  });
  if (sinTilde === 'DIGITAL') return 'Digital';
  if (sinTilde === 'UAR') return 'UAR';
  if (sinTilde === 'REESTUDIO') return 'Reestudio';
  if (sinTilde === 'BIOMETRIA') return 'Biometría';
  if (sinTilde === 'INDUCCION') return 'Inducción';
  return v;
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('MetricasPanel')
    .evaluate()
    .setTitle('Métricas Análisis')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getEmailUsuario() {
  return Session.getActiveUser().getEmail();
}

/**
 * Helper para formatear string a fecha JavaScript
 */
function parseFechaDDMMYYYY(fechaStr) {
  if (!fechaStr || typeof fechaStr !== 'string') return null;
  const partes = fechaStr.trim().split('/');
  if (partes.length !== 3) return null;
  const dia = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10) - 1;
  const anio = parseInt(partes[2], 10);
  if (isNaN(dia) || isNaN(mes) || isNaN(anio)) return null;
  const fecha = new Date(anio, mes, dia);
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes || fecha.getDate() !== dia) return null;
  return fecha;
}

/**
 * Parsea un datetime string "dd/MM/yyyy HH:mm:ss" o "dd/MM/yyyy HH:mm" a Date
 */
function parseDatetimeStr(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim();
  var partes = str.split(' ');
  if (partes.length < 2) return null;
  var fechaParts = partes[0].split('/');
  if (fechaParts.length !== 3) return null;
  var horaParts = partes[1].split(':');
  if (horaParts.length < 2) return null;
  var dia = parseInt(fechaParts[0], 10);
  var mes = parseInt(fechaParts[1], 10) - 1;
  var anio = parseInt(fechaParts[2], 10);
  var h = parseInt(horaParts[0], 10);
  var m = parseInt(horaParts[1], 10);
  var s = horaParts.length >= 3 ? parseInt(horaParts[2], 10) : 0;
  if (isNaN(dia) || isNaN(mes) || isNaN(anio) || isNaN(h) || isNaN(m)) return null;
  return new Date(anio, mes, dia, h, m, s);
}

/**
 * Determina la sucursal/ciudad basándose en el número de póliza.
 */
function obtenerSucursalPorPoliza(polizaStr) {
  const num = parseInt(String(polizaStr).trim(), 10);
  if (isNaN(num)) return "Sin clasificar";
  if (num === 0) return "Operador Inmobiliario";
  if (num >= 1 && num <= 9999) return "Bogotá";
  if (num >= 10000 && num <= 10999) return "Cali";
  if (num >= 11000 && num <= 11999) return "Bucaramanga";
  if (num >= 12000 && num <= 12999) return "Eje Cafetero";
  if (num >= 13000 && num <= 13999) return "Medellín";
  if (num >= 14000 && num <= 14999) return "Barranquilla";
  if (num >= 15000 && num <= 15999) return "Cartagena";
  if (num >= 16000 && num <= 16999) return "Eje Cafetero";
  return "Sin clasificar";
}

function _parsearFechaFlexible(str) {
  if (!str) return null;
  str = String(str).trim().split(' ')[0];
  var d, m, y;
  if (str.indexOf('/') > -1) {
    var p = str.split('/');
    if (p.length !== 3) return null;
    d = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; y = parseInt(p[2], 10);
  } else if (str.indexOf('-') > -1) {
    var p = str.split('-');
    if (p.length !== 3) return null;
    if (p[0].length === 4) { y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; d = parseInt(p[2], 10); }
    else { d = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; y = parseInt(p[2], 10); }
  } else if (str.length === 8 && !isNaN(str)) {
    y = parseInt(str.substring(0, 4), 10); m = parseInt(str.substring(4, 6), 10) - 1; d = parseInt(str.substring(6, 8), 10);
  } else {
    return null;
  }
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  return new Date(y, m, d);
}

/**
 * Carga la hoja "score" como diccionario en memoria.
 * Mapea Poliza -> { inmobiliaria, segmento }
 */
function cargarDiccionarioScore() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get('scoreMap');
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  var scoreMap = {};
  try {
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hojaScore = ss.getSheetByName("score");
    if (hojaScore) {
      var data = hojaScore.getDataRange().getDisplayValues();
      var headers = data[0].map(function(h) { return h.trim().toLowerCase(); });
      var idxPoliza = headers.indexOf("poliza");
      var idxInmobiliaria = headers.indexOf("inmobiliaria");
      var idxSegmento = headers.indexOf("segmentación final");
      if (idxPoliza < 0) idxPoliza = headers.indexOf("póliza");
      if (idxSegmento < 0) idxSegmento = headers.indexOf("segmentacion final");
      if (idxSegmento < 0) idxSegmento = headers.indexOf("segmentación");
      if (idxSegmento < 0) idxSegmento = headers.indexOf("segmento");

      if (idxPoliza >= 0 && idxInmobiliaria >= 0 && idxSegmento >= 0) {
        for (var i = 1; i < data.length; i++) {
          var poliza = String(data[i][idxPoliza] || "").trim();
          if (!poliza) continue;
          scoreMap[poliza] = {
            inmobiliaria: String(data[i][idxInmobiliaria] || "").trim() || "Sin Nombre",
            segmento: normalizarSegmento(String(data[i][idxSegmento] || "").trim())
          };
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se pudo cargar la hoja score: " + e.message);
  }

  try {
    var json = JSON.stringify(scoreMap);
    if (json.length < 90000) cache.put('scoreMap', json, 21600);
  } catch (e) {}

  return scoreMap;
}

/**
 * Normaliza el segmento a las categorías estándar
 */
function normalizarSegmento(seg) {
  if (!seg) return "Sin Categoría";
  var s = seg.toUpperCase().trim();
  if (s.indexOf("VIP") >= 0) return "VIP";
  if (s.indexOf("MEDIAN") >= 0) return "Medianas";
  if (s.indexOf("PEQUEÑ") >= 0 || s.indexOf("PEQUEÑ") >= 0) return "Pequeñas";
  if (s.indexOf("DESARR") >= 0) return "Desarrollo";
  if (s === "") return "Sin Categoría";
  return seg;
}

/**
 * Obtiene segmento e inmobiliaria para una póliza usando el diccionario score
 */
function obtenerSegmentoInmobiliaria(polizaStr, scoreMap) {
  var poliza = String(polizaStr || "").trim();
  if (scoreMap[poliza]) {
    return scoreMap[poliza];
  }
  return { inmobiliaria: "Sin Nombre", segmento: "Sin Categoría" };
}

/**
 * Obtiene todas las métricas agregadas para el rango de fechas dado.
 * Incluye: Tiempo de Cola, Segmentación por Inmobiliaria y Semáforo de Backlog.
 */
function obtenerDatosMetricas(fechaDesde, fechaHasta) {
  const ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  const hoja = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
  if (!hoja) throw new Error("No se pudo acceder a la hoja de solicitudes.");

  const data = hoja.getDataRange().getDisplayValues();
  const desde = parseFechaDDMMYYYY(fechaDesde);
  const hasta = parseFechaDDMMYYYY(fechaHasta);
  if (!desde || !hasta) throw new Error("Formato de fecha inválido. Use dd/MM/yyyy.");

  hasta.setHours(23, 59, 59, 999);

  // Cargar diccionario de score (inmobiliarias y segmentos)
  var scoreMap = cargarDiccionarioScore();

  // Abrir la hoja de reestudios una única vez
  let ssReest = null;
  let hojaReest = null;
  let tieneReestudios = false;
  try {
    ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    tieneReestudios = (hojaReest !== null);
  } catch (e) {
    Logger.log("Aviso: No se pudo conectar a la hoja de reestudios: " + e.message);
  }

  let totalGestionadas = 0;
  let sumaTiempos = 0;
  let countTiempos = 0;
  let sumaTiemposResolucion = 0;
  let countTiemposResolucion = 0;
  let aprobadas = 0;
  let negadas = 0;
  let aplazadas = 0;
  let fueraDeSLA = 0;

  // Tiempo de Cola acumuladores
  let sumaTiempoCola = 0;
  let countTiempoCola = 0;

  const produccionMap = {};
  const slaMap = {};
  const analistaMap = {};
  const sucursalMap = {};
  const tipoMap = {};
  const tiemposDetalle = [];
  const negacionSucursal = {};

  // Segmentación por Inmobiliaria
  // segmentoInmobMap[segmento][inmobiliaria] = { count, sumaCola, countCola, sumaGestion, countGestion }
  var segmentoInmobMap = {};

  // 1. Procesar Histórico de Gestiones
  for (let i = 1; i < data.length; i++) {
    const fila = data[i];
    const fechaFinRaw = String(fila[26] || "").trim();
    if (!fechaFinRaw) continue;
    const fechaGestionStr = fechaFinRaw.split(' ')[0];

    const fechaGestion = parseFechaDDMMYYYY(fechaGestionStr);
    if (!fechaGestion || fechaGestion < desde || fechaGestion > hasta) continue;

    totalGestionadas++;
    const estado = String(fila[16] || "").toUpperCase().trim();
    const nombre = String(fila[27] || "Sin nombre").trim();
    const tiempoGestionRaw = String(fila[35] || "").trim();
    const tiempoResolucionRaw = String(fila[36] || "").trim();

    if (estado.includes("APROB") && !estado.includes("PENDIENTE")) aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) negadas++;
    else if (estado.includes("APLAZ")) aplazadas++;

    let tipoSol = _normalizarTipoAsignado(fila[60]) || 'Digital';

    if (!tipoMap[fechaGestionStr]) tipoMap[fechaGestionStr] = { Digital: 0, UAR: 0, Reestudio: 0, 'Biometría': 0, 'Inducción': 0 };
    tipoMap[fechaGestionStr][tipoSol]++;

    const tiempoGestion = parseFloat(tiempoGestionRaw.replace(',', '.'));
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) {
      sumaTiempos += tiempoGestion;
      countTiempos++;
    }
    const tiempoResolucionMin = parseFloat(tiempoResolucionRaw.replace(',', '.'));
    const tiempoResolucion = !isNaN(tiempoResolucionMin) ? tiempoResolucionMin / 60 : NaN;
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) {
      sumaTiemposResolucion += tiempoResolucion;
      countTiemposResolucion++;
    }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) fueraDeSLA++;

    // Tiempo de Cola: leído directamente de minutos_cola (col AI)
    var tiempoColaMin = null;
    var tiempoColaRawVal = parseFloat(String(fila[34] || "").replace(',', '.'));
    if (!isNaN(tiempoColaRawVal) && tiempoColaRawVal >= 0) {
      tiempoColaMin = tiempoColaRawVal;
      sumaTiempoCola += tiempoColaMin;
      countTiempoCola++;
    }

    // Segmentación por Inmobiliaria
    var polizaVal = String(fila[1] || "").trim();
    var infoSeg = obtenerSegmentoInmobiliaria(polizaVal, scoreMap);
    var seg = infoSeg.segmento;
    var inmob = infoSeg.inmobiliaria;
    if (!segmentoInmobMap[seg]) segmentoInmobMap[seg] = {};
    if (!segmentoInmobMap[seg][inmob]) segmentoInmobMap[seg][inmob] = { count: 0, sumaCola: 0, countCola: 0, sumaGestion: 0, countGestion: 0, sumaGeneral: 0, countGeneral: 0 };
    segmentoInmobMap[seg][inmob].count++;
    if (tiempoColaMin !== null) {
      segmentoInmobMap[seg][inmob].sumaCola += tiempoColaMin;
      segmentoInmobMap[seg][inmob].countCola++;
    }
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) {
      segmentoInmobMap[seg][inmob].sumaGestion += tiempoGestion;
      segmentoInmobMap[seg][inmob].countGestion++;
    }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) {
      segmentoInmobMap[seg][inmob].sumaGeneral += tiempoResolucion;
      segmentoInmobMap[seg][inmob].countGeneral++;
    }

    if (!produccionMap[fechaGestionStr]) produccionMap[fechaGestionStr] = 0;
    produccionMap[fechaGestionStr]++;

    if (!slaMap[fechaGestionStr]) slaMap[fechaGestionStr] = { dentroSLA: 0, fueraSLA: 0 };
    if (!isNaN(tiempoResolucion)) {
      if (tiempoResolucion <= 2) slaMap[fechaGestionStr].dentroSLA++;
      else slaMap[fechaGestionStr].fueraSLA++;
    }

    if (!analistaMap[nombre]) {
      analistaMap[nombre] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, diasInfo: {}, horasSlot: {} };
    }
    const a = analistaMap[nombre];
    a.total++;

    const fechaFinCompleta = String(fila[26] || "").trim();
    const horaFin = fechaFinCompleta.split(' ')[1] || "";
    if (horaFin && fechaGestionStr) {
      const horaFinNorm = normalizarHora(horaFin);
      if (!a.diasInfo[fechaGestionStr]) a.diasInfo[fechaGestionStr] = { count: 0, primera: horaFinNorm, ultima: horaFinNorm };
      a.diasInfo[fechaGestionStr].count++;
      if (horaFinNorm < a.diasInfo[fechaGestionStr].primera) a.diasInfo[fechaGestionStr].primera = horaFinNorm;
      if (horaFinNorm > a.diasInfo[fechaGestionStr].ultima) a.diasInfo[fechaGestionStr].ultima = horaFinNorm;
      const hSlot = parseInt(horaFin.split(':')[0], 10);
      if (!isNaN(hSlot)) a.horasSlot[hSlot] = (a.horasSlot[hSlot] || 0) + 1;
    }

    if (estado.includes("APROB") && !estado.includes("PENDIENTE")) a.aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) a.negadas++;
    else if (estado.includes("APLAZ")) a.aplazadas++;

    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) { a.sumaTiempo += tiempoGestion; a.countTiempo++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) { a.sumaTiempoResolucion += tiempoResolucion; a.countTiempoResolucion++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) a.fueraSLA++;

    const sucursal = obtenerSucursalPorPoliza(fila[1]);
    if (!sucursalMap[fechaGestionStr]) sucursalMap[fechaGestionStr] = {};
    sucursalMap[fechaGestionStr][sucursal] = (sucursalMap[fechaGestionStr][sucursal] || 0) + 1;

    if (!negacionSucursal[sucursal]) negacionSucursal[sucursal] = { total: 0, negadas: 0 };
    negacionSucursal[sucursal].total++;
    if (estado.includes("NEGAD") || estado.includes("RECHAZ")) negacionSucursal[sucursal].negadas++;

    const solicitudId = String(fila[0] || "").trim();
    var estadoLabel = (estado.includes("APROB") && !estado.includes("PENDIENTE")) ? "APROBADO" : (estado.includes("NEGAD") || estado.includes("RECHAZ")) ? "RECHAZADO" : estado.includes("APLAZ") ? "APLAZADO" : "OTRO";
    tiemposDetalle.push({ solicitud: solicitudId, poliza: polizaVal, fecha: fechaGestionStr, sucursal: sucursal, tipo: tipoSol, analista: nombre, segmento: seg, inmobiliaria: inmob, estado: estadoLabel, tGestion: !isNaN(tiempoGestion) && tiempoGestion >= 0 ? tiempoGestion : null, tResolucion: !isNaN(tiempoResolucion) && tiempoResolucion > 0 ? tiempoResolucion : null, tCola: tiempoColaMin !== null ? tiempoColaMin : null });
  }

  // 2. Procesar Reestudios
  if (tieneReestudios) {
    try {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 18).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const fechaFinStr = String(dataReest[i][9]).trim();
          if (!fechaFinStr) continue;

          const fechaParte = fechaFinStr.split(' ')[0];
          const fechaGestion = parseFechaDDMMYYYY(fechaParte);
          if (!fechaGestion || fechaGestion < desde || fechaGestion > hasta) continue;

          totalGestionadas++;
          const estadoR = String(dataReest[i][10]).toUpperCase().trim();
          const nombreR = String(dataReest[i][7] || "Sin nombre").trim();
          const tiempoResolucionReestRaw = String(dataReest[i][16] || "").trim();
          const tiempoGestionReestRaw = String(dataReest[i][15] || "").trim();

          if (estadoR.includes("APROB") && !estadoR.includes("PENDIENTE")) aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) negadas++;
          else if (estadoR.includes("APLAZ")) aplazadas++;

          const origenR = String(dataReest[i][3] || "").toUpperCase().trim();
          const tipoProcesoR = String(dataReest[i][4] || "").toUpperCase().trim();
          const esUarMetrica = origenR === "CORREO" && (tipoProcesoR.includes("ADICIONAL") || tipoProcesoR.includes("NUEVA"));
          const tipoReest = esUarMetrica ? 'UAR' : 'Reestudio';

          if (!tipoMap[fechaParte]) tipoMap[fechaParte] = { Digital: 0, UAR: 0, Reestudio: 0, 'Biometría': 0, 'Inducción': 0 };
          tipoMap[fechaParte][tipoReest]++;

          const tiempoResolucionReest = parseFloat(tiempoResolucionReestRaw.replace(',', '.'));
          const tiempoResolucionReestHoras = !isNaN(tiempoResolucionReest) ? tiempoResolucionReest / 60 : NaN;
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) {
            sumaTiemposResolucion += tiempoResolucionReestHoras;
            countTiemposResolucion++;
          }
          const tiempoGestionReest = parseFloat(tiempoGestionReestRaw.replace(',', '.'));
          if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) {
            sumaTiempos += tiempoGestionReest;
            countTiempos++;
          }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) fueraDeSLA++;

          // Tiempo de Cola: leído directamente de minutos_cola (col O)
          var tiempoColaReest = null;
          var tiempoColaReestVal = parseFloat(String(dataReest[i][14] || "").replace(',', '.'));
          if (!isNaN(tiempoColaReestVal) && tiempoColaReestVal >= 0) {
            tiempoColaReest = tiempoColaReestVal;
            sumaTiempoCola += tiempoColaReest;
            countTiempoCola++;
          }

          // Segmentación por Inmobiliaria para reestudios (poliza col R = 17)
          var polizaReest = String(dataReest[i][17] || dataReest[i][2] || "").trim();
          var infoSegR = obtenerSegmentoInmobiliaria(polizaReest, scoreMap);
          var segR = infoSegR.segmento;
          var inmobR = infoSegR.inmobiliaria;
          if (!segmentoInmobMap[segR]) segmentoInmobMap[segR] = {};
          if (!segmentoInmobMap[segR][inmobR]) segmentoInmobMap[segR][inmobR] = { count: 0, sumaCola: 0, countCola: 0, sumaGestion: 0, countGestion: 0, sumaGeneral: 0, countGeneral: 0 };
          segmentoInmobMap[segR][inmobR].count++;
          if (tiempoColaReest !== null) {
            segmentoInmobMap[segR][inmobR].sumaCola += tiempoColaReest;
            segmentoInmobMap[segR][inmobR].countCola++;
          }
          if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) {
            segmentoInmobMap[segR][inmobR].sumaGestion += tiempoGestionReest;
            segmentoInmobMap[segR][inmobR].countGestion++;
          }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) {
            segmentoInmobMap[segR][inmobR].sumaGeneral += tiempoResolucionReestHoras;
            segmentoInmobMap[segR][inmobR].countGeneral++;
          }

          if (!produccionMap[fechaParte]) produccionMap[fechaParte] = 0;
          produccionMap[fechaParte]++;

          if (!slaMap[fechaParte]) slaMap[fechaParte] = { dentroSLA: 0, fueraSLA: 0 };
          if (!isNaN(tiempoResolucionReestHoras)) {
            if (tiempoResolucionReestHoras <= 2) slaMap[fechaParte].dentroSLA++;
            else slaMap[fechaParte].fueraSLA++;
          }
          if (!analistaMap[nombreR]) {
            analistaMap[nombreR] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, diasInfo: {}, horasSlot: {} };
          }
          const aR = analistaMap[nombreR];
          aR.total++;

          const horaFinR = fechaFinStr.split(' ')[1] || "";
          if (horaFinR && fechaParte) {
            const horaFinRNorm = normalizarHora(horaFinR);
            if (!aR.diasInfo[fechaParte]) aR.diasInfo[fechaParte] = { count: 0, primera: horaFinRNorm, ultima: horaFinRNorm };
            aR.diasInfo[fechaParte].count++;
            if (horaFinRNorm < aR.diasInfo[fechaParte].primera) aR.diasInfo[fechaParte].primera = horaFinRNorm;
            if (horaFinRNorm > aR.diasInfo[fechaParte].ultima) aR.diasInfo[fechaParte].ultima = horaFinRNorm;
            const hSlotR = parseInt(horaFinR.split(':')[0], 10);
            if (!isNaN(hSlotR)) aR.horasSlot[hSlotR] = (aR.horasSlot[hSlotR] || 0) + 1;
          }
          if (estadoR.includes("APROB") && !estadoR.includes("PENDIENTE")) aR.aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) aR.negadas++;
          else if (estadoR.includes("APLAZ")) aR.aplazadas++;
          if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) { aR.sumaTiempo += tiempoGestionReest; aR.countTiempo++; }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) { aR.sumaTiempoResolucion += tiempoResolucionReestHoras; aR.countTiempoResolucion++; }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) aR.fueraSLA++;

          const sucursalR = obtenerSucursalPorPoliza(dataReest[i][17]);
          if (!sucursalMap[fechaParte]) sucursalMap[fechaParte] = {};
          sucursalMap[fechaParte][sucursalR] = (sucursalMap[fechaParte][sucursalR] || 0) + 1;

          if (!negacionSucursal[sucursalR]) negacionSucursal[sucursalR] = { total: 0, negadas: 0 };
          negacionSucursal[sucursalR].total++;
          if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) negacionSucursal[sucursalR].negadas++;

          const solicitudIdR = String(dataReest[i][1] || "").trim();
          var estadoLabelR = (estadoR.includes("APROB") && !estadoR.includes("PENDIENTE")) ? "APROBADO" : (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) ? "RECHAZADO" : estadoR.includes("APLAZ") ? "APLAZADO" : "OTRO";
          tiemposDetalle.push({ solicitud: solicitudIdR, poliza: polizaReest, fecha: fechaParte, sucursal: sucursalR, tipo: tipoReest, analista: nombreR, segmento: segR, inmobiliaria: inmobR, estado: estadoLabelR, tGestion: !isNaN(tiempoGestionReest) && tiempoGestionReest >= 0 ? tiempoGestionReest : null, tResolucion: !isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0 ? tiempoResolucionReestHoras : null, tCola: tiempoColaReest !== null ? tiempoColaReest : null });
        }
      }
    } catch (e) {
      Logger.log("Aviso: No se incluyeron reestudios en métricas: " + e.message);
    }
  }

  const tiempoPromedioMinutos = countTiempos > 0 ? Math.round((sumaTiempos / countTiempos) * 10) / 10 : 0;
  const tiempoPromedioResolucionHoras = countTiemposResolucion > 0 ? Number((sumaTiemposResolucion / countTiemposResolucion).toFixed(2)) : 0;
  const tasaAprobacion = totalGestionadas > 0 ? Math.round((aprobadas / totalGestionadas) * 1000) / 10 : 0;
  const tiempoColaPromedio = countTiempoCola > 0 ? Math.round((sumaTiempoCola / countTiempoCola) * 10) / 10 : 0;

  // Negación Directa y Total Radicadas (cada fila cuenta como una radicada)
  var negacionDirectaCount = 0;
  var totalRadicadas = 0;

  // Radicadas desde Historico_Gestiones (col 17 = fecha_radicacion) — SOLO lo ya gestionado
  for (var ri = 1; ri < data.length; ri++) {
    var frMain = _parsearFechaFlexible(String(data[ri][17] || "").trim());
    if (frMain && frMain >= desde && frMain <= hasta) {
      totalRadicadas++;
    }
  }

  // Radicadas AÚN NO gestionadas: viven en la hoja "solicitud" (se sacan de ahí en cuanto se
  // asignan), así que Historico_Gestiones nunca las ve. Se usa fechaResultado (col 18) en vez
  // de fechaRadicacion (col 17) porque esta última llega con error de datos desde la API para
  // estas filas — esto es exclusivamente para contar Total Radicadas, no afecta nada más.
  try {
    var ssSol = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hojaSol = ssSol.getSheetByName("solicitud");
    if (hojaSol && hojaSol.getLastRow() > 1) {
      var dataSol = hojaSol.getDataRange().getDisplayValues();
      for (var si = 1; si < dataSol.length; si++) {
        var frSol = _parsearFechaFlexible(String(dataSol[si][18] || "").trim());
        if (frSol && frSol >= desde && frSol <= hasta) {
          totalRadicadas++;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: Error contando radicadas pendientes de la hoja solicitud: " + e.message);
  }

  // Radicadas desde Reestudios (col 0 = fecha_radicacion)
  if (hojaReest) {
    try {
      var dataReestRad = hojaReest.getDataRange().getDisplayValues();
      for (var rj = 1; rj < dataReestRad.length; rj++) {
        var frReest = _parsearFechaFlexible(String(dataReestRad[rj][0] || "").trim());
        if (frReest && frReest >= desde && frReest <= hasta) {
          totalRadicadas++;
        }
      }
    } catch (e) {
      Logger.log("Aviso: Error contando radicadas de reestudios: " + e.message);
    }
  }

  // Radicadas y negación directa desde rechazado_gestion_directa (col 17 = fecha_radicacion)
  try {
    var ssRech = SpreadsheetApp.openById(SAI_CONFIG.SHEET_ID);
    var hojaRech = ssRech.getSheetByName('rechazado_gestion_directa');
    if (hojaRech && hojaRech.getLastRow() > 1) {
      var dataRech = hojaRech.getRange(2, 1, hojaRech.getLastRow() - 1, 18).getDisplayValues();
      for (var rk = 0; rk < dataRech.length; rk++) {
        var frRech = _parsearFechaFlexible(String(dataRech[rk][17] || "").trim());
        if (frRech && frRech >= desde && frRech <= hasta) {
          negacionDirectaCount++;
          totalRadicadas++;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se pudo leer rechazado_gestion_directa: " + e.message);
  }

  var pctNegacionDirecta = totalRadicadas > 0 ? Math.round((negacionDirectaCount / totalRadicadas) * 1000) / 10 : 0;
  var pctNegacion = totalGestionadas > 0 ? Math.round((negadas / totalGestionadas) * 1000) / 10 : 0;
  var pctAplazamiento = totalGestionadas > 0 ? Math.round((aplazadas / totalGestionadas) * 1000) / 10 : 0;

  // 3. Backlog con Semáforo de SLA
  let backlog = 0;
  const backlogDetalle = [];
  const ahora = new Date();
  // Backlog Digital/Biometría/Inducción desde Historico_Gestiones (ya cargado en `data`)
  // Columnas: [24] fecha asignación · [26] fecha fin gestión · [27] Nombre analista
  for (let i = 1; i < data.length; i++) {
    const fechaAsig = String(data[i][24] || "").trim();
    const fechaFin  = String(data[i][26] || "").trim();
    if (fechaAsig !== "" && fechaFin === "") {
      backlog++;
      var dtAsigBack = parseDatetimeStr(fechaAsig);
      var minutosEspera = 0;
      var alertaSLA = "verde";
      if (dtAsigBack) {
        minutosEspera = Math.round((ahora - dtAsigBack) / 60000);
        if (minutosEspera < 0) minutosEspera = 0;
        if (minutosEspera > 30) alertaSLA = "rojo";
        else if (minutosEspera >= 15) alertaSLA = "amarillo";
        else alertaSLA = "verde";
      }
      var polizaBack = String(data[i][1] || "").trim();
      var infoSegBack = obtenerSegmentoInmobiliaria(polizaBack, scoreMap);
      var tipoBack = _normalizarTipoAsignado(data[i][60]) || 'Digital';
      backlogDetalle.push({
        solicitud:      String(data[i][0]  || "").trim(),
        fechaAsignacion: fechaAsig,
        analista:       String(data[i][27] || "Sin nombre").trim(),
        minutosEspera:  minutosEspera,
        alertaSLA:      alertaSLA,
        inmobiliaria:   infoSegBack.inmobiliaria,
        segmento:       infoSegBack.segmento,
        tipo:           tipoBack,
        origen:         'Digital/Inducción'
      });
    }
  }

  // Backlog reestudios
  if (tieneReestudios) {
    try {
      const lastRowB = hojaReest.getLastRow();
      if (lastRowB > 1) {
        const dataB = hojaReest.getRange(2, 1, lastRowB - 1, 18).getDisplayValues();
        for (let i = 0; i < dataB.length; i++) {
          const fAsig = String(dataB[i][8]).trim();
          const fFin = String(dataB[i][9] || "").trim();
          if (fAsig !== "" && fFin === "") {
            backlog++;
            var dtAsigBackR = parseDatetimeStr(fAsig);
            var minutosEsperaR = 0;
            var alertaSLAR = "verde";
            if (dtAsigBackR) {
              minutosEsperaR = Math.round((ahora - dtAsigBackR) / 60000);
              if (minutosEsperaR < 0) minutosEsperaR = 0;
              if (minutosEsperaR > 30) alertaSLAR = "rojo";
              else if (minutosEsperaR >= 15) alertaSLAR = "amarillo";
              else alertaSLAR = "verde";
            }
            var polizaBackR = String(dataB[i][17] || dataB[i][2] || "").trim();
            var infoSegBackR = obtenerSegmentoInmobiliaria(polizaBackR, scoreMap);
            var tipoProcesoBack = String(dataB[i][4] || "").trim() || 'Reestudio';
            backlogDetalle.push({
              solicitud: String(dataB[i][1] || "").trim(),
              fechaAsignacion: fAsig,
              analista: String(dataB[i][7] || "Sin nombre").trim(),
              minutosEspera: minutosEsperaR,
              alertaSLA: alertaSLAR,
              inmobiliaria: infoSegBackR.inmobiliaria,
              segmento: infoSegBackR.segmento,
              tipo: tipoProcesoBack,
              origen: 'Reestudios/UAR'
            });
          }
        }
      }
    } catch(e) {
      Logger.log("Aviso: Error en backlog reestudios: " + e.message);
    }
  }

  // Ordenar backlog por mayor espera primero
  backlogDetalle.sort(function(a, b) { return b.minutosEspera - a.minutosEspera; });

  // Preparar datos de segmentación por inmobiliaria para frontend
  var segmentacion = {};
  Object.keys(segmentoInmobMap).forEach(function(seg) {
    segmentacion[seg] = Object.keys(segmentoInmobMap[seg]).map(function(inmob) {
      var d = segmentoInmobMap[seg][inmob];
      return {
        inmobiliaria: inmob,
        count: d.count,
        tiempoColaPromedio: d.countCola > 0 ? Math.round((d.sumaCola / d.countCola) * 10) / 10 : 0,
        tiempoGestionPromedio: d.countGestion > 0 ? Math.round((d.sumaGestion / d.countGestion) * 10) / 10 : 0,
        tiempoGeneralPromedio: d.countGeneral > 0 ? Number((d.sumaGeneral / d.countGeneral).toFixed(2)) : 0
      };
    }).sort(function(a, b) { return b.count - a.count; });
  });

  const tasaNegacionSucursal = Object.keys(negacionSucursal).map(s => ({
    sucursal: s,
    total: negacionSucursal[s].total,
    negadas: negacionSucursal[s].negadas,
    tasa: negacionSucursal[s].total > 0 ? Math.round((negacionSucursal[s].negadas / negacionSucursal[s].total) * 1000) / 10 : 0
  })).sort((a, b) => b.tasa - a.tasa);

  const fechasSLAOrden = Object.keys(slaMap).sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b));
  const tendenciaSLA = fechasSLAOrden.map(function(f) {
    const d = slaMap[f];
    const t = d.dentroSLA + d.fueraSLA;
    return { fecha: f, pctCumplimiento: t > 0 ? Math.round((d.dentroSLA / t) * 1000) / 10 : 100 };
  });

  const heatmapHora = {};
  for (let h = 6; h <= 21; h++) heatmapHora[h] = 0;
  Object.keys(analistaMap).forEach(nombre => {
    const slots = analistaMap[nombre].horasSlot;
    Object.keys(slots).forEach(h => { heatmapHora[h] = (heatmapHora[h] || 0) + slots[h]; });
  });

  const produccionDiaria = Object.keys(produccionMap)
    .sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b))
    .map(fecha => ({ fecha: fecha, cantidad: produccionMap[fecha] }));

  const slaDiario = Object.keys(slaMap)
    .sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b))
    .map(fecha => ({ fecha: fecha, dentroSLA: slaMap[fecha].dentroSLA, fueraSLA: slaMap[fecha].fueraSLA }));

  const porAnalista = Object.keys(analistaMap)
    .map(nombre => {
      const a = analistaMap[nombre];
      return {
        nombre: nombre,
        total: a.total,
        aprobadas: a.aprobadas,
        negadas: a.negadas,
        aplazadas: a.aplazadas,
        tiempoPromedio: a.countTiempo > 0 ? Math.round((a.sumaTiempo / a.countTiempo) * 10) / 10 : 0,
        tiempoPromedioGeneral: a.countTiempoResolucion > 0 ? Number((a.sumaTiempoResolucion / a.countTiempoResolucion).toFixed(2)) : 0,
        promedioPorHora: (function() {
          const dias = Object.keys(a.diasInfo);
          if (dias.length === 0) return 0;
          let sumaRates = 0;
          let diasConRango = 0;
          for (let d = 0; d < dias.length; d++) {
            const info = a.diasInfo[dias[d]];
            if (info.count <= 1) { sumaRates += info.count; diasConRango++; continue; }
            const pParts = info.primera.split(':');
            const uParts = info.ultima.split(':');
            const pMin = parseInt(pParts[0], 10) * 60 + parseInt(pParts[1], 10);
            const uMin = parseInt(uParts[0], 10) * 60 + parseInt(uParts[1], 10);
            const diffHoras = (uMin - pMin) / 60;
            if (diffHoras > 0) { sumaRates += info.count / diffHoras; diasConRango++; }
            else { sumaRates += info.count; diasConRango++; }
          }
          return diasConRango > 0 ? Math.round(sumaRates / diasConRango) : 0;
        })(),
        prodRealPorHora: (function() {
          const dias = Object.keys(a.diasInfo);
          if (dias.length === 0 || a.total === 0) return 0;
          const hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
          const inicioParts = HORA_INICIO_OPERACION.split(':');
          const inicioMin = parseInt(inicioParts[0], 10) * 60 + parseInt(inicioParts[1], 10);
          let sumaRates = 0;
          let diasValidos = 0;
          for (let d = 0; d < dias.length; d++) {
            const info = a.diasInfo[dias[d]];
            let corteMin;
            if (dias[d] === hoyStr) {
              const ahoraZ = new Date();
              const ahoraEnZona = Utilities.formatDate(ahoraZ, TIMEZONE, "HH:mm");
              const ahoraParts = ahoraEnZona.split(':');
              corteMin = parseInt(ahoraParts[0], 10) * 60 + parseInt(ahoraParts[1], 10);
            } else {
              const finParts = HORA_FIN_TURNO.split(':');
              corteMin = parseInt(finParts[0], 10) * 60 + parseInt(finParts[1], 10);
            }
            let horasTranscurridas = (corteMin - inicioMin) / 60;
            if (horasTranscurridas <= 0) horasTranscurridas = 1;
            sumaRates += info.count / horasTranscurridas;
            diasValidos++;
          }
          return diasValidos > 0 ? Math.round(sumaRates / diasValidos) : 0;
        })(),
        detalleHoras: (function() {
          const numDias = Object.keys(a.diasInfo).length || 1;
          const detalle = {};
          for (let h = 6; h <= 21; h++) {
            detalle[h] = a.horasSlot[h] ? Math.round(a.horasSlot[h] / numDias) : 0;
          }
          return detalle;
        })(),
        fueraSLA: a.fueraSLA
      };
    })
    .sort((a, b) => b.total - a.total);

  const sucursalesUnicas = {};
  Object.keys(sucursalMap).forEach(fecha => {
    Object.keys(sucursalMap[fecha]).forEach(s => { sucursalesUnicas[s] = true; });
  });
  const listaSucursales = Object.keys(sucursalesUnicas).sort();
  const porSucursal = {
    fechas: Object.keys(sucursalMap).sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b)),
    sucursales: listaSucursales,
    datos: {}
  };
  listaSucursales.forEach(s => {
    porSucursal.datos[s] = porSucursal.fechas.map(f => sucursalMap[f][s] || 0);
  });

  return {
    totalGestionadas: totalGestionadas,
    tiempoPromedioMinutos: tiempoPromedioMinutos,
    tiempoPromedioGeneralHoras: tiempoPromedioResolucionHoras,
    tiempoColaPromedio: tiempoColaPromedio,
    tasaAprobacion: tasaAprobacion,
    fueraDeSLA: fueraDeSLA,
    reestudiosDisponibles: tieneReestudios,
    backlog: backlog,
    backlogDetalle: backlogDetalle,
    segmentacion: segmentacion,
    produccionDiaria: produccionDiaria,
    distribucionEstados: { aprobadas: aprobadas, negadas: negadas, aplazadas: aplazadas },
    porAnalista: porAnalista,
    slaDiario: slaDiario,
    porSucursal: porSucursal,
    porTipo: Object.keys(tipoMap)
      .sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b))
      .map(fecha => ({ fecha: fecha, Digital: tipoMap[fecha].Digital, UAR: tipoMap[fecha].UAR, Reestudio: tipoMap[fecha].Reestudio, Biometria: tipoMap[fecha]['Biometría'], Induccion: tipoMap[fecha]['Inducción'] })),
    tiemposDetalle: tiemposDetalle,
    tasaNegacionSucursal: tasaNegacionSucursal,
    tendenciaSLA: tendenciaSLA,
    heatmapHora: heatmapHora,
    negacionDirecta: negacionDirectaCount,
    pctNegacionDirecta: pctNegacionDirecta,
    pctNegacion: pctNegacion,
    pctAplazamiento: pctAplazamiento,
    totalRadicadas: totalRadicadas,
    aGestionNormal: totalRadicadas - negacionDirectaCount
  };
}

/**
 * Obtiene métricas de rendimiento individual por analista para una fecha específica.
 */
function obtenerRendimientoPorDia(fechaFiltro) {
  let fechaStr;
  if (fechaFiltro && /^\d{4}-\d{2}-\d{2}$/.test(fechaFiltro)) {
    const partes = fechaFiltro.split("-");
    fechaStr = partes[2] + "/" + partes[1] + "/" + partes[0];
  } else {
    fechaStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  }

  const ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  const hoja = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
  const data = hoja.getDataRange().getDisplayValues();
  const analistaMap = {};

  for (let i = 1; i < data.length; i++) {
    const fechaFinRawR = String(data[i][26] || "").trim();
    if (!fechaFinRawR) continue;
    const fechaGestionStr = fechaFinRawR.split(' ')[0];
    if (fechaGestionStr !== fechaStr) continue;

    const estado = String(data[i][16] || "").toUpperCase().trim();
    const nombre = String(data[i][27] || "Sin nombre").trim();
    const correo = String(data[i][25] || "").toLowerCase().trim();
    const clave = correo || nombre;
    const tiempoGestionRaw = String(data[i][35] || "").trim();
    const tiempoResolucionRaw = String(data[i][36] || "").trim();
    const fechaFinCompleta = String(data[i][26] || "").trim();
    const horaFin = fechaFinCompleta.split(' ')[1] || "";

    if (!analistaMap[clave]) {
      analistaMap[clave] = { nombre: nombre, correo: correo, total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, primera: "", ultima: "", count: 0, horasSlot: {} };
    }
    const a = analistaMap[clave];
    a.total++;
    a.count++;

    if (estado.includes("APROB") && !estado.includes("PENDIENTE")) a.aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) a.negadas++;
    else if (estado.includes("APLAZ")) a.aplazadas++;

    const tiempoGestion = parseFloat(tiempoGestionRaw.replace(',', '.'));
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) { a.sumaTiempo += tiempoGestion; a.countTiempo++; }

    const tiempoResolucionMinD = parseFloat(tiempoResolucionRaw.replace(',', '.'));
    const tiempoResolucion = !isNaN(tiempoResolucionMinD) ? tiempoResolucionMinD / 60 : NaN;
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) { a.sumaTiempoResolucion += tiempoResolucion; a.countTiempoResolucion++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) a.fueraSLA++;

    if (horaFin) {
      const horaFinNorm = normalizarHora(horaFin);
      if (!a.primera || horaFinNorm < a.primera) a.primera = horaFinNorm;
      if (!a.ultima || horaFinNorm > a.ultima) a.ultima = horaFinNorm;
      const hSlot = parseInt(horaFin.split(':')[0], 10);
      if (!isNaN(hSlot)) a.horasSlot[hSlot] = (a.horasSlot[hSlot] || 0) + 1;
    }
  }

  try {
    const ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 17).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const fechaFinStr = String(dataReest[i][9]).trim();
          if (!fechaFinStr) continue;
          const fechaParte = fechaFinStr.split(' ')[0];
          if (fechaParte !== fechaStr) continue;

          const estadoR = String(dataReest[i][10]).toUpperCase().trim();
          const nombreR = String(dataReest[i][7] || "Sin nombre").trim();
          const correoR = String(dataReest[i][6] || "").toLowerCase().trim();
          const claveR = correoR || nombreR;
          const tiempoResolucionReestRaw = String(dataReest[i][16] || "").trim();
          const tiempoGestionReestRaw = String(dataReest[i][15] || "").trim();
          const horaFinR = fechaFinStr.split(' ')[1] || "";

          if (!analistaMap[claveR]) {
            analistaMap[claveR] = { nombre: nombreR, correo: correoR, total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, primera: "", ultima: "", count: 0, horasSlot: {} };
          }
          const aR = analistaMap[claveR];
          aR.total++;
          aR.count++;

          if (estadoR.includes("APROB") && !estadoR.includes("PENDIENTE")) aR.aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) aR.negadas++;
          else if (estadoR.includes("APLAZ")) aR.aplazadas++;

          const tiempoGestionReest = parseFloat(tiempoGestionReestRaw.replace(',', '.'));
          if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) { aR.sumaTiempo += tiempoGestionReest; aR.countTiempo++; }

          const tiempoResolucionReest = parseFloat(tiempoResolucionReestRaw.replace(',', '.'));
          const tiempoResolucionReestHoras = !isNaN(tiempoResolucionReest) ? tiempoResolucionReest / 60 : NaN;
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) { aR.sumaTiempoResolucion += tiempoResolucionReestHoras; aR.countTiempoResolucion++; }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) aR.fueraSLA++;

          if (horaFinR) {
            const horaFinRNorm = normalizarHora(horaFinR);
            if (!aR.primera || horaFinRNorm < aR.primera) aR.primera = horaFinRNorm;
            if (!aR.ultima || horaFinRNorm > aR.ultima) aR.ultima = horaFinRNorm;
            const hSlotR = parseInt(horaFinR.split(':')[0], 10);
            if (!isNaN(hSlotR)) aR.horasSlot[hSlotR] = (aR.horasSlot[hSlotR] || 0) + 1;
          }
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso reestudios rendimiento por día: " + e.message);
  }

  const hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  const inicioParts = HORA_INICIO_OPERACION.split(':');
  const inicioMin = parseInt(inicioParts[0], 10) * 60 + parseInt(inicioParts[1], 10);

  return Object.keys(analistaMap).map(clave => {
    const a = analistaMap[clave];
    let ritmoEfec = 0;
    if (a.count >= 2 && a.primera && a.ultima) {
      const pParts = a.primera.split(':');
      const uParts = a.ultima.split(':');
      const pMin = parseInt(pParts[0], 10) * 60 + parseInt(pParts[1], 10);
      const uMin = parseInt(uParts[0], 10) * 60 + parseInt(uParts[1], 10);
      const diffHoras = (uMin - pMin) / 60;
      ritmoEfec = diffHoras > 0 ? Math.round(a.count / diffHoras) : 0;
    }

    let corteMin;
    if (fechaStr === hoyStr) {
      const ahoraEnZona = Utilities.formatDate(new Date(), TIMEZONE, "HH:mm");
      const ahoraParts = ahoraEnZona.split(':');
      corteMin = parseInt(ahoraParts[0], 10) * 60 + parseInt(ahoraParts[1], 10);
    } else {
      const finParts = HORA_FIN_TURNO.split(':');
      corteMin = parseInt(finParts[0], 10) * 60 + parseInt(finParts[1], 10);
    }
    let startMin = inicioMin;
    if (a.primera) {
      const pInicioParts = a.primera.split(':');
      const primeroMin = parseInt(pInicioParts[0], 10) * 60 + parseInt(pInicioParts[1], 10);
      startMin = Math.max(inicioMin, primeroMin);
    }
    let horasTranscurridas = (corteMin - startMin) / 60;
    if (horasTranscurridas <= 0) horasTranscurridas = 1;
    const prodReal = Math.round(a.total / horasTranscurridas);

    return {
      nombre: a.nombre || clave,
      correo: a.correo || "",
      total: a.total,
      aprobadas: a.aprobadas,
      negadas: a.negadas,
      aplazadas: a.aplazadas,
      tiempoPromedio: a.countTiempo > 0 ? Math.round((a.sumaTiempo / a.countTiempo) * 10) / 10 : 0,
      tiempoPromedioGeneral: a.countTiempoResolucion > 0 ? Number((a.sumaTiempoResolucion / a.countTiempoResolucion).toFixed(2)) : 0,
      promedioPorHora: ritmoEfec,
      prodRealPorHora: prodReal,
      detalleHoras: (function() {
        const detalle = {};
        for (let h = 6; h <= 21; h++) {
          detalle[h] = a.horasSlot[h] || 0;
        }
        return detalle;
      })(),
      fueraSLA: a.fueraSLA
    };
  }).sort((a, b) => b.total - a.total);
}

/**
 * Normaliza una cadena de fecha dd/MM/yyyy a formato con ceros dd/MM/yyyy.
 */
function normalizarFechaDDMMYYYY(fechaRaw) {
  if (!fechaRaw || typeof fechaRaw !== 'string') return "";
  const soloFecha = fechaRaw.trim().split(' ')[0];
  const partes = soloFecha.split('/');
  if (partes.length !== 3) return "";
  const dia = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  const anio = parseInt(partes[2], 10);
  if (isNaN(dia) || isNaN(mes) || isNaN(anio)) return "";
  return String(dia).padStart(2, '0') + "/" + String(mes).padStart(2, '0') + "/" + anio;
}

/**
 * Normaliza una hora a formato HH:MM:SS con ceros iniciales para comparación correcta.
 */
function normalizarHora(horaRaw) {
  if (!horaRaw || typeof horaRaw !== 'string') return "";
  const partes = horaRaw.trim().split(':');
  if (partes.length < 2) return "";
  const h = String(parseInt(partes[0], 10)).padStart(2, '0');
  const m = String(parseInt(partes[1], 10)).padStart(2, '0');
  const s = partes.length >= 3 ? String(parseInt(partes[2], 10)).padStart(2, '0') : "00";
  return h + ":" + m + ":" + s;
}

/**
 * Compara si la parte de fecha de un datetime coincide exactamente con la fecha objetivo.
 */
function coincideFecha(fechaRaw, fechaObjetivo) {
  return normalizarFechaDDMMYYYY(fechaRaw) === fechaObjetivo;
}

/**
 * Obtiene la lista de analistas activos con la hora de su primer resultado del día.
 */
function admin_obtenerAsesoresActivosPrimerResultado(fechaFiltro) {
  const ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  const hojaUser = ss.getSheetByName("Usuarios");
  const dataUser = hojaUser.getDataRange().getValues();
  const hojaSol = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
  const dataSol = hojaSol.getDataRange().getDisplayValues();

  const hoyRealStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  let fechaStr;
  if (fechaFiltro && /^\d{4}-\d{2}-\d{2}$/.test(fechaFiltro)) {
    const partesFecha = fechaFiltro.split("-");
    fechaStr = partesFecha[2] + "/" + partesFecha[1] + "/" + partesFecha[0];
  } else {
    fechaStr = hoyRealStr;
  }
  const esHoy = (fechaStr === hoyRealStr);

  let ssReest = null;
  let hojaReest = null;
  let tieneReestudios = false;
  try {
    ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    tieneReestudios = (hojaReest !== null);
  } catch (e) {
    Logger.log("Aviso: No se pudo conectar a la hoja de reestudios en seguimiento: " + e.message);
  }

  const primerResultadoMap = {};
  const ultimoResultadoMap = {};
  const gestionadasMap = {};
  const pendientesMap = {};
  const tiemposGestionMap = {};
  const tiemposGeneralMap = {};

  for (let i = 1; i < dataSol.length; i++) {
    const asignado = String(dataSol[i][25] || "").toLowerCase().trim();
    const fechaFinRaw = String(dataSol[i][26] || "").trim();
    const tiempoGestionVal = String(dataSol[i][35] || "").trim();
    const tiempoGeneralVal = String(dataSol[i][36] || "").trim();
    if (!asignado) continue;
    if (fechaFinRaw && coincideFecha(fechaFinRaw, fechaStr)) {
      gestionadasMap[asignado] = (gestionadasMap[asignado] || 0) + 1;
      const tg = parseFloat(tiempoGestionVal.replace(',', '.'));
      if (!isNaN(tg) && tg > 0) {
        if (!tiemposGestionMap[asignado]) tiemposGestionMap[asignado] = [];
        tiemposGestionMap[asignado].push(tg);
      }
      const tGenMin = parseFloat(tiempoGeneralVal.replace(',', '.'));
      if (!isNaN(tGenMin) && tGenMin > 0) {
        if (!tiemposGeneralMap[asignado]) tiemposGeneralMap[asignado] = [];
        tiemposGeneralMap[asignado].push(Number((tGenMin / 60).toFixed(2)));
      }
      const partes = fechaFinRaw.split(" ");
      const hora = partes.length > 1 ? normalizarHora(partes[1]) : "";
      if (hora) {
        if (!primerResultadoMap[asignado] || hora < primerResultadoMap[asignado]) primerResultadoMap[asignado] = hora;
        if (!ultimoResultadoMap[asignado] || hora > ultimoResultadoMap[asignado]) ultimoResultadoMap[asignado] = hora;
      }
    }
  }

  if (tieneReestudios) {
    try {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 17).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const asignado = String(dataReest[i][6]).trim().toLowerCase();
          const fechaFinRaw = String(dataReest[i][9]).trim();
          const tiempoTotalReest = String(dataReest[i][16] || "").trim();
          const tiempoGestionReest = String(dataReest[i][15] || "").trim();

          if (!asignado) continue;
          if (fechaFinRaw && coincideFecha(fechaFinRaw, fechaStr)) {
            gestionadasMap[asignado] = (gestionadasMap[asignado] || 0) + 1;
            const tgReest = parseFloat(tiempoGestionReest);
            if (!isNaN(tgReest) && tgReest > 0) {
              if (!tiemposGestionMap[asignado]) tiemposGestionMap[asignado] = [];
              tiemposGestionMap[asignado].push(tgReest);
            }
            const tGenReest = parseFloat(tiempoTotalReest);
            if (!isNaN(tGenReest) && tGenReest > 0) {
              if (!tiemposGeneralMap[asignado]) tiemposGeneralMap[asignado] = [];
              tiemposGeneralMap[asignado].push(Number((tGenReest / 60).toFixed(2)));
            }
            const partes = fechaFinRaw.split(" ");
            const hora = partes.length > 1 ? normalizarHora(partes[1]) : "";
            if (hora) {
              if (!primerResultadoMap[asignado] || hora < primerResultadoMap[asignado]) primerResultadoMap[asignado] = hora;
              if (!ultimoResultadoMap[asignado] || hora > ultimoResultadoMap[asignado]) ultimoResultadoMap[asignado] = hora;
            }
          }
        }
      }
    } catch (e) {
      Logger.log("Aviso: No se incluyeron reestudios en seguimiento: " + e.message);
    }
  }

  const hojaSolicitud = ss.getSheetByName("solicitud");
  if (hojaSolicitud) {
    const dataSolicitud = hojaSolicitud.getDataRange().getDisplayValues();
    for (let i = 1; i < dataSolicitud.length; i++) {
      const asignado = String(dataSolicitud[i][27] || "").toLowerCase().trim();
      const fechaAsig = String(dataSolicitud[i][26] || "").trim();
      const fechaFin = String(dataSolicitud[i][28] || "").trim();
      if (!asignado || fechaAsig === "") continue;
      if (fechaFin === "") {
        pendientesMap[asignado] = (pendientesMap[asignado] || 0) + 1;
      }
    }
  }

  if (tieneReestudios) {
    try {
      const lastRowP = hojaReest.getLastRow();
      if (lastRowP > 1) {
        const dataP = hojaReest.getRange(2, 7, lastRowP - 1, 4).getDisplayValues();
        for (let i = 0; i < dataP.length; i++) {
          const asignado = String(dataP[i][0]).trim().toLowerCase();
          const fechaAsig = String(dataP[i][2]).trim();
          const fechaFin = String(dataP[i][3]).trim();
          if (!asignado || fechaAsig === "") continue;
          if (fechaFin === "") {
            pendientesMap[asignado] = (pendientesMap[asignado] || 0) + 1;
          }
        }
      }
    } catch (e) {
      Logger.log("Aviso: No se incluyeron reestudios pendientes en seguimiento: " + e.message);
    }
  }

  const resultado = [];
  for (let j = 1; j < dataUser.length; j++) {
    const estadoUser = String(dataUser[j][5] || "").toUpperCase().trim();
    if (estadoUser === "") continue;

    const correo = String(dataUser[j][2] || "").toLowerCase().trim();
    const nombre = String(dataUser[j][1] || "").trim();
    const especialidad = String(dataUser[j][4] || "").trim();
    const arrGestion = tiemposGestionMap[correo] || [];
    const arrGeneral = tiemposGeneralMap[correo] || [];
    const promedioGestion = arrGestion.length > 0 ? Number((arrGestion.reduce((a, b) => a + b, 0) / arrGestion.length).toFixed(1)) : null;
    const promedioGeneral = arrGeneral.length > 0 ? Number((arrGeneral.reduce((a, b) => a + b, 0) / arrGeneral.length).toFixed(2)) : null;

    resultado.push({
      nombre: nombre,
      correo: correo,
      estado: estadoUser,
      especialidad: especialidad,
      gestionadas: gestionadasMap[correo] || 0,
      pendientes: pendientesMap[correo] || 0,
      primerResultado: primerResultadoMap[correo] || null,
      ultimoResultado: ultimoResultadoMap[correo] || null,
      promedioGestion: promedioGestion,
      promedioGeneral: promedioGeneral
    });
  }

  resultado.sort((a, b) => {
    if (!a.primerResultado && !b.primerResultado) return a.nombre.localeCompare(b.nombre);
    if (!a.primerResultado) return -1;
    if (!b.primerResultado) return 1;
    return a.primerResultado.localeCompare(b.primerResultado);
  });

  return { esHoy: esHoy, fecha: fechaStr, datos: resultado };
}

/**
 * Obtiene el detalle de solicitudes de un analista para una fecha específica.
 */
function admin_obtenerDetallePorAnalista(correoAnalista, fechaFiltro) {
  correoAnalista = String(correoAnalista || "").toLowerCase().trim();
  if (!correoAnalista) return { success: false, message: "Correo no proporcionado." };

  const ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  const hojaSol = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
  const dataSol = hojaSol.getDataRange().getDisplayValues();
  const hoyRealStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");

  let fechaStr;
  if (fechaFiltro && /^\d{4}-\d{2}-\d{2}$/.test(fechaFiltro)) {
    const partesFecha = fechaFiltro.split("-");
    fechaStr = partesFecha[2] + "/" + partesFecha[1] + "/" + partesFecha[0];
  } else {
    fechaStr = hoyRealStr;
  }
  const esHoy = (fechaStr === hoyRealStr);

  let nombreAnalista = correoAnalista;
  const hojaUser = ss.getSheetByName("Usuarios");
  const dataUser = hojaUser.getDataRange().getValues();
  for (let j = 1; j < dataUser.length; j++) {
    if (String(dataUser[j][2]).toLowerCase().trim() === correoAnalista) {
      nombreAnalista = String(dataUser[j][1]).trim();
      break;
    }
  }

  const gestionadas = [];
  const pendientes = [];
  for (let i = 1; i < dataSol.length; i++) {
    const asignado = String(dataSol[i][25] || "").toLowerCase().trim();
    if (asignado !== correoAnalista) continue;

    const solicitudId = String(dataSol[i][0] || "").trim();
    const poliza = String(dataSol[i][1] || "");
    const estado = String(dataSol[i][16] || "").toUpperCase();
    const fechaRadicacion = String(dataSol[i][17] || "").trim();
    const fechaAsignacion = String(dataSol[i][24] || "").trim();
    const fechaFin = String(dataSol[i][26] || "").trim();
    const tiempoGestion = String(dataSol[i][35] || "").trim();
    const tiempoGeneralMin = parseFloat(String(dataSol[i][36] || "").replace(',', '.'));
    const tiempoSLA = !isNaN(tiempoGeneralMin) && tiempoGeneralMin > 0 ? String(Number((tiempoGeneralMin / 60).toFixed(2))) : "";
    const tiempoGeneral = tiempoSLA;

    if (!solicitudId) continue;
    let tipo = _normalizarTipoAsignado(dataSol[i][60]) || 'Digital';

    if (fechaFin !== "" && coincideFecha(fechaFin, fechaStr)) {
      gestionadas.push({
        id: solicitudId, poliza: poliza, tipo: tipo, estado: estado,
        fechaRadicacion: fechaRadicacion, fechaAsignacion: fechaAsignacion,
        fechaFin: fechaFin, duracion: tiempoGestion, tiempoSLA: tiempoSLA, tiempoGeneral: tiempoGeneral
      });
    }

    if (esHoy) {
      if (fechaAsignacion !== "" && fechaFin === "") {
        pendientes.push({ id: solicitudId, poliza: poliza, tipo: tipo, estado: estado, fechaRadicacion: fechaRadicacion, fechaAsignacion: fechaAsignacion });
      }
    } else {
      if (fechaAsignacion && coincideFecha(fechaAsignacion, fechaStr)) {
        pendientes.push({ id: solicitudId, poliza: poliza, tipo: tipo, estado: estado, fechaRadicacion: fechaRadicacion, fechaAsignacion: fechaAsignacion });
      }
    }
  }

  try {
    const ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 17).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const asignado = String(dataReest[i][6]).toLowerCase().trim();
          if (asignado !== correoAnalista) continue;

          const solicitud = String(dataReest[i][1] || "").trim();
          const origen = String(dataReest[i][3]).trim();
          const tipoProceso = String(dataReest[i][4]).trim();
          const fechaRadicR = String(dataReest[i][0] || "").trim();
          const fechaAsig = String(dataReest[i][8]).trim();
          const fechaFin = String(dataReest[i][9]).trim();
          const estadoG = String(dataReest[i][10]).trim();
          const tiempoTotalR = String(dataReest[i][16] || "").trim();
          const tiempoG = String(dataReest[i][15]).trim();

          if (!solicitud) continue;
          const origenUp = origen.toUpperCase();
          const tipoUp = tipoProceso.toUpperCase();
          const esUar = origenUp === "CORREO" && (tipoUp.includes("ADICIONAL") || tipoUp.includes("NUEVA"));
          const tipoLabel = esUar ? 'UAR' : 'Reestudio';

          if (fechaFin !== "" && coincideFecha(fechaFin, fechaStr)) {
            let tGenReestH = "";
            const tResFloat = parseFloat(tiempoTotalR.replace(',', '.'));
            if (!isNaN(tResFloat) && tResFloat > 0) tGenReestH = String(Number((tResFloat / 60).toFixed(2)));
            gestionadas.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: estadoG, fechaRadicacion: fechaRadicR, fechaAsignacion: fechaAsig, fechaFin: fechaFin, duracion: tiempoG, tiempoSLA: tiempoTotalR, tiempoGeneral: tGenReestH });
          }

          if (esHoy) {
            if (fechaAsig !== "" && fechaFin === "") {
              pendientes.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: "En gestión", fechaRadicacion: fechaRadicR, fechaAsignacion: fechaAsig });
            }
          } else {
            if (fechaAsig && coincideFecha(fechaAsig, fechaStr)) {
              pendientes.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: estadoG || "En gestión", fechaRadicacion: fechaRadicR, fechaAsignacion: fechaAsig });
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log("Error leyendo reestudios para detalle analista: " + e.message);
  }

  return {
    success: true,
    nombre: nombreAnalista,
    correo: correoAnalista,
    esHoy: esHoy,
    fecha: fechaStr,
    gestionadas: gestionadas,
    pendientes: pendientes
  };
}

// ============================================================================
// CONTROL DE ACCESO POR SECCIONES
// ============================================================================

var ACCESS_COORD_KEY = "ACCESS_COORDINADORES";
var ACCESS_BIO_KEY = "ACCESS_BIOMETRIA";
var COORD_FIJO = "desarrollocrmlibertador@ellibertador.co";

function obtenerPermisoUsuario() {
  var email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  var coords = _obtenerListaAcceso(ACCESS_COORD_KEY);
  var bios = _obtenerListaAcceso(ACCESS_BIO_KEY);

  if (email === COORD_FIJO) return { rol: "coordinador", email: email };
  if (coords.length === 0 && bios.length === 0) return { rol: "coordinador", email: email };
  if (coords.indexOf(email) !== -1) return { rol: "coordinador", email: email };
  if (bios.indexOf(email) !== -1) return { rol: "biometria", email: email };
  return { rol: "sin_acceso", email: email };
}

function _obtenerListaAcceso(key) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return [];
}

function obtenerListasAcceso() {
  return {
    coordinadores: _obtenerListaAcceso(ACCESS_COORD_KEY),
    biometria: _obtenerListaAcceso(ACCESS_BIO_KEY)
  };
}

function guardarListasAcceso(coordinadores, biometria) {
  var props = PropertiesService.getScriptProperties();
  var lCoord = (coordinadores || []).map(function(e) { return String(e).toLowerCase().trim(); }).filter(function(e) { return e.indexOf("@") !== -1; });
  var lBio = (biometria || []).map(function(e) { return String(e).toLowerCase().trim(); }).filter(function(e) { return e.indexOf("@") !== -1; });
  props.setProperty(ACCESS_COORD_KEY, JSON.stringify(lCoord));
  props.setProperty(ACCESS_BIO_KEY, JSON.stringify(lBio));
  return { success: true, coordinadores: lCoord, biometria: lBio };
}

// ============================================================================
// COLA DE ASIGNACIÓN Y BIOMETRÍA
// ============================================================================

function obtenerColaAsignacion() {
  var desplazamiento = 0, induccion = 0, digital = 0;
  var reestudio = 0, nuevaUar = 0, deudorUar = 0, biometriaFallida = 0;

  try {
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hojaSol = ss.getSheetByName("solicitud");
    if (hojaSol && hojaSol.getLastRow() > 1) {
      var data = hojaSol.getDataRange().getDisplayValues();
      for (var i = 1; i < data.length; i++) {
        // No se filtra por "asignacion"/"fecha fin gestión": en cuanto una solicitud se asigna,
        // el sistema la saca de la hoja "solicitud" y la mueve a Historico_Gestiones. Estar
        // presente aquí ya implica que sigue sin asignar.
        var estadoGen = String(data[i][16] || "").toUpperCase().replace(/\s+/g, '_').trim();
        var clase = String(data[i][20] || "").toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
          return { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U" }[c] || c;
        }).trim();

        if (estadoGen === "APROBADO" || estadoGen === "RECHAZADO" || estadoGen === "NEGADO") continue;

        if (estadoGen.indexOf("APROBADO_PENDIENTE_BIOMETRIA") !== -1) {
          desplazamiento++;
        } else if (clase === "INDUCCION") {
          induccion++;
        } else {
          digital++;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: Error leyendo hoja solicitud: " + e.message);
  }

  try {
    var ssR = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    var hojaOrigen = ssR.getSheetByName("ORIGEN");
    if (hojaOrigen && hojaOrigen.getLastRow() > 1) {
      var dataO = hojaOrigen.getDataRange().getDisplayValues();
      for (var j = 1; j < dataO.length; j++) {
        var analistaAsig = String(dataO[j][6] || "").trim();
        var fechaFinG = String(dataO[j][9] || "").trim();
        if (analistaAsig !== "" || fechaFinG !== "") continue;

        var origen = String(dataO[j][3] || "").toUpperCase().trim();
        var tipoP = String(dataO[j][4] || "").toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
          return { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U" }[c] || c;
        }).trim();

        if (tipoP.indexOf("BIOMETRIA FALLIDA") !== -1) biometriaFallida++;
        else if (origen === "CORREO" && tipoP === "NUEVA") nuevaUar++;
        else if (origen === "CORREO" && tipoP === "ADICIONAL") deudorUar++;
        else if (tipoP === "REESTUDIO") reestudio++;
      }
    }
  } catch (e) {
    Logger.log("Aviso: Error leyendo hoja ORIGEN: " + e.message);
  }

  return {
    total: desplazamiento + induccion + digital + biometriaFallida + nuevaUar + deudorUar + reestudio,
    desplazamiento: desplazamiento,
    induccion: induccion,
    digital: digital,
    biometriaFallida: biometriaFallida,
    nuevaUar: nuevaUar,
    deudorUar: deudorUar,
    reestudio: reestudio
  };
}

function obtenerDatosBiometria(fechaDesde, fechaHasta) {
  var vacio = { totalConsultadas: 0, totalEnviados: 0, totalNoEnviados: 0, totalProcesadas: 0, totalSinIniciar: 0, faltanRevisar: 0, esperandoCorte: 0, totalEnEspera: 0, totalEscaladas: 0, colaActual: 0, totalResueltas: 0, resueltasConWA: 0, resueltasSinWA: 0, enviadasYResueltas: 0, enviadasYEscaladas: 0, cohorteResueltasSinWA: 0, cohorteEnviadas: 0, tasaEnvio: 0, tasaConversion: 0, tendencia: [], gestion: { total: 0, okLlamada: 0, noContesto: 0, aprobadas: 0, negadas: 0, aplazadas: 0, motivos: {}, tasaContacto: 0 } };

  // Cola de asignación en vivo: viene de la hoja "solicitud" (sin filtro de fecha), no de
  // pendiente_biometria. Es la fuente autoritativa del backlog real, independiente del
  // rango de fechas seleccionado en el dashboard (a diferencia de las métricas por período de abajo).
  var colaActual = 0;
  try {
    colaActual = obtenerColaAsignacion().desplazamiento || 0;
  } catch (e) {
    Logger.log("Aviso: No se pudo obtener cola de asignación para biometría: " + e.message);
  }
  vacio.colaActual = colaActual;

  try {
    var ss = SpreadsheetApp.openById(ID_HOJA_BIOMETRIA);
    var hoja = ss.getSheetByName("pendiente_biometria");
    if (!hoja || hoja.getLastRow() < 2) return vacio;

    var filtroDesde = fechaDesde ? fechaDesde.replace(/-/g, '') : '';
    var filtroHasta = fechaHasta ? fechaHasta.replace(/-/g, '') : '';

    var data = hoja.getDataRange().getDisplayValues();
    var headers = data[0];

    var colMap = {};
    for (var h = 0; h < headers.length; h++) {
      var hNorm = headers[h].toLowerCase().replace(/\s+/g, '_').trim();
      colMap[hNorm] = h;
    }

    var cFC = colMap["fecha_consulta_sai"] != null ? colMap["fecha_consulta_sai"] : -1;
    var cFE = colMap["fecha_envio_brodcast"] != null ? colMap["fecha_envio_brodcast"] : -1;
    var cFA = colMap["fecha_actualizacion_fase"] != null ? colMap["fecha_actualizacion_fase"] : -1;
    var cEB = colMap["estado_brodcast"] != null ? colMap["estado_brodcast"] : -1;
    var cFS = colMap["fase_seguimiento_biometria"] != null ? colMap["fase_seguimiento_biometria"] : -1;

    // fase_seguimiento_biometria es la fuente de verdad del ciclo (Biometria.js):
    //   ""          -> recién capturada (cada 10 min); espera cumplir 4h desde fecha_resultado
    //                  para su primer contacto (cicloPrimerContactoBiometria, corre cada hora)
    //   WA_ENVIADO  -> ya tuvo su oportunidad de WhatsApp, espera el corte de escalación (8am/12m)
    //   ESCALADA    -> no completó biometría tras el mensaje, pasa a cola de analista
    //   RESUELTA    -> completó biometría (con o sin haber recibido el mensaje; también la puede
    //                  cerrar la verificación diaria de las 16:00-17:00)
    //
    // Cada métrica se filtra/agrupa por SU propia fecha real, no todas por fecha_consulta_sai:
    //   Consultadas / Sin Iniciar -> fecha_consulta_sai (única fecha que existe para estos casos)
    //   Enviados                  -> fecha_envio_brodcast
    //   En Espera / Escaladas / Resueltas (con y sin WA) -> fecha_actualizacion_fase
    // Así, un caso consultado tarde en el día que se resuelve o escala al día siguiente queda
    // bien ubicado en el día real de su desenlace, no perdido en el día de la consulta.
    var totalConsultadas = 0, totalEnviados = 0, totalNoEnviados = 0;
    var totalSinIniciar = 0, totalEnEspera = 0, totalEscaladas = 0;
    var resueltasConWA = 0, resueltasSinWA = 0;
    // Cohorte-consistentes: de las ENVIADAS por fecha de envío (mismo grupo que "WA Enviados"),
    // cuántas están AHORA MISMO en cada estado — sin importar cuándo cambiaron de fase. Esto
    // alimenta tanto las tarjetas "Resueltas por WhatsApp"/"Escaladas a Análisis" del Ciclo de
    // Hoy como la Tasa de Conversión, para que ambas cuenten exactamente la misma historia.
    var enviadasYResueltas = 0;
    var enviadasYEscaladas = 0;

    // Cascada ESTRICTA de "Consultadas hoy": de las mismas solicitudes consultadas en el rango,
    // cuántas ya tienen WA enviado y cuántas ya se resolvieron sin necesitar el mensaje — ambas
    // ancladas a fecha_consulta_sai (no a su propia fecha de evento), para que
    // Consultadas = Sin Iniciar + Resueltas sin WA (cohorte) + Enviadas (cohorte) cierre exacto.
    var cohorteResueltasSinWA = 0;
    var cohorteEnviadas = 0;

    // En vivo, SIN filtro de fecha (igual que Cola de Asignación): cuántas filas siguen con
    // fase_seguimiento_biometria vacía ahora mismo, esperando su primer corte de revisión.
    var liveFaltanRevisar = 0;
    // En vivo también: cuántas ya tienen WA_ENVIADO ahora mismo, esperando el próximo corte de
    // escalación (8am/12pm) que decide si se resuelven solas o pasan a la cola de analista.
    var liveEsperandoCorte = 0;

    var tendenciaMap = {};

    function _fechaParte(raw) { return raw ? raw.split(" ")[0] : ""; }
    // La hoja guarda las fechas como DD/MM/YYYY; hay que reordenarlas a YYYY-MM-DD antes de
    // usarlas como llave de tendencia o de compararlas contra filtroDesde/filtroHasta (que
    // vienen de un <input type="date"> en YYYY-MM-DD) — si no, tanto el filtro de rango como
    // el orden cronológico del gráfico quedan rotos (ver mismo tratamiento en gestión, abajo).
    function _fechaISO(parte) {
      if (!parte) return "";
      var p = parte.split("/");
      if (p.length !== 3) return parte;
      return p[2] + "-" + ("0" + p[1]).slice(-2) + "-" + ("0" + p[0]).slice(-2);
    }
    function _fechaNorm(iso) { return iso.replace(/-/g, ''); }
    function _enRango(norm) {
      if (!filtroDesde && !filtroHasta) return true;
      if (!norm) return false;
      if (filtroDesde && norm < filtroDesde) return false;
      if (filtroHasta && norm > filtroHasta) return false;
      return true;
    }
    function _bucket(dayKey, campo) {
      if (!dayKey) return;
      if (!tendenciaMap[dayKey]) tendenciaMap[dayKey] = { consultadas: 0, enviados: 0, resueltasConWA: 0, resueltasSinWA: 0, escaladas: 0, enEspera: 0, sinIniciar: 0, enviadasYResueltas: 0 };
      tendenciaMap[dayKey][campo]++;
    }

    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][0] || "").trim();
      if (!solicitud) continue;

      var consultaParte = cFC >= 0 ? _fechaISO(_fechaParte(String(data[i][cFC] || "").trim())) : "";
      var envioParte = cFE >= 0 ? _fechaISO(_fechaParte(String(data[i][cFE] || "").trim())) : "";
      var faseParte = cFA >= 0 ? _fechaISO(_fechaParte(String(data[i][cFA] || "").trim())) : "";
      var estadoBrod = cEB >= 0 ? String(data[i][cEB] || "").toUpperCase().trim() : "";
      var fase = cFS >= 0 ? String(data[i][cFS] || "").toUpperCase().trim() : "";
      var fueEnviado = estadoBrod === "ENVIADO" || estadoBrod === "SI" || estadoBrod === "OK" || estadoBrod === "TRUE" || estadoBrod === "1";

      if (fase === "") liveFaltanRevisar++;
      else if (fase === "WA_ENVIADO") liveEsperandoCorte++;

      if (_enRango(_fechaNorm(consultaParte))) {
        totalConsultadas++;
        _bucket(consultaParte, 'consultadas');
        if (fase === "") { totalSinIniciar++; _bucket(consultaParte, 'sinIniciar'); }
        else if (fase === "RESUELTA" && !fueEnviado) { cohorteResueltasSinWA++; }
        else { cohorteEnviadas++; } // WA_ENVIADO, ESCALADA, o RESUELTA-con-envío — cualquier fase
        // que no sea "" ni "RESUELTA sin envío" implica que ya se intentó el contacto, sin
        // importar si estado_brodcast quedó en "ENVIADO" o en otro valor (p.ej. "ERROR").
      }

      if (_enRango(_fechaNorm(envioParte))) {
        if (fueEnviado) {
          totalEnviados++; _bucket(envioParte, 'enviados');
          if (fase === "RESUELTA") { enviadasYResueltas++; _bucket(envioParte, 'enviadasYResueltas'); }
          else if (fase === "ESCALADA") { enviadasYEscaladas++; }
        }
        else totalNoEnviados++;
      }

      if (_enRango(_fechaNorm(faseParte))) {
        if (fase === "WA_ENVIADO") { totalEnEspera++; _bucket(faseParte, 'enEspera'); }
        else if (fase === "ESCALADA") { totalEscaladas++; _bucket(faseParte, 'escaladas'); }
        else if (fase === "RESUELTA") {
          if (fueEnviado) { resueltasConWA++; _bucket(faseParte, 'resueltasConWA'); }
          else { resueltasSinWA++; _bucket(faseParte, 'resueltasSinWA'); }
        }
      }
    }

    var tendenciaArr = Object.keys(tendenciaMap).sort().map(function(f) {
      var td = tendenciaMap[f];
      return { fecha: f, consultadas: td.consultadas, enviados: td.enviados, resueltasConWA: td.resueltasConWA, resueltasSinWA: td.resueltasSinWA, escaladas: td.escaladas, enEspera: td.enEspera, sinIniciar: td.sinIniciar, enviadasYResueltas: td.enviadasYResueltas };
    });

    // Informativo: de las consultadas en el rango, cuántas ya pasaron por su primer contacto
    // (excluye las recién capturadas que aún no cumplen las 4h desde fecha_resultado).
    var totalProcesadas = totalConsultadas - totalSinIniciar;
    var totalResueltas = resueltasConWA + resueltasSinWA;

    // --- Resultados de gestión desde Historico_Gestiones (tipoAsignado=DESAPLAZAMIENTO) ---
    // resFinal se lee de estadoGeneral: ese campo se actualiza al final del día para reflejar
    // si la solicitud quedó aprobada, así que consultar "hoy" en pleno día puede mostrar
    // Gestionadas > (Aprobadas+Negadas+Aplazadas) para los casos de hoy que aún no tienen ese cierre.
    var gestion = { total: 0, okLlamada: 0, noContesto: 0, aprobadas: 0, negadas: 0, aplazadas: 0, aprobadasConLlamada: 0, motivos: {}, tendencia: [] };
    try {
      var ssHist = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
      var hojaHist = ssHist.getSheetByName(SHEET_NAME_SOLICITUDES);
      if (hojaHist && hojaHist.getLastRow() > 1) {
        var dataH = hojaHist.getDataRange().getDisplayValues();
        var gesTendMap = {};
        for (var g = 1; g < dataH.length; g++) {
          var tipoAsignadoH = String(dataH[g][60] || "").toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) { return { "Á":"A","É":"E","Í":"I","Ó":"O","Ú":"U" }[c] || c; }).trim();
          if (tipoAsignadoH !== "DESAPLAZAMIENTO") continue;

          var fechaFinH = String(dataH[g][26] || "").trim();
          if (!fechaFinH) continue;

          var fechaFinParte = fechaFinH.split(" ")[0];
          var partes = fechaFinParte.split("/");
          var fechaDia = partes.length === 3 ? partes[2] + "-" + partes[1] + "-" + partes[0] : fechaFinParte;
          var fechaFinNorm = fechaDia.replace(/-/g, '');

          if (filtroDesde || filtroHasta) {
            if (filtroDesde && fechaFinNorm < filtroDesde) continue;
            if (filtroHasta && fechaFinNorm > filtroHasta) continue;
          }

          gestion.total++;

          if (!gesTendMap[fechaDia]) gesTendMap[fechaDia] = { okLlamada: 0, noContesto: 0, aprobadas: 0, negadas: 0, aplazadas: 0 };

          var resLlamada = String(dataH[g][38] || "").toUpperCase().trim();
          if (resLlamada === "OK LLAMADA") { gestion.okLlamada++; gesTendMap[fechaDia].okLlamada++; }
          else if (resLlamada === "NO CONTESTO") { gestion.noContesto++; gesTendMap[fechaDia].noContesto++; }

          var resFinal = String(dataH[g][16] || "").toUpperCase().trim();
          // aprobadasConLlamada exige AMBAS condiciones en la MISMA fila (mismo cohorte: llamadas
          // que sí conectaron) — no mezclar con gestion.aprobadas, que cuenta todo aprobado sin
          // importar si hubo o no contacto telefónico. Ver lección de cohorte-consistencia.
          if (resLlamada === "OK LLAMADA" && resFinal === "APROBADO") gestion.aprobadasConLlamada++;
          if (resFinal === "APROBADO") { gestion.aprobadas++; gesTendMap[fechaDia].aprobadas++; }
          else if (resFinal === "RECHAZADO") { gestion.negadas++; gesTendMap[fechaDia].negadas++; }
          else if (resFinal === "APLAZADO") {
            gestion.aplazadas++; gesTendMap[fechaDia].aplazadas++;
            var motivo = String(dataH[g][28] || "").trim();
            if (motivo) gestion.motivos[motivo] = (gestion.motivos[motivo] || 0) + 1;
          }
        }
        gestion.tendencia = Object.keys(gesTendMap).sort().map(function(f) {
          var d = gesTendMap[f];
          return { fecha: f, okLlamada: d.okLlamada, noContesto: d.noContesto, aprobadas: d.aprobadas, negadas: d.negadas, aplazadas: d.aplazadas };
        });
      }
    } catch (e) {
      Logger.log("Aviso: Error leyendo gestión biometría: " + e.message);
    }

    gestion.tasaContacto = gestion.total > 0 ? Math.round((gestion.okLlamada / gestion.total) * 1000) / 10 : 0;
    // "¿Sirve la llamada?": de las llamadas que SÍ conectaron (OK Llamada), qué % terminó aprobado.
    // Cohorte-consistente: numerador y denominador salen de la misma fila (mismo grupo de casos).
    gestion.tasaConversionLlamada = gestion.okLlamada > 0 ? Math.round((gestion.aprobadasConLlamada / gestion.okLlamada) * 1000) / 10 : 0;

    return {
      totalConsultadas: totalConsultadas,
      totalEnviados: totalEnviados,
      totalNoEnviados: totalNoEnviados,
      totalProcesadas: totalProcesadas,
      totalSinIniciar: totalSinIniciar,
      faltanRevisar: liveFaltanRevisar,
      esperandoCorte: liveEsperandoCorte,
      totalEnEspera: totalEnEspera,
      totalEscaladas: totalEscaladas,
      colaActual: colaActual,
      totalResueltas: totalResueltas,
      resueltasConWA: resueltasConWA,
      resueltasSinWA: resueltasSinWA,
      enviadasYResueltas: enviadasYResueltas,
      enviadasYEscaladas: enviadasYEscaladas,
      cohorteResueltasSinWA: cohorteResueltasSinWA,
      cohorteEnviadas: cohorteEnviadas,
      tasaEnvio: (totalEnviados + resueltasSinWA) > 0 ? Math.round((totalEnviados / (totalEnviados + resueltasSinWA)) * 1000) / 10 : 0,
      tasaConversion: totalEnviados > 0 ? Math.round((enviadasYResueltas / totalEnviados) * 1000) / 10 : 0,
      tendencia: tendenciaArr,
      gestion: gestion
    };
  } catch (e) {
    Logger.log("Error en obtenerDatosBiometria: " + e.message);
    return vacio;
  }
}

function buscarBiometriaSolicitud(query) {
  try {
    var ss = SpreadsheetApp.openById(ID_HOJA_BIOMETRIA);
    var hoja = ss.getSheetByName("pendiente_biometria");
    if (!hoja || hoja.getLastRow() < 2) return [];

    var data = hoja.getDataRange().getDisplayValues();
    var headers = data[0];
    var colMap = {};
    for (var h = 0; h < headers.length; h++) {
      colMap[headers[h].toLowerCase().replace(/\s+/g, '_').trim()] = h;
    }

    var cFC = colMap["fecha_consulta_sai"] != null ? colMap["fecha_consulta_sai"] : -1;
    var cFE = colMap["fecha_envio_brodcast"] != null ? colMap["fecha_envio_brodcast"] : -1;
    var cFA = colMap["fecha_actualizacion_fase"] != null ? colMap["fecha_actualizacion_fase"] : -1;
    var cEB = colMap["estado_brodcast"] != null ? colMap["estado_brodcast"] : -1;
    var cNE = colMap["nuevo_estado_sai"] != null ? colMap["nuevo_estado_sai"] : -1;
    var cFS = colMap["fase_seguimiento_biometria"] != null ? colMap["fase_seguimiento_biometria"] : -1;

    var q = String(query || "").trim().toLowerCase();
    if (!q) return [];

    var resultados = [];
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][0] || "").trim();
      var poliza = String(data[i][1] || "").trim();
      var nombre = String(data[i][4] || "").trim();

      if (!solicitud) continue;
      if (solicitud.toLowerCase().indexOf(q) === -1 && poliza.toLowerCase().indexOf(q) === -1) continue;

      var fechaConsulta = cFC >= 0 ? String(data[i][cFC] || "").trim() : "";
      var fechaEnvio = cFE >= 0 ? String(data[i][cFE] || "").trim() : "";
      var fechaActualizacionFase = cFA >= 0 ? String(data[i][cFA] || "").trim() : "";
      var estadoBrod = cEB >= 0 ? String(data[i][cEB] || "").toUpperCase().trim() : "";
      var nuevoEstado = cNE >= 0 ? String(data[i][cNE] || "").toUpperCase().replace(/\s+/g, '_').trim() : "";
      var fase = cFS >= 0 ? String(data[i][cFS] || "").toUpperCase().trim() : "";

      var numDest = 0;
      if (cNE >= 0) {
        for (var d = 0; d < 4; d++) {
          var telIdx = cNE + 1 + d * 3 + 2;
          if (telIdx < data[i].length && String(data[i][telIdx] || "").trim()) numDest++;
        }
      }

      resultados.push({ solicitud: solicitud, poliza: poliza, nombre: nombre, fechaConsulta: fechaConsulta, fechaEnvio: fechaEnvio, fechaActualizacionFase: fechaActualizacionFase, estadoBrodcast: estadoBrod, nuevoEstado: nuevoEstado, fase: fase, destinatarios: numDest });
      if (resultados.length >= 50) break;
    }

    return resultados;
  } catch (e) {
    Logger.log("Error en buscarBiometriaSolicitud: " + e.message);
    return [];
  }
}

// Drilldown de las tarjetas del tablero de biometría: dado el "tipo" de tarjeta que el usuario
// clickeó, reproduce EXACTAMENTE el mismo criterio de conteo que obtenerDatosBiometria() para ese
// tipo, pero en vez de sumar devuelve las filas que lo componen (mismo shape que
// buscarBiometriaSolicitud, para reutilizar el mismo render de tabla en el cliente).
function obtenerDetalleBiometriaPorTarjeta(tipo, fechaDesde, fechaHasta) {
  try {
    if (tipo === "colaAsignacion") {
      var ssC = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
      var hojaC = ssC.getSheetByName("solicitud");
      var outC = [];
      if (hojaC && hojaC.getLastRow() > 1) {
        var dataC = hojaC.getDataRange().getDisplayValues();
        for (var c = 1; c < dataC.length; c++) {
          var estadoGenC = String(dataC[c][16] || "").toUpperCase().replace(/\s+/g, '_').trim();
          if (estadoGenC.indexOf("APROBADO_PENDIENTE_BIOMETRIA") === -1) continue;
          outC.push({
            solicitud: String(dataC[c][0] || "").trim(),
            poliza: String(dataC[c][1] || "").trim(),
            nombre: String(dataC[c][4] || "").trim(),
            fechaConsulta: String(dataC[c][17] || "").trim(),
            fechaEnvio: "",
            fechaActualizacionFase: String(dataC[c][18] || "").trim(),
            estadoBrodcast: "",
            fase: "ESCALADA",
            destinatarios: 0
          });
          if (outC.length >= 200) break;
        }
      }
      return outC;
    }

    var ss = SpreadsheetApp.openById(ID_HOJA_BIOMETRIA);
    var hoja = ss.getSheetByName("pendiente_biometria");
    if (!hoja || hoja.getLastRow() < 2) return [];

    var filtroDesde = fechaDesde ? fechaDesde.replace(/-/g, '') : '';
    var filtroHasta = fechaHasta ? fechaHasta.replace(/-/g, '') : '';

    var data = hoja.getDataRange().getDisplayValues();
    var headers = data[0];
    var colMap = {};
    for (var h = 0; h < headers.length; h++) {
      colMap[headers[h].toLowerCase().replace(/\s+/g, '_').trim()] = h;
    }
    var cFC = colMap["fecha_consulta_sai"] != null ? colMap["fecha_consulta_sai"] : -1;
    var cFE = colMap["fecha_envio_brodcast"] != null ? colMap["fecha_envio_brodcast"] : -1;
    var cFA = colMap["fecha_actualizacion_fase"] != null ? colMap["fecha_actualizacion_fase"] : -1;
    var cEB = colMap["estado_brodcast"] != null ? colMap["estado_brodcast"] : -1;
    var cNE = colMap["nuevo_estado_sai"] != null ? colMap["nuevo_estado_sai"] : -1;
    var cFS = colMap["fase_seguimiento_biometria"] != null ? colMap["fase_seguimiento_biometria"] : -1;

    function _fechaParteD(raw) { return raw ? raw.split(" ")[0] : ""; }
    function _fechaISOD(parte) {
      if (!parte) return "";
      var p = parte.split("/");
      if (p.length !== 3) return parte;
      return p[2] + "-" + ("0" + p[1]).slice(-2) + "-" + ("0" + p[0]).slice(-2);
    }
    function _fechaNormD(iso) { return iso.replace(/-/g, ''); }
    function _enRangoD(norm) {
      if (!filtroDesde && !filtroHasta) return true;
      if (!norm) return false;
      if (filtroDesde && norm < filtroDesde) return false;
      if (filtroHasta && norm > filtroHasta) return false;
      return true;
    }

    var resultados = [];
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][0] || "").trim();
      if (!solicitud) continue;

      var consultaParte = cFC >= 0 ? _fechaISOD(_fechaParteD(String(data[i][cFC] || "").trim())) : "";
      var envioParte = cFE >= 0 ? _fechaISOD(_fechaParteD(String(data[i][cFE] || "").trim())) : "";
      var faseParte = cFA >= 0 ? _fechaISOD(_fechaParteD(String(data[i][cFA] || "").trim())) : "";
      var estadoBrod = cEB >= 0 ? String(data[i][cEB] || "").toUpperCase().trim() : "";
      var fase = cFS >= 0 ? String(data[i][cFS] || "").toUpperCase().trim() : "";
      var fueEnviado = estadoBrod === "ENVIADO" || estadoBrod === "SI" || estadoBrod === "OK" || estadoBrod === "TRUE" || estadoBrod === "1";

      var incluir = false;
      if (tipo === "esperandoCorte") {
        incluir = (fase === "WA_ENVIADO");
      } else if (tipo === "cascadaSinIniciar") {
        incluir = _enRangoD(_fechaNormD(consultaParte)) && fase === "";
      } else if (tipo === "cascadaResueltasSinWA") {
        incluir = _enRangoD(_fechaNormD(consultaParte)) && fase === "RESUELTA" && !fueEnviado;
      } else if (tipo === "cascadaEnviadas") {
        incluir = _enRangoD(_fechaNormD(consultaParte)) && !(fase === "") && !(fase === "RESUELTA" && !fueEnviado);
      } else if (tipo === "cicloConsultadas") {
        incluir = _enRangoD(_fechaNormD(consultaParte));
      } else if (tipo === "cicloResueltasSinWA") {
        incluir = _enRangoD(_fechaNormD(faseParte)) && fase === "RESUELTA" && !fueEnviado;
      } else if (tipo === "cicloEnviados") {
        incluir = _enRangoD(_fechaNormD(envioParte)) && fueEnviado;
      } else if (tipo === "cicloResueltasConWA") {
        incluir = _enRangoD(_fechaNormD(envioParte)) && fueEnviado && fase === "RESUELTA";
      } else if (tipo === "cicloEscaladas") {
        incluir = _enRangoD(_fechaNormD(envioParte)) && fueEnviado && fase === "ESCALADA";
      }
      if (!incluir) continue;

      var numDest = 0;
      if (cNE >= 0) {
        for (var d = 0; d < 4; d++) {
          var telIdx = cNE + 1 + d * 3 + 2;
          if (telIdx < data[i].length && String(data[i][telIdx] || "").trim()) numDest++;
        }
      }

      resultados.push({
        solicitud: solicitud,
        poliza: String(data[i][1] || "").trim(),
        nombre: String(data[i][4] || "").trim(),
        fechaConsulta: cFC >= 0 ? String(data[i][cFC] || "").trim() : "",
        fechaEnvio: cFE >= 0 ? String(data[i][cFE] || "").trim() : "",
        fechaActualizacionFase: cFA >= 0 ? String(data[i][cFA] || "").trim() : "",
        estadoBrodcast: estadoBrod,
        fase: fase,
        destinatarios: numDest
      });
      if (resultados.length >= 200) break;
    }
    return resultados;
  } catch (e) {
    Logger.log("Error en obtenerDetalleBiometriaPorTarjeta: " + e.message);
    return [];
  }
}

// ============================================================================
// AGENTE COORDINADOR INTELIGENTE
// ============================================================================

var AGENT_CONFIG_KEY = "AGENT_CONFIG";
var AGENT_HISTORY_KEY = "AGENT_ALERT_HISTORY";
var AGENT_HIST_CACHE_KEY = "AGENT_HIST_30D";
var AGENT_DIAG_CACHE_KEY = "AGENT_LAST_DIAGNOSTICO";
var MAX_ALERT_HISTORY = 50;

var DEFAULT_AGENT_CONFIG = {
  enabled: true,
  metas: {
    solicitudesPorDiaPorAnalista: 25,
    slaPct: 90,
    maxTiempoGestionMin: 20,
    maxTiempoGeneralHoras: 2,
    maxTiempoColaMin: 45,
    maxBacklog: 15,
    maxTasaNegacionPct: 25,
    umbralMinutosPausa: 90
  },
  umbrales: {
    desviacionHistoricaPct: 20,
    inactividadMinutos: 90,
    outlierStdDev: 3
  },
  // Cada correo periódico (Alertas Críticas, Foto del Momento) tiene su propio interruptor y su
  // propia frecuencia en horas — son independientes entre sí, no comparten una sola frecuencia.
  // Chequeo de Conexión tiene su propio offset en minutos desde horaInicio. Inicio de Operación
  // y Resumen Diario/Biometría son eventos de una sola vez al día (a horaInicio/horaFin), por
  // eso no tienen frecuencia — solo interruptor.
  notificaciones: {
    enviarInicioOperacion: true,
    enviarChequeoConexion: true,
    chequeoConexionOffsetMin: 30,
    enviarAlertasCriticas: true,
    alertasCriticasFrecuenciaHoras: 1,
    // Foto del Momento incluye tanto la vista agregada (salud, KPIs, radicado) como el
    // detalle por analista (antes era el correo separado "Corte de Gestión").
    enviarFotoMomento: true,
    fotoMomentoFrecuenciaHoras: 2,
    enviarResumenDiario: true,
    enviarResumenBiometria: true,
    // Informe Individual Semanal (uno por analista, viernes a horaFin) — arranca apagado para
    // poder probarlo primero con agente_enviarInformeIndividualManual antes de activarlo para todos.
    enviarInformeIndividual: false,
    informeIndividualDiaISO: 5
  },
  horarioReporte: {
    activo: true,
    // Cada día de la semana (1=lunes...7=domingo) tiene su propio horario, porque entre semana
    // y fin de semana la operación trabaja jornadas distintas.
    // horaInicio/horaFin en formato "HH:mm" (soporta medias horas, ej. "12:30") — el motor
    // late cada 30 min, así que ese es el nivel de precisión posible.
    dias: {
      "1": { activo: true, horaInicio: "08:00", horaFin: "17:00" },
      "2": { activo: true, horaInicio: "08:00", horaFin: "17:00" },
      "3": { activo: true, horaInicio: "08:00", horaFin: "17:00" },
      "4": { activo: true, horaInicio: "08:00", horaFin: "17:00" },
      "5": { activo: true, horaInicio: "08:00", horaFin: "17:00" },
      "6": { activo: false, horaInicio: "08:00", horaFin: "13:00" },
      "7": { activo: false, horaInicio: "08:00", horaFin: "13:00" }
    }
  }
};

// --- CONFIGURACIÓN ---

function agente_obtenerConfig() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(AGENT_CONFIG_KEY);
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      // Backfill de configs guardadas antes de agregar horarioReporte, para que no rompa.
      if (!parsed.horarioReporte) {
        parsed.horarioReporte = JSON.parse(JSON.stringify(DEFAULT_AGENT_CONFIG.horarioReporte));
      } else if (Array.isArray(parsed.horarioReporte.dias)) {
        // Migración: versión anterior guardaba un solo horario global + lista plana de días.
        // Se traduce a horario por día, reutilizando ese mismo rango para los días que estaban activos.
        var diasViejos = parsed.horarioReporte.dias;
        var hInicioViejo = parsed.horarioReporte.horaInicio != null ? parsed.horarioReporte.horaInicio : 8;
        var hFinViejo = parsed.horarioReporte.horaFin != null ? parsed.horarioReporte.horaFin : 17;
        var diasNuevo = {};
        for (var dm = 1; dm <= 7; dm++) {
          diasNuevo[String(dm)] = {
            activo: diasViejos.indexOf(dm) !== -1,
            horaInicio: hInicioViejo,
            horaFin: hFinViejo
          };
        }
        parsed.horarioReporte.dias = diasNuevo;
        delete parsed.horarioReporte.horaInicio;
        delete parsed.horarioReporte.horaFin;
      }
      // Normaliza horaInicio/horaFin de hora entera (formato viejo, ej. 8) a "HH:mm" (nuevo,
      // permite medias horas como "12:30"). El motor solo entiende el formato nuevo.
      if (parsed.horarioReporte.dias) {
        Object.keys(parsed.horarioReporte.dias).forEach(function(dk) {
          var dcfg = parsed.horarioReporte.dias[dk];
          if (typeof dcfg.horaInicio === "number") dcfg.horaInicio = String(dcfg.horaInicio).padStart(2, "0") + ":00";
          if (typeof dcfg.horaFin === "number") dcfg.horaFin = String(dcfg.horaFin).padStart(2, "0") + ":00";
        });
      }
      // Backfill de notificaciones agregadas después de creada la config guardada.
      if (!parsed.notificaciones) parsed.notificaciones = JSON.parse(JSON.stringify(DEFAULT_AGENT_CONFIG.notificaciones));
      if (parsed.notificaciones.enviarInicioOperacion === undefined) parsed.notificaciones.enviarInicioOperacion = true;
      if (parsed.notificaciones.enviarChequeoConexion === undefined) parsed.notificaciones.enviarChequeoConexion = true;
      if (parsed.notificaciones.chequeoConexionOffsetMin === undefined) parsed.notificaciones.chequeoConexionOffsetMin = 30;
      if (parsed.notificaciones.enviarFotoMomento === undefined) parsed.notificaciones.enviarFotoMomento = true;
      // La frecuencia de Foto del Momento vivía en horarioReporte.frecuenciaHoras (compartida
      // con Alertas Críticas); ahora cada correo periódico tiene la suya propia, así que se
      // hereda el valor viejo solo para Foto del Momento y Alertas Críticas arranca en 1h.
      if (parsed.notificaciones.fotoMomentoFrecuenciaHoras === undefined) {
        parsed.notificaciones.fotoMomentoFrecuenciaHoras = (parsed.horarioReporte && parsed.horarioReporte.frecuenciaHoras) || 2;
      }
      if (parsed.notificaciones.alertasCriticasFrecuenciaHoras === undefined) parsed.notificaciones.alertasCriticasFrecuenciaHoras = 1;
      if (parsed.notificaciones.enviarInformeIndividual === undefined) parsed.notificaciones.enviarInformeIndividual = false;
      if (parsed.notificaciones.informeIndividualDiaISO === undefined) parsed.notificaciones.informeIndividualDiaISO = 5;
      if (parsed.metas && parsed.metas.umbralMinutosPausa === undefined) parsed.metas.umbralMinutosPausa = 90;
      return parsed;
    } catch (e) {}
  }
  var cfg = JSON.parse(JSON.stringify(DEFAULT_AGENT_CONFIG));
  props.setProperty(AGENT_CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

function agente_guardarConfig(configObj) {
  var current = agente_obtenerConfig();
  if (configObj.metas) {
    Object.keys(configObj.metas).forEach(function(k) { current.metas[k] = configObj.metas[k]; });
  }
  if (configObj.umbrales) {
    Object.keys(configObj.umbrales).forEach(function(k) { current.umbrales[k] = configObj.umbrales[k]; });
  }
  if (configObj.notificaciones) {
    Object.keys(configObj.notificaciones).forEach(function(k) { current.notificaciones[k] = configObj.notificaciones[k]; });
  }
  if (configObj.horarioReporte) {
    if (!current.horarioReporte) current.horarioReporte = JSON.parse(JSON.stringify(DEFAULT_AGENT_CONFIG.horarioReporte));
    Object.keys(configObj.horarioReporte).forEach(function(k) { current.horarioReporte[k] = configObj.horarioReporte[k]; });
  }
  if (configObj.enabled !== undefined) current.enabled = configObj.enabled;
  PropertiesService.getScriptProperties().setProperty(AGENT_CONFIG_KEY, JSON.stringify(current));
  return { success: true, config: current };
}

// --- LECTURA DE DATOS PARA EL AGENTE ---

function _agente_leerDatosHoy() {
  var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  return _agente_leerDatosRango(hoyStr, hoyStr);
}

function _agente_leerDatosRango(fechaDesdeStr, fechaHastaStr) {
  var desde = parseFechaDDMMYYYY(fechaDesdeStr);
  var hasta = parseFechaDDMMYYYY(fechaHastaStr);
  if (!desde || !hasta) return null;
  hasta.setHours(23, 59, 59, 999);

  var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  var hoja = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
  var data = hoja.getDataRange().getDisplayValues();
  var scoreMap = cargarDiccionarioScore();

  var registros = [];
  var backlogDetalle = [];
  var ahora = new Date();

  for (var i = 1; i < data.length; i++) {
    var fila = data[i];
    var fechaFinAgent = String(fila[26] || "").trim();
    var fechaGestionStr = fechaFinAgent ? fechaFinAgent.split(" ")[0] : "";
    var fechaAsig = String(fila[24] || "").trim();

    if (fechaAsig !== "" && fechaFinAgent === "") {
      var dtAsig = parseDatetimeStr(fechaAsig);
      var minEspera = dtAsig ? Math.max(0, Math.round((ahora - dtAsig) / 60000)) : 0;
      var polB = String(fila[1] || "").trim();
      var infoB = obtenerSegmentoInmobiliaria(polB, scoreMap);
      backlogDetalle.push({
        solicitud: String(fila[0] || "").trim(),
        analista: String(fila[27] || "Sin nombre").trim(),
        minutosEspera: minEspera,
        alertaSLA: minEspera > 30 ? "rojo" : minEspera >= 15 ? "amarillo" : "verde",
        tipo: "Digital"
      });
    }

    if (!fechaGestionStr) continue;
    var fechaGestion = parseFechaDDMMYYYY(fechaGestionStr);
    if (!fechaGestion || fechaGestion < desde || fechaGestion > hasta) continue;

    var estado = String(fila[16] || "").toUpperCase().trim();
    var nombre = String(fila[27] || "Sin nombre").trim();
    var correo = String(fila[25] || "").toLowerCase().trim();
    var tGestionRaw = parseFloat(String(fila[35] || "").replace(",", "."));
    var tResolucionRaw = parseFloat(String(fila[36] || "").replace(",", "."));
    var tColaRaw = parseFloat(String(fila[34] || "").replace(",", "."));
    var poliza = String(fila[1] || "").trim();
    var sucursal = obtenerSucursalPorPoliza(poliza);

    var estadoLabel = (estado.includes("APROB") && !estado.includes("PENDIENTE")) ? "APROBADO" :
                     (estado.includes("NEGAD") || estado.includes("RECHAZ")) ? "RECHAZADO" :
                     estado.includes("APLAZ") ? "APLAZADO" : "OTRO";

    registros.push({
      solicitud: String(fila[0] || "").trim(),
      fecha: fechaGestionStr,
      analista: nombre,
      correo: correo,
      estado: estadoLabel,
      sucursal: sucursal,
      tGestion: !isNaN(tGestionRaw) && tGestionRaw >= 0 ? tGestionRaw : null,
      tResolucion: !isNaN(tResolucionRaw) ? tResolucionRaw / 60 : null,
      tCola: !isNaN(tColaRaw) && tColaRaw >= 0 ? tColaRaw : null,
      tieneId: String(fila[0] || "").trim() !== "",
      tieneEstado: estado !== "",
      tieneAnalista: nombre !== "Sin nombre" && nombre !== "",
      tieneFecha: fechaGestionStr !== ""
    });
  }

  // Reestudios
  try {
    var ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    var hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      var lastRow = hojaReest.getLastRow();
      if (lastRow > 1) {
        var dataReest = hojaReest.getRange(2, 1, lastRow - 1, 18).getDisplayValues();
        for (var j = 0; j < dataReest.length; j++) {
          var fAsig = String(dataReest[j][8]).trim();
          var fFin = String(dataReest[j][9] || "").trim();
          if (fAsig !== "" && fFin === "") {
            var dtAsigR = parseDatetimeStr(fAsig);
            var minEsperaR = dtAsigR ? Math.max(0, Math.round((ahora - dtAsigR) / 60000)) : 0;
            backlogDetalle.push({
              solicitud: String(dataReest[j][1] || "").trim(),
              analista: String(dataReest[j][7] || "Sin nombre").trim(),
              minutosEspera: minEsperaR,
              alertaSLA: minEsperaR > 30 ? "rojo" : minEsperaR >= 15 ? "amarillo" : "verde",
              tipo: "Reestudio"
            });
          }

          var fechaFinStr = String(dataReest[j][9]).trim();
          if (!fechaFinStr) continue;
          var fechaParte = fechaFinStr.split(" ")[0];
          var fechaR = parseFechaDDMMYYYY(fechaParte);
          if (!fechaR || fechaR < desde || fechaR > hasta) continue;

          var estadoR = String(dataReest[j][10]).toUpperCase().trim();
          var nombreR = String(dataReest[j][7] || "Sin nombre").trim();
          var correoR = String(dataReest[j][6] || "").toLowerCase().trim();
          var tGestionR = parseFloat(String(dataReest[j][15] || "").replace(",", "."));
          var tResolucionR = parseFloat(String(dataReest[j][16] || "").replace(",", "."));
          var tColaR = parseFloat(String(dataReest[j][14] || "").replace(",", "."));
          var polizaR = String(dataReest[j][17] || dataReest[j][2] || "").trim();
          var sucursalR = obtenerSucursalPorPoliza(polizaR);

          var estadoLabelR = (estadoR.includes("APROB") && !estadoR.includes("PENDIENTE")) ? "APROBADO" :
                            (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) ? "RECHAZADO" :
                            estadoR.includes("APLAZ") ? "APLAZADO" : "OTRO";

          registros.push({
            solicitud: String(dataReest[j][1] || "").trim(),
            fecha: fechaParte,
            analista: nombreR,
            correo: correoR,
            estado: estadoLabelR,
            sucursal: sucursalR,
            tGestion: !isNaN(tGestionR) && tGestionR >= 0 ? tGestionR : null,
            tResolucion: !isNaN(tResolucionR) ? tResolucionR / 60 : null,
            tCola: !isNaN(tColaR) && tColaR >= 0 ? tColaR : null,
            tieneId: String(dataReest[j][1] || "").trim() !== "",
            tieneEstado: estadoR !== "",
            tieneAnalista: nombreR !== "Sin nombre" && nombreR !== "",
            tieneFecha: fechaParte !== ""
          });
        }
      }
    }
  } catch (e) {
    Logger.log("Agente: No se pudieron leer reestudios: " + e.message);
  }

  // Todos los analistas + equipo
  var analistasActivos = [];
  var todosAnalistas = [];
  var equipoPorCorreo = {};
  try {
    var hojaUser = ss.getSheetByName("Usuarios");
    if (hojaUser) {
      var dataUser = hojaUser.getDataRange().getValues();
      for (var u = 1; u < dataUser.length; u++) {
        var estUser = String(dataUser[u][5] || "").toUpperCase().trim();
        var correoUser = String(dataUser[u][2] || "").toLowerCase().trim();
        var equipoUser = String(dataUser[u][4] || "").trim();
        var nombreUser = String(dataUser[u][1] || "").trim();
        if (!correoUser) continue;
        equipoPorCorreo[correoUser] = equipoUser;
        var userObj = { nombre: nombreUser, correo: correoUser, especialidad: equipoUser, equipo: equipoUser, estado: estUser };
        todosAnalistas.push(userObj);
        if (estUser === "ACTIVO") analistasActivos.push(userObj);
      }
    }
  } catch (e) {
    Logger.log("Agente: No se pudo leer Usuarios: " + e.message);
  }

  // Mapear TODOS los analistas por equipo (para distribución de cupos GENERAL)
  var analistasPorEquipo = {};
  todosAnalistas.forEach(function(a) {
    var eq = a.equipo || "Sin equipo";
    if (!analistasPorEquipo[eq]) analistasPorEquipo[eq] = [];
    analistasPorEquipo[eq].push(a);
  });

  // Cupos asignados (historico_cupos) — soporta tipo GENERAL (equipo) e INDIVIDUAL (analista)
  var cuposMap = {};
  var cuposEquipo = {};
  try {
    var hojaCupos = ss.getSheetByName("historico_cupos");
    if (hojaCupos) {
      var dataCupos = hojaCupos.getDataRange().getDisplayValues();
      for (var c = 1; c < dataCupos.length; c++) {
        var fechaCupo = String(dataCupos[c][0] || "").trim().split(" ")[0];
        var fechaCupoP = parseFechaDDMMYYYY(fechaCupo);
        if (!fechaCupoP || fechaCupoP < desde || fechaCupoP > hasta) continue;

        var tipoCupo = String(dataCupos[c][1] || "").toLowerCase().trim();
        var equipoCupo = String(dataCupos[c][2] || "").trim();
        var correoCupo = String(dataCupos[c][3] || "").toLowerCase().trim();
        var nombreCupo = String(dataCupos[c][4] || "").trim();
        var cupoData = {
          total: parseInt(dataCupos[c][5]) || 0,
          nuevas: parseInt(dataCupos[c][6]) || 0,
          reestudios: parseInt(dataCupos[c][7]) || 0,
          inducciones: parseInt(dataCupos[c][8]) || 0,
          biometria: parseInt(dataCupos[c][9]) || 0,
          nuevaUAR: parseInt(dataCupos[c][10]) || 0,
          deudorUAR: parseInt(dataCupos[c][11]) || 0
        };

        if (tipoCupo === "individual" && correoCupo) {
          if (!cuposMap[correoCupo]) cuposMap[correoCupo] = { nombre: nombreCupo, equipo: equipoCupo || equipoPorCorreo[correoCupo] || "", total: 0, nuevas: 0, reestudios: 0, inducciones: 0, biometria: 0, nuevaUAR: 0, deudorUAR: 0, tipo: "individual" };
          var cu = cuposMap[correoCupo];
          cu.total += cupoData.total; cu.nuevas += cupoData.nuevas; cu.reestudios += cupoData.reestudios;
          cu.inducciones += cupoData.inducciones; cu.biometria += cupoData.biometria;
          cu.nuevaUAR += cupoData.nuevaUAR; cu.deudorUAR += cupoData.deudorUAR;
        } else if (tipoCupo === "general" && equipoCupo) {
          if (!cuposEquipo[equipoCupo]) cuposEquipo[equipoCupo] = { total: 0, nuevas: 0, reestudios: 0, inducciones: 0, biometria: 0, nuevaUAR: 0, deudorUAR: 0 };
          var ce = cuposEquipo[equipoCupo];
          ce.total += cupoData.total; ce.nuevas += cupoData.nuevas; ce.reestudios += cupoData.reestudios;
          ce.inducciones += cupoData.inducciones; ce.biometria += cupoData.biometria;
          ce.nuevaUAR += cupoData.nuevaUAR; ce.deudorUAR += cupoData.deudorUAR;
        }
      }
    }
  } catch (e) {
    Logger.log("Agente: No se pudo leer historico_cupos: " + e.message);
  }

  // Si hay cupos por equipo, distribuir entre analistas del equipo que no tengan cupo individual
  // Normalizar: buscar coincidencia flexible entre nombre de equipo en cupos y Especialidad en Usuarios
  var _normEq = function(s) { return String(s || "").toUpperCase().replace(/[_\s]+/g, "").trim(); };
  var equipoNormMap = {};
  Object.keys(analistasPorEquipo).forEach(function(eq) { equipoNormMap[_normEq(eq)] = eq; });

  Object.keys(cuposEquipo).forEach(function(eq) {
    var eqNorm = _normEq(eq);
    var eqReal = equipoNormMap[eqNorm] || eq;
    var miembros = analistasPorEquipo[eqReal] || analistasPorEquipo[eq] || [];
    var sinCupoIndividual = miembros.filter(function(m) { return !cuposMap[m.correo]; });
    if (sinCupoIndividual.length > 0) {
      var ce = cuposEquipo[eq];
      sinCupoIndividual.forEach(function(m) {
        cuposMap[m.correo] = { nombre: m.nombre, equipo: eq, total: ce.total, nuevas: ce.nuevas, reestudios: ce.reestudios, inducciones: ce.inducciones, biometria: ce.biometria, nuevaUAR: ce.nuevaUAR, deudorUAR: ce.deudorUAR, tipo: "general", totalEquipo: ce.total, miembrosEquipo: sinCupoIndividual.length };
      });
    }
  });

  return {
    registros: registros,
    backlogDetalle: backlogDetalle,
    analistasActivos: analistasActivos,
    cuposMap: cuposMap,
    cuposEquipo: cuposEquipo,
    equipoPorCorreo: equipoPorCorreo,
    fechaDesde: fechaDesdeStr,
    fechaHasta: fechaHastaStr
  };
}

// --- PROMEDIOS HISTÓRICOS ---

function agente_calcularPromediosHistoricos() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get(AGENT_HIST_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  var hoy = new Date();
  var hace30 = new Date(hoy);
  hace30.setDate(hoy.getDate() - 30);
  var desdeStr = Utilities.formatDate(hace30, TIMEZONE, "dd/MM/yyyy");
  var hastaStr = Utilities.formatDate(hoy, TIMEZONE, "dd/MM/yyyy");

  var datos = _agente_leerDatosRango(desdeStr, hastaStr);
  if (!datos || datos.registros.length === 0) {
    return { periodo: "30d", solicitudesPorDia: 0, tiempoGestionMin: 0, tiempoGeneralHoras: 0, tiempoColaMin: 0, slaPct: 100, tasaNegacionPct: 0, backlogPromedio: 0, porAnalista: {} };
  }

  var regs = datos.registros;
  var diasMap = {};
  var sumaG = 0, cG = 0, sumaR = 0, cR = 0, sumaCola = 0, cCola = 0;
  var aprobadas = 0, negadas = 0, dentroSLA = 0, totalSLA = 0;
  var porAnalista = {};

  regs.forEach(function(r) {
    diasMap[r.fecha] = true;
    if (r.estado === "APROBADO") aprobadas++;
    if (r.estado === "RECHAZADO") negadas++;
    if (r.tGestion !== null) { sumaG += r.tGestion; cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) {
      sumaR += r.tResolucion; cR++;
      totalSLA++;
      if (r.tResolucion <= 2) dentroSLA++;
    }
    if (r.tCola !== null) { sumaCola += r.tCola; cCola++; }

    var key = r.analista;
    if (!porAnalista[key]) porAnalista[key] = { total: 0, dias: {}, sumaG: 0, cG: 0 };
    porAnalista[key].total++;
    porAnalista[key].dias[r.fecha] = true;
    if (r.tGestion !== null) { porAnalista[key].sumaG += r.tGestion; porAnalista[key].cG++; }
  });

  var numDias = Math.max(1, Object.keys(diasMap).length);
  var analistaAvg = {};
  Object.keys(porAnalista).forEach(function(k) {
    var a = porAnalista[k];
    var diasA = Math.max(1, Object.keys(a.dias).length);
    analistaAvg[k] = {
      solDia: Math.round(a.total / diasA * 10) / 10,
      tGestion: a.cG > 0 ? Math.round(a.sumaG / a.cG * 10) / 10 : 0
    };
  });

  var result = {
    periodo: "30d",
    solicitudesPorDia: Math.round(regs.length / numDias * 10) / 10,
    tiempoGestionMin: cG > 0 ? Math.round(sumaG / cG * 10) / 10 : 0,
    tiempoGeneralHoras: cR > 0 ? Number((sumaR / cR).toFixed(2)) : 0,
    tiempoColaMin: cCola > 0 ? Math.round(sumaCola / cCola * 10) / 10 : 0,
    slaPct: totalSLA > 0 ? Math.round(dentroSLA / totalSLA * 1000) / 10 : 100,
    tasaNegacionPct: regs.length > 0 ? Math.round(negadas / regs.length * 1000) / 10 : 0,
    backlogPromedio: 0,
    porAnalista: analistaAvg
  };

  try {
    var json = JSON.stringify(result);
    if (json.length < 90000) cache.put(AGENT_HIST_CACHE_KEY, json, 21600);
  } catch (e) {}

  return result;
}

// --- INFORME INDIVIDUAL SEMANAL ---

// Calcula, por analista, sus métricas de "esta semana" (lunes de esta semana hasta hoy) contra el
// mismo tramo de la semana anterior (mismo número de días, para que la comparación sea justa —
// nunca semana completa vs semana parcial) más una racha de días hábiles consecutivos con al menos
// una gestión cerrada. Reutiliza _agente_leerDatosRango en una sola lectura para ambas semanas.
function _agente_calcularRendimientoSemanal() {
  var hoy = new Date();
  var diaISOHoy = parseInt(Utilities.formatDate(hoy, TIMEZONE, "u"), 10); // 1=lunes...7=domingo

  var lunesActual = new Date(hoy);
  lunesActual.setDate(hoy.getDate() - (diaISOHoy - 1));
  lunesActual.setHours(0, 0, 0, 0);

  var lunesAnterior = new Date(lunesActual);
  lunesAnterior.setDate(lunesActual.getDate() - 7);

  var desdeStr = Utilities.formatDate(lunesAnterior, TIMEZONE, "dd/MM/yyyy");
  var hastaStr = Utilities.formatDate(hoy, TIMEZONE, "dd/MM/yyyy");
  var datos = _agente_leerDatosRango(desdeStr, hastaStr);
  var registros = (datos && datos.registros) || [];

  // Tramo comparable: lunes..hoy (o lunes..viernes si se corre en fin de semana), y el mismo tramo
  // de la semana anterior.
  var topDiaISO = Math.min(diaISOHoy, 5);
  var diasActual = [];
  for (var d = 1; d <= topDiaISO; d++) {
    var f = new Date(lunesActual);
    f.setDate(lunesActual.getDate() + (d - 1));
    diasActual.push(Utilities.formatDate(f, TIMEZONE, "dd/MM/yyyy"));
  }
  var diasPrev = diasActual.map(function(fStr) {
    var dt = parseFechaDDMMYYYY(fStr);
    dt.setDate(dt.getDate() - 7);
    return Utilities.formatDate(dt, TIMEZONE, "dd/MM/yyyy");
  });

  var actualSet = {}; diasActual.forEach(function(f) { actualSet[f] = true; });
  var prevSet = {}; diasPrev.forEach(function(f) { prevSet[f] = true; });

  var porAnalista = {};
  registros.forEach(function(r) {
    if (!r.correo) return;
    var enActual = !!actualSet[r.fecha];
    var enPrev = !!prevSet[r.fecha];

    if (!porAnalista[r.correo]) {
      porAnalista[r.correo] = {
        nombre: r.analista,
        correo: r.correo,
        actual: { total: 0, sumaG: 0, cG: 0, dentroSLA: 0, totalSLA: 0 },
        prev: { total: 0, sumaG: 0, cG: 0, dentroSLA: 0, totalSLA: 0 },
        porDia: {}
      };
    }
    var a = porAnalista[r.correo];

    // La racha mira actividad reciente en general, no solo dentro de las dos ventanas de comparación.
    a.porDia[r.fecha] = (a.porDia[r.fecha] || 0) + 1;

    if (!enActual && !enPrev) return;
    var bucket = enActual ? a.actual : a.prev;
    bucket.total++;
    if (r.tGestion !== null) { bucket.sumaG += r.tGestion; bucket.cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) {
      bucket.totalSLA++;
      if (r.tResolucion <= 2) bucket.dentroSLA++;
    }
  });

  var config = agente_obtenerConfig();
  var diasHabiles = (config.horarioReporte && config.horarioReporte.dias) || {};

  var resultado = Object.keys(porAnalista).map(function(correo) {
    var a = porAnalista[correo];

    // Racha: días hábiles consecutivos, desde hoy hacia atrás, con al menos una gestión cerrada.
    // Se detiene en el primer día hábil sin gestiones; los días no laborales (según horarioReporte)
    // se saltan sin romper la racha.
    var racha = 0;
    var cursor = new Date(hoy);
    for (var back = 0; back < 30; back++) {
      var fechaCursorStr = Utilities.formatDate(cursor, TIMEZONE, "dd/MM/yyyy");
      var isoCursor = parseInt(Utilities.formatDate(cursor, TIMEZONE, "u"), 10);
      var cfgDia = diasHabiles[String(isoCursor)];
      var esHabil = !cfgDia || cfgDia.activo !== false;
      if (esHabil) {
        if ((a.porDia[fechaCursorStr] || 0) > 0) racha++;
        else break;
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      nombre: a.nombre,
      correo: a.correo,
      gestionadas: a.actual.total,
      gestionadasPrev: a.prev.total,
      tiempoProm: a.actual.cG > 0 ? Math.round(a.actual.sumaG / a.actual.cG * 10) / 10 : null,
      tiempoPromPrev: a.prev.cG > 0 ? Math.round(a.prev.sumaG / a.prev.cG * 10) / 10 : null,
      slaPct: a.actual.totalSLA > 0 ? Math.round(a.actual.dentroSLA / a.actual.totalSLA * 1000) / 10 : null,
      slaPctPrev: a.prev.totalSLA > 0 ? Math.round(a.prev.dentroSLA / a.prev.totalSLA * 1000) / 10 : null,
      racha: racha
    };
  });

  return {
    fechaDesdeActual: diasActual[0],
    fechaHastaActual: diasActual[diasActual.length - 1],
    fechaDesdePrev: diasPrev[0],
    fechaHastaPrev: diasPrev[diasPrev.length - 1],
    porAnalista: resultado
  };
}

// --- 7 REGLAS DE DETECCIÓN ---

function _alerta_slaCumplimiento(registros, config, historicos) {
  var alertas = [];
  var dentroSLA = 0, totalSLA = 0;
  registros.forEach(function(r) {
    if (r.tResolucion !== null && r.tResolucion > 0) {
      totalSLA++;
      if (r.tResolucion <= 2) dentroSLA++;
    }
  });
  if (totalSLA === 0) return alertas;

  var pctSLA = Math.round(dentroSLA / totalSLA * 1000) / 10;
  var meta = config.metas.slaPct;

  if (pctSLA < 70) {
    alertas.push({ severity: "critico", category: "sla", title: "SLA crítico: " + pctSLA + "%", description: "El cumplimiento de SLA hoy es del " + pctSLA + "%, muy por debajo de la meta del " + meta + "%. Hay " + (totalSLA - dentroSLA) + " solicitudes fuera de SLA.", suggestion: "Hablar con los analistas que tienen solicitudes con mayor tiempo general para identificar bloqueos. Verificar si hay solicitudes de alta complejidad que requieran apoyo.", affectedEntities: [] });
  } else if (pctSLA < meta) {
    alertas.push({ severity: "advertencia", category: "sla", title: "SLA por debajo de la meta: " + pctSLA + "%", description: "El cumplimiento SLA (" + pctSLA + "%) está por debajo de la meta (" + meta + "%). " + (totalSLA - dentroSLA) + " solicitudes fuera de SLA.", suggestion: "Hacer seguimiento a los analistas con solicitudes más antiguas. Consultar si tienen dudas o si requieren escalamiento por complejidad.", affectedEntities: [] });
  }

  if (historicos.slaPct > 0) {
    var desviacion = ((historicos.slaPct - pctSLA) / historicos.slaPct) * 100;
    if (desviacion > config.umbrales.desviacionHistoricaPct) {
      alertas.push({ severity: "advertencia", category: "sla", title: "SLA desviado del histórico", description: "El SLA hoy (" + pctSLA + "%) se desvía un " + Math.round(desviacion) + "% por debajo del promedio histórico de 30 días (" + historicos.slaPct + "%).", suggestion: "Investigar causas de la caída con el equipo: mayor complejidad en las solicitudes, analistas nuevos en curva de aprendizaje, o novedades del día.", affectedEntities: [] });
    }
  }
  return alertas;
}

function _alerta_backlogCritico(backlogDetalle, config) {
  var alertas = [];
  var total = backlogDetalle.length;
  var rojos = backlogDetalle.filter(function(b) { return b.alertaSLA === "rojo"; });
  var amarillos = backlogDetalle.filter(function(b) { return b.alertaSLA === "amarillo"; });

  if (rojos.length > 0) {
    var nombres = rojos.slice(0, 5).map(function(b) { return b.analista + " (" + b.minutosEspera + " min)"; });
    alertas.push({ severity: "critico", category: "backlog", title: rojos.length + " solicitudes en backlog >30 min", description: "Hay " + rojos.length + " solicitudes esperando más de 30 minutos, fuera de SLA. Total backlog: " + total + ".", suggestion: "Verificar con los analistas asignados si tienen bloqueos con estas solicitudes. Si la complejidad es alta, evaluar si requieren acompañamiento o escalamiento.", affectedEntities: nombres });
  }

  if (total > config.metas.maxBacklog) {
    alertas.push({ severity: total > config.metas.maxBacklog * 2 ? "critico" : "advertencia", category: "backlog", title: "Backlog alto: " + total + " solicitudes", description: "El backlog actual (" + total + ") supera la meta máxima de " + config.metas.maxBacklog + ". Rojos: " + rojos.length + ", Amarillos: " + amarillos.length + ".", suggestion: "Confirmar que todos los analistas estén conectados y gestionando. El modelo de asignación ya distribuyó las solicitudes; el foco está en que el equipo las atienda.", affectedEntities: [] });
  }

  return alertas;
}

function _alerta_inactividadAnalistas(analistasActivos, registros, config, cuposMap) {
  var alertas = [];
  var ahora = new Date();
  var horaActual = parseInt(Utilities.formatDate(ahora, TIMEZONE, "HH"), 10);
  if (horaActual < 8 || horaActual >= 17) return alertas;

  var horasTranscurridas = horaActual - 8;
  if (horasTranscurridas < 1) return alertas;

  var gestionesPorCorreo = {};
  registros.forEach(function(r) {
    if (r.correo) gestionesPorCorreo[r.correo] = (gestionesPorCorreo[r.correo] || 0) + 1;
  });

  // Detectar inactividad por cupos: quien tiene cupo asignado y 0 gestiones
  var inactivos = [];
  Object.keys(cuposMap || {}).forEach(function(correo) {
    var count = gestionesPorCorreo[correo] || 0;
    if (count === 0 && cuposMap[correo].total > 0) {
      inactivos.push(cuposMap[correo].nombre + " (" + cuposMap[correo].total + " cupos asignados)");
    }
  });

  // También analistas marcados ACTIVO sin gestiones ni cupos
  analistasActivos.forEach(function(a) {
    var count = gestionesPorCorreo[a.correo] || 0;
    if (count === 0 && !cuposMap[a.correo]) {
      inactivos.push(a.nombre);
    }
  });

  if (inactivos.length > 0) {
    var severity = horasTranscurridas >= 2 ? "critico" : "advertencia";
    alertas.push({ severity: severity, category: "inactividad", title: inactivos.length + " analista(s) sin gestiones hoy", description: "Los siguientes analistas no han registrado ningún resultado después de " + horasTranscurridas + " horas de operación: " + inactivos.join(", ") + ".", suggestion: "Contactar a estos analistas para confirmar disponibilidad. Verificar si están conectados, si tienen alguna novedad, o si necesitan acompañamiento. Ya tienen solicitudes asignadas por el modelo.", affectedEntities: inactivos });
  }

  return alertas;
}

function _alerta_productividad(registros, config, historicos, analistasActivos, cuposMap) {
  var alertas = [];
  var ahora = new Date();
  var horaActual = parseInt(Utilities.formatDate(ahora, TIMEZONE, "HH"), 10);
  var minActual = parseInt(Utilities.formatDate(ahora, TIMEZONE, "mm"), 10);
  var horasTranscurridas = Math.max(1, (horaActual - 8) + minActual / 60);
  if (horaActual < 8) return alertas;
  if (horaActual >= 17) horasTranscurridas = 9;

  var totalHoy = registros.length;

  // Calcular esperado desde cupos reales, si no hay cupos usar meta genérica
  var totalCuposAsignados = 0;
  Object.keys(cuposMap || {}).forEach(function(k) { totalCuposAsignados += (cuposMap[k].total || 0); });
  var esperadoEquipo;
  if (totalCuposAsignados > 0) {
    esperadoEquipo = Math.round(totalCuposAsignados * (horasTranscurridas / 9));
  } else {
    var numAnalistas = Math.max(1, analistasActivos.length);
    esperadoEquipo = Math.round(config.metas.solicitudesPorDiaPorAnalista * numAnalistas * (horasTranscurridas / 9));
  }

  if (esperadoEquipo > 0 && totalHoy < esperadoEquipo * 0.7) {
    alertas.push({ severity: "advertencia", category: "productividad", title: "Producción por debajo del ritmo esperado", description: "Se han gestionado " + totalHoy + " solicitudes pero se esperaban ~" + esperadoEquipo + " a esta hora (basado en " + (totalCuposAsignados > 0 ? totalCuposAsignados + " cupos asignados" : "meta genérica") + ", " + Math.round(horasTranscurridas) + "h transcurridas).", suggestion: "Verificar si hay analistas inactivos o con novedades. Las solicitudes ya están asignadas; el foco es que el equipo mantenga el ritmo de gestión.", affectedEntities: [] });
  }

  if (historicos.porAnalista && Object.keys(historicos.porAnalista).length > 0) {
    var porAnalistaHoy = {};
    registros.forEach(function(r) { porAnalistaHoy[r.analista] = (porAnalistaHoy[r.analista] || 0) + 1; });

    var bajosRendimiento = [];
    Object.keys(historicos.porAnalista).forEach(function(nombre) {
      var histDia = historicos.porAnalista[nombre].solDia;
      var hoy = porAnalistaHoy[nombre] || 0;
      var esperadoAhora = Math.round(histDia * horasTranscurridas / 9);
      if (esperadoAhora >= 3 && hoy < esperadoAhora * 0.5) {
        bajosRendimiento.push(nombre + " (" + hoy + " vs ~" + esperadoAhora + " esperadas)");
      }
    });

    if (bajosRendimiento.length > 0) {
      alertas.push({ severity: "info", category: "productividad", title: bajosRendimiento.length + " analista(s) por debajo de su ritmo habitual", description: "Los siguientes analistas están significativamente por debajo de su promedio histórico para esta hora del día.", suggestion: "Conversar con estos analistas para entender si tienen solicitudes complejas, dudas técnicas, o alguna novedad que esté afectando su ritmo.", affectedEntities: bajosRendimiento });
    }
  }

  return alertas;
}

function _alerta_tiemposAnomalos(registros, config, historicos) {
  var alertas = [];
  var sumaG = 0, cG = 0, sumaR = 0, cR = 0, sumaCola = 0, cCola = 0;
  registros.forEach(function(r) {
    if (r.tGestion !== null) { sumaG += r.tGestion; cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) { sumaR += r.tResolucion; cR++; }
    if (r.tCola !== null) { sumaCola += r.tCola; cCola++; }
  });

  var avgG = cG > 0 ? Math.round(sumaG / cG * 10) / 10 : 0;
  var avgR = cR > 0 ? Number((sumaR / cR).toFixed(2)) : 0;
  var avgCola = cCola > 0 ? Math.round(sumaCola / cCola * 10) / 10 : 0;

  if (avgG > config.metas.maxTiempoGestionMin) {
    alertas.push({ severity: "advertencia", category: "tiempos", title: "Tiempo gestión elevado: " + avgG + " min", description: "El promedio de tiempo de gestión hoy (" + avgG + " min) supera la meta de " + config.metas.maxTiempoGestionMin + " min.", suggestion: "Identificar qué analistas tienen los tiempos más altos y hablar con ellos. Evaluar si hay solicitudes atípicas o si necesitan capacitación en algún tipo de análisis.", affectedEntities: [] });
  }

  if (avgR > config.metas.maxTiempoGeneralHoras) {
    var sev = avgR > 3 ? "critico" : "advertencia";
    alertas.push({ severity: sev, category: "tiempos", title: "Tiempo general elevado: " + avgR + " h", description: "El promedio de tiempo general hoy (" + avgR + " h) supera la meta de " + config.metas.maxTiempoGeneralHoras + " h.", suggestion: "Revisar si el tiempo de cola antes de asignación es el factor principal. Si los tiempos de gestión son normales, el cuello de botella puede estar en volumen de ingreso vs. capacidad del equipo.", affectedEntities: [] });
  }

  if (avgCola > config.metas.maxTiempoColaMin) {
    alertas.push({ severity: "advertencia", category: "tiempos", title: "Tiempo de cola elevado: " + avgCola + " min", description: "El promedio de tiempo de cola (" + avgCola + " min) supera la meta de " + config.metas.maxTiempoColaMin + " min.", suggestion: "El modelo de asignación está distribuyendo, pero la cola es alta. Evaluar si la capacidad actual del equipo es suficiente para el volumen de ingreso o si se necesita refuerzo temporal.", affectedEntities: [] });
  }

  var umbral = config.umbrales.desviacionHistoricaPct;
  if (historicos.tiempoGestionMin > 0 && avgG > 0) {
    var desvG = ((avgG - historicos.tiempoGestionMin) / historicos.tiempoGestionMin) * 100;
    if (desvG > umbral) {
      alertas.push({ severity: "info", category: "tiempos", title: "Tiempo gestión desviado del histórico", description: "El tiempo de gestión hoy (" + avgG + " min) es " + Math.round(desvG) + "% mayor que el promedio de 30 días (" + historicos.tiempoGestionMin + " min).", suggestion: "Consultar con el equipo si hoy las solicitudes son más complejas de lo habitual o si hay analistas nuevos que aún están en curva de aprendizaje.", affectedEntities: [] });
    }
  }

  if (historicos.tiempoColaMin > 0 && avgCola > 0) {
    var desvCola = ((avgCola - historicos.tiempoColaMin) / historicos.tiempoColaMin) * 100;
    if (desvCola > umbral) {
      alertas.push({ severity: "info", category: "tiempos", title: "Tiempo de cola desviado del histórico", description: "El tiempo de cola hoy (" + avgCola + " min) es " + Math.round(desvCola) + "% mayor que el promedio de 30 días (" + historicos.tiempoColaMin + " min).", suggestion: "Puede indicar mayor volumen de ingreso hoy. Verificar si hay analistas ausentes o con novedades que reduzcan la capacidad de atención del equipo.", affectedEntities: [] });
    }
  }

  return alertas;
}



function _alerta_calidadDatos(registros) {
  var alertas = [];
  var totalRegs = registros.length;
  if (totalRegs === 0) return alertas;

  var valoresG = [], valoresR = [];

  registros.forEach(function(r) {
    if (r.tGestion !== null && r.tGestion > 0) valoresG.push(r.tGestion);
    if (r.tResolucion !== null && r.tResolucion > 0) valoresR.push(r.tResolucion);
  });

  var outliersG = _detectarOutliers(valoresG, 3);
  var outliersR = _detectarOutliers(valoresR, 3);
  var totalOutliers = outliersG.count + outliersR.count;

  if (totalOutliers > 0) {
    var detallesOut = [];
    if (outliersG.count > 0) detallesOut.push(outliersG.count + " en T. Gestión (>" + Math.round(outliersG.umbral) + " min)");
    if (outliersR.count > 0) detallesOut.push(outliersR.count + " en T. General (>" + Number(outliersR.umbral * 60).toFixed(0) + " min)");
    alertas.push({ severity: "info", category: "calidad", title: totalOutliers + " valores atípicos detectados", description: "Se encontraron valores atípicos (>3 desv. estándar): " + detallesOut.join(", ") + ".", suggestion: "Revisar estos casos puntuales con los analistas: pueden ser errores de registro en el sistema o solicitudes con complejidad fuera de lo normal.", affectedEntities: [] });
  }

  return alertas;
}

function _detectarOutliers(valores, numStdDev) {
  if (valores.length < 5) return { count: 0, umbral: 0 };
  var sum = 0;
  valores.forEach(function(v) { sum += v; });
  var mean = sum / valores.length;
  var sumSq = 0;
  valores.forEach(function(v) { sumSq += (v - mean) * (v - mean); });
  var std = Math.sqrt(sumSq / valores.length);
  var umbral = mean + numStdDev * std;
  var count = valores.filter(function(v) { return v > umbral; }).length;
  return { count: count, umbral: umbral };
}

// --- HEALTH SCORE ---

function _calcularHealthScore(registros, config, historicos, alertas, backlogDetalle, analistasActivos, cuposMap) {
  var components = {};

  // 1. SLA Cumplimiento (25%)
  var dentroSLA = 0, totalSLA = 0;
  registros.forEach(function(r) {
    if (r.tResolucion !== null && r.tResolucion > 0) {
      totalSLA++;
      if (r.tResolucion <= 2) dentroSLA++;
    }
  });
  var pctSLA = totalSLA > 0 ? (dentroSLA / totalSLA) * 100 : 100;
  var scoreSLA = Math.min(100, (pctSLA / config.metas.slaPct) * 100);
  components.slaCumplimiento = { value: Math.round(scoreSLA), weight: 25 };

  // 2. Productividad (20%) — basada en cupos reales
  var ahora = new Date();
  var horaActual = parseInt(Utilities.formatDate(ahora, TIMEZONE, "HH"), 10);
  var minActual = parseInt(Utilities.formatDate(ahora, TIMEZONE, "mm"), 10);
  var horasT = horaActual >= 17 ? 9 : Math.max(1, (horaActual - 8) + minActual / 60);
  var totalCupos = 0;
  Object.keys(cuposMap || {}).forEach(function(k) { totalCupos += (cuposMap[k].total || 0); });
  var esperado;
  if (totalCupos > 0) {
    esperado = Math.max(1, totalCupos * (horasT / 9));
  } else {
    var numAn = Math.max(1, analistasActivos.length);
    esperado = Math.max(1, config.metas.solicitudesPorDiaPorAnalista * numAn * (horasT / 9));
  }
  var scoreProd = Math.min(100, (registros.length / esperado) * 100);
  components.productividad = { value: Math.round(scoreProd), weight: 20 };

  // 3. Tiempo Gestión (15%)
  var sumaG = 0, cG = 0;
  registros.forEach(function(r) { if (r.tGestion !== null) { sumaG += r.tGestion; cG++; } });
  var avgG = cG > 0 ? sumaG / cG : 0;
  var metaG = config.metas.maxTiempoGestionMin;
  var scoreG = avgG <= metaG ? 100 : Math.max(0, 100 - ((avgG - metaG) / metaG * 100));
  components.tiempoGestion = { value: Math.round(scoreG), weight: 15 };

  // 4. Backlog Salud (15%)
  var totalBack = backlogDetalle.length;
  var rojos = backlogDetalle.filter(function(b) { return b.alertaSLA === "rojo"; }).length;
  var metaBack = Math.max(1, config.metas.maxBacklog);
  var scoreBack = Math.max(0, 100 - (totalBack / metaBack * 50) - (totalBack > 0 ? (rojos / totalBack * 50) : 0));
  components.backlogSalud = { value: Math.round(Math.min(100, scoreBack)), weight: 15 };

  // 5. Actividad del equipo (25%) — basada en cupos: cuántos analistas con cupo han gestionado
  var gestionesPorCorreo = {};
  registros.forEach(function(r) { if (r.correo) gestionesPorCorreo[r.correo] = true; });
  var totalConCupo = Object.keys(cuposMap || {}).length;
  var conCupoYGestion = 0;
  Object.keys(cuposMap || {}).forEach(function(correo) { if (gestionesPorCorreo[correo]) conCupoYGestion++; });
  var scoreInact = totalConCupo > 0 ? (conCupoYGestion / totalConCupo) * 100 : 100;
  components.inactividad = { value: Math.round(scoreInact), weight: 25 };

  // Score final
  var total = 0;
  Object.keys(components).forEach(function(k) {
    var c = components[k];
    c.weighted = Math.round(c.value * c.weight / 100 * 10) / 10;
    total += c.weighted;
  });

  var score = Math.round(Math.min(100, Math.max(0, total)));
  var grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

  return { score: score, grade: grade, components: components, timestamp: Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy HH:mm") };
}

// --- DIAGNÓSTICO PRINCIPAL ---

function agente_ejecutarDiagnostico() {
  var config = agente_obtenerConfig();
  var datos = _agente_leerDatosHoy();
  if (!datos) return { alerts: [], healthScore: { score: 0, grade: "F", components: {}, timestamp: "" }, dataQuality: {}, timestamp: "" };

  var historicos = agente_calcularPromediosHistoricos();
  var regs = datos.registros;
  var backlog = datos.backlogDetalle;
  var analistas = datos.analistasActivos;
  var cuposMap = datos.cuposMap || {};
  var equipoPorCorreo = datos.equipoPorCorreo || {};

  var alertas = [];
  alertas = alertas.concat(_alerta_slaCumplimiento(regs, config, historicos));
  alertas = alertas.concat(_alerta_backlogCritico(backlog, config));
  alertas = alertas.concat(_alerta_inactividadAnalistas(analistas, regs, config, cuposMap));
  alertas = alertas.concat(_alerta_productividad(regs, config, historicos, analistas, cuposMap));
  alertas = alertas.concat(_alerta_tiemposAnomalos(regs, config, historicos));
  alertas = alertas.concat(_alerta_calidadDatos(regs));

  var healthScore = _calcularHealthScore(regs, config, historicos, alertas, backlog, analistas, cuposMap);

  // Data quality report
  var valG = regs.filter(function(r) { return r.tGestion !== null && r.tGestion > 0; }).map(function(r) { return r.tGestion; });
  var valR = regs.filter(function(r) { return r.tResolucion !== null && r.tResolucion > 0; }).map(function(r) { return r.tResolucion; });
  var outG = _detectarOutliers(valG, 3);
  var outR = _detectarOutliers(valR, 3);

  var dataQuality = {
    totalRegistros: regs.length,
    outliers: { gestion: outG.count, general: outR.count, total: outG.count + outR.count, umbralGestion: outG.umbral > 0 ? Math.round(outG.umbral) : 0, umbralGeneral: outR.umbral > 0 ? Math.round(outR.umbral * 60) : 0 },
    backlogActual: backlog.length,
    analistasActivos: analistas.length,
    analistasConGestiones: Object.keys(regs.reduce(function(acc, r) { if (r.correo) acc[r.correo] = true; return acc; }, {})).length
  };

  // Resumen para emails
  var sumaG = 0, cG = 0, sumaR = 0, cR = 0, aprobadas = 0, negadas = 0;
  regs.forEach(function(r) {
    if (r.tGestion !== null) { sumaG += r.tGestion; cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) { sumaR += r.tResolucion; cR++; }
    if (r.estado === "APROBADO") aprobadas++;
    if (r.estado === "RECHAZADO") negadas++;
  });

  var aplazadas = regs.filter(function(r) { return r.estado === "APLAZADO"; }).length;
  var sumaCola = 0, cCola = 0;
  regs.forEach(function(r) { if (r.tCola !== null && r.tCola >= 0) { sumaCola += r.tCola; cCola++; } });
  var fueraSLA = regs.filter(function(r) { return r.tResolucion !== null && r.tResolucion > 2; }).length;
  var dentroSLA = regs.filter(function(r) { return r.tResolucion !== null && r.tResolucion > 0 && r.tResolucion <= 2; }).length;
  var slaPct = (dentroSLA + fueraSLA) > 0 ? Math.round(dentroSLA / (dentroSLA + fueraSLA) * 1000) / 10 : 0;

  var prodPorTipo = {};
  regs.forEach(function(r) { var t = r.tipo || "Otro"; prodPorTipo[t] = (prodPorTipo[t] || 0) + 1; });

  var kpis = {
    totalGestionadas: regs.length,
    tiempoGestionProm: cG > 0 ? Math.round(sumaG / cG * 10) / 10 : 0,
    tiempoGeneralProm: cR > 0 ? Number((sumaR / cR).toFixed(2)) : 0,
    tiempoColaProm: cCola > 0 ? Math.round(sumaCola / cCola * 10) / 10 : 0,
    tasaAprobacion: regs.length > 0 ? Math.round(aprobadas / regs.length * 1000) / 10 : 0,
    tasaNegacion: regs.length > 0 ? Math.round(negadas / regs.length * 1000) / 10 : 0,
    backlog: backlog.length,
    // Mismo desglose Verde/Amarillo/Rojo que "Asignado en Proceso" en el tablero — para que el
    // correo no muestre solo un número plano donde el tablero ya muestra el semáforo completo.
    backlogVerde: backlog.filter(function(b) { return b.alertaSLA === "verde"; }).length,
    backlogAmarillo: backlog.filter(function(b) { return b.alertaSLA === "amarillo"; }).length,
    backlogRojo: backlog.filter(function(b) { return b.alertaSLA === "rojo"; }).length,
    aprobadas: aprobadas,
    negadas: negadas,
    aplazadas: aplazadas,
    slaPct: slaPct,
    fueraSLA: fueraSLA,
    prodPorTipo: prodPorTipo
  };

  // Ritmo esperado del equipo A ESTA HORA (mismo criterio que la alerta de productividad y que
  // el "esperado" por analista): cupos reales asignados si existen, si no meta genérica × analistas
  // activos, prorrateado por la fracción de jornada (8am-5pm) ya transcurrida. Evita que "Métricas
  // del Día" se vea "atrás" a media mañana solo por comparar contra la meta del día completo.
  var horaKpi = parseInt(Utilities.formatDate(new Date(), TIMEZONE, "HH"), 10);
  var minKpi = parseInt(Utilities.formatDate(new Date(), TIMEZONE, "mm"), 10);
  var horasTranscurridasKpi = horaKpi >= 17 ? 9 : Math.max(1, (horaKpi - 8) + minKpi / 60);
  var totalCuposKpi = 0;
  Object.keys(cuposMap || {}).forEach(function(ck) { totalCuposKpi += (cuposMap[ck].total || 0); });
  kpis.esperadoHoyEquipo = totalCuposKpi > 0
    ? Math.round(totalCuposKpi * (horasTranscurridasKpi / 9))
    : Math.round(config.metas.solicitudesPorDiaPorAnalista * Math.max(1, analistas.length) * (horasTranscurridasKpi / 9));

  // Análisis detallado por analista
  var porAn = {};
  regs.forEach(function(r) {
    if (!porAn[r.analista]) porAn[r.analista] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaG: 0, cG: 0, sumaR: 0, cR: 0, fueraSLA: 0 };
    var a = porAn[r.analista];
    a.total++;
    if (r.estado === "APROBADO") a.aprobadas++;
    if (r.estado === "RECHAZADO") a.negadas++;
    if (r.estado === "APLAZADO") a.aplazadas++;
    if (r.tGestion !== null) { a.sumaG += r.tGestion; a.cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) { a.sumaR += r.tResolucion; a.cR++; if (r.tResolucion > 2) a.fueraSLA++; }
  });

  var totalEquipo = regs.length;
  var numAnalistasConDatos = Object.keys(porAn).length;
  var promEquipoG = 0, promEquipoTotal = 0;
  if (numAnalistasConDatos > 0) {
    var sTG = 0, sCG = 0, sTotal = 0;
    Object.keys(porAn).forEach(function(k) { var a = porAn[k]; sTotal += a.total; if (a.cG > 0) { sTG += a.sumaG; sCG += a.cG; } });
    promEquipoG = sCG > 0 ? Math.round(sTG / sCG * 10) / 10 : 0;
    promEquipoTotal = Math.round(sTotal / numAnalistasConDatos * 10) / 10;
  }

  var rankAnalistas = Object.keys(porAn).map(function(n) {
    var a = porAn[n];
    return { nombre: n, total: a.total, aprobadas: a.aprobadas, negadas: a.negadas, aplazadas: a.aplazadas, tGestionProm: a.cG > 0 ? Math.round(a.sumaG / a.cG * 10) / 10 : 0, fueraSLA: a.fueraSLA || 0 };
  }).sort(function(a, b) { return b.total - a.total; });

  function _desglosesCupo(cupo) {
    var partes = [];
    if (cupo.nuevas > 0) partes.push("nuevas:" + cupo.nuevas);
    if (cupo.reestudios > 0) partes.push("reestudios:" + cupo.reestudios);
    if (cupo.inducciones > 0) partes.push("inducciones:" + cupo.inducciones);
    if (cupo.biometria > 0) partes.push("biometría:" + cupo.biometria);
    if (cupo.nuevaUAR > 0) partes.push("UAR nueva:" + cupo.nuevaUAR);
    if (cupo.deudorUAR > 0) partes.push("UAR deudor:" + cupo.deudorUAR);
    return partes.join(", ");
  }

  // Seguimiento de personas (basado en cupos asignados)
  var ahora = new Date();
  var horaAct = parseInt(Utilities.formatDate(ahora, TIMEZONE, "HH"), 10);
  var minAct = parseInt(Utilities.formatDate(ahora, TIMEZONE, "mm"), 10);
  var horasOp = horaAct >= 17 ? 9 : Math.max(1, (horaAct - 8) + minAct / 60);
  var pctJornada = horasOp / 9;
  var tieneCupos = Object.keys(cuposMap).length > 0;

  var seguimientoPersonas = [];

  // Producción real por correo
  var prodPorCorreo = {};
  regs.forEach(function(r) {
    if (!r.correo) return;
    if (!prodPorCorreo[r.correo]) prodPorCorreo[r.correo] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaG: 0, cG: 0, sumaR: 0, cR: 0, sumaCola: 0, cCola: 0, fueraSLA: 0, nombre: r.analista, tipos: {} };
    var p = prodPorCorreo[r.correo];
    p.total++;
    var tipoR = r.tipo || "Otro";
    p.tipos[tipoR] = (p.tipos[tipoR] || 0) + 1;
    if (r.estado === "APROBADO") p.aprobadas++;
    if (r.estado === "RECHAZADO") p.negadas++;
    if (r.estado === "APLAZADO") p.aplazadas++;
    if (r.tGestion !== null) { p.sumaG += r.tGestion; p.cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) { p.sumaR += r.tResolucion; p.cR++; if (r.tResolucion > 2) p.fueraSLA++; }
    if (r.tCola !== null && r.tCola >= 0) { p.sumaCola += r.tCola; p.cCola++; }
  });

  // Analistas sin gestiones (que tienen cupo asignado)
  var correosConProd = {};
  Object.keys(prodPorCorreo).forEach(function(k) { correosConProd[k] = true; });

  Object.keys(cuposMap).forEach(function(correo) {
    if (correosConProd[correo]) return;
    var cupo = cuposMap[correo];
    var equipoAn = cupo.equipo || equipoPorCorreo[correo] || "—";
    var desglose = _desglosesCupo(cupo);
    seguimientoPersonas.push({
      nombre: cupo.nombre || correo,
      tipo: "inactividad",
      severidad: horasOp >= 2 ? "critico" : "advertencia",
      resumen: "Sin gestiones hoy",
      datos: [
        { label: "Gestiones hoy", valor: "0", meta: "de " + cupo.total + " asignadas" },
        { label: "Cupos asignados", valor: String(cupo.total), meta: desglose },
        { label: "Equipo", valor: equipoAn, meta: "" },
        { label: "Horas de operación", valor: _fmtMinEmail(horasOp * 60), meta: "" }
      ],
      puntoConversacion: "No ha registrado ninguna gestión en " + Math.round(horasOp) + " horas de operación. Tiene " + cupo.total + " cupos asignados para hoy. Verificar si tiene solicitudes asignadas o si necesita apoyo."
    });
  });

  // También analistas activos sin gestiones NI cupos
  analistas.forEach(function(an) {
    if (correosConProd[an.correo] || cuposMap[an.correo]) return;
    seguimientoPersonas.push({
      nombre: an.nombre,
      tipo: "inactividad",
      severidad: horasOp >= 2 ? "advertencia" : "info",
      resumen: "Sin gestiones y sin cupos asignados",
      datos: [
        { label: "Gestiones hoy", valor: "0", meta: "sin cupos asignados" },
        { label: "Equipo", valor: an.equipo || "—", meta: "" }
      ],
      puntoConversacion: "No tiene gestiones hoy y no aparece en los cupos del día. Verificar si debería tener asignación."
    });
  });

  // Evaluar analistas con producción
  Object.keys(prodPorCorreo).forEach(function(correo) {
    var prod = prodPorCorreo[correo];
    var cupo = cuposMap[correo];
    var nombre = prod.nombre;
    var totalHoy = prod.total;
    var equipoAn2 = cupo ? cupo.equipo : (equipoPorCorreo[correo] || "");
    var motivos = [];

    // Comparar contra cupos asignados
    if (cupo && cupo.total > 0) {
      var esperadoAhora = Math.round(cupo.total * pctJornada);
      var pctCumplido = Math.round(totalHoy / cupo.total * 100);

      if (totalHoy < esperadoAhora * 0.6 && esperadoAhora >= 2) {
        var desglose = _desglosesCupo(cupo);
        motivos.push({
          tipo: "productividad",
          datos: [
            { label: "Gestionadas / Asignadas", valor: totalHoy + " / " + cupo.total, meta: "~" + esperadoAhora + " esperadas a esta hora" },
            { label: "Avance", valor: pctCumplido + "%", meta: "de sus cupos del día" },
            { label: "Equipo", valor: equipoAn2, meta: "" }
          ],
          punto: "Lleva " + totalHoy + " de " + cupo.total + " cupos asignados (" + pctCumplido + "%). A esta hora debería llevar ~" + esperadoAhora + "."
        });
        if (desglose) motivos[motivos.length - 1].datos.push({ label: "Desglose cupos", valor: desglose, meta: "" });
      }
    } else if (!cupo && tieneCupos) {
      if (totalHoy > 0) {
        motivos.push({
          tipo: "info",
          datos: [{ label: "Gestiones hoy", valor: String(totalHoy), meta: "Sin cupos asignados" }],
          punto: "Tiene " + totalHoy + " gestiones pero no aparece en los cupos del día. Verificar asignación."
        });
      }
    }

    // Tiempo gestión alto
    if (prod.cG >= 2) {
      var tGProm = Math.round(prod.sumaG / prod.cG * 10) / 10;
      if (tGProm > config.metas.maxTiempoGestionMin) {
        motivos.push({
          tipo: "tiempos",
          datos: [
            { label: "T. Gestión promedio", valor: _fmtMinEmail(tGProm), meta: "Meta: " + _fmtMinEmail(config.metas.maxTiempoGestionMin) },
            { label: "Promedio equipo", valor: _fmtMinEmail(promEquipoG), meta: "" }
          ],
          punto: "Su tiempo de gestión promedio (" + _fmtMinEmail(tGProm) + ") supera la meta de " + _fmtMinEmail(config.metas.maxTiempoGestionMin) + ". El promedio del equipo es " + _fmtMinEmail(promEquipoG) + "."
        });
      }
    }

    // Fuera de SLA
    if (prod.fueraSLA > 0 && prod.cR >= 2) {
      var pctFuera = Math.round(prod.fueraSLA / prod.cR * 1000) / 10;
      motivos.push({
        tipo: "sla",
        datos: [
          { label: "Fuera de SLA", valor: prod.fueraSLA + " solicitudes", meta: ">" + config.metas.maxTiempoGeneralHoras + "h" },
          { label: "% fuera SLA", valor: pctFuera + "%", meta: "Meta SLA: " + config.metas.slaPct + "%" }
        ],
        punto: prod.fueraSLA + " solicitud(es) superaron las " + config.metas.maxTiempoGeneralHoras + " horas de tiempo general (" + pctFuera + "% de sus gestiones)."
      });
    }

    // Tasa de negación alta
    if (prod.negadas > 0 && prod.total >= 3) {
      var pctNeg = Math.round(prod.negadas / prod.total * 100);
      if (pctNeg > config.metas.maxTasaNegacionPct) {
        motivos.push({
          tipo: "negacion",
          datos: [{ label: "Tasa negación", valor: pctNeg + "%", meta: "Meta: <" + config.metas.maxTasaNegacionPct + "%" }],
          punto: "Tasa de negación del " + pctNeg + "% (" + prod.negadas + " de " + prod.total + "). Supera la meta de " + config.metas.maxTasaNegacionPct + "%.",
          sugerencia: "Revisar criterios de análisis y calidad de los expedientes que recibe."
        });
      }
    }

    // Generar sugerencias por motivo
    motivos.forEach(function(m) {
      if (!m.sugerencia) {
        if (m.tipo === "productividad") m.sugerencia = "Verificar si tiene solicitudes pendientes en cola o si requiere apoyo con casos complejos.";
        else if (m.tipo === "tiempos") m.sugerencia = "Analizar si está recibiendo casos más complejos o si necesita capacitación en algún tipo de estudio.";
        else if (m.tipo === "sla") m.sugerencia = "Priorizar los casos con mayor tiempo de espera y verificar si hay cuellos de botella en la asignación.";
        else if (m.tipo === "info") m.sugerencia = "Confirmar con el coordinador si debe tener asignación para hoy.";
      }
    });

    if (motivos.length > 0) {
      var tGProd = prod.cG > 0 ? Math.round(prod.sumaG / prod.cG * 10) / 10 : 0;
      var tRProd = prod.cR > 0 ? Number((prod.sumaR / prod.cR).toFixed(2)) : 0;
      var tColaProd = prod.cCola > 0 ? Math.round(prod.sumaCola / prod.cCola * 10) / 10 : 0;

      var sevMax = motivos.some(function(m) { return m.tipo === "inactividad"; }) ? "critico" :
                   motivos.some(function(m) { return m.tipo === "sla" || m.tipo === "productividad" || m.tipo === "negacion"; }) ? "advertencia" : "info";

      seguimientoPersonas.push({
        nombre: nombre,
        tipo: motivos.map(function(m) { return m.tipo; }).join(", "),
        severidad: sevMax,
        equipo: equipoAn2 || "—",
        produccion: {
          total: totalHoy,
          cupo: cupo ? cupo.total : 0,
          aprobadas: prod.aprobadas,
          negadas: prod.negadas,
          aplazadas: prod.aplazadas
        },
        tiempos: {
          gestion: tGProd,
          general: tRProd,
          cola: tColaProd,
          fueraSLA: prod.fueraSLA
        },
        tipos: prod.tipos,
        hallazgos: motivos.map(function(m) { return { tipo: m.tipo, detalle: m.punto, sugerencia: m.sugerencia }; }),
        datos: motivos.reduce(function(acc, m) { m.datos.forEach(function(d) { var e = acc.some(function(x) { return x.label === d.label; }); if (!e) acc.push(d); }); return acc; }, []),
        puntoConversacion: motivos.map(function(m, i) { return (i + 1) + ". " + m.punto; }).join("\n")
      });
    }
  });

  seguimientoPersonas.sort(function(a, b) {
    var ord = { critico: 0, advertencia: 1, info: 2 };
    return (ord[a.severidad] || 3) - (ord[b.severidad] || 3);
  });

  var timestamp = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy HH:mm");

  alertas.sort(function(a, b) {
    var ord = { critico: 0, advertencia: 1, info: 2 };
    return (ord[a.severity] || 3) - (ord[b.severity] || 3);
  });

  alertas.forEach(function(al, idx) {
    al.id = al.category + "_" + idx + "_" + Utilities.formatDate(ahora, TIMEZONE, "yyyyMMdd_HHmmss");
    al.timestamp = timestamp;
  });

  _agente_guardarHistorialAlertas(alertas);

  // Cache del resultado
  try {
    var resultado = { alerts: alertas, healthScore: healthScore, dataQuality: dataQuality, kpis: kpis, rankAnalistas: rankAnalistas, seguimientoPersonas: seguimientoPersonas, historicos: historicos, timestamp: timestamp };
    var json = JSON.stringify(resultado);
    if (json.length < 90000) CacheService.getScriptCache().put(AGENT_DIAG_CACHE_KEY, json, 3600);
  } catch (e) {}

  return { alerts: alertas, healthScore: healthScore, dataQuality: dataQuality, kpis: kpis, rankAnalistas: rankAnalistas, seguimientoPersonas: seguimientoPersonas, historicos: historicos, timestamp: timestamp };
}

function _agente_guardarHistorialAlertas(newAlerts) {
  var props = PropertiesService.getScriptProperties();
  var history = [];
  try {
    var raw = props.getProperty(AGENT_HISTORY_KEY);
    if (raw) history = JSON.parse(raw);
  } catch (e) {}

  var criticos = newAlerts.filter(function(a) { return a.severity === "critico"; });
  var advertencias = newAlerts.filter(function(a) { return a.severity === "advertencia"; });
  history = criticos.concat(advertencias).concat(history);
  history = history.slice(0, MAX_ALERT_HISTORY);

  try {
    var json = JSON.stringify(history);
    if (json.length < 9000) props.setProperty(AGENT_HISTORY_KEY, json);
  } catch (e) {}
}

function agente_obtenerHistorialAlertas() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(AGENT_HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

// --- EMAILS ---

function _construirEmailAlertas(diagnostico) {
  var d = diagnostico;
  var hs = d.healthScore;
  var gradeColor = _gradeColor(hs.grade);
  var gradeBg = _gradeBg(hs.grade);

  var criticas = d.alerts.filter(function(a) { return a.severity === "critico"; });
  var advertencias = d.alerts.filter(function(a) { return a.severity === "advertencia"; });

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  // Header con banner rojo de urgencia
  html += '<tr><td style="background:#BD0F14;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<div style="font-size:28px;margin-bottom:8px;">&#9888;&#65039;</div>';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">ALERTA CRÍTICA</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">' + criticas.length + ' situación(es) que requiere(n) atención inmediata</p>';
  html += '</td></tr>';

  // Barra de salud operativa
  html += '<tr><td style="background:#fff;padding:20px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  html += '<td style="text-align:center;padding:12px;background:' + gradeBg + ';border-radius:10px;">';
  html += '<div style="font-size:12px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Salud Operativa</div>';
  html += '<span style="font-size:40px;font-weight:800;color:' + gradeColor + ';">' + hs.score + '</span>';
  html += '<span style="font-size:14px;color:#706F6F;">/100</span>';
  html += '<span style="font-size:16px;font-weight:700;color:' + gradeColor + ';background:#fff;padding:4px 14px;border-radius:8px;margin-left:10px;">' + hs.grade + '</span>';
  html += '</td></tr></table>';
  html += '</td></tr>';

  // Sección: Alertas Críticas — qué está pasando
  html += '<tr><td style="background:#fff;padding:24px 32px;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128308; Qué está pasando</h2>';
  criticas.forEach(function(al, idx) {
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>';
    html += '<td style="background:#fde8e8;border-left:5px solid #BD0F14;border-radius:0 10px 10px 0;padding:16px 20px;">';
    html += '<div style="font-weight:800;font-size:15px;color:#BD0F14;margin-bottom:6px;">' + (idx + 1) + '. ' + _escHtml(al.title) + '</div>';
    html += '<div style="font-size:14px;color:#4a4a4a;line-height:1.5;">' + _escHtml(al.description) + '</div>';
    if (al.affectedEntities && al.affectedEntities.length > 0) {
      html += '<div style="font-size:13px;color:#706F6F;margin-top:8px;"><strong>Personas afectadas:</strong> ' + _escHtml(al.affectedEntities.join(", ")) + '</div>';
    }
    html += '</td></tr></table>';
  });
  html += '</td></tr>';

  // Sección: Pasos a seguir
  var sugerencias = criticas.filter(function(a) { return a.suggestion; });
  if (sugerencias.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#166534;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#9989; Pasos a seguir</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    sugerencias.forEach(function(al, idx) {
      html += '<tr><td style="padding:12px 16px;background:' + (idx % 2 === 0 ? "#f0fdf4" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td width="32" valign="top" style="padding-right:12px;"><div style="width:28px;height:28px;background:#166534;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:800;">' + (idx + 1) + '</div></td>';
      html += '<td style="font-size:14px;color:#253150;line-height:1.5;">' + _escHtml(al.suggestion) + '</td>';
      html += '</tr></table>';
      html += '</td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // Sección: Advertencias (si las hay)
  if (advertencias.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#a16207;border-bottom:2px solid #fef9c3;padding-bottom:10px;">&#128992; Advertencias (' + advertencias.length + ')</h2>';
    advertencias.forEach(function(al) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
      html += '<td style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:14px 18px;">';
      html += '<div style="font-weight:700;font-size:14px;color:#92400e;margin-bottom:4px;">' + _escHtml(al.title) + '</div>';
      if (al.description) html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.4;">' + _escHtml(al.description) + '</div>';
      if (al.suggestion) html += '<div style="font-size:13px;color:#a16207;margin-top:8px;font-style:italic;">&#128161; ' + _escHtml(al.suggestion) + '</div>';
      html += '</td></tr></table>';
    });
    html += '</td></tr>';
  }

  // Sección: Hablar con estas personas
  var personas = d.seguimientoPersonas || [];
  if (personas.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128101; Seguimiento Individual (' + personas.length + ')</h2>';
    personas.forEach(function(p) {
      var bCol = p.severidad === "critico" ? "#BD0F14" : p.severidad === "advertencia" ? "#f59e0b" : "#253150";
      var bgCard = p.severidad === "critico" ? "#fef2f2" : p.severidad === "advertencia" ? "#fffbeb" : "#f8fafc";
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>';
      html += '<td style="border-left:5px solid ' + bCol + ';border-radius:0 10px 10px 0;padding:18px 20px;background:' + bgCard + ';">';
      html += '<div style="font-weight:800;font-size:16px;color:#253150;margin-bottom:10px;">' + _escHtml(p.nombre) + '</div>';
      // Métricas en tabla
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;"><tr>';
      p.datos.slice(0, 4).forEach(function(dat) {
        html += '<td width="25%" style="padding:8px 6px;text-align:center;background:#fff;border:2px solid ' + bgCard + ';border-radius:8px;">';
        html += '<div style="font-size:11px;color:#706F6F;font-weight:700;text-transform:uppercase;margin-bottom:4px;">' + _escHtml(dat.label) + '</div>';
        html += '<div style="font-size:16px;font-weight:800;color:#253150;">' + _escHtml(dat.valor) + '</div>';
        if (dat.meta) html += '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">Meta: ' + _escHtml(dat.meta) + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';
      // Puntos de conversación
      html += '<div style="background:#fff;border-radius:8px;padding:12px 14px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;margin-bottom:6px;">Punto de conversación</div>';
      var lineas = p.puntoConversacion.split("\n");
      lineas.forEach(function(l) {
        if (l.trim()) html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.6;margin-bottom:4px;">&#8226; ' + _escHtml(l) + '</div>';
      });
      html += '</div>';
      html += '</td></tr></table>';
    });
    html += '</td></tr>';
  }

  // Footer
  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + d.timestamp + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

function _construirEmailResumenDiario(diagnostico, datosBio, datosCola, titulo, datosRadicado, datosCorteGestion) {
  var d = diagnostico;
  titulo = titulo || "Cierre del Día";
  var hs = d.healthScore;
  var k = d.kpis;
  var config = agente_obtenerConfig();
  var gradeColor = _gradeColor(hs.grade);
  var gradeBg = _gradeBg(hs.grade);

  var criticas = d.alerts.filter(function(a) { return a.severity === "critico"; });
  var advertencias = d.alerts.filter(function(a) { return a.severity === "advertencia"; });
  var infos = d.alerts.filter(function(a) { return a.severity === "info"; });

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  // Header
  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">' + _escHtml(titulo) + '</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">' + d.timestamp + '</p>';
  html += '</td></tr>';

  // ═══════════════════════════════════════════
  // SECCIÓN 1: Salud Operativa (protagonista)
  // ═══════════════════════════════════════════
  html += '<tr><td style="background:#fff;padding:28px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  html += '<td style="text-align:center;padding:20px;background:' + gradeBg + ';border-radius:12px;">';
  html += '<div style="font-size:12px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Salud Operativa</div>';
  html += '<span style="font-size:48px;font-weight:800;color:' + gradeColor + ';">' + hs.score + '</span>';
  html += '<span style="font-size:16px;color:#706F6F;">/100</span>';
  html += '<span style="font-size:18px;font-weight:700;color:' + gradeColor + ';background:#fff;padding:4px 16px;border-radius:8px;margin-left:12px;">' + hs.grade + '</span>';
  html += '</td></tr></table>';

  // Componentes del score (tabla en vez de flex)
  if (hs.components) {
    var compNames = { slaCumplimiento: "SLA", productividad: "Productividad", tiempoGestion: "T. Gestión", backlogSalud: "Backlog", inactividad: "Actividad Equipo" };
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>';
    Object.keys(hs.components).forEach(function(ck) {
      var c = hs.components[ck];
      var col = c.value >= 80 ? "#166534" : c.value >= 60 ? "#a16207" : "#BD0F14";
      var bg = c.value >= 80 ? "#d1fae5" : c.value >= 60 ? "#fef9c3" : "#fde8e8";
      html += '<td style="text-align:center;padding:8px 4px;">';
      html += '<div style="font-size:11px;color:#706F6F;font-weight:700;margin-bottom:4px;">' + (compNames[ck] || ck) + '</div>';
      html += '<div style="font-size:16px;font-weight:800;color:' + col + ';background:' + bg + ';padding:6px 4px;border-radius:8px;">' + c.value + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
  }
  html += '</td></tr>';

  // ═══════════════════════════════════════════
  // SECCIÓN 1.5: Radicado del Día (mismo cohorte que la sección "Radicado del Período" del tablero)
  // ═══════════════════════════════════════════
  if (datosRadicado) {
    var pctAGN = datosRadicado.totalRadicadas > 0 ? Math.round((datosRadicado.aGestionNormal || 0) / datosRadicado.totalRadicadas * 1000) / 10 : 0;
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128229; Radicado del Día</h2>';
    html += '<p style="margin:0 0 16px;font-size:12px;color:#706F6F;border-bottom:2px solid #e8edf6;padding-bottom:10px;">Lo que ingresó hoy al sistema — cohorte distinto de "Gestionado" de abajo, no tienen por qué coincidir.</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
    html += '<td style="text-align:center;padding:18px;background:#e8edf6;border-radius:12px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Radicadas</div>';
    html += '<span style="font-size:36px;font-weight:800;color:#253150;">' + (datosRadicado.totalRadicadas || 0) + '</span>';
    html += '<div style="font-size:11px;color:#706F6F;margin-top:4px;">Ingresaron al sistema hoy</div>';
    html += '</td></tr></table>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#3a4d7a;margin-bottom:4px;">A Gestión Normal</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#3a4d7a;">' + (datosRadicado.aGestionNormal || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + pctAGN + '% del total radicado</div>';
    html += '</td>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#fde8e8;border-radius:10px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#BD0F14;margin-bottom:4px;">Negación Directa</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + (datosRadicado.negacionDirecta || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + (datosRadicado.pctNegacionDirecta || 0) + '% del total radicado</div>';
    html += '</td>';
    html += '</tr></table>';
    html += '</td></tr>';
  }

  // ═══════════════════════════════════════════
  // SECCIÓN 2: Métricas Principales (Gestionado del Día)
  // ═══════════════════════════════════════════
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128202; Métricas del Día</h2>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:4px;">';

  var kpiItems = [
    { label: "Solicitudes Gestionadas", value: k.totalGestionadas, meta: k.esperadoHoyEquipo, metaLabel: "Esperadas a esta hora", icon: "&#128196;" },
    { label: "Tiempo de Gestión", value: _fmtMinEmail(k.tiempoGestionProm), meta: _fmtMinEmail(config.metas.maxTiempoGestionMin), icon: "&#9201;" },
    { label: "Tiempo General", value: _fmtHorasEmail(k.tiempoGeneralProm), meta: _fmtHorasEmail(config.metas.maxTiempoGeneralHoras), icon: "&#128337;" },
    { label: "Tasa de Aprobación", value: k.tasaAprobacion + "%", meta: null, icon: "&#9989;" },
    { label: "Backlog Pendiente", value: k.backlog, meta: config.metas.maxBacklog, icon: "&#128203;" }
  ];

  // Primera fila: 3 KPIs
  html += '<tr>';
  kpiItems.slice(0, 3).forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:14px 8px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:12px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ki.icon + ' ' + ki.label + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:#253150;">' + ki.value + '</div>';
    if (ki.meta !== null) html += '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">' + (ki.metaLabel || "Meta") + ': ' + ki.meta + '</div>';
    html += '</td>';
  });
  html += '</tr>';
  // Segunda fila: 2 KPIs centrados
  html += '<tr>';
  html += '<td width="33%"></td>';
  kpiItems.slice(3, 5).forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:14px 8px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:12px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ki.icon + ' ' + ki.label + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:#253150;">' + ki.value + '</div>';
    if (ki.meta !== null) html += '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">' + (ki.metaLabel || "Meta") + ': ' + ki.meta + '</div>';
    html += '</td>';
  });
  html += '</tr>';
  html += '</table>';
  html += '</td></tr>';

  // ═══════════════════════════════════════════
  // SECCIÓN 2.5: Cola de Asignación + Producción + SLA
  // ═══════════════════════════════════════════
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';

  // Cola de asignación
  if (datosCola && datosCola.total > 0) {
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128229; Cola de Asignación — ' + datosCola.total + ' sin asignar</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>';
    var colaItems = [
      { l: "Desplazamiento", v: datosCola.desplazamiento },
      { l: "Inducción", v: datosCola.induccion },
      { l: "Digital", v: datosCola.digital }
    ];
    colaItems.forEach(function(ci) {
      html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#fde8e8;border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '</tr><tr>';
    var colaItems2 = [
      { l: "Bio. Fallida", v: datosCola.biometriaFallida },
      { l: "Nueva UAR", v: datosCola.nuevaUar },
      { l: "Deudor UAR", v: datosCola.deudorUar }
    ];
    colaItems2.forEach(function(ci) {
      html += '<td width="33%" style="text-align:center;padding:8px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    if (datosCola.reestudio > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr>';
      html += '<td style="text-align:center;padding:10px;background:#ecfdf5;border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#059669;">Reestudios</div>';
      html += '<div style="font-size:22px;font-weight:800;color:#059669;">' + datosCola.reestudio + '</div>';
      html += '</td></tr></table>';
    }
    html += '<div style="height:20px;"></div>';
  }

  // Asignado en Proceso: mismo semáforo Verde/Amarillo/Rojo que el tablero (backlog ya tomado por un analista, sin cerrar)
  if (k.backlog > 0) {
    html += '<h2 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#253150;">&#8987; Asignado en Proceso — ' + k.backlog + ' sin cerrar</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    [
      { l: "Dentro de SLA", v: k.backlogVerde || 0, c: "#059669", b: "#ecfdf5" },
      { l: "Por vencer", v: k.backlogAmarillo || 0, c: "#d97706", b: "#fffbeb" },
      { l: "Fuera de SLA", v: k.backlogRojo || 0, c: "#BD0F14", b: "#fde8e8" }
    ].forEach(function(bi) {
      html += '<td width="33%" style="text-align:center;padding:10px 6px;background:' + bi.b + ';border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:' + bi.c + ';">' + bi.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + bi.c + ';">' + bi.v + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    html += '<div style="height:20px;"></div>';
  }

  // Producción por tipo
  if (k.prodPorTipo && Object.keys(k.prodPorTipo).length > 0) {
    html += '<h2 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#253150;">&#128200; Producción por Tipo</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>';
    var tipoKeys = Object.keys(k.prodPorTipo).sort(function(a, b) { return k.prodPorTipo[b] - k.prodPorTipo[a]; });
    var tipoColores = { Digital: "#253150", UAR: "#BD0F14", Reestudio: "#706F6F", "Biometría": "#3a4d7a", "Inducción": "#8b0a0e" };
    tipoKeys.forEach(function(t) {
      html += '<td style="text-align:center;padding:10px 4px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + _escHtml(t) + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + (tipoColores[t] || "#253150") + ';">' + k.prodPorTipo[t] + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    html += '<div style="height:16px;"></div>';
  }

  // Distribución por Estado + SLA
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:#ecfdf5;border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#059669;">Aprobados</div>';
  html += '<div style="font-size:22px;font-weight:800;color:#059669;">' + (k.aprobadas || 0) + '</div></td>';
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:#fde8e8;border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#BD0F14;">Rechazados</div>';
  html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + (k.negadas || 0) + '</div></td>';
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:#fffbeb;border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#d97706;">Aplazados</div>';
  html += '<div style="font-size:22px;font-weight:800;color:#d97706;">' + (k.aplazadas || 0) + '</div></td>';
  var slaColor = k.slaPct >= 90 ? "#059669" : k.slaPct >= 70 ? "#d97706" : "#BD0F14";
  var slaBg = k.slaPct >= 90 ? "#ecfdf5" : k.slaPct >= 70 ? "#fffbeb" : "#fde8e8";
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:' + slaBg + ';border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:' + slaColor + ';">SLA</div>';
  html += '<div style="font-size:22px;font-weight:800;color:' + slaColor + ';">' + k.slaPct + '%</div></td>';
  html += '</tr></table>';

  // Tiempos resumen
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>';
  html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">T. Cola</div>';
  html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + _fmtMinEmail(k.tiempoColaProm || 0) + '</div></td>';
  html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">T. Gestión</div>';
  html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + _fmtMinEmail(k.tiempoGestionProm) + '</div></td>';
  html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">T. General</div>';
  html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + _fmtHorasEmail(k.tiempoGeneralProm) + '</div></td>';
  html += '</tr></table>';

  html += '</td></tr>';

  // ═══════════════════════════════════════════
  // SECCIÓN 3: Estado de Alertas
  // ═══════════════════════════════════════════
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128276; Estado de Alertas</h2>';

  if (d.alerts.length === 0) {
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
    html += '<td style="background:#d1fae5;border-radius:10px;padding:16px 20px;text-align:center;">';
    html += '<div style="font-size:15px;font-weight:700;color:#166534;">&#9989; Sin alertas — Operación saludable</div>';
    html += '</td></tr></table>';
  } else {
    if (criticas.length > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
      html += '<td style="background:#fde8e8;border-left:5px solid #BD0F14;border-radius:0 10px 10px 0;padding:14px 18px;">';
      html += '<div style="font-weight:800;font-size:14px;color:#BD0F14;margin-bottom:6px;">&#128308; ' + criticas.length + ' Alerta(s) Crítica(s)</div>';
      criticas.forEach(function(a) {
        html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.5;margin-bottom:4px;">&#8226; <strong>' + _escHtml(a.title) + '</strong></div>';
      });
      html += '</td></tr></table>';
    }
    if (advertencias.length > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
      html += '<td style="background:#fffbeb;border-left:5px solid #f59e0b;border-radius:0 10px 10px 0;padding:14px 18px;">';
      html += '<div style="font-weight:800;font-size:14px;color:#a16207;margin-bottom:6px;">&#128992; ' + advertencias.length + ' Advertencia(s)</div>';
      advertencias.forEach(function(a) {
        html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.5;margin-bottom:4px;">&#8226; ' + _escHtml(a.title) + '</div>';
      });
      html += '</td></tr></table>';
    }
    if (infos.length > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="background:#e8edf6;border-left:5px solid #253150;border-radius:0 10px 10px 0;padding:14px 18px;">';
      html += '<div style="font-weight:800;font-size:14px;color:#253150;margin-bottom:6px;">&#128309; ' + infos.length + ' Informativa(s)</div>';
      infos.forEach(function(a) {
        html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.5;margin-bottom:4px;">&#8226; ' + _escHtml(a.title) + '</div>';
      });
      html += '</td></tr></table>';
    }
  }
  html += '</td></tr>';

  // ═══════════════════════════════════════════
  // SECCIÓN 3.5: Corte de Gestión (detalle por analista) — solo en Foto del Momento
  // ═══════════════════════════════════════════
  if (datosCorteGestion && datosCorteGestion.analistas && datosCorteGestion.analistas.length > 0) {
    html += _htmlSeccionCorteGestion(datosCorteGestion);
  }

  // ═══════════════════════════════════════════
  // SECCIÓN 4: Top Analistas
  // ═══════════════════════════════════════════
  if (d.rankAnalistas && d.rankAnalistas.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#127942; Desempeño del Equipo (' + d.rankAnalistas.length + ' analistas)</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    html += '<tr style="background:#253150;">';
    html += '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#fff;font-weight:700;border-radius:8px 0 0 0;">Analista</th>';
    html += '<th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Total</th>';
    html += '<th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Aprob.</th>';
    html += '<th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Neg.</th>';
    html += '<th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Aplaz.</th>';
    html += '<th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">T.Gestión</th>';
    html += '<th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;border-radius:0 8px 0 0;">F.SLA</th>';
    html += '</tr>';
    d.rankAnalistas.forEach(function(a, idx) {
      var rowBg = idx % 2 === 0 ? "#f8fafc" : "#fff";
      var medal = idx === 0 ? "&#129351; " : idx === 1 ? "&#129352; " : idx === 2 ? "&#129353; " : "";
      html += '<tr>';
      html += '<td style="padding:7px 10px;font-weight:600;font-size:12px;color:#253150;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + medal + _escHtml(a.nombre) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:13px;font-weight:800;color:#253150;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + a.total + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;color:#059669;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.aprobadas || 0) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;color:#BD0F14;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.negadas || 0) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;color:#d97706;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.aplazadas || 0) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;font-weight:600;color:#706F6F;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.tGestionProm || 0) + 'm</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;font-weight:700;color:' + ((a.fueraSLA || 0) > 0 ? '#BD0F14' : '#059669') + ';background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.fueraSLA || 0) + '</td>';
      html += '</tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // ═══════════════════════════════════════════
  // SECCIÓN 5: Pasos a Seguir / Sugerencias
  // ═══════════════════════════════════════════
  var sugerencias = d.alerts.filter(function(a) { return a.suggestion; }).map(function(a) { return a.suggestion; });
  if (sugerencias.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#166534;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#127919; Pasos a Seguir</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    sugerencias.slice(0, 5).forEach(function(s, i) {
      html += '<tr><td style="padding:12px 14px;background:' + (i % 2 === 0 ? "#f0fdf4" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td width="36" valign="top" style="padding-right:12px;"><div style="width:30px;height:30px;background:#166534;color:#fff;border-radius:50%;text-align:center;line-height:30px;font-size:14px;font-weight:800;">' + (i + 1) + '</div></td>';
      html += '<td style="font-size:14px;color:#253150;line-height:1.5;">' + _escHtml(s) + '</td>';
      html += '</tr></table>';
      html += '</td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // ═══════════════════════════════════════════
  // SECCIÓN 6: Reporte de Biometría
  // ═══════════════════════════════════════════
  if (datosBio && datosBio.totalConsultadas > 0) {
    var bio = datosBio;
    var ges = bio.gestion || {};
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#129302; Reporte Biometría del Día</h2>';

    html += '<div style="font-size:13px;font-weight:700;color:#059669;margin-bottom:2px;">Ciclo de Broadcast (WhatsApp)</div>';
    html += '<div style="font-size:11px;color:#706F6F;margin-bottom:10px;">Cola y Esperando Próximo Corte son en vivo (no dependen del día). El resto es actividad real de hoy — Tasa Conversión = Resueltas por WA ÷ WA Enviados, sin pasar por analista.</div>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    var bioKpis = [
      { label: "Cola de Asignación (en vivo)", value: bio.colaActual, color: "#d97706", bg: "#fffbeb" },
      { label: "Esperando Próximo Corte (en vivo)", value: bio.esperandoCorte, color: "#253150", bg: "#f8fafc" },
      { label: "WA Enviados Hoy", value: bio.totalEnviados, color: "#25D366", bg: "#ecfdf5" },
      { label: "Resueltas por WA Hoy", value: bio.enviadasYResueltas, color: "#059669", bg: "#ecfdf5" },
      { label: "Resueltas sin WA Hoy", value: bio.resueltasSinWA, color: "#253150", bg: "#f8fafc" },
      { label: "Tasa Conversión", value: bio.tasaConversion + "%", color: "#059669", bg: "#ecfdf5" }
    ];
    bioKpis.slice(0, 3).forEach(function(ki) {
      html += '<td width="33%" style="text-align:center;padding:12px 6px;background:' + ki.bg + ';border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.label + '</div>';
      html += '<div style="font-size:22px;font-weight:800;color:' + ki.color + ';">' + ki.value + '</div>';
      html += '</td>';
    });
    html += '</tr><tr>';
    bioKpis.slice(3, 6).forEach(function(ki) {
      html += '<td width="33%" style="text-align:center;padding:12px 6px;background:' + ki.bg + ';border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.label + '</div>';
      html += '<div style="font-size:22px;font-weight:800;color:' + ki.color + ';">' + ki.value + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';

    if (ges.total > 0) {
      html += '<div style="font-size:13px;font-weight:700;color:#253150;margin:18px 0 10px;border-top:1px solid #e5e7eb;padding-top:14px;">Gestión de Analistas (llamadas)</div>';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
      [{ l: "Gestionadas", v: ges.total, c: "#253150" }, { l: "OK Llamada", v: ges.okLlamada, c: "#059669" }, { l: "No Contestó", v: ges.noContesto, c: "#d97706" }, { l: "Tasa Contacto", v: ges.tasaContacto + "%", c: "#253150" }, { l: "¿Sirve la llamada?", v: (ges.tasaConversionLlamada || 0) + "%", c: "#059669" }].forEach(function(ki) {
        html += '<td width="20%" style="text-align:center;padding:10px 4px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
        html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
        html += '<div style="font-size:20px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';

      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:6px;"><tr>';
      [{ l: "Aprobados", v: ges.aprobadas, c: "#059669", b: "#ecfdf5" }, { l: "Rechazados", v: ges.negadas, c: "#BD0F14", b: "#fde8e8" }, { l: "Aplazados", v: ges.aplazadas, c: "#d97706", b: "#fffbeb" }].forEach(function(ri) {
        html += '<td width="33%" style="text-align:center;padding:10px 6px;background:' + ri.b + ';border-radius:10px;">';
        html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ri.l + '</div>';
        html += '<div style="font-size:20px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';

      var motivoKeys = Object.keys(ges.motivos || {});
      if (motivoKeys.length > 0) {
        html += '<div style="font-size:12px;font-weight:700;color:#d97706;margin:12px 0 6px;">Motivos de aplazamiento:</div>';
        motivoKeys.forEach(function(m) {
          html += '<div style="font-size:12px;color:#4a4a4a;line-height:1.6;">&#8226; ' + _escHtml(m) + ': <strong>' + ges.motivos[m] + '</strong></div>';
        });
      }
    }

    html += '</td></tr>';
  }

  // Footer
  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + d.timestamp + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

function _construirEmailInicioOperacion(datosCola, datosRadicado, fecha) {
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  // Header
  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">&#9728;&#65039; Inicio de Operación</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">¡Buenos días! Así arranca la operación hoy — ' + _escHtml(fecha) + '</p>';
  html += '</td></tr>';

  // Sección: Total Estudios Radicados (mismo cohorte que "Radicado del Período" del tablero)
  if (datosRadicado) {
    var pctAGN = datosRadicado.totalRadicadas > 0 ? Math.round((datosRadicado.aGestionNormal || 0) / datosRadicado.totalRadicadas * 1000) / 10 : 0;
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128229; Total Estudios Radicados</h2>';
    html += '<p style="margin:0 0 16px;font-size:12px;color:#706F6F;border-bottom:2px solid #e8edf6;padding-bottom:10px;">Lo que ha ingresado al sistema hoy hasta este momento.</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
    html += '<td style="text-align:center;padding:18px;background:#e8edf6;border-radius:12px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Radicadas</div>';
    html += '<span style="font-size:36px;font-weight:800;color:#253150;">' + (datosRadicado.totalRadicadas || 0) + '</span>';
    html += '</td></tr></table>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#3a4d7a;margin-bottom:4px;">A Gestión Normal</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#3a4d7a;">' + (datosRadicado.aGestionNormal || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + pctAGN + '% del total radicado</div>';
    html += '</td>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#fde8e8;border-radius:10px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#BD0F14;margin-bottom:4px;">Negación Directa</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + (datosRadicado.negacionDirecta || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + (datosRadicado.pctNegacionDirecta || 0) + '% del total radicado</div>';
    html += '</td>';
    html += '</tr></table>';
    html += '</td></tr>';
  }

  // Sección: Cola Pendiente al Iniciar — todos los tipos de estudio
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  if (datosCola && datosCola.total > 0) {
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128229; Cola Pendiente al Iniciar — ' + datosCola.total + ' sin asignar</h2>';
    var colaTipos = [
      { l: "Digital", v: datosCola.digital },
      { l: "Desplazamiento", v: datosCola.desplazamiento },
      { l: "Inducción", v: datosCola.induccion },
      { l: "Reestudio", v: datosCola.reestudio },
      { l: "UAR Nueva", v: datosCola.nuevaUar },
      { l: "UAR Deudor", v: datosCola.deudorUar },
      { l: "Biometría Fallida", v: datosCola.biometriaFallida }
    ];
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>';
    colaTipos.slice(0, 4).forEach(function(ci) {
      html += '<td width="25%" style="text-align:center;padding:10px 4px;background:#fde8e8;border-radius:10px;">';
      html += '<div style="font-size:10px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:#BD0F14;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '</tr><tr>';
    colaTipos.slice(4, 7).forEach(function(ci) {
      html += '<td width="25%" style="text-align:center;padding:10px 4px 0;background:#fde8e8;border-radius:10px;">';
      html += '<div style="font-size:10px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:#BD0F14;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '<td width="25%"></td>';
    html += '</tr></table>';
  } else {
    html += '<h2 style="margin:0 0 8px;font-size:16px;font-weight:800;color:#166534;">&#9989; Sin Cola Pendiente</h2>';
    html += '<p style="margin:0;font-size:13px;color:#706F6F;">No hay solicitudes heredadas sin asignar al iniciar la operación.</p>';
  }
  html += '</td></tr>';

  // Footer
  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + _escHtml(fecha) + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

function _construirEmailChequeoConexion(listaActivos, porEstado, fecha, horaChequeo, offsetMin) {
  var totalNoActivos = Object.keys(porEstado).reduce(function(acc, k) { return acc + porEstado[k].length; }, 0);
  var sinAsignacion = listaActivos.filter(function(a) { return !a.primeraAsignacion; }).length;

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  // Header
  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  var offsetLabel = _fmtMinEmail(offsetMin || 30) + ' después del inicio';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">&#128075; Chequeo de Conexión</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">Un vistazo rápido a quién ya está conectado — ' + _escHtml(offsetLabel) + ' · ' + _escHtml(fecha) + ' ' + _escHtml(horaChequeo) + '</p>';
  html += '</td></tr>';

  // Resumen
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [
    { l: "Analistas Activos", v: listaActivos.length, c: "#166534", bg: "#d1fae5" },
    { l: "Analistas No Activos", v: totalNoActivos, c: "#BD0F14", bg: "#fde8e8" },
    { l: "Activos Sin Asignación", v: sinAsignacion, c: "#a16207", bg: "#fef9c3" }
  ].forEach(function(ri) {
    html += '<td width="33%" style="text-align:center;padding:14px 8px;background:' + ri.bg + ';border-radius:10px;">';
    html += '<div style="font-size:12px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ri.l + '</div>';
    html += '<div style="font-size:26px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  // Analistas activos — primera asignación y primer resultado
  html += '<tr><td style="background:#fff;padding:24px 32px 24px;">';
  html += '<h2 style="margin:0 0 6px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#9989; Analistas Activos (' + listaActivos.length + ')</h2>';
  html += '<p style="margin:8px 0 12px;font-size:12px;color:#706F6F;">Hora de la primera solicitud asignada, de su primer resultado cerrado hoy, y cuántas lleva gestionadas hasta este momento (Historico_Gestiones + Reestudios).</p>';
  if (listaActivos.length > 0) {
    var ordenados = listaActivos.slice().sort(function(a, b) {
      if (!a.primeraAsignacion && b.primeraAsignacion) return -1;
      if (a.primeraAsignacion && !b.primeraAsignacion) return 1;
      if (!a.primerResultado && b.primerResultado) return -1;
      if (a.primerResultado && !b.primerResultado) return 1;
      return String(a.primeraAsignacion || "").localeCompare(String(b.primeraAsignacion || ""));
    });
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    html += '<tr><td style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">Analista</td><td width="110" style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">1ª Asignación</td><td width="110" style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">1er Resultado</td><td width="90" align="center" style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">Gestionadas</td></tr>';
    ordenados.forEach(function(a, idx) {
      // "Sin conexión" solo cuando NO hay asignación NI resultado — si hay resultado pero no
      // se encontró la asignación, es un hueco de datos (no un analista desconectado que a la
      // vez cerró una solicitud, contradicción imposible), así que se marca aparte como "N/D".
      var sinConexion = !a.primeraAsignacion && !a.primerResultado;
      var inconsistente = !a.primeraAsignacion && !!a.primerResultado;
      var sinResultadoAun = !!a.primeraAsignacion && !a.primerResultado;
      var bg = sinConexion ? "#fde8e8" : sinResultadoAun ? "#fffbeb" : inconsistente ? "#f8fafc" : (idx % 2 === 0 ? "#f0fdf4" : "#fff");
      var colAsig = sinConexion ? "#BD0F14" : inconsistente ? "#94a3b8" : "#253150";
      var txtAsig = a.primeraAsignacion ? _escHtml(a.primeraAsignacion) : (sinConexion ? "Sin conexión" : "N/D");
      var colRes = a.primerResultado ? "#166534" : (sinConexion ? "#BD0F14" : "#a16207");
      var txtRes = a.primerResultado ? _escHtml(a.primerResultado) : (sinConexion ? "—" : "Sin resultado");
      html += '<tr><td style="padding:8px 12px;background:' + bg + ';border-radius:8px 0 0 8px;font-size:13px;font-weight:700;color:#253150;">' + _escHtml(a.nombre) + '</td>';
      html += '<td style="padding:8px 12px;background:' + bg + ';font-size:13px;font-weight:800;color:' + colAsig + ';">' + txtAsig + '</td>';
      html += '<td style="padding:8px 12px;background:' + bg + ';font-size:13px;font-weight:800;color:' + colRes + ';">' + txtRes + '</td>';
      html += '<td style="padding:8px 12px;background:' + bg + ';border-radius:0 8px 8px 0;font-size:13px;font-weight:800;color:#253150;text-align:center;">' + a.gestionadas + '</td></tr>';
    });
    html += '</table>';
  } else {
    html += '<p style="margin:0;font-size:13px;color:#706F6F;">No hay analistas con Estado ACTIVO en la hoja Usuarios.</p>';
  }
  html += '</td></tr>';

  // Analistas no activos — agrupados por el estado exacto que tengan en Usuarios
  var estadosKeys = Object.keys(porEstado).sort(function(a, b) { return porEstado[b].length - porEstado[a].length; });
  if (estadosKeys.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128308; Analistas No Activos (' + totalNoActivos + ')</h2>';
    estadosKeys.forEach(function(estado) {
      var nombres = porEstado[estado].slice().sort(function(a, b) { return a.localeCompare(b); });
      html += '<div style="margin-bottom:16px;">';
      html += '<div style="font-weight:800;font-size:13px;color:#BD0F14;margin-bottom:8px;">&#9679; ' + _escHtml(estado) + ' (' + nombres.length + ')</div>';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
      for (var i = 0; i < nombres.length; i += 2) {
        html += '<tr>';
        for (var j = i; j < i + 2; j++) {
          html += '<td width="50%" style="padding:3px 4px 3px 0;">';
          if (j < nombres.length) {
            html += '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:12px;color:#253150;font-weight:600;">' + _escHtml(nombres[j]) + '</div>';
          }
          html += '</td>';
        }
        html += '</tr>';
      }
      html += '</table>';
      html += '</div>';
    });
    html += '</td></tr>';
  }

  // Footer
  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + _escHtml(fecha) + ' ' + _escHtml(horaChequeo) + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

function _construirEmailReporteBiometria(bio, fecha) {
  var ges = bio.gestion || {};
  var convColor = bio.tasaConversion >= 60 ? "#166534" : bio.tasaConversion >= 40 ? "#a16207" : "#BD0F14";
  var convBg = bio.tasaConversion >= 60 ? "#d1fae5" : bio.tasaConversion >= 40 ? "#fef9c3" : "#fde8e8";

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  // Header
  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">&#129302; Reporte Biometría del Día</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">Así se movió la biometría hoy — ' + fecha + '</p>';
  html += '</td></tr>';

  // Hero: Tasa de Conversión
  html += '<tr><td style="background:#fff;padding:28px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  html += '<td style="text-align:center;padding:20px;background:' + convBg + ';border-radius:12px;">';
  html += '<div style="font-size:12px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Tasa de Conversión — ¿Sirve el WhatsApp?</div>';
  html += '<span style="font-size:48px;font-weight:800;color:' + convColor + ';">' + bio.tasaConversion + '%</span>';
  html += '<div style="font-size:12px;color:#706F6F;margin-top:6px;">De los WA enviados, % que se aprobó SOLO con el mensaje — sin pasar por un analista</div>';
  html += '</td></tr></table>';
  html += '</td></tr>';

  // En vivo: Cola de Asignación + Faltan por Revisar
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#8987; En Vivo (ahora mismo)</h2>';
  html += '<p style="margin:0 0 16px;font-size:12px;color:#706F6F;border-bottom:2px solid #e8edf6;padding-bottom:10px;">No dependen del día — es el estado actual del ciclo, tomado en el momento de generar este correo</p>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [
    { l: "Cola de Asignación", v: bio.colaActual, c: "#d97706", b: "#fffbeb", s: "Esperando analista, ahora mismo" },
    { l: "Esperando Próximo Corte", v: bio.esperandoCorte, c: "#253150", b: "#f8fafc", s: "Ya tienen WA enviado, esperan el corte de las 8am/12pm" }
  ].forEach(function(ki) {
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:' + ki.b + ';border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
    html += '<div style="font-size:22px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
    html += '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + ki.s + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  // Cascada Estricta de Hoy: mismo grupo que Consultadas SAI, cierra exacto
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128202; Cascada Estricta de Hoy</h2>';
  html += '<p style="margin:0 0 16px;font-size:12px;color:#706F6F;border-bottom:2px solid #e8edf6;padding-bottom:10px;">De lo que ENTRÓ hoy (mismo grupo que Consultadas SAI, ' + bio.totalConsultadas + '): Sin Iniciar + Resueltas sin WA + Ya Enviadas cierra exacto contra ese total. Si el rango es corto, "Resueltas sin WA" aquí normalmente da bajo o cero — lo de hoy casi nunca alcanza a resolverse el mismo día.</p>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [
    { l: "Sin Iniciar", v: bio.totalSinIniciar, c: "#706F6F", b: "#f8fafc" },
    { l: "Resueltas sin WA", v: bio.cohorteResueltasSinWA, c: "#253150", b: "#e8edf6" },
    { l: "Ya Enviadas", v: bio.cohorteEnviadas, c: "#25D366", b: "#ecfdf5" }
  ].forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:12px 6px;background:' + ki.b + ';border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
    html += '<div style="font-size:22px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  // Ciclo de Hoy (actividad real, incluye arrastre de días anteriores)
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128241; Ciclo de Hoy (actividad real)</h2>';
  html += '<p style="margin:0 0 16px;font-size:12px;color:#706F6F;border-bottom:2px solid #e8edf6;padding-bottom:10px;">Cuánto pasó HOY en la vida real, sin importar cuándo entró la solicitud — por eso puede incluir casos consultados días atrás que hoy tuvieron su corte. No tiene que coincidir con la Cascada Estricta de arriba, son preguntas distintas.</p>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [
    { l: "Resueltas sin WhatsApp", v: bio.resueltasSinWA, c: "#253150", b: "#e8edf6" },
    { l: "WA Enviados", v: bio.totalEnviados, c: "#25D366", b: "#ecfdf5" }
  ].forEach(function(ki) {
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:' + ki.b + ';border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
    html += '<div style="font-size:22px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>';
  [
    { l: "Resueltas por WhatsApp", v: bio.enviadasYResueltas, c: "#059669", b: "#ecfdf5" },
    { l: "Escaladas a Análisis", v: bio.enviadasYEscaladas, c: "#d97706", b: "#fffbeb" }
  ].forEach(function(ki) {
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:' + ki.b + ';border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
    html += '<div style="font-size:22px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  // Gestión de Analistas
  if (ges.total > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128222; Gestión de Analistas (llamadas)</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    [
      { l: "Gestionadas", v: ges.total, c: "#253150" },
      { l: "OK Llamada", v: ges.okLlamada, c: "#059669" },
      { l: "No Contestó", v: ges.noContesto, c: "#d97706" },
      { l: "Tasa Contacto", v: ges.tasaContacto + "%", c: "#253150" },
      { l: "¿Sirve la llamada?", v: (ges.tasaConversionLlamada || 0) + "%", c: "#059669" }
    ].forEach(function(ki) {
      html += '<td width="20%" style="text-align:center;padding:10px 4px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';

    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>';
    [
      { l: "Aprobados", v: ges.aprobadas, c: "#059669", b: "#ecfdf5" },
      { l: "Rechazados", v: ges.negadas, c: "#BD0F14", b: "#fde8e8" },
      { l: "Aplazados", v: ges.aplazadas, c: "#d97706", b: "#fffbeb" }
    ].forEach(function(ri) {
      html += '<td width="33%" style="text-align:center;padding:10px 6px;background:' + ri.b + ';border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ri.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';

    var motivoKeys = Object.keys(ges.motivos || {});
    if (motivoKeys.length > 0) {
      html += '<div style="font-size:12px;font-weight:700;color:#d97706;margin:14px 0 6px;">Motivos de aplazamiento:</div>';
      motivoKeys.forEach(function(m) {
        html += '<div style="font-size:12px;color:#4a4a4a;line-height:1.6;">&#8226; ' + _escHtml(m) + ': <strong>' + ges.motivos[m] + '</strong></div>';
      });
    }
    html += '</td></tr>';
  }

  // Footer
  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + fecha + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

function _escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _gradeColor(grade) {
  return grade === "A" ? "#166534" : grade === "B" ? "#253150" : grade === "C" ? "#a16207" : grade === "D" ? "#c2410c" : "#BD0F14";
}

function _gradeBg(grade) {
  return grade === "A" ? "#d1fae5" : grade === "B" ? "#e8edf6" : grade === "C" ? "#fef9c3" : grade === "D" ? "#fed7aa" : "#fde8e8";
}

function _fmtMinEmail(min) {
  if (!min || min === 0) return "0m";
  var h = Math.floor(min / 60);
  var m = Math.round(min % 60);
  if (m === 60) { h++; m = 0; }
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  return m + "m";
}

function _fmtHorasEmail(horas) {
  if (!horas || horas === 0) return "0m";
  var totalMin = Math.round(horas * 60);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  return m + "m";
}

// Quien recibe reportes = quien tiene acceso al tablero (Control de Acceso), sin lista manual
// aparte — así no hay dos lugares distintos que mantener sincronizados ni confusión sobre
// quién realmente recibe qué. Los coordinadores reciben todos los reportes generales.
function _obtenerDestinatarios(config) {
  var emails = _obtenerListaAcceso(ACCESS_COORD_KEY);
  if (emails.length === 0) {
    var userEmail = Session.getActiveUser().getEmail();
    if (userEmail) emails.push(userEmail);
  }
  return emails;
}

function _obtenerDestinatariosBiometria(config) {
  var emails = _obtenerDestinatarios(config);
  var bios = _obtenerListaAcceso(ACCESS_BIO_KEY);
  bios.forEach(function(e) {
    if (emails.indexOf(e) === -1) emails.push(e);
  });
  return emails;
}

function agente_enviarAlertasCriticas(diagnostico) {
  var config = agente_obtenerConfig();
  if (!config.notificaciones.enviarAlertasCriticas) return { sent: false, reason: "desactivado" };

  var criticas = diagnostico.alerts.filter(function(a) { return a.severity === "critico"; });
  if (criticas.length === 0) return { sent: false, reason: "sin alertas criticas" };

  var emails = _obtenerDestinatarios(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");

  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hora = Utilities.formatDate(ahora, TIMEZONE, "HH:mm");
  var html = _construirEmailAlertas(diagnostico);

  try {
    MailApp.sendEmail({
      to: email,
      bcc: BCC_REPORTES_AGENTE,
      subject: "ALERTA CRÍTICA | " + criticas.length + " situación(es) requiere(n) atención | " + fecha + " " + hora,
      htmlBody: html,
      name: NOMBRE_REMITENTE_AGENTE,
      noReply: true
    });
    return { sent: true, to: email, alertCount: criticas.length };
  } catch (e) {
    Logger.log("Error enviando email de alertas: " + e.message);
    return { sent: false, reason: e.message };
  }
}

function agente_enviarResumenDiario() {
  var diagnostico = agente_ejecutarDiagnostico();
  var config = agente_obtenerConfig();

  var emails = _obtenerDestinatarios(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");

  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hoy = Utilities.formatDate(ahora, TIMEZONE, "yyyy-MM-dd");
  var hs = diagnostico.healthScore || {};

  var datosBio = null;
  try { datosBio = obtenerDatosBiometria(hoy, hoy); } catch (e) { Logger.log("Aviso: No se pudo obtener datos biometría para email: " + e.message); }

  var datosCola = null;
  try { datosCola = obtenerColaAsignacion(); } catch (e) { Logger.log("Aviso: No se pudo obtener cola para email: " + e.message); }

  var datosRadicado = null;
  try { datosRadicado = obtenerDatosMetricas(fecha, fecha); } catch (e) { Logger.log("Aviso: No se pudo obtener radicado para email: " + e.message); }

  var html = _construirEmailResumenDiario(diagnostico, datosBio, datosCola, null, datosRadicado);

  try {
    MailApp.sendEmail({
      to: email,
      bcc: BCC_REPORTES_AGENTE,
      subject: "Cierre del Día | Salud " + (hs.score || "—") + "/100 (" + (hs.grade || "—") + ") | " + fecha,
      htmlBody: html,
      name: NOMBRE_REMITENTE_AGENTE,
      noReply: true
    });
    return { sent: true, to: email };
  } catch (e) {
    Logger.log("Error enviando resumen diario: " + e.message);
    return { sent: false, reason: e.message };
  }
}

function agente_enviarResumenManual() {
  return agente_enviarResumenDiario();
}

function agente_enviarSnapshotActual() {
  var diagnostico = agente_ejecutarDiagnostico();
  var config = agente_obtenerConfig();

  var emails = _obtenerDestinatarios(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");

  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hora = Utilities.formatDate(ahora, TIMEZONE, "HH:mm");
  var hoy = Utilities.formatDate(ahora, TIMEZONE, "yyyy-MM-dd");
  var hs = diagnostico.healthScore || {};

  var datosBio = null;
  try { datosBio = obtenerDatosBiometria(hoy, hoy); } catch (e) { Logger.log("Aviso: No se pudo obtener datos biometría para snapshot: " + e.message); }

  var datosCola = null;
  try { datosCola = obtenerColaAsignacion(); } catch (e) { Logger.log("Aviso: No se pudo obtener cola para snapshot: " + e.message); }

  var datosRadicado = null;
  try { datosRadicado = obtenerDatosMetricas(fecha, fecha); } catch (e) { Logger.log("Aviso: No se pudo obtener radicado para snapshot: " + e.message); }

  var datosCorteGestion = null;
  try { datosCorteGestion = agente_obtenerCorteGestion(); } catch (e) { Logger.log("Aviso: No se pudo obtener corte de gestión para snapshot: " + e.message); }

  var html = _construirEmailResumenDiario(diagnostico, datosBio, datosCola, "Foto del Momento", datosRadicado, datosCorteGestion);

  var atencion = datosCorteGestion && datosCorteGestion.analistas ? datosCorteGestion.analistas.filter(function(a) { return a.semaforo === "rojo" || a.semaforo === "amarillo"; }).length : null;
  var subject = "Foto del Momento | Salud " + (hs.score || "—") + "/100 (" + (hs.grade || "—") + ")" + (atencion !== null ? " | " + atencion + " requieren atención" : "") + " | " + fecha + " " + hora;

  try {
    MailApp.sendEmail({
      to: email,
      bcc: BCC_REPORTES_AGENTE,
      subject: subject,
      htmlBody: html,
      name: NOMBRE_REMITENTE_AGENTE,
      noReply: true
    });
    return { sent: true, to: email };
  } catch (e) {
    Logger.log("Error enviando foto del momento: " + e.message);
    return { sent: false, reason: e.message };
  }
}

function agente_enviarReporteBiometria() {
  var config = agente_obtenerConfig();

  var emails = _obtenerDestinatariosBiometria(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");

  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hoy = Utilities.formatDate(ahora, TIMEZONE, "yyyy-MM-dd");

  var datosBio;
  try {
    datosBio = obtenerDatosBiometria(hoy, hoy);
  } catch (e) {
    Logger.log("Error obteniendo datos biometría para el reporte: " + e.message);
    return { sent: false, reason: e.message };
  }

  if (!datosBio || datosBio.totalConsultadas === 0) return { sent: false, reason: "sin datos de biometría hoy" };

  var html = _construirEmailReporteBiometria(datosBio, fecha);

  try {
    MailApp.sendEmail({
      to: email,
      bcc: BCC_REPORTES_AGENTE,
      subject: "Reporte Biometría del Día | " + datosBio.totalConsultadas + " consultadas · " + datosBio.tasaConversion + "% conversión | " + fecha,
      htmlBody: html,
      name: NOMBRE_REMITENTE_AGENTE,
      noReply: true
    });
    return { sent: true, to: email };
  } catch (e) {
    Logger.log("Error enviando reporte de biometría: " + e.message);
    return { sent: false, reason: e.message };
  }
}

function agente_enviarReporteBiometriaManual() {
  return agente_enviarReporteBiometria();
}

function agente_enviarInicioOperacion() {
  var config = agente_obtenerConfig();
  var emails = _obtenerDestinatarios(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");

  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hora = Utilities.formatDate(ahora, TIMEZONE, "HH:mm");

  var datosCola = null;
  try { datosCola = obtenerColaAsignacion(); } catch (e) { Logger.log("Aviso: No se pudo obtener cola para inicio de operación: " + e.message); }

  var datosRadicado = null;
  try { datosRadicado = obtenerDatosMetricas(fecha, fecha); } catch (e) { Logger.log("Aviso: No se pudo obtener radicado para inicio de operación: " + e.message); }

  var html = _construirEmailInicioOperacion(datosCola, datosRadicado, fecha);

  try {
    MailApp.sendEmail({
      to: email,
      bcc: BCC_REPORTES_AGENTE,
      subject: "Inicio de Operación | " + ((datosCola && datosCola.total) || 0) + " en cola, " + ((datosRadicado && datosRadicado.totalRadicadas) || 0) + " radicadas | " + fecha + " " + hora,
      htmlBody: html,
      name: NOMBRE_REMITENTE_AGENTE,
      noReply: true
    });
    return { sent: true, to: email };
  } catch (e) {
    Logger.log("Error enviando inicio de operación: " + e.message);
    return { sent: false, reason: e.message };
  }
}

function agente_enviarInicioOperacionManual() {
  return agente_enviarInicioOperacion();
}

// Primera hora de asignación de hoy por analista, cruzando Historico_Gestiones (columna
// "Fecha Asignación") y la hoja de Reestudios — misma fuente que ya usa _agente_leerDatosHoy
// para detectar backlog (fecha de asignación con fecha de fin vacía = todavía pendiente).
function _agente_obtenerPrimeraAsignacionHoy() {
  var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  var primeraAsignacion = {};

  try {
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hoja = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
    var data = hoja.getDataRange().getDisplayValues();
    for (var i = 1; i < data.length; i++) {
      var fila = data[i];
      var correo = String(fila[25] || "").toLowerCase().trim();
      var fechaAsigRaw = String(fila[24] || "").trim();
      if (!correo || !fechaAsigRaw || !coincideFecha(fechaAsigRaw, hoyStr)) continue;
      var partes = fechaAsigRaw.split(" ");
      var hora = normalizarHora(partes[1] || "");
      if (!hora) continue;
      if (!primeraAsignacion[correo] || hora < primeraAsignacion[correo]) primeraAsignacion[correo] = hora;
    }
  } catch (e) {
    Logger.log("Aviso: No se pudo leer Historico_Gestiones para primera asignación: " + e.message);
  }

  try {
    var ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    var hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      var lastRow = hojaReest.getLastRow();
      if (lastRow > 1) {
        var dataReest = hojaReest.getRange(2, 1, lastRow - 1, 10).getDisplayValues();
        for (var j = 0; j < dataReest.length; j++) {
          var correoR = String(dataReest[j][6] || "").toLowerCase().trim();
          var fechaAsigR = String(dataReest[j][8] || "").trim();
          if (!correoR || !fechaAsigR || !coincideFecha(fechaAsigR, hoyStr)) continue;
          var partesR = fechaAsigR.split(" ");
          var horaR = normalizarHora(partesR[1] || "");
          if (!horaR) continue;
          if (!primeraAsignacion[correoR] || horaR < primeraAsignacion[correoR]) primeraAsignacion[correoR] = horaR;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se pudo leer Reestudios para primera asignación: " + e.message);
  }

  return primeraAsignacion;
}

// Minutos acumulados hoy por cada estado (mismo catálogo de Estado que la hoja Usuarios: ACTIVO,
// BREAK MAÑANA, ALMUERZO, INCAPACIDAD, etc.) y el estado en el que está cada analista en este
// momento, leyendo "Historico_Estados" de la misma hoja de cálculo (TARGET_SOLICITUDES_SS_ID).
// Columnas: fecha, analista (correo), estado, hora inicio, hora fin, minutos totales.
function _agente_leerHistoricoEstadosHoy() {
  var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  var porAnalista = {};

  try {
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hoja = ss.getSheetByName("Historico_Estados");
    if (!hoja) return porAnalista;
    var data = hoja.getDataRange().getDisplayValues();
    for (var i = 1; i < data.length; i++) {
      var fila = data[i];
      var fecha = String(fila[0] || "").trim();
      if (!fecha || !coincideFecha(fecha, hoyStr)) continue;
      var correo = String(fila[1] || "").toLowerCase().trim();
      if (!correo) continue;
      var estado = String(fila[2] || "").toUpperCase().trim();
      var horaInicio = String(fila[3] || "").trim();
      var horaFin = String(fila[4] || "").trim();
      var minutosRaw = parseFloat(String(fila[5] || "").replace(",", "."));
      var minutos = !isNaN(minutosRaw) && minutosRaw >= 0 ? minutosRaw : 0;

      if (!porAnalista[correo]) porAnalista[correo] = { minutosPorEstado: {}, estadoActual: null, horaInicioActual: "", horaPrimeraConexion: "" };
      var reg = porAnalista[correo];
      reg.minutosPorEstado[estado] = (reg.minutosPorEstado[estado] || 0) + minutos;

      // La fila con la hora de inicio más temprana del día (sin importar el estado) marca cuándo
      // se conectó por primera vez — puede ser antes de la hora "Desde" configurada.
      var horaInicioNorm = normalizarHora(horaInicio);
      if (horaInicioNorm && (!reg.horaPrimeraConexion || horaInicioNorm < reg.horaPrimeraConexion)) {
        reg.horaPrimeraConexion = horaInicioNorm;
      }

      // Fila sin hora fin = todavía en curso; entre varias en curso (no debería pasar, pero por
      // si hay un hueco de datos) se queda con la de hora de inicio más reciente.
      if (!horaFin) {
        if (!reg.horaInicioActual || horaInicioNorm > reg.horaInicioActual) {
          reg.estadoActual = estado;
          reg.horaInicioActual = horaInicioNorm;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se pudo leer Historico_Estados: " + e.message);
  }

  return porAnalista;
}

// Construye el correo individual de la semana para un analista. A diferencia de Corte de Gestión
// (que usa semáforo rojo/amarillo/verde para coordinadores), este tiene tono cálido y compara solo
// contra la propia semana anterior del analista — nunca contra el equipo. Regla de tono: si una
// métrica empeoró respecto a la semana pasada, se muestra el número de esta semana sin flecha ni
// texto de variación (nunca se dice explícitamente "bajaste"); la comparación solo aparece cuando
// el cambio es igual o mejor.
function _construirEmailInformeIndividual(m, rango) {
  var primerNombre = String(m.nombre || "").trim().split(/\s+/)[0] || "";
  primerNombre = primerNombre.charAt(0) + primerNombre.slice(1).toLowerCase();

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<div style="font-size:13px;opacity:0.85;letter-spacing:0.5px;text-transform:uppercase;">Tu semana en números</div>';
  html += '<h1 style="margin:6px 0 0;font-size:22px;font-weight:800;">&#128075; Hola, ' + _escHtml(primerNombre) + '</h1>';
  html += '<p style="margin:8px 0 0;font-size:13px;opacity:0.9;">' + _escHtml(rango.fechaDesdeActual) + ' al ' + _escHtml(rango.fechaHastaActual) + '</p>';
  html += '</td></tr>';

  html += '<tr><td style="background:#fff;padding:28px 32px;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';

  // Volumen gestionado — mejora si es mayor o igual que la semana pasada.
  var mejoraVolumen = m.gestionadasPrev != null && m.gestionadasPrev > 0 && m.gestionadas >= m.gestionadasPrev;
  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:#f8fafc;border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#128193; Casos gestionados</div>';
  html += '<div style="font-size:30px;font-weight:800;color:#253150;">' + m.gestionadas + '</div>';
  if (mejoraVolumen) {
    var pctVol = Math.round((m.gestionadas - m.gestionadasPrev) / m.gestionadasPrev * 100);
    html += '<div style="font-size:11px;font-weight:700;color:#166534;margin-top:4px;">&#9650; ' + (pctVol > 0 ? pctVol + "% más" : "Igual") + ' que la semana pasada</div>';
  }
  html += '</td>';

  // Tiempo promedio de gestión — mejora si es menor o igual que la semana pasada.
  var mejoraTiempo = m.tiempoProm != null && m.tiempoPromPrev != null && m.tiempoProm <= m.tiempoPromPrev;
  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:#f8fafc;border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#9201; Tiempo promedio</div>';
  html += '<div style="font-size:30px;font-weight:800;color:#253150;">' + (m.tiempoProm != null ? _fmtMinEmail(m.tiempoProm) : "—") + '</div>';
  if (mejoraTiempo && m.tiempoProm < m.tiempoPromPrev) {
    html += '<div style="font-size:11px;font-weight:700;color:#166534;margin-top:4px;">&#9650; Más ágil que la semana pasada</div>';
  }
  html += '</td>';
  html += '</tr></table>';

  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>';

  // % dentro de SLA — mejora si es mayor o igual que la semana pasada.
  var mejoraSla = m.slaPct != null && m.slaPctPrev != null && m.slaPct >= m.slaPctPrev;
  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:#f0fdf4;border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#9989; Dentro de tiempo objetivo</div>';
  html += '<div style="font-size:30px;font-weight:800;color:#166534;">' + (m.slaPct != null ? m.slaPct + "%" : "—") + '</div>';
  if (mejoraSla && m.slaPct > m.slaPctPrev) {
    html += '<div style="font-size:11px;font-weight:700;color:#166534;margin-top:4px;">&#9650; Mejor que la semana pasada</div>';
  }
  html += '</td>';

  // Racha — solo se muestra si hay algo que celebrar (2+ días); si no, se omite en vez de mostrar un número bajo.
  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:' + (m.racha >= 2 ? '#fff7ed' : '#f8fafc') + ';border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#128293; Constancia</div>';
  if (m.racha >= 2) {
    html += '<div style="font-size:30px;font-weight:800;color:#c2410c;">' + m.racha + '</div>';
    html += '<div style="font-size:11px;font-weight:700;color:#c2410c;margin-top:4px;">días seguidos gestionando</div>';
  } else {
    html += '<div style="font-size:16px;font-weight:700;color:#94a3b8;padding-top:6px;">Vas arrancando esta semana</div>';
  }
  html += '</td>';
  html += '</tr></table>';

  html += '<p style="font-size:13px;color:#4a4a4a;line-height:1.6;margin:24px 0 0;">Gracias por tu trabajo esta semana. Este es solo un vistazo rápido de tu propio avance — ¡sigue así! &#128170;</p>';
  html += '</td></tr>';

  html += '<tr><td style="background:#253150;color:#fff;padding:18px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Equipo de Analítica — El Libertador</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// Envía el Informe Individual Semanal a cada analista con al menos una gestión cerrada esta
// semana. Si se pasa correoPrueba, envía solo a esa dirección (con [PRUEBA] en el asunto) para
// poder revisar el copy real antes de activarlo para todos — ver notificaciones.enviarInformeIndividual.
// Cuenta a cuántos analistas les llegaría el Informe Individual Semanal si se enviara ahora mismo,
// sin enviar nada — para que la UI pueda mostrar el número en el diálogo de confirmación antes del
// envío real.
function agente_contarCandidatosInformeIndividual() {
  var rendimiento = _agente_calcularRendimientoSemanal();
  var candidatos = rendimiento.porAnalista.filter(function(m) { return m.gestionadas > 0 && m.correo; });
  return { total: candidatos.length, fechaDesdeActual: rendimiento.fechaDesdeActual, fechaHastaActual: rendimiento.fechaHastaActual };
}

function agente_enviarInformeIndividualAnalistas(correoPrueba) {
  var rendimiento = _agente_calcularRendimientoSemanal();
  var rango = { fechaDesdeActual: rendimiento.fechaDesdeActual, fechaHastaActual: rendimiento.fechaHastaActual };

  var candidatos = rendimiento.porAnalista.filter(function(m) { return m.gestionadas > 0 && m.correo; });

  var enviados = 0;
  var fallidos = [];

  if (!correoPrueba && candidatos.length === 0) {
    return { sent: false, modo: "masivo", enviados: 0, totalCandidatos: 0, fallidos: [], reason: "sin analistas con gestiones esta semana" };
  }

  if (correoPrueba) {
    var muestra = candidatos[0] || { nombre: "Analista", correo: correoPrueba, gestionadas: 0, gestionadasPrev: null, tiempoProm: null, tiempoPromPrev: null, slaPct: null, slaPctPrev: null, racha: 0 };
    try {
      MailApp.sendEmail({
        to: correoPrueba,
        subject: "[PRUEBA] Tu resumen de la semana · " + rango.fechaDesdeActual + " al " + rango.fechaHastaActual,
        htmlBody: _construirEmailInformeIndividual(muestra, rango),
        name: NOMBRE_REMITENTE_AGENTE,
        noReply: true
      });
      return { sent: true, modo: "prueba", to: correoPrueba, muestraDe: muestra.nombre };
    } catch (e) {
      return { sent: false, modo: "prueba", reason: e.message };
    }
  }

  candidatos.forEach(function(m) {
    try {
      MailApp.sendEmail({
        to: m.correo,
        subject: "Tu resumen de la semana · " + rango.fechaDesdeActual + " al " + rango.fechaHastaActual,
        htmlBody: _construirEmailInformeIndividual(m, rango),
        name: NOMBRE_REMITENTE_AGENTE,
        noReply: true
      });
      enviados++;
    } catch (e) {
      fallidos.push({ correo: m.correo, reason: e.message });
    }
  });

  return { sent: enviados > 0, modo: "masivo", enviados: enviados, totalCandidatos: candidatos.length, fallidos: fallidos };
}

// Requiere el correo de prueba explícitamente — si se ejecuta desde el editor de Apps Script con
// el botón ▶ (sin argumento), NO debe caer al modo masivo por accidente.
function agente_enviarInformeIndividualManual(correoPrueba) {
  if (!correoPrueba) {
    throw new Error("agente_enviarInformeIndividualManual requiere un correo de prueba, ej.: agente_enviarInformeIndividualManual('tu-correo@segurosbolivar.com'). Para enviar a todos los analistas usa agente_enviarInformeIndividualAnalistas() directamente.");
  }
  return agente_enviarInformeIndividualAnalistas(correoPrueba);
}

// Ensambla el detalle por analista para la sección "Corte de Gestión" del correo Foto del
// Momento: producción y desglose de
// resultados del día (obtenerRendimientoPorDia), ritmo esperado según el promedio histórico de
// 30 días (agente_calcularPromediosHistoricos), y distribución del tiempo entre ACTIVO y el
// resto de estados (_agente_leerHistoricoEstadosHoy) — todas fuentes que ya existen en otras
// partes del sistema, ninguna se recalcula desde cero aquí.
function agente_obtenerCorteGestion() {
  var config = agente_obtenerConfig();

  var seguimiento;
  try {
    seguimiento = admin_obtenerAsesoresActivosPrimerResultado();
  } catch (e) {
    Logger.log("Error obteniendo seguimiento para corte de gestión: " + e.message);
    seguimiento = { datos: [] };
  }
  var activos = (seguimiento.datos || []).filter(function(a) { return String(a.estado || "").toUpperCase() === "ACTIVO"; });

  var rendimientoPorCorreo = {};
  try {
    obtenerRendimientoPorDia().forEach(function(r) { if (r.correo) rendimientoPorCorreo[r.correo] = r; });
  } catch (e) {
    Logger.log("Aviso: No se pudo obtener rendimiento del día para corte de gestión: " + e.message);
  }

  var historicos;
  try {
    historicos = agente_calcularPromediosHistoricos();
  } catch (e) {
    historicos = { porAnalista: {} };
  }

  var estadosPorCorreo = {};
  try {
    estadosPorCorreo = _agente_leerHistoricoEstadosHoy();
  } catch (e) {
    Logger.log("Aviso: No se pudo obtener Historico_Estados para corte de gestión: " + e.message);
  }

  var umbralPausaMin = (config.metas && config.metas.umbralMinutosPausa) || 90;

  // Hora "Desde" del día de hoy, para poder marcar a quién se conectó antes de su horario.
  var hr = config.horarioReporte || DEFAULT_AGENT_CONFIG.horarioReporte;
  var diaHoy = parseInt(Utilities.formatDate(new Date(), TIMEZONE, "u"), 10);
  var diaCfgHoy = (hr.dias || {})[String(diaHoy)];
  var minutosInicioHoy = _horaMinToMinutos(diaCfgHoy && diaCfgHoy.horaInicio, 8 * 60);

  var analistas = activos.map(function(a) {
    var rend = rendimientoPorCorreo[a.correo] || { total: a.gestionadas || 0, aprobadas: 0, negadas: 0, aplazadas: 0, tiempoPromedio: a.promedioGestion || 0, detalleHoras: {} };
    var estadosInfo = estadosPorCorreo[a.correo] || { minutosPorEstado: {}, estadoActual: null, horaPrimeraConexion: "" };
    var minutosPorEstado = estadosInfo.minutosPorEstado || {};

    var minutosProductivos = minutosPorEstado.ACTIVO || 0;
    var minutosNoProductivos = 0;
    var desglosePausas = {};
    Object.keys(minutosPorEstado).forEach(function(e) {
      if (e === "ACTIVO") return;
      minutosNoProductivos += minutosPorEstado[e];
      desglosePausas[e] = Math.round(minutosPorEstado[e]);
    });

    var histDia = (historicos.porAnalista[a.nombre] || {}).solDia || 0;
    var gestionadas = rend.total || a.gestionadas || 0;
    // Ritmo esperado ajustado por tiempo REALMENTE activo (no por horas de turno transcurridas),
    // para no penalizar a quien estuvo en incapacidad, capacitación, etc.
    var esperado = histDia > 0 ? Math.round(histDia * (minutosProductivos / 60) / 9) : 0;
    var pctCumplimiento = esperado > 0 ? Math.round((gestionadas / esperado) * 100) : null;

    var semaforo = "gris";
    if (esperado > 0) {
      if (gestionadas >= esperado * 0.8) semaforo = "verde";
      else if (gestionadas >= esperado * 0.5) semaforo = "amarillo";
      else semaforo = "rojo";
    }

    var horaPrimeraConexion = estadosInfo.horaPrimeraConexion || null;
    var minutosConexion = horaPrimeraConexion ? _horaMinToMinutos(horaPrimeraConexion, null) : null;
    var conectadoAntesDeHorario = minutosConexion !== null && minutosConexion < minutosInicioHoy;

    return {
      nombre: a.nombre,
      correo: a.correo,
      equipo: a.especialidad || "Sin Equipo",
      gestionadas: gestionadas,
      aprobadas: rend.aprobadas || 0,
      negadas: rend.negadas || 0,
      aplazadas: rend.aplazadas || 0,
      tiempoGestionProm: rend.tiempoPromedio || 0,
      detalleHoras: rend.detalleHoras || {},
      estadoActual: estadosInfo.estadoActual || "ACTIVO",
      minutosProductivos: Math.round(minutosProductivos),
      minutosNoProductivos: Math.round(minutosNoProductivos),
      desglosePausas: desglosePausas,
      pausaExcedida: minutosNoProductivos > umbralPausaMin,
      esperado: esperado,
      pctCumplimiento: pctCumplimiento,
      semaforo: semaforo,
      horaPrimeraConexion: horaPrimeraConexion,
      conectadoAntesDeHorario: conectadoAntesDeHorario
    };
  });

  // Media de producción por equipo — mismo campo "Equipo" de la hoja Usuarios.
  var porEquipo = {};
  analistas.forEach(function(a) {
    if (!porEquipo[a.equipo]) porEquipo[a.equipo] = { equipo: a.equipo, analistas: 0, totalGestionado: 0 };
    porEquipo[a.equipo].analistas++;
    porEquipo[a.equipo].totalGestionado += a.gestionadas;
  });
  var equipos = Object.keys(porEquipo).map(function(k) {
    var e = porEquipo[k];
    e.media = e.analistas > 0 ? Math.round((e.totalGestionado / e.analistas) * 10) / 10 : 0;
    return e;
  }).sort(function(a, b) { return b.media - a.media; });

  return {
    fecha: Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy"),
    hora: Utilities.formatDate(new Date(), TIMEZONE, "HH:mm"),
    umbralPausaMin: umbralPausaMin,
    analistas: analistas,
    equipos: equipos
  };
}

function agente_enviarChequeoConexion() {
  var config = agente_obtenerConfig();
  var emails = _obtenerDestinatarios(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");

  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hora = Utilities.formatDate(ahora, TIMEZONE, "HH:mm");

  var seguimiento;
  try {
    seguimiento = admin_obtenerAsesoresActivosPrimerResultado();
  } catch (e) {
    Logger.log("Error obteniendo seguimiento para chequeo de conexión: " + e.message);
    return { sent: false, reason: e.message };
  }

  var todos = seguimiento.datos || [];
  if (todos.length === 0) return { sent: false, reason: "sin analistas registrados en Usuarios" };

  var primeraAsignacion = {};
  try {
    primeraAsignacion = _agente_obtenerPrimeraAsignacionHoy();
  } catch (e) {
    Logger.log("Aviso: No se pudo calcular primera asignación para chequeo de conexión: " + e.message);
  }

  var listaActivos = [];
  var porEstado = {};
  todos.forEach(function(a) {
    if (String(a.estado || "").toUpperCase() === "ACTIVO") {
      listaActivos.push({
        nombre: a.nombre,
        correo: a.correo,
        primeraAsignacion: primeraAsignacion[a.correo] || null,
        primerResultado: a.primerResultado || null,
        gestionadas: a.gestionadas || 0
      });
    } else {
      var estado = a.estado || "SIN ESTADO";
      if (!porEstado[estado]) porEstado[estado] = [];
      porEstado[estado].push(a.nombre);
    }
  });

  var totalNoActivos = Object.keys(porEstado).reduce(function(acc, k) { return acc + porEstado[k].length; }, 0);
  var html = _construirEmailChequeoConexion(listaActivos, porEstado, fecha, hora, config.notificaciones.chequeoConexionOffsetMin);

  try {
    MailApp.sendEmail({
      to: email,
      bcc: BCC_REPORTES_AGENTE,
      subject: "Chequeo de Conexión | " + listaActivos.length + " activos, " + totalNoActivos + " no activos | " + fecha + " " + hora,
      htmlBody: html,
      name: NOMBRE_REMITENTE_AGENTE,
      noReply: true
    });
    return { sent: true, to: email, activos: listaActivos.length, noActivos: totalNoActivos };
  } catch (e) {
    Logger.log("Error enviando chequeo de conexión: " + e.message);
    return { sent: false, reason: e.message };
  }
}

function agente_enviarChequeoConexionManual() {
  return agente_enviarChequeoConexion();
}

// Tira de 16 casillas (6:00 a 21:00) con la cantidad de solicitudes cerradas en cada hora. Misma
// escala de color que el modal "Detalle" de Rendimiento Individual en el tablero, para que un
// coordinador que ya conoce esa vista lea el correo igual de rápido.
function _renderSparklineHoras(detalleHoras) {
  var html = '<table role="presentation" cellpadding="0" cellspacing="2"><tr>';
  for (var h = 6; h <= 21; h++) {
    var c = (detalleHoras && detalleHoras[h]) || 0;
    var bg = c === 0 ? "#f4f5f8" : c <= 2 ? "#e8edf6" : c <= 5 ? "#253150" : "#BD0F14";
    var tc = c <= 2 ? "#253150" : "#fff";
    html += '<td style="background:' + bg + ';color:' + tc + ';border-radius:4px;padding:4px 2px;text-align:center;width:30px;">';
    html += '<div style="font-size:8px;opacity:0.75;">' + h + '</div><div style="font-size:11px;font-weight:800;">' + c + '</div>';
    html += '</td>';
  }
  html += '</tr></table>';
  return html;
}

// Sección "Corte de Gestión" (detalle por analista) embebida dentro del email de Foto del
// Momento — devuelve solo las filas de tabla (sin doctype/header/footer propios), para
// insertarse en el mismo documento que _construirEmailResumenDiario.
function _htmlSeccionCorteGestion(datos) {
  var analistas = datos.analistas || [];
  var rojos = analistas.filter(function(a) { return a.semaforo === "rojo"; });
  var amarillos = analistas.filter(function(a) { return a.semaforo === "amarillo"; });
  var verdes = analistas.filter(function(a) { return a.semaforo === "verde"; });
  var grises = analistas.filter(function(a) { return a.semaforo === "gris"; });
  var atencion = rojos.concat(amarillos).sort(function(a, b) {
    if (a.semaforo !== b.semaforo) return a.semaforo === "rojo" ? -1 : 1;
    return a.gestionadas - b.gestionadas;
  });
  var totalGestionado = analistas.reduce(function(s, a) { return s + a.gestionadas; }, 0);

  var html = '';

  // Resumen
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128101; Corte de Gestión — Detalle por Analista</h2>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [
    { l: "Requieren Atención", v: atencion.length, c: "#BD0F14", bg: "#fde8e8" },
    { l: "En Buen Ritmo", v: verdes.length, c: "#166534", bg: "#d1fae5" },
    { l: "Sin Histórico Suf.", v: grises.length, c: "#706F6F", bg: "#f8fafc" },
    { l: "Total Gestionado", v: totalGestionado, c: "#253150", bg: "#e8edf6" }
  ].forEach(function(ri) {
    html += '<td width="25%" style="text-align:center;padding:14px 6px;background:' + ri.bg + ';border-radius:10px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ri.l + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  // Media de producción por equipo
  var equipos = datos.equipos || [];
  if (equipos.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128202; Media de Producción por Equipo</h2>';
    var anchoEquipo = Math.floor(100 / equipos.length) + '%';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    equipos.forEach(function(e) {
      html += '<td width="' + anchoEquipo + '" style="text-align:center;padding:12px 8px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + _escHtml(e.equipo) + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:#253150;">' + e.media + '</div>';
      html += '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + e.totalGestionado + ' entre ' + e.analistas + ' analista(s)</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    html += '</td></tr>';
  }

  // Requieren atención — detalle completo por analista
  if (atencion.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px 8px;">';
    html += '<h2 style="margin:0 0 6px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128308; Requieren Atención (' + atencion.length + ')</h2>';
    html += '<p style="margin:8px 0 12px;font-size:12px;color:#706F6F;">Gestionadas hoy por debajo de lo esperado, ajustado por su tiempo realmente activo (no por horas de turno).</p>';
    html += '</td></tr>';
    atencion.forEach(function(a) {
      var esRojo = a.semaforo === "rojo";
      var col = esRojo ? "#BD0F14" : "#a16207";
      var bg = esRojo ? "#fde8e8" : "#fffbeb";
      html += '<tr><td style="background:#fff;padding:0 32px 16px;">';
      html += '<div style="border-left:5px solid ' + col + ';border-radius:0 10px 10px 0;background:' + bg + ';padding:16px 20px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="font-weight:800;font-size:15px;color:#253150;">' + _escHtml(a.nombre) + '</td>';
      html += '<td align="right"><span style="font-size:12px;font-weight:800;color:' + col + ';background:#fff;padding:4px 10px;border-radius:8px;">' + (esRojo ? "Atrás del ritmo" : "Por debajo del ritmo") + '</span></td>';
      html += '</tr></table>';

      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin-top:12px;"><tr>';
      [
        { l: "Gestionadas", v: a.gestionadas },
        { l: "Esperadas", v: a.esperado || "—", sub: a.pctCumplimiento !== null ? a.pctCumplimiento + "% cumpl." : null },
        { l: "Aprob/Neg/Aplaz", v: a.aprobadas + "/" + a.negadas + "/" + a.aplazadas },
        { l: "T. Gestión", v: _fmtMinEmail(a.tiempoGestionProm) }
      ].forEach(function(m) {
        html += '<td width="25%" style="text-align:center;padding:8px 4px;background:#fff;border-radius:8px;">';
        html += '<div style="font-size:10px;font-weight:700;color:#706F6F;">' + m.l + '</div>';
        html += '<div style="font-size:15px;font-weight:800;color:#253150;">' + m.v + '</div>';
        if (m.sub) html += '<div style="font-size:10px;font-weight:700;color:' + col + ';margin-top:2px;">' + m.sub + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';

      if (a.conectadoAntesDeHorario) {
        html += '<div style="margin-top:10px;font-size:12px;font-weight:700;color:#166534;background:#d1fae5;display:inline-block;padding:4px 10px;border-radius:8px;">&#127749; Conectó antes de horario (' + _escHtml(a.horaPrimeraConexion) + ')</div>';
      }

      html += '<div style="margin-top:10px;font-size:12px;color:#4a4a4a;">';
      html += '<strong style="color:#253150;">Estado actual:</strong> ' + _escHtml(a.estadoActual) + ' &nbsp;·&nbsp; ';
      html += '<strong style="color:#253150;">Tiempo activo:</strong> ' + _fmtMinEmail(a.minutosProductivos) + ' &nbsp;·&nbsp; ';
      html += '<strong style="color:' + (a.pausaExcedida ? "#BD0F14" : "#253150") + ';">Tiempo en pausas:</strong> <span style="color:' + (a.pausaExcedida ? "#BD0F14" : "#4a4a4a") + ';font-weight:' + (a.pausaExcedida ? "800" : "400") + ';">' + _fmtMinEmail(a.minutosNoProductivos) + (a.pausaExcedida ? " ⚠" : "") + '</span>';
      var pausaKeys = Object.keys(a.desglosePausas || {});
      if (pausaKeys.length > 0) {
        html += '<div style="margin-top:4px;color:#706F6F;">' + pausaKeys.map(function(k) { return _escHtml(k) + ": " + _fmtMinEmail(a.desglosePausas[k]); }).join(" · ") + '</div>';
      }
      html += '</div>';

      html += '<div style="margin-top:12px;">' + _renderSparklineHoras(a.detalleHoras) + '</div>';
      html += '</div></td></tr>';
    });
  }

  // En buen ritmo — tabla compacta
  if (verdes.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px 8px;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#166534;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#9989; En Buen Ritmo (' + verdes.length + ')</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    verdes.sort(function(a, b) { return b.gestionadas - a.gestionadas; }).forEach(function(a, idx) {
      html += '<tr><td style="padding:8px 12px;background:' + (idx % 2 === 0 ? "#f0fdf4" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="font-size:13px;font-weight:700;color:#253150;">' + (a.conectadoAntesDeHorario ? "&#127749; " : "") + _escHtml(a.nombre) + '</td>';
      html += '<td width="110" align="center" style="font-size:12px;color:#166534;font-weight:700;">' + a.gestionadas + '/' + a.esperado + ' (' + a.pctCumplimiento + '%)</td>';
      html += '<td width="130" align="right" style="font-size:12px;color:#706F6F;">' + _escHtml(a.estadoActual) + '</td>';
      html += '</tr></table></td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // Sin histórico suficiente — tabla compacta
  if (grises.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px 24px;">';
    html += '<h2 style="margin:0 0 6px;font-size:16px;font-weight:800;color:#706F6F;border-bottom:2px solid #f0f2f5;padding-bottom:10px;">&#8505; Sin Histórico Suficiente (' + grises.length + ')</h2>';
    html += '<p style="margin:8px 0 12px;font-size:12px;color:#706F6F;">Menos de 30 días de historial para calcular un ritmo esperado — se muestran solo sus gestionadas de hoy.</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    grises.sort(function(a, b) { return b.gestionadas - a.gestionadas; }).forEach(function(a, idx) {
      html += '<tr><td style="padding:8px 12px;background:' + (idx % 2 === 0 ? "#f8fafc" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="font-size:13px;font-weight:700;color:#253150;">' + (a.conectadoAntesDeHorario ? "&#127749; " : "") + _escHtml(a.nombre) + '</td>';
      html += '<td width="90" align="center" style="font-size:12px;color:#706F6F;">' + a.gestionadas + ' hoy</td>';
      html += '<td width="130" align="right" style="font-size:12px;color:#706F6F;">' + _escHtml(a.estadoActual) + '</td>';
      html += '</tr></table></td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  return html;
}

// --- TRIGGERS ---

var AGENT_TRIGGER_FNS = ["agente_triggerOperacion"];

function agente_instalarTriggers() {
  agente_desinstalarTriggers();

  ScriptApp.newTrigger("agente_triggerOperacion")
    .timeBased()
    .everyMinutes(30)
    .create();

  return { success: true, message: "Trigger instalado: Inicio de Operación, Chequeo de Conexión, alertas críticas, Foto del Momento (incluye detalle por analista) y Resumen Diario, todo según tu Horario de Reporte de Operación y las frecuencias que configures para cada correo" };
}

function agente_desinstalarTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (AGENT_TRIGGER_FNS.indexOf(fn) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  return { success: true };
}

function agente_obtenerEstadoTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var agentTriggers = [];
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (AGENT_TRIGGER_FNS.indexOf(fn) !== -1) {
      agentTriggers.push({ functionName: fn, type: String(t.getEventType()), id: t.getUniqueId() });
    }
  });
  return { installed: agentTriggers.length > 0, triggers: agentTriggers, count: agentTriggers.length };
}

// Único trigger real de Apps Script: late cada 30 min y decide, leyendo "Horario de Reporte de
// Operación" (activo/horaInicio/horaFin por día) y las frecuencias propias de cada correo en
// config.notificaciones, si le toca:
//   0) enviar "Inicio de Operación" (una sola vez, justo al llegar a horaInicio),
//   0b) enviar "Chequeo de Conexión" (una sola vez, chequeoConexionOffsetMin después de horaInicio),
//   1) revisar alertas críticas (dentro de la ventana, cada alertasCriticasFrecuenciaHoras),
//   2) enviar "Foto del Momento" (dentro de la ventana, cada fotoMomentoFrecuenciaHoras —
//      incluye salud/KPIs agregados y el detalle por analista, antes separado como "Corte de
//      Gestión"),
//   3) enviar el Resumen Diario + Reporte de Biometría (una sola vez, justo al llegar a la
//      hora de cierre configurada para ese día — horaFin).
// Cada correo tiene su propio interruptor Y su propia frecuencia — no se mueven juntos. Todas
// comparten la MISMA config, así que cambiar el horario aquí las mueve a todas, sin reinstalar
// triggers.
// Convierte "HH:mm" (o, por compatibilidad, una hora entera vieja) a minutos desde medianoche.
function _horaMinToMinutos(valor, defaultMin) {
  if (typeof valor === "number") return valor * 60;
  if (typeof valor === "string" && valor.indexOf(":") !== -1) {
    var partes = valor.split(":");
    var h = parseInt(partes[0], 10);
    var m = parseInt(partes[1], 10);
    if (!isNaN(h)) return h * 60 + (isNaN(m) ? 0 : m);
  }
  return defaultMin;
}

// ¿Le toca a este correo en el bucket de 30 min actual, dada su propia frecuencia en horas?
// Se ancla a bucketInicio (horaInicio del día) para que la frecuencia siempre arranque a contar
// desde el inicio de la ventana, sin importar a qué hora se instaló el trigger.
function _agente_tocaPorFrecuencia(bucketAhora, bucketInicio, frecuenciaHoras) {
  var bucketsPorCiclo = Math.max(1, Math.round((frecuenciaHoras || 1) * 2));
  var bucketsDesdeInicio = (bucketAhora - bucketInicio) / 30;
  return bucketsDesdeInicio >= 0 && (bucketsDesdeInicio % bucketsPorCiclo) === 0;
}

// Motivos que NO son una falla real — son el resultado esperado de la lógica del correo (ej.
// "no había alertas críticas en este momento") y no deben generar un aviso.
var AGENT_RAZONES_NO_ALERTAR = ["sin alertas criticas", "desactivado", "sin datos de biometría hoy", "sin analistas con gestiones esta semana"];

// Si un envío automático no logró salir (sin destinatarios, error de MailApp, excepción), avisa
// por correo directo al admin — para no depender de revisar Logger.log o el panel manualmente.
function _agente_notificarSiFallo(nombreCorreo, resultado) {
  if (!resultado || resultado.sent) return;
  if (AGENT_RAZONES_NO_ALERTAR.indexOf(resultado.reason) !== -1) return;
  try {
    MailApp.sendEmail({
      to: BCC_REPORTES_AGENTE,
      subject: "⚠ Agente Coordinador: \"" + nombreCorreo + "\" no se envió",
      htmlBody: '<p style="font-family:Arial,sans-serif;font-size:14px;">El correo automático <b>' + _escHtml(nombreCorreo) + '</b> no se pudo enviar.</p>' +
        '<p style="font-family:Arial,sans-serif;font-size:14px;"><b>Motivo:</b> ' + _escHtml(String(resultado.reason || "desconocido")) + '</p>' +
        '<p style="font-family:Arial,sans-serif;font-size:12px;color:#706F6F;">' + Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy HH:mm") + '</p>',
      name: NOMBRE_REMITENTE_AGENTE,
      noReply: true
    });
  } catch (e) {
    Logger.log("Error enviando aviso de fallo (" + nombreCorreo + "): " + e.message);
  }
}

function agente_triggerOperacion() {
  var config = agente_obtenerConfig();
  var noti = config.notificaciones;
  var hr = config.horarioReporte || DEFAULT_AGENT_CONFIG.horarioReporte;
  if (hr.activo === false) return;

  var ahora = new Date();
  var dia = parseInt(Utilities.formatDate(ahora, TIMEZONE, "u"), 10);
  var diaCfg = (hr.dias || {})[String(dia)];
  if (!diaCfg || diaCfg.activo === false) return;

  var hora = parseInt(Utilities.formatDate(ahora, TIMEZONE, "HH"), 10);
  var minuto = parseInt(Utilities.formatDate(ahora, TIMEZONE, "mm"), 10);

  var minutosInicio = _horaMinToMinutos(diaCfg.horaInicio, 8 * 60);
  var minutosFin = _horaMinToMinutos(diaCfg.horaFin, 17 * 60);
  var minutosAhora = hora * 60 + minuto;
  var dentroDeVentana = minutosAhora >= minutosInicio && minutosAhora < minutosFin;

  // Bucket de 30 min al que pertenece cada momento — el trigger corre una vez por bucket, así
  // que comparar buckets (en vez de igualdad exacta de minuto) tolera el jitter normal de
  // Apps Script y permite horarios con medias horas (ej. "12:30").
  var bucketAhora = Math.floor(minutosAhora / 30) * 30;
  var bucketInicio = Math.floor(minutosInicio / 30) * 30;
  var bucketFin = Math.floor(minutosFin / 30) * 30;

  // 0) Inicio de Operación — una sola vez, en el bucket exacto de horaInicio
  if (bucketAhora === bucketInicio && noti.enviarInicioOperacion) {
    try {
      _agente_notificarSiFallo("Inicio de Operación", agente_enviarInicioOperacion());
    } catch (e) {
      Logger.log("Error en inicio de operación: " + e.message);
      _agente_notificarSiFallo("Inicio de Operación", { sent: false, reason: e.message });
    }
  }

  // 0b) Chequeo de Conexión — en el bucket más cercano a horaInicio + su propio offset
  var bucketChequeo = bucketInicio + Math.max(30, Math.round((noti.chequeoConexionOffsetMin || 30) / 30) * 30);
  if (bucketAhora === bucketChequeo && noti.enviarChequeoConexion) {
    try {
      _agente_notificarSiFallo("Chequeo de Conexión", agente_enviarChequeoConexion());
    } catch (e) {
      Logger.log("Error en chequeo de conexión: " + e.message);
      _agente_notificarSiFallo("Chequeo de Conexión", { sent: false, reason: e.message });
    }
  }

  // 1) Alertas críticas — dentro de la ventana, con su propia frecuencia independiente
  if (dentroDeVentana && noti.enviarAlertasCriticas && _agente_tocaPorFrecuencia(bucketAhora, bucketInicio, noti.alertasCriticasFrecuenciaHoras)) {
    try {
      var diagnostico = agente_ejecutarDiagnostico();
      var criticas = diagnostico.alerts.filter(function(a) { return a.severity === "critico"; });
      if (criticas.length > 0) _agente_notificarSiFallo("Alertas Críticas", agente_enviarAlertasCriticas(diagnostico));
    } catch (e) {
      Logger.log("Error en revisión de alertas críticas: " + e.message);
      _agente_notificarSiFallo("Alertas Críticas", { sent: false, reason: e.message });
    }
  }

  // 2) Foto del Momento — dentro de la ventana, con su propia frecuencia independiente
  if (dentroDeVentana && noti.enviarFotoMomento && _agente_tocaPorFrecuencia(bucketAhora, bucketInicio, noti.fotoMomentoFrecuenciaHoras)) {
    try {
      _agente_notificarSiFallo("Foto del Momento", agente_enviarSnapshotActual());
    } catch (e) {
      Logger.log("Error en Foto del Momento: " + e.message);
      _agente_notificarSiFallo("Foto del Momento", { sent: false, reason: e.message });
    }
  }

  // 3) Resumen Diario + Reporte de Biometría — una sola vez, en el bucket exacto de horaFin
  if (bucketAhora === bucketFin) {
    if (config.notificaciones.enviarResumenDiario) {
      try {
        _agente_notificarSiFallo("Resumen Diario", agente_enviarResumenDiario());
      } catch (e) {
        Logger.log("Error en resumen diario: " + e.message);
        _agente_notificarSiFallo("Resumen Diario", { sent: false, reason: e.message });
      }
    }
    if (config.notificaciones.enviarResumenBiometria) {
      try {
        _agente_notificarSiFallo("Reporte de Biometría", agente_enviarReporteBiometria());
      } catch (e) {
        Logger.log("Error en reporte de biometría: " + e.message);
        _agente_notificarSiFallo("Reporte de Biometría", { sent: false, reason: e.message });
      }
    }

    // 4) Informe Individual Semanal — una sola vez, el día ISO configurado (viernes por defecto),
    // en el mismo bucket de horaFin que el Resumen Diario.
    if (config.notificaciones.enviarInformeIndividual && dia === (config.notificaciones.informeIndividualDiaISO || 5)) {
      try {
        _agente_notificarSiFallo("Informe Individual Semanal", agente_enviarInformeIndividualAnalistas());
      } catch (e) {
        Logger.log("Error en informe individual semanal: " + e.message);
        _agente_notificarSiFallo("Informe Individual Semanal", { sent: false, reason: e.message });
      }
    }
  }
}

// --- FUNCIÓN PRINCIPAL PARA FRONTEND ---

function agente_obtenerDatosDashboard() {
  var cache = CacheService.getScriptCache();
  var diagnostico = null;

  try {
    var cached = cache.get(AGENT_DIAG_CACHE_KEY);
    if (cached) diagnostico = JSON.parse(cached);
  } catch (e) {}

  if (!diagnostico) {
    diagnostico = agente_ejecutarDiagnostico();
  }

  var config = agente_obtenerConfig();
  var history = agente_obtenerHistorialAlertas();
  var triggerStatus = { installed: false, triggers: [], count: 0 };
  try {
    triggerStatus = agente_obtenerEstadoTriggers();
  } catch (e) {
    Logger.log("Agente: No se pudo consultar triggers: " + e.message);
  }

  return {
    healthScore: diagnostico.healthScore,
    alerts: diagnostico.alerts,
    dataQuality: diagnostico.dataQuality,
    kpis: diagnostico.kpis,
    rankAnalistas: diagnostico.rankAnalistas,
    seguimientoPersonas: diagnostico.seguimientoPersonas,
    historicos: diagnostico.historicos,
    alertHistory: history,
    config: config,
    triggers: triggerStatus,
    timestamp: diagnostico.timestamp
  };
}

function agente_autorizarPermisos() {
  MailApp.getRemainingDailyQuota();
  ScriptApp.getProjectTriggers();
  return "Permisos autorizados correctamente";
}

function agente_ejecutarManual() {
  CacheService.getScriptCache().remove(AGENT_DIAG_CACHE_KEY);
  return agente_ejecutarDiagnostico();
}
