/**
 * CONSTANTES DE CONEXIÓN DE BASE DE DATOS
 */
const TARGET_SOLICITUDES_SS_ID = "1x9groW5-I7Xg5ULh7DXfa2XGmS_RMdfqfW1iDWB8bJ0";
const SHEET_NAME_SOLICITUDES = "Historico_Gestiones";
const ID_HOJA_REESTUDIOS = "1slgykTgjoAtCd6KmlG7Lqiuw-nM1hSguQbi0XqeLu7U";
const NOMBRE_PESTANA_REESTUDIOS = "ORIGEN";
const TIMEZONE = "America/Bogota";
const HORA_INICIO_OPERACION = "08:00";
const HORA_FIN_TURNO = "17:00";

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

/**
 * Carga la hoja "score" como diccionario en memoria.
 * Mapea Poliza -> { inmobiliaria, segmento }
 */
function cargarDiccionarioScore() {
  var scoreMap = {};
  try {
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hojaScore = ss.getSheetByName("score");
    if (hojaScore) {
      var data = hojaScore.getDataRange().getDisplayValues();
      // Buscar columnas por encabezado
      var headers = data[0].map(function(h) { return h.trim().toLowerCase(); });
      var idxPoliza = headers.indexOf("poliza");
      var idxInmobiliaria = headers.indexOf("inmobiliaria");
      var idxSegmento = headers.indexOf("segmentación final");
      // Fallbacks por nombre alternativo
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
    const fechaGestionStr = String(fila[33] || "").trim();
    if (!fechaGestionStr) continue;

    const fechaGestion = parseFechaDDMMYYYY(fechaGestionStr);
    if (!fechaGestion || fechaGestion < desde || fechaGestion > hasta) continue;

    totalGestionadas++;
    const estado = String(fila[16] || "").toUpperCase().trim();
    const nombre = String(fila[30] || "Sin nombre").trim();
    const tiempoGestionRaw = String(fila[34] || "").trim();
    const tiempoResolucionRaw = String(fila[29] || "").trim();

    if (estado.includes("APROB")) aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) negadas++;
    else if (estado.includes("APLAZ")) aplazadas++;

    const clase = String(fila[20] || "").toUpperCase().trim();
    let tipoSol = 'Digital';
    if (estado.includes('BIOMETRIA')) tipoSol = 'Biometría';
    else if (clase === 'INDUCCION') tipoSol = 'Inducción';

    if (!tipoMap[fechaGestionStr]) tipoMap[fechaGestionStr] = { Digital: 0, UAR: 0, Reestudio: 0, 'Biometría': 0, 'Inducción': 0 };
    tipoMap[fechaGestionStr][tipoSol]++;

    const tiempoGestion = parseFloat(tiempoGestionRaw);
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) {
      sumaTiempos += tiempoGestion;
      countTiempos++;
    }
    const tiempoResolucion = parseFloat(tiempoResolucionRaw.replace(',', '.'));
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) {
      sumaTiemposResolucion += tiempoResolucion;
      countTiemposResolucion++;
    }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) fueraDeSLA++;

    // Cálculo de Tiempo de Cola: fechaAsignacion - fechaRadicacion (en minutos)
    var fechaRadicStr = String(fila[37] || "").trim();
    var fechaAsigStr = String(fila[26] || "").trim();
    var dtRadicacion = parseDatetimeStr(fechaRadicStr);
    var dtAsignacion = parseDatetimeStr(fechaAsigStr);
    var tiempoColaMin = null;
    if (dtRadicacion && dtAsignacion && dtAsignacion >= dtRadicacion) {
      tiempoColaMin = (dtAsignacion - dtRadicacion) / 60000;
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

    const fechaFinCompleta = String(fila[28] || "").trim();
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

    if (estado.includes("APROB")) a.aprobadas++;
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
    var estadoLabel = estado.includes("APROB") ? "APROBADA" : (estado.includes("NEGAD") || estado.includes("RECHAZ")) ? "NEGADA" : estado.includes("APLAZ") ? "APLAZADA" : "OTRO";
    tiemposDetalle.push({ solicitud: solicitudId, poliza: polizaVal, fecha: fechaGestionStr, sucursal: sucursal, tipo: tipoSol, analista: nombre, segmento: seg, inmobiliaria: inmob, estado: estadoLabel, tGestion: !isNaN(tiempoGestion) && tiempoGestion >= 0 ? tiempoGestion : null, tResolucion: !isNaN(tiempoResolucion) && tiempoResolucion > 0 ? tiempoResolucion : null, tCola: tiempoColaMin });
  }

  // 2. Procesar Reestudios
  if (tieneReestudios) {
    try {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 17).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const fechaFinStr = String(dataReest[i][9]).trim();
          if (!fechaFinStr) continue;

          const fechaParte = fechaFinStr.split(' ')[0];
          const fechaGestion = parseFechaDDMMYYYY(fechaParte);
          if (!fechaGestion || fechaGestion < desde || fechaGestion > hasta) continue;

          totalGestionadas++;
          const estadoR = String(dataReest[i][10]).toUpperCase().trim();
          const nombreR = String(dataReest[i][7] || "Sin nombre").trim();
          const tiempoResolucionReestRaw = String(dataReest[i][14] || "").trim();
          const tiempoGestionReestRaw = String(dataReest[i][15] || "").trim();

          if (estadoR.includes("APROB")) aprobadas++;
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

          // Tiempo de Cola para reestudios: fechaAsignacion (col 8) - fechaRadicacion (col 0)
          var fechaRadicReestStr = String(dataReest[i][0] || "").trim();
          var fechaAsigReestStr = String(dataReest[i][8] || "").trim();
          var dtRadicReest = parseDatetimeStr(fechaRadicReestStr);
          var dtAsigReest = parseDatetimeStr(fechaAsigReestStr);
          var tiempoColaReest = null;
          if (dtRadicReest && dtAsigReest && dtAsigReest >= dtRadicReest) {
            tiempoColaReest = (dtAsigReest - dtRadicReest) / 60000;
            sumaTiempoCola += tiempoColaReest;
            countTiempoCola++;
          }

          // Segmentación por Inmobiliaria para reestudios (usando poliza col 16 si existe, o col 2)
          var polizaReest = String(dataReest[i][16] || dataReest[i][2] || "").trim();
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
          if (estadoR.includes("APROB")) aR.aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) aR.negadas++;
          else if (estadoR.includes("APLAZ")) aR.aplazadas++;
          if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) { aR.sumaTiempo += tiempoGestionReest; aR.countTiempo++; }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) { aR.sumaTiempoResolucion += tiempoResolucionReestHoras; aR.countTiempoResolucion++; }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) aR.fueraSLA++;

          const sucursalR = obtenerSucursalPorPoliza(dataReest[i][16]);
          if (!sucursalMap[fechaParte]) sucursalMap[fechaParte] = {};
          sucursalMap[fechaParte][sucursalR] = (sucursalMap[fechaParte][sucursalR] || 0) + 1;

          if (!negacionSucursal[sucursalR]) negacionSucursal[sucursalR] = { total: 0, negadas: 0 };
          negacionSucursal[sucursalR].total++;
          if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) negacionSucursal[sucursalR].negadas++;

          const solicitudIdR = String(dataReest[i][1] || "").trim();
          var estadoLabelR = estadoR.includes("APROB") ? "APROBADA" : (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) ? "NEGADA" : estadoR.includes("APLAZ") ? "APLAZADA" : "OTRO";
          tiemposDetalle.push({ solicitud: solicitudIdR, poliza: polizaReest, fecha: fechaParte, sucursal: sucursalR, tipo: tipoReest, analista: nombreR, segmento: segR, inmobiliaria: inmobR, estado: estadoLabelR, tGestion: !isNaN(tiempoGestionReest) && tiempoGestionReest >= 0 ? tiempoGestionReest : null, tResolucion: !isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0 ? tiempoResolucionReestHoras : null, tCola: tiempoColaReest });
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

  // 3. Backlog con Semáforo de SLA
  let backlog = 0;
  const backlogDetalle = [];
  const ahora = new Date();
  const hojaSolicitud = ss.getSheetByName("solicitud");
  if (hojaSolicitud) {
    const dataSolicitud = hojaSolicitud.getDataRange().getDisplayValues();
    for (let i = 1; i < dataSolicitud.length; i++) {
      const fechaAsig = String(dataSolicitud[i][26] || "").trim();
      const fechaFin = String(dataSolicitud[i][28] || "").trim();
      if (fechaAsig !== "" && fechaFin === "") {
        backlog++;
        var dtAsigBack = parseDatetimeStr(fechaAsig);
        var minutosEspera = 0;
        var alertaSLA = "verde";
        if (dtAsigBack) {
          minutosEspera = Math.round((ahora - dtAsigBack) / 60000);
          if (minutosEspera < 0) minutosEspera = 0;
          if (minutosEspera > 90) alertaSLA = "rojo";
          else if (minutosEspera >= 45) alertaSLA = "amarillo";
          else alertaSLA = "verde";
        }
        // Obtener segmento para backlog
        var polizaBack = String(dataSolicitud[i][1] || "").trim();
        var infoSegBack = obtenerSegmentoInmobiliaria(polizaBack, scoreMap);
        backlogDetalle.push({
          solicitud: String(dataSolicitud[i][0] || "").trim(),
          fechaAsignacion: fechaAsig,
          analista: String(dataSolicitud[i][30] || "Sin nombre").trim(),
          minutosEspera: minutosEspera,
          alertaSLA: alertaSLA,
          inmobiliaria: infoSegBack.inmobiliaria,
          segmento: infoSegBack.segmento
        });
      }
    }
  }

  // Backlog reestudios
  if (tieneReestudios) {
    try {
      const lastRowB = hojaReest.getLastRow();
      if (lastRowB > 1) {
        const dataB = hojaReest.getRange(2, 1, lastRowB - 1, 17).getDisplayValues();
        for (let i = 0; i < dataB.length; i++) {
          const fAsig = String(dataB[i][8] || dataB[i][7]).trim();
          const fFin = String(dataB[i][9] || "").trim();
          if (fAsig !== "" && fFin === "") {
            backlog++;
            var dtAsigBackR = parseDatetimeStr(fAsig);
            var minutosEsperaR = 0;
            var alertaSLAR = "verde";
            if (dtAsigBackR) {
              minutosEsperaR = Math.round((ahora - dtAsigBackR) / 60000);
              if (minutosEsperaR < 0) minutosEsperaR = 0;
              if (minutosEsperaR > 90) alertaSLAR = "rojo";
              else if (minutosEsperaR >= 45) alertaSLAR = "amarillo";
              else alertaSLAR = "verde";
            }
            var polizaBackR = String(dataB[i][16] || dataB[i][2] || "").trim();
            var infoSegBackR = obtenerSegmentoInmobiliaria(polizaBackR, scoreMap);
            backlogDetalle.push({
              solicitud: String(dataB[i][1] || "").trim(),
              fechaAsignacion: fAsig,
              analista: String(dataB[i][7] || "Sin nombre").trim(),
              minutosEspera: minutosEsperaR,
              alertaSLA: alertaSLAR,
              inmobiliaria: infoSegBackR.inmobiliaria,
              segmento: infoSegBackR.segmento
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
  for (let h = 7; h <= 18; h++) heatmapHora[h] = 0;
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
          for (let h = 7; h <= 18; h++) {
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
    heatmapHora: heatmapHora
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
    const fechaGestionStr = String(data[i][33] || "").trim();
    if (!fechaGestionStr || fechaGestionStr !== fechaStr) continue;

    const estado = String(data[i][16] || "").toUpperCase().trim();
    const nombre = String(data[i][30] || "Sin nombre").trim();
    const tiempoGestionRaw = String(data[i][34] || "").trim();
    const tiempoResolucionRaw = String(data[i][29] || "").trim();
    const fechaFinCompleta = String(data[i][28] || "").trim();
    const horaFin = fechaFinCompleta.split(' ')[1] || "";

    if (!analistaMap[nombre]) {
      analistaMap[nombre] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, primera: "", ultima: "", count: 0, horasSlot: {} };
    }
    const a = analistaMap[nombre];
    a.total++;
    a.count++;

    if (estado.includes("APROB")) a.aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) a.negadas++;
    else if (estado.includes("APLAZ")) a.aplazadas++;

    const tiempoGestion = parseFloat(tiempoGestionRaw);
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) { a.sumaTiempo += tiempoGestion; a.countTiempo++; }

    const tiempoResolucion = parseFloat(tiempoResolucionRaw.replace(',', '.'));
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
          const tiempoResolucionReestRaw = String(dataReest[i][14] || "").trim();
          const tiempoGestionReestRaw = String(dataReest[i][15] || "").trim();
          const horaFinR = fechaFinStr.split(' ')[1] || "";

          if (!analistaMap[nombreR]) {
            analistaMap[nombreR] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, primera: "", ultima: "", count: 0, horasSlot: {} };
          }
          const aR = analistaMap[nombreR];
          aR.total++;
          aR.count++;

          if (estadoR.includes("APROB")) aR.aprobadas++;
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

  return Object.keys(analistaMap).map(nombre => {
    const a = analistaMap[nombre];
    let ritmoEfec = 0;
    if (a.count > 1 && a.primera && a.ultima) {
      const pParts = a.primera.split(':');
      const uParts = a.ultima.split(':');
      const pMin = parseInt(pParts[0], 10) * 60 + parseInt(pParts[1], 10);
      const uMin = parseInt(uParts[0], 10) * 60 + parseInt(uParts[1], 10);
      const diffHoras = (uMin - pMin) / 60;
      ritmoEfec = diffHoras > 0 ? Math.round(a.count / diffHoras) : a.count;
    } else {
      ritmoEfec = a.count;
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
    let horasTranscurridas = (corteMin - inicioMin) / 60;
    if (horasTranscurridas <= 0) horasTranscurridas = 1;
    const prodReal = Math.round(a.total / horasTranscurridas);

    return {
      nombre: nombre,
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
        for (let h = 7; h <= 18; h++) {
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
    const asignado = String(dataSol[i][27] || "").toLowerCase().trim();
    const fechaFinRaw = String(dataSol[i][28] || "").trim();
    const tiempoGestionVal = String(dataSol[i][34] || "").trim();
    const tiempoGeneralVal = String(dataSol[i][36] || "").trim();
    if (!asignado) continue;
    if (fechaFinRaw && coincideFecha(fechaFinRaw, fechaStr)) {
      gestionadasMap[asignado] = (gestionadasMap[asignado] || 0) + 1;
      const tg = parseFloat(tiempoGestionVal);
      if (!isNaN(tg) && tg > 0) {
        if (!tiemposGestionMap[asignado]) tiemposGestionMap[asignado] = [];
        tiemposGestionMap[asignado].push(tg);
      }
      const tGen = parseFloat(tiempoGeneralVal);
      if (!isNaN(tGen) && tGen > 0) {
        if (!tiemposGeneralMap[asignado]) tiemposGeneralMap[asignado] = [];
        tiemposGeneralMap[asignado].push(tGen);
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
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 16).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const asignado = String(dataReest[i][6]).trim().toLowerCase();
          const fechaFinRaw = String(dataReest[i][9]).trim();
          const tiempoTotalReest = String(dataReest[i][14] || "").trim();
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
    const asignado = String(dataSol[i][27] || "").toLowerCase().trim();
    if (asignado !== correoAnalista) continue;

    const solicitudId = String(dataSol[i][0] || "").trim();
    const poliza = String(dataSol[i][1] || "");
    const estado = String(dataSol[i][16] || "").toUpperCase();
    const clase = String(dataSol[i][20] || "").toUpperCase();
    const fechaRadicacion = String(dataSol[i][37] || "").trim();
    const fechaAsignacion = String(dataSol[i][26] || "").trim();
    const fechaFin = String(dataSol[i][28] || "").trim();
    const tiempoGestion = String(dataSol[i][34] || "").trim();
    const tiempoSLA = String(dataSol[i][29] || "").trim();
    const tiempoGeneral = String(dataSol[i][36] || "").trim();

    if (!solicitudId) continue;
    let tipo = 'Digital';
    if (estado.includes('BIOMETRIA')) tipo = 'Biometría';
    else if (clase === 'INDUCCION') tipo = 'Inducción';

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
          const tiempoTotalR = String(dataReest[i][14] || "").trim();
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
