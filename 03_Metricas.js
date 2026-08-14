/**
 * 03_Metricas.js — Pipeline compartido de procesamiento de métricas
 *
 * Consolida la lógica duplicada de obtenerDatosMetricas, obtenerRendimientoPorDia
 * y _agente_leerDatosRango en un pipeline único que itera Historico_Gestiones +
 * Reestudios, aplica filtros, clasifica estados y agrega métricas.
 *
 * Dependencias (scope global desde 00_Config.js):
 *   COL_HISTORICO, COL_REESTUDIOS, COL_SOLICITUD, TIMEZONE,
 *   HORA_INICIO_OPERACION, HORA_FIN_TURNO, SAI_CONFIG
 *
 * Dependencias (scope global desde 01_Datos.js):
 *   obtenerHistoricoGestiones, obtenerHojaReestudios, obtenerHojaSolicitud,
 *   cargarDiccionarioScore
 *
 * Dependencias (scope global desde 02_Utilidades.js):
 *   parsearFecha, clasificarEstado, parsearTiempoMinutos, fechaEnRango,
 *   normalizarTipoAsignado, obtenerSucursalPorPoliza, obtenerSegmentoInmobiliaria,
 *   normalizarHora
 */

// ============================================================================
// HELPER — Mapa de columnas por nombre de header
// ============================================================================

/**
 * Dado un arreglo de datos con headers en la primera fila, construye un mapa
 * de nombre de columna a su índice. Usa matching case-insensitive sin espacios.
 *
 * @param {string[][]} datos - Datos con headers en la fila 0
 * @param {string[]} nombres - Lista de nombres de columna a buscar
 * @returns {Object.<string, number>} Mapa {nombre: índice} (-1 si no se encontró)
 */
function _mapaColumnasPorNombre(datos, nombres) {
  var headers = datos[0] || [];
  var norm = function(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); };
  var mapa = {};
  nombres.forEach(function(nombreBuscado) {
    var clave = norm(nombreBuscado);
    mapa[nombreBuscado] = -1;
    for (var i = 0; i < headers.length; i++) {
      if (norm(headers[i]) === clave) { mapa[nombreBuscado] = i; break; }
    }
  });
  return mapa;
}

// ============================================================================
// HELPERS INTERNOS — Motivos de negación/aplazamiento
// ============================================================================

/**
 * Incrementa el conteo de un motivo en el mapa de motivos.
 * @param {Object.<string, number>} mapaMotivos
 * @param {string} motivo
 */
function _tallyMotivo(mapaMotivos, motivo) {
  var m = String(motivo || "").trim();
  if (!m) return;
  mapaMotivos[m] = (mapaMotivos[m] || 0) + 1;
}

/**
 * Retorna el motivo con mayor conteo en un mapa de motivos.
 * @param {Object.<string, number>} mapaMotivos
 * @returns {{motivo: string, count: number}|null}
 */
function _motivoPrincipal(mapaMotivos) {
  var claves = Object.keys(mapaMotivos || {});
  if (claves.length === 0) return null;
  var top = claves[0];
  claves.forEach(function(k) { if (mapaMotivos[k] > mapaMotivos[top]) top = k; });
  return { motivo: top, count: mapaMotivos[top] };
}

/**
 * Determina el motivo principal combinado entre negación y aplazamiento.
 * Empate favorece negación por ser la señal más seria.
 * @param {Object.<string, number>} motivosNegacion
 * @param {Object.<string, number>} motivosAplazamiento
 * @returns {{tipo: string, motivo: string, count: number}|null}
 */
function _motivoPrincipalCombinado(motivosNegacion, motivosAplazamiento) {
  var topNeg = _motivoPrincipal(motivosNegacion);
  var topApl = _motivoPrincipal(motivosAplazamiento);
  if (!topNeg && !topApl) return null;
  if (!topNeg) return { tipo: "aplazamiento", motivo: topApl.motivo, count: topApl.count };
  if (!topApl) return { tipo: "negacion", motivo: topNeg.motivo, count: topNeg.count };
  return topNeg.count >= topApl.count
    ? { tipo: "negacion", motivo: topNeg.motivo, count: topNeg.count }
    : { tipo: "aplazamiento", motivo: topApl.motivo, count: topApl.count };
}

// ============================================================================
// PIPELINE COMPARTIDO — _procesarFilasMetricas
// ============================================================================

/**
 * Pipeline compartido de procesamiento de filas de métricas.
 * Itera Historico_Gestiones + Reestudios, aplica filtros, clasifica y agrega.
 *
 * @param {object} opciones
 * @param {Date} opciones.desde - Fecha inicio del rango
 * @param {Date} opciones.hasta - Fecha fin del rango (se ajusta a 23:59:59)
 * @param {boolean} [opciones.incluirReestudios=true] - Si se procesan reestudios
 * @param {boolean} [opciones.incluirBacklog=false] - Si se agrega backlog
 * @param {function} [opciones.procesarFila] - Callback(fila, fecha, fechaStr, estado, fuente)
 * @returns {object} Resultado agregado con todas las métricas base
 */
function _procesarFilasMetricas(opciones) {
  var desde = opciones.desde;
  var hasta = new Date(opciones.hasta.getTime());
  hasta.setHours(23, 59, 59, 999);

  var incluirReestudios = opciones.incluirReestudios !== false;
  var incluirBacklog = opciones.incluirBacklog === true;

  // Obtener datos desde Capa_de_Datos (memoizados)
  var dataHistorico = obtenerHistoricoGestiones();
  var dataReestudios = incluirReestudios ? obtenerHojaReestudios() : [];
  var scoreMap = cargarDiccionarioScore();

  // Resolver columnas de motivos por nombre de header
  var colsMotivo = _mapaColumnasPorNombre(dataHistorico, ["Motivo de negación", "Motivo de aplazamiento"]);
  var idxMotivoNeg = colsMotivo["Motivo de negación"];
  var idxMotivoApl = colsMotivo["Motivo de aplazamiento"];

  // Acumuladores principales
  var totalGestionadas = 0;
  var aprobadas = 0;
  var negadas = 0;
  var aplazadas = 0;
  var fueraDeSLA = 0;

  // Tiempos
  var sumaTiempos = 0;
  var countTiempos = 0;
  var sumaTiemposResolucion = 0;
  var countTiemposResolucion = 0;
  var sumaTiempoCola = 0;
  var countTiempoCola = 0;

  // Mapas de agregación
  var produccionMap = {};
  var slaMap = {};
  var analistaMap = {};
  var sucursalMap = {};
  var tipoMap = {};
  var segmentoInmobMap = {};
  var negacionSucursal = {};

  // Detalle
  var tiemposDetalle = [];
  var backlogDetalle = [];

  // ---- Procesar Historico_Gestiones ----
  for (var i = 1; i < dataHistorico.length; i++) {
    var fila = dataHistorico[i];
    var fechaFinRaw = String(fila[COL_HISTORICO.FECHA_FIN] || "").trim();

    // Backlog: asignada pero sin fecha_fin
    if (incluirBacklog && String(fila[COL_HISTORICO.FECHA_ASIGNACION] || "").trim() !== "" && fechaFinRaw === "") {
      var ahora = new Date();
      var dtAsigBack = parsearFecha(String(fila[COL_HISTORICO.FECHA_ASIGNACION] || "").trim());
      var minutosEspera = 0;
      var alertaSLA = "verde";
      if (dtAsigBack) {
        minutosEspera = Math.round((ahora - dtAsigBack) / 60000);
        if (minutosEspera < 0) minutosEspera = 0;
        if (minutosEspera > 30) alertaSLA = "rojo";
        else if (minutosEspera >= 15) alertaSLA = "amarillo";
      }
      var polizaBack = String(fila[COL_HISTORICO.POLIZA] || "").trim();
      var infoSegBack = obtenerSegmentoInmobiliaria(polizaBack, scoreMap);
      var tipoBack = normalizarTipoAsignado(fila[COL_HISTORICO.TIPO_ASIGNADO]) || 'Digital';
      backlogDetalle.push({
        solicitud: String(fila[COL_HISTORICO.SOLICITUD] || "").trim(),
        fechaAsignacion: String(fila[COL_HISTORICO.FECHA_ASIGNACION] || "").trim(),
        analista: String(fila[COL_HISTORICO.NOMBRE_ANALISTA] || "Sin nombre").trim(),
        minutosEspera: minutosEspera,
        alertaSLA: alertaSLA,
        inmobiliaria: infoSegBack.inmobiliaria,
        segmento: infoSegBack.segmento,
        tipo: tipoBack,
        origen: 'Digital/Inducción'
      });
      continue;
    }

    if (!fechaFinRaw) continue;

    var fechaGestionStr = fechaFinRaw.split(' ')[0];
    var fechaGestion = parsearFecha(fechaGestionStr);
    if (!fechaGestion) continue; // Omitir filas con fecha no parseable

    if (!fechaEnRango(fechaGestion, desde, hasta)) continue;

    totalGestionadas++;
    var estado = clasificarEstado(fila[COL_HISTORICO.ESTADO_GENERAL]);
    var nombre = String(fila[COL_HISTORICO.NOMBRE_ANALISTA] || "Sin nombre").trim();
    var tiempoGestionRaw = String(fila[COL_HISTORICO.MINUTOS_GESTION] || "").trim();
    var tiempoResolucionRaw = String(fila[COL_HISTORICO.MINUTOS_GENERAL] || "").trim();

    // Clasificar estado
    if (estado === 'APROBADO') aprobadas++;
    else if (estado === 'RECHAZADO') negadas++;
    else if (estado === 'APLAZADO') aplazadas++;

    // Tipo de solicitud
    var tipoSol = normalizarTipoAsignado(fila[COL_HISTORICO.TIPO_ASIGNADO]) || 'Digital';
    if (!tipoMap[fechaGestionStr]) tipoMap[fechaGestionStr] = { Digital: 0, UAR: 0, Reestudio: 0, 'Biometría': 0, 'Inducción': 0 };
    tipoMap[fechaGestionStr][tipoSol]++;

    // Tiempo de gestión
    var tiempoGestion = parsearTiempoMinutos(tiempoGestionRaw);
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) {
      sumaTiempos += tiempoGestion;
      countTiempos++;
    }

    // Tiempo de resolución (general) — convertir de minutos a horas
    var tiempoResolucionMin = parsearTiempoMinutos(tiempoResolucionRaw);
    var tiempoResolucion = !isNaN(tiempoResolucionMin) ? tiempoResolucionMin / 60 : NaN;
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) {
      sumaTiemposResolucion += tiempoResolucion;
      countTiemposResolucion++;
    }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) fueraDeSLA++;

    // Tiempo de Cola
    var tiempoColaMin = null;
    var tiempoColaRawVal = parsearTiempoMinutos(String(fila[COL_HISTORICO.MINUTOS_COLA] || ""));
    if (!isNaN(tiempoColaRawVal) && tiempoColaRawVal >= 0) {
      tiempoColaMin = tiempoColaRawVal;
      sumaTiempoCola += tiempoColaMin;
      countTiempoCola++;
    }

    // Segmentación por Inmobiliaria
    var polizaVal = String(fila[COL_HISTORICO.POLIZA] || "").trim();
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

    // Producción por día
    if (!produccionMap[fechaGestionStr]) produccionMap[fechaGestionStr] = 0;
    produccionMap[fechaGestionStr]++;

    // SLA por día
    if (!slaMap[fechaGestionStr]) slaMap[fechaGestionStr] = { dentroSLA: 0, fueraSLA: 0 };
    if (!isNaN(tiempoResolucion)) {
      if (tiempoResolucion <= 2) slaMap[fechaGestionStr].dentroSLA++;
      else slaMap[fechaGestionStr].fueraSLA++;
    }

    // Analista
    if (!analistaMap[nombre]) {
      analistaMap[nombre] = {
        total: 0, aprobadas: 0, negadas: 0, aplazadas: 0,
        sumaTiempo: 0, countTiempo: 0,
        sumaTiempoResolucion: 0, countTiempoResolucion: 0,
        fueraSLA: 0, diasInfo: {}, horasSlot: {},
        motivosNegacion: {}, motivosAplazamiento: {}, decisionPorDia: {}
      };
    }
    var a = analistaMap[nombre];
    a.total++;

    // Hora fin para ritmo/heatmap
    var fechaFinCompleta = String(fila[COL_HISTORICO.FECHA_FIN] || "").trim();
    var horaFin = fechaFinCompleta.split(' ')[1] || "";
    if (horaFin && fechaGestionStr) {
      var horaFinNorm = normalizarHora(horaFin);
      if (!a.diasInfo[fechaGestionStr]) a.diasInfo[fechaGestionStr] = { count: 0, primera: horaFinNorm, ultima: horaFinNorm };
      a.diasInfo[fechaGestionStr].count++;
      if (horaFinNorm < a.diasInfo[fechaGestionStr].primera) a.diasInfo[fechaGestionStr].primera = horaFinNorm;
      if (horaFinNorm > a.diasInfo[fechaGestionStr].ultima) a.diasInfo[fechaGestionStr].ultima = horaFinNorm;
      var hSlot = parseInt(horaFin.split(':')[0], 10);
      if (!isNaN(hSlot)) a.horasSlot[hSlot] = (a.horasSlot[hSlot] || 0) + 1;
    }

    // Decisión por día
    if (!a.decisionPorDia[fechaGestionStr]) a.decisionPorDia[fechaGestionStr] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0 };
    a.decisionPorDia[fechaGestionStr].total++;

    if (estado === 'APROBADO') { a.aprobadas++; a.decisionPorDia[fechaGestionStr].aprobadas++; }
    else if (estado === 'RECHAZADO') {
      a.negadas++;
      a.decisionPorDia[fechaGestionStr].negadas++;
      if (idxMotivoNeg >= 0) _tallyMotivo(a.motivosNegacion, fila[idxMotivoNeg]);
    }
    else if (estado === 'APLAZADO') {
      a.aplazadas++;
      a.decisionPorDia[fechaGestionStr].aplazadas++;
      if (idxMotivoApl >= 0) _tallyMotivo(a.motivosAplazamiento, fila[idxMotivoApl]);
    }

    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) { a.sumaTiempo += tiempoGestion; a.countTiempo++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) { a.sumaTiempoResolucion += tiempoResolucion; a.countTiempoResolucion++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) a.fueraSLA++;

    // Sucursal
    var sucursal = obtenerSucursalPorPoliza(fila[COL_HISTORICO.POLIZA]);
    if (!sucursalMap[fechaGestionStr]) sucursalMap[fechaGestionStr] = {};
    sucursalMap[fechaGestionStr][sucursal] = (sucursalMap[fechaGestionStr][sucursal] || 0) + 1;

    if (!negacionSucursal[sucursal]) negacionSucursal[sucursal] = { total: 0, negadas: 0 };
    negacionSucursal[sucursal].total++;
    if (estado === 'RECHAZADO') negacionSucursal[sucursal].negadas++;

    // Detalle de tiempos
    var solicitudId = String(fila[COL_HISTORICO.SOLICITUD] || "").trim();
    var estadoLabel = estado === 'APROBADO' ? "APROBADO" : estado === 'RECHAZADO' ? "RECHAZADO" : estado === 'APLAZADO' ? "APLAZADO" : "OTRO";
    tiemposDetalle.push({
      solicitud: solicitudId,
      poliza: polizaVal,
      fecha: fechaGestionStr,
      sucursal: sucursal,
      tipo: tipoSol,
      analista: nombre,
      segmento: seg,
      inmobiliaria: inmob,
      estado: estadoLabel,
      tGestion: !isNaN(tiempoGestion) && tiempoGestion >= 0 ? tiempoGestion : null,
      tResolucion: !isNaN(tiempoResolucion) && tiempoResolucion > 0 ? tiempoResolucion : null,
      tCola: tiempoColaMin !== null ? tiempoColaMin : null
    });

    // Callback del consumidor
    if (opciones.procesarFila) {
      opciones.procesarFila(fila, fechaGestion, fechaGestionStr, estado, 'historico');
    }
  }

  // ---- Procesar Reestudios ----
  if (incluirReestudios && dataReestudios.length > 1) {
    for (var ri = 1; ri < dataReestudios.length; ri++) {
      var filaR = dataReestudios[ri];
      var fechaFinStrR = String(filaR[COL_REESTUDIOS.FECHA_FIN] || "").trim();

      // Backlog reestudios
      if (incluirBacklog && String(filaR[COL_REESTUDIOS.FECHA_ASIGNACION] || "").trim() !== "" && fechaFinStrR === "") {
        var ahoraR = new Date();
        var dtAsigBackR = parsearFecha(String(filaR[COL_REESTUDIOS.FECHA_ASIGNACION] || "").trim());
        var minutosEsperaR = 0;
        var alertaSLAR = "verde";
        if (dtAsigBackR) {
          minutosEsperaR = Math.round((ahoraR - dtAsigBackR) / 60000);
          if (minutosEsperaR < 0) minutosEsperaR = 0;
          if (minutosEsperaR > 30) alertaSLAR = "rojo";
          else if (minutosEsperaR >= 15) alertaSLAR = "amarillo";
        }
        var polizaBackR = String(filaR[COL_REESTUDIOS.POLIZA] || filaR[COL_REESTUDIOS.POLIZA_ALT] || "").trim();
        var infoSegBackR = obtenerSegmentoInmobiliaria(polizaBackR, scoreMap);
        var tipoProcesoBack = String(filaR[COL_REESTUDIOS.TIPO_PROCESO] || "").trim() || 'Reestudio';
        backlogDetalle.push({
          solicitud: String(filaR[COL_REESTUDIOS.SOLICITUD] || "").trim(),
          fechaAsignacion: String(filaR[COL_REESTUDIOS.FECHA_ASIGNACION] || "").trim(),
          analista: String(filaR[COL_REESTUDIOS.NOMBRE_ANALISTA] || "Sin nombre").trim(),
          minutosEspera: minutosEsperaR,
          alertaSLA: alertaSLAR,
          inmobiliaria: infoSegBackR.inmobiliaria,
          segmento: infoSegBackR.segmento,
          tipo: tipoProcesoBack,
          origen: 'Reestudios/UAR'
        });
        continue;
      }

      if (!fechaFinStrR) continue;

      var fechaParteR = fechaFinStrR.split(' ')[0];
      var fechaGestionR = parsearFecha(fechaParteR);
      if (!fechaGestionR) continue; // Omitir filas con fecha no parseable

      if (!fechaEnRango(fechaGestionR, desde, hasta)) continue;

      totalGestionadas++;
      var estadoR = clasificarEstado(filaR[COL_REESTUDIOS.ESTADO_GENERAL]);
      var nombreR = String(filaR[COL_REESTUDIOS.NOMBRE_ANALISTA] || "Sin nombre").trim();
      var tiempoGestionReestRaw = String(filaR[COL_REESTUDIOS.MINUTOS_GESTION] || "").trim();
      var tiempoResolucionReestRaw = String(filaR[COL_REESTUDIOS.MINUTOS_GENERAL] || "").trim();

      // Clasificar estado
      if (estadoR === 'APROBADO') aprobadas++;
      else if (estadoR === 'RECHAZADO') negadas++;
      else if (estadoR === 'APLAZADO') aplazadas++;

      // Tipo de solicitud para reestudios
      var origenR = String(filaR[COL_REESTUDIOS.ORIGEN] || "").toUpperCase().trim();
      var tipoProcesoR = String(filaR[COL_REESTUDIOS.TIPO_PROCESO] || "").toUpperCase().trim();
      var esUarMetrica = origenR === "CORREO" && (tipoProcesoR.indexOf("ADICIONAL") >= 0 || tipoProcesoR.indexOf("NUEVA") >= 0);
      var tipoReest = esUarMetrica ? 'UAR' : 'Reestudio';

      if (!tipoMap[fechaParteR]) tipoMap[fechaParteR] = { Digital: 0, UAR: 0, Reestudio: 0, 'Biometría': 0, 'Inducción': 0 };
      tipoMap[fechaParteR][tipoReest]++;

      // Tiempo de resolución (general) — minutos a horas
      var tiempoResolucionReest = parsearTiempoMinutos(tiempoResolucionReestRaw);
      var tiempoResolucionReestHoras = !isNaN(tiempoResolucionReest) ? tiempoResolucionReest / 60 : NaN;
      if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) {
        sumaTiemposResolucion += tiempoResolucionReestHoras;
        countTiemposResolucion++;
      }

      // Tiempo de gestión
      var tiempoGestionReest = parsearTiempoMinutos(tiempoGestionReestRaw);
      if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) {
        sumaTiempos += tiempoGestionReest;
        countTiempos++;
      }
      if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) fueraDeSLA++;

      // Tiempo de Cola para reestudios
      var tiempoColaReest = null;
      var tiempoColaReestVal = parsearTiempoMinutos(String(filaR[COL_REESTUDIOS.MINUTOS_COLA] || ""));
      if (!isNaN(tiempoColaReestVal) && tiempoColaReestVal >= 0) {
        tiempoColaReest = tiempoColaReestVal;
        sumaTiempoCola += tiempoColaReest;
        countTiempoCola++;
      }

      // Segmentación por Inmobiliaria para reestudios
      var polizaReest = String(filaR[COL_REESTUDIOS.POLIZA] || filaR[COL_REESTUDIOS.POLIZA_ALT] || "").trim();
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

      // Producción por día
      if (!produccionMap[fechaParteR]) produccionMap[fechaParteR] = 0;
      produccionMap[fechaParteR]++;

      // SLA por día
      if (!slaMap[fechaParteR]) slaMap[fechaParteR] = { dentroSLA: 0, fueraSLA: 0 };
      if (!isNaN(tiempoResolucionReestHoras)) {
        if (tiempoResolucionReestHoras <= 2) slaMap[fechaParteR].dentroSLA++;
        else slaMap[fechaParteR].fueraSLA++;
      }

      // Analista
      if (!analistaMap[nombreR]) {
        analistaMap[nombreR] = {
          total: 0, aprobadas: 0, negadas: 0, aplazadas: 0,
          sumaTiempo: 0, countTiempo: 0,
          sumaTiempoResolucion: 0, countTiempoResolucion: 0,
          fueraSLA: 0, diasInfo: {}, horasSlot: {},
          motivosNegacion: {}, motivosAplazamiento: {}, decisionPorDia: {}
        };
      }
      var aR = analistaMap[nombreR];
      aR.total++;

      // Hora fin para ritmo/heatmap
      var horaFinR = fechaFinStrR.split(' ')[1] || "";
      if (horaFinR && fechaParteR) {
        var horaFinRNorm = normalizarHora(horaFinR);
        if (!aR.diasInfo[fechaParteR]) aR.diasInfo[fechaParteR] = { count: 0, primera: horaFinRNorm, ultima: horaFinRNorm };
        aR.diasInfo[fechaParteR].count++;
        if (horaFinRNorm < aR.diasInfo[fechaParteR].primera) aR.diasInfo[fechaParteR].primera = horaFinRNorm;
        if (horaFinRNorm > aR.diasInfo[fechaParteR].ultima) aR.diasInfo[fechaParteR].ultima = horaFinRNorm;
        var hSlotR = parseInt(horaFinR.split(':')[0], 10);
        if (!isNaN(hSlotR)) aR.horasSlot[hSlotR] = (aR.horasSlot[hSlotR] || 0) + 1;
      }

      // Decisión por día
      if (!aR.decisionPorDia[fechaParteR]) aR.decisionPorDia[fechaParteR] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0 };
      aR.decisionPorDia[fechaParteR].total++;

      if (estadoR === 'APROBADO') { aR.aprobadas++; aR.decisionPorDia[fechaParteR].aprobadas++; }
      else if (estadoR === 'RECHAZADO') { aR.negadas++; aR.decisionPorDia[fechaParteR].negadas++; }
      else if (estadoR === 'APLAZADO') { aR.aplazadas++; aR.decisionPorDia[fechaParteR].aplazadas++; }

      if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) { aR.sumaTiempo += tiempoGestionReest; aR.countTiempo++; }
      if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) { aR.sumaTiempoResolucion += tiempoResolucionReestHoras; aR.countTiempoResolucion++; }
      if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) aR.fueraSLA++;

      // Sucursal
      var sucursalR = obtenerSucursalPorPoliza(filaR[COL_REESTUDIOS.POLIZA]);
      if (!sucursalMap[fechaParteR]) sucursalMap[fechaParteR] = {};
      sucursalMap[fechaParteR][sucursalR] = (sucursalMap[fechaParteR][sucursalR] || 0) + 1;

      if (!negacionSucursal[sucursalR]) negacionSucursal[sucursalR] = { total: 0, negadas: 0 };
      negacionSucursal[sucursalR].total++;
      if (estadoR === 'RECHAZADO') negacionSucursal[sucursalR].negadas++;

      // Detalle de tiempos
      var solicitudIdR = String(filaR[COL_REESTUDIOS.SOLICITUD] || "").trim();
      var estadoLabelR = estadoR === 'APROBADO' ? "APROBADO" : estadoR === 'RECHAZADO' ? "RECHAZADO" : estadoR === 'APLAZADO' ? "APLAZADO" : "OTRO";
      tiemposDetalle.push({
        solicitud: solicitudIdR,
        poliza: polizaReest,
        fecha: fechaParteR,
        sucursal: sucursalR,
        tipo: tipoReest,
        analista: nombreR,
        segmento: segR,
        inmobiliaria: inmobR,
        estado: estadoLabelR,
        tGestion: !isNaN(tiempoGestionReest) && tiempoGestionReest >= 0 ? tiempoGestionReest : null,
        tResolucion: !isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0 ? tiempoResolucionReestHoras : null,
        tCola: tiempoColaReest !== null ? tiempoColaReest : null
      });

      // Callback del consumidor
      if (opciones.procesarFila) {
        opciones.procesarFila(filaR, fechaGestionR, fechaParteR, estadoR, 'reestudios');
      }
    }
  }

  // ---- Conteos separados: Radicadas y Negación Directa ----
  var negacionDirectaCount = 0;
  var totalRadicadas = 0;

  // Radicadas desde Historico_Gestiones (fecha_radicacion)
  for (var rhi = 1; rhi < dataHistorico.length; rhi++) {
    var frMain = parsearFecha(String(dataHistorico[rhi][COL_HISTORICO.FECHA_RADICACION] || "").trim());
    if (frMain && fechaEnRango(frMain, desde, hasta)) {
      totalRadicadas++;
    }
  }

  // Radicadas aún no gestionadas (hoja "solicitud")
  // Se usa fechaResultado (col 18) en vez de fechaRadicacion porque llega con error de datos
  try {
    var dataSol = obtenerHojaSolicitud();
    if (dataSol.length > 1) {
      for (var si = 1; si < dataSol.length; si++) {
        var frSol = parsearFecha(String(dataSol[si][18] || "").trim());
        if (frSol && fechaEnRango(frSol, desde, hasta)) {
          totalRadicadas++;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: Error contando radicadas pendientes de la hoja solicitud: " + e.message);
  }

  // Radicadas desde Reestudios (fecha_radicacion = col 0)
  if (incluirReestudios && dataReestudios.length > 1) {
    for (var rrj = 1; rrj < dataReestudios.length; rrj++) {
      var frReest = parsearFecha(String(dataReestudios[rrj][COL_REESTUDIOS.FECHA_RADICACION] || "").trim());
      if (frReest && fechaEnRango(frReest, desde, hasta)) {
        totalRadicadas++;
      }
    }
  }

  // Radicadas y negación directa desde rechazado_gestion_directa
  try {
    var ssRech = SpreadsheetApp.openById(SAI_CONFIG.SHEET_ID);
    var hojaRech = ssRech.getSheetByName('rechazado_gestion_directa');
    if (hojaRech && hojaRech.getLastRow() > 1) {
      var dataRech = hojaRech.getRange(2, 1, hojaRech.getLastRow() - 1, 18).getDisplayValues();
      for (var rk = 0; rk < dataRech.length; rk++) {
        var frRech = parsearFecha(String(dataRech[rk][17] || "").trim());
        if (frRech && fechaEnRango(frRech, desde, hasta)) {
          negacionDirectaCount++;
          totalRadicadas++;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se pudo leer rechazado_gestion_directa: " + e.message);
  }

  // ---- Ordenar backlog por mayor espera primero ----
  backlogDetalle.sort(function(a, b) { return b.minutosEspera - a.minutosEspera; });

  // ---- Retornar resultado acumulado ----
  return {
    totalGestionadas: totalGestionadas,
    aprobadas: aprobadas,
    negadas: negadas,
    aplazadas: aplazadas,
    fueraDeSLA: fueraDeSLA,

    // Acumuladores de tiempo (para cálculo de promedios por consumidor)
    sumaTiempos: sumaTiempos,
    countTiempos: countTiempos,
    sumaTiemposResolucion: sumaTiemposResolucion,
    countTiemposResolucion: countTiemposResolucion,
    sumaTiempoCola: sumaTiempoCola,
    countTiempoCola: countTiempoCola,

    // Mapas de agregación
    produccionMap: produccionMap,
    slaMap: slaMap,
    analistaMap: analistaMap,
    sucursalMap: sucursalMap,
    tipoMap: tipoMap,
    segmentoInmobMap: segmentoInmobMap,
    negacionSucursal: negacionSucursal,

    // Detalle
    tiemposDetalle: tiemposDetalle,
    backlogDetalle: backlogDetalle,

    // Radicadas y negación directa
    negacionDirectaCount: negacionDirectaCount,
    totalRadicadas: totalRadicadas,

    // Metadata
    reestudiosDisponibles: incluirReestudios && dataReestudios.length > 1
  };
}

// ============================================================================
// HELPERS COMPARTIDOS — Filtrado por fecha y resolución de analista
// ============================================================================

/**
 * Filtra filas de datos por un rango de fechas [desde, hasta] (inclusive).
 * Salta la fila de encabezados (índice 0) y omite filas con fechas no parseables.
 *
 * Usado por obtenerDatosMetricas y admin_obtenerAsesoresActivosPrimerResultado
 * para seleccionar filas de Historico_Gestiones y Hoja_Reestudios.
 *
 * @param {string[][]} datos - Datos crudos de la hoja (incluye headers en fila 0)
 * @param {Date} desde - Fecha inicio del rango (inclusive)
 * @param {Date} hasta - Fecha fin del rango (inclusive, debe tener 23:59:59 si se quiere cubrir todo el día)
 * @param {number} colFecha - Índice de la columna que contiene la fecha a evaluar
 * @returns {Array<{fila: string[], fecha: Date, fechaStr: string}>} Filas filtradas con metadata de fecha
 */
function _filtrarFilasPorRango(datos, desde, hasta, colFecha) {
  var resultado = [];
  if (!datos || datos.length < 2) return resultado;
  if (!(desde instanceof Date) || !(hasta instanceof Date)) return resultado;

  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var valorFecha = String(fila[colFecha] || "").trim();
    if (!valorFecha) continue;

    // Extraer solo la parte de fecha (sin hora) para parseo consistente
    var fechaStr = valorFecha.split(' ')[0];
    var fecha = parsearFecha(fechaStr);
    if (!fecha) continue; // Omitir filas con fechas no parseables

    if (!fechaEnRango(fecha, desde, hasta)) continue;

    resultado.push({
      fila: fila,
      fecha: fecha,
      fechaStr: fechaStr
    });
  }

  return resultado;
}

/**
 * Filtra filas de datos por coincidencia exacta de día (ignora componente de hora).
 * Salta la fila de encabezados (índice 0) y omite filas con fechas no parseables.
 *
 * Usado por admin_obtenerAsesoresActivosPrimerResultado y obtenerRendimientoPorDia
 * cuando se necesita filtrar por una fecha única en vez de un rango.
 *
 * @param {string[][]} datos - Datos crudos de la hoja (incluye headers en fila 0)
 * @param {Date} fechaExacta - Fecha objetivo (solo se compara día/mes/año)
 * @param {number} colFecha - Índice de la columna que contiene la fecha a evaluar
 * @returns {Array<{fila: string[], fecha: Date, fechaStr: string}>} Filas filtradas con metadata de fecha
 */
function _filtrarFilasPorFechaExacta(datos, fechaExacta, colFecha) {
  var resultado = [];
  if (!datos || datos.length < 2) return resultado;
  if (!(fechaExacta instanceof Date) || isNaN(fechaExacta.getTime())) return resultado;

  var diaObjetivo = fechaExacta.getDate();
  var mesObjetivo = fechaExacta.getMonth();
  var anioObjetivo = fechaExacta.getFullYear();

  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var valorFecha = String(fila[colFecha] || "").trim();
    if (!valorFecha) continue;

    // Extraer solo la parte de fecha (sin hora)
    var fechaStr = valorFecha.split(' ')[0];
    var fecha = parsearFecha(fechaStr);
    if (!fecha) continue; // Omitir filas con fechas no parseables

    // Comparar solo día/mes/año (ignorar componente de hora)
    if (fecha.getDate() === diaObjetivo &&
        fecha.getMonth() === mesObjetivo &&
        fecha.getFullYear() === anioObjetivo) {
      resultado.push({
        fila: fila,
        fecha: fecha,
        fechaStr: fechaStr
      });
    }
  }

  return resultado;
}

/**
 * Resuelve nombre y especialidad de un analista por correo electrónico.
 * Busca en la hoja "Usuarios" obtenida desde la Capa_de_Datos (obtenerHojaUsuarios).
 * La comparación de correos es case-insensitive.
 *
 * Usado por obtenerDatosMetricas y admin_obtenerAsesoresActivosPrimerResultado
 * para resolver datos del analista sin iterar la hoja Usuarios de forma independiente.
 *
 * @param {string} correo - Correo electrónico del analista a buscar
 * @returns {{nombre: string, especialidad: string}} Datos del analista o valores por defecto
 */
function _resolverAnalista(correo) {
  try {
    if (!correo || typeof correo !== 'string' || correo.trim() === '') {
      return { nombre: correo || '', especialidad: '' };
    }

    var correoBuscado = correo.trim().toLowerCase();
    var datosUsuarios = obtenerHojaUsuarios();

    if (!datosUsuarios || datosUsuarios.length < 2) {
      return { nombre: correo, especialidad: '' };
    }

    // Iterar desde fila 1 (saltando headers)
    for (var i = 1; i < datosUsuarios.length; i++) {
      var filaUsuario = datosUsuarios[i];
      var correoUsuario = String(filaUsuario[COL_USUARIOS.CORREO] || "").trim().toLowerCase();

      if (correoUsuario === correoBuscado) {
        var nombre = String(filaUsuario[COL_USUARIOS.NOMBRE] || "").trim();
        var especialidad = String(filaUsuario[COL_USUARIOS.ESPECIALIDAD] || "").trim();
        return {
          nombre: nombre || correo,
          especialidad: especialidad
        };
      }
    }

    // Correo no encontrado — retornar valores por defecto
    return { nombre: correo, especialidad: '' };
  } catch (e) {
    // Nunca lanzar excepción
    return { nombre: correo || '', especialidad: '' };
  }
}


// ============================================================================
// FUNCIONES REFACTORIZADAS — Delegación al pipeline compartido
// ============================================================================

/**
 * obtenerDatosMetricas refactorizado — delega al pipeline _procesarFilasMetricas.
 * Mantiene firma y retorno IDÉNTICOS al original en Código.js para compatibilidad
 * con JSClient.html y el dashboard.
 *
 * @param {string} fechaDesde - dd/MM/yyyy
 * @param {string} fechaHasta - dd/MM/yyyy
 * @returns {object} Estructura completa de métricas del dashboard
 */
function obtenerDatosMetricas(fechaDesde, fechaHasta) {
  var desde = parsearFecha(fechaDesde);
  var hasta = parsearFecha(fechaHasta);
  if (!desde || !hasta) throw new Error("Formato de fecha inválido. Use dd/MM/yyyy.");

  // Verificar CacheService primero
  var claveCache = "metricas_" + fechaDesde + "_" + fechaHasta;
  var cacheado = _cacheGet(claveCache);
  if (cacheado) return cacheado;

  // Ejecutar pipeline compartido
  var r = _procesarFilasMetricas({
    desde: desde,
    hasta: hasta,
    incluirReestudios: true,
    incluirBacklog: true
  });

  // Calcular promedios derivados
  var tiempoPromedioMinutos = r.countTiempos > 0 ? Math.round((r.sumaTiempos / r.countTiempos) * 10) / 10 : 0;
  var tiempoPromedioResolucionHoras = r.countTiemposResolucion > 0 ? Number((r.sumaTiemposResolucion / r.countTiemposResolucion).toFixed(2)) : 0;
  var tasaAprobacion = r.totalGestionadas > 0 ? Math.round((r.aprobadas / r.totalGestionadas) * 1000) / 10 : 0;
  var tiempoColaPromedio = r.countTiempoCola > 0 ? Math.round((r.sumaTiempoCola / r.countTiempoCola) * 10) / 10 : 0;

  // Negación directa y porcentajes
  var pctNegacionDirecta = r.totalRadicadas > 0 ? Math.round((r.negacionDirectaCount / r.totalRadicadas) * 1000) / 10 : 0;
  var pctNegacion = r.totalGestionadas > 0 ? Math.round((r.negadas / r.totalGestionadas) * 1000) / 10 : 0;
  var pctAplazamiento = r.totalGestionadas > 0 ? Math.round((r.aplazadas / r.totalGestionadas) * 1000) / 10 : 0;

  // Preparar datos de segmentación por inmobiliaria para frontend
  var segmentacion = {};
  Object.keys(r.segmentoInmobMap).forEach(function(seg) {
    segmentacion[seg] = Object.keys(r.segmentoInmobMap[seg]).map(function(inmob) {
      var d = r.segmentoInmobMap[seg][inmob];
      return {
        inmobiliaria: inmob,
        count: d.count,
        tiempoColaPromedio: d.countCola > 0 ? Math.round((d.sumaCola / d.countCola) * 10) / 10 : 0,
        tiempoGestionPromedio: d.countGestion > 0 ? Math.round((d.sumaGestion / d.countGestion) * 10) / 10 : 0,
        tiempoGeneralPromedio: d.countGeneral > 0 ? Number((d.sumaGeneral / d.countGeneral).toFixed(2)) : 0
      };
    }).sort(function(a, b) { return b.count - a.count; });
  });

  // Tasa de negación por sucursal
  var tasaNegacionSucursal = Object.keys(r.negacionSucursal).map(function(s) {
    return {
      sucursal: s,
      total: r.negacionSucursal[s].total,
      negadas: r.negacionSucursal[s].negadas,
      tasa: r.negacionSucursal[s].total > 0 ? Math.round((r.negacionSucursal[s].negadas / r.negacionSucursal[s].total) * 1000) / 10 : 0
    };
  }).sort(function(a, b) { return b.tasa - a.tasa; });

  // Tendencia SLA
  var fechasSLAOrden = Object.keys(r.slaMap).sort(function(a, b) { return parsearFecha(a) - parsearFecha(b); });
  var tendenciaSLA = fechasSLAOrden.map(function(f) {
    var d = r.slaMap[f];
    var t = d.dentroSLA + d.fueraSLA;
    return { fecha: f, pctCumplimiento: t > 0 ? Math.round((d.dentroSLA / t) * 1000) / 10 : 100 };
  });

  // Heatmap de hora global
  var heatmapHora = {};
  for (var h = 6; h <= 21; h++) heatmapHora[h] = 0;
  Object.keys(r.analistaMap).forEach(function(nombre) {
    var slots = r.analistaMap[nombre].horasSlot;
    Object.keys(slots).forEach(function(hh) { heatmapHora[hh] = (heatmapHora[hh] || 0) + slots[hh]; });
  });

  // Producción diaria (sorted)
  var produccionDiaria = Object.keys(r.produccionMap)
    .sort(function(a, b) { return parsearFecha(a) - parsearFecha(b); })
    .map(function(fecha) { return { fecha: fecha, cantidad: r.produccionMap[fecha] }; });

  // SLA diario (sorted)
  var slaDiario = Object.keys(r.slaMap)
    .sort(function(a, b) { return parsearFecha(a) - parsearFecha(b); })
    .map(function(fecha) { return { fecha: fecha, dentroSLA: r.slaMap[fecha].dentroSLA, fueraSLA: r.slaMap[fecha].fueraSLA }; });

  // Por analista (sorted by total desc)
  var porAnalista = Object.keys(r.analistaMap)
    .map(function(nombre) {
      var a = r.analistaMap[nombre];
      return {
        nombre: nombre,
        total: a.total,
        aprobadas: a.aprobadas,
        negadas: a.negadas,
        aplazadas: a.aplazadas,
        pctAprobacion: a.total > 0 ? Math.round((a.aprobadas / a.total) * 1000) / 10 : 0,
        pctNegacion: a.total > 0 ? Math.round((a.negadas / a.total) * 1000) / 10 : 0,
        pctAplazamiento: a.total > 0 ? Math.round((a.aplazadas / a.total) * 1000) / 10 : 0,
        motivosNegacion: a.motivosNegacion,
        motivosAplazamiento: a.motivosAplazamiento,
        motivoPrincipal: _motivoPrincipalCombinado(a.motivosNegacion, a.motivosAplazamiento),
        tendenciaDiaria: Object.keys(a.decisionPorDia || {}).sort(function(f1, f2) { return parsearFecha(f1) - parsearFecha(f2); }).map(function(f) {
          var d = a.decisionPorDia[f];
          return {
            fecha: f,
            total: d.total,
            aprobadas: d.aprobadas,
            negadas: d.negadas,
            aplazadas: d.aplazadas,
            pctAprobacion: d.total > 0 ? Math.round((d.aprobadas / d.total) * 1000) / 10 : 0,
            pctNegacion: d.total > 0 ? Math.round((d.negadas / d.total) * 1000) / 10 : 0,
            pctAplazamiento: d.total > 0 ? Math.round((d.aplazadas / d.total) * 1000) / 10 : 0
          };
        }),
        tiempoPromedio: a.countTiempo > 0 ? Math.round((a.sumaTiempo / a.countTiempo) * 10) / 10 : 0,
        tiempoPromedioGeneral: a.countTiempoResolucion > 0 ? Number((a.sumaTiempoResolucion / a.countTiempoResolucion).toFixed(2)) : 0,
        promedioPorHora: (function() {
          var dias = Object.keys(a.diasInfo);
          if (dias.length === 0) return 0;
          var sumaRates = 0;
          var diasConRango = 0;
          for (var d = 0; d < dias.length; d++) {
            var info = a.diasInfo[dias[d]];
            if (info.count <= 1) { sumaRates += info.count; diasConRango++; continue; }
            var pParts = info.primera.split(':');
            var uParts = info.ultima.split(':');
            var pMin = parseInt(pParts[0], 10) * 60 + parseInt(pParts[1], 10);
            var uMin = parseInt(uParts[0], 10) * 60 + parseInt(uParts[1], 10);
            var diffHoras = (uMin - pMin) / 60;
            if (diffHoras > 0) { sumaRates += info.count / diffHoras; diasConRango++; }
            else { sumaRates += info.count; diasConRango++; }
          }
          return diasConRango > 0 ? Math.round(sumaRates / diasConRango) : 0;
        })(),
        prodRealPorHora: (function() {
          var dias = Object.keys(a.diasInfo);
          if (dias.length === 0 || a.total === 0) return 0;
          var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
          var inicioParts = HORA_INICIO_OPERACION.split(':');
          var inicioMin = parseInt(inicioParts[0], 10) * 60 + parseInt(inicioParts[1], 10);
          var sumaRates = 0;
          var diasValidos = 0;
          for (var d = 0; d < dias.length; d++) {
            var info = a.diasInfo[dias[d]];
            var corteMin;
            if (dias[d] === hoyStr) {
              var ahoraEnZona = Utilities.formatDate(new Date(), TIMEZONE, "HH:mm");
              var ahoraParts = ahoraEnZona.split(':');
              corteMin = parseInt(ahoraParts[0], 10) * 60 + parseInt(ahoraParts[1], 10);
            } else {
              var finParts = HORA_FIN_TURNO.split(':');
              corteMin = parseInt(finParts[0], 10) * 60 + parseInt(finParts[1], 10);
            }
            var horasTranscurridas = (corteMin - inicioMin) / 60;
            if (horasTranscurridas <= 0) horasTranscurridas = 1;
            sumaRates += info.count / horasTranscurridas;
            diasValidos++;
          }
          return diasValidos > 0 ? Math.round(sumaRates / diasValidos) : 0;
        })(),
        detalleHoras: (function() {
          var numDias = Object.keys(a.diasInfo).length || 1;
          var detalle = {};
          for (var hh = 6; hh <= 21; hh++) {
            detalle[hh] = a.horasSlot[hh] ? Math.round(a.horasSlot[hh] / numDias) : 0;
          }
          return detalle;
        })(),
        fueraSLA: a.fueraSLA
      };
    })
    .sort(function(a, b) { return b.total - a.total; });

  // Sucursal por día
  var sucursalesUnicas = {};
  Object.keys(r.sucursalMap).forEach(function(fecha) {
    Object.keys(r.sucursalMap[fecha]).forEach(function(s) { sucursalesUnicas[s] = true; });
  });
  var listaSucursales = Object.keys(sucursalesUnicas).sort();
  var porSucursal = {
    fechas: Object.keys(r.sucursalMap).sort(function(a, b) { return parsearFecha(a) - parsearFecha(b); }),
    sucursales: listaSucursales,
    datos: {}
  };
  listaSucursales.forEach(function(s) {
    porSucursal.datos[s] = porSucursal.fechas.map(function(f) { return r.sucursalMap[f][s] || 0; });
  });

  // Tipo de solicitud por día
  var porTipo = Object.keys(r.tipoMap)
    .sort(function(a, b) { return parsearFecha(a) - parsearFecha(b); })
    .map(function(fecha) {
      return {
        fecha: fecha,
        Digital: r.tipoMap[fecha].Digital,
        UAR: r.tipoMap[fecha].UAR,
        Reestudio: r.tipoMap[fecha].Reestudio,
        Biometria: r.tipoMap[fecha]['Biometría'],
        Induccion: r.tipoMap[fecha]['Inducción']
      };
    });

  // Construir resultado final — misma estructura que el original
  var resultado = {
    totalGestionadas: r.totalGestionadas,
    tiempoPromedioMinutos: tiempoPromedioMinutos,
    tiempoPromedioGeneralHoras: tiempoPromedioResolucionHoras,
    tiempoColaPromedio: tiempoColaPromedio,
    tasaAprobacion: tasaAprobacion,
    fueraDeSLA: r.fueraDeSLA,
    reestudiosDisponibles: r.reestudiosDisponibles,
    backlog: r.backlogDetalle.length,
    backlogDetalle: r.backlogDetalle,
    segmentacion: segmentacion,
    produccionDiaria: produccionDiaria,
    distribucionEstados: { aprobadas: r.aprobadas, negadas: r.negadas, aplazadas: r.aplazadas },
    porAnalista: porAnalista,
    slaDiario: slaDiario,
    porSucursal: porSucursal,
    porTipo: porTipo,
    tiemposDetalle: r.tiemposDetalle,
    tasaNegacionSucursal: tasaNegacionSucursal,
    tendenciaSLA: tendenciaSLA,
    heatmapHora: heatmapHora,
    negacionDirecta: r.negacionDirectaCount,
    pctNegacionDirecta: pctNegacionDirecta,
    pctNegacion: pctNegacion,
    pctAplazamiento: pctAplazamiento,
    totalRadicadas: r.totalRadicadas,
    aGestionNormal: r.totalRadicadas - r.negacionDirectaCount
  };

  // Almacenar en CacheService
  _cachePut(claveCache, resultado);

  return resultado;
}

/**
 * obtenerRendimientoPorDia refactorizado — delega al pipeline _procesarFilasMetricas.
 * Obtiene métricas de rendimiento individual por analista para una fecha específica.
 * Mantiene firma y retorno IDÉNTICOS al original en Código.js.
 *
 * @param {string} fechaFiltro - dd/MM/yyyy o yyyy-MM-dd
 * @returns {Array} Array de objetos con rendimiento por analista (sorted by total desc)
 */
function obtenerRendimientoPorDia(fechaFiltro) {
  // Parsear fecha — soportar ambos formatos
  var fechaStr;
  if (fechaFiltro && /^\d{4}-\d{2}-\d{2}$/.test(fechaFiltro)) {
    var partes = fechaFiltro.split("-");
    fechaStr = partes[2] + "/" + partes[1] + "/" + partes[0];
  } else {
    fechaStr = fechaFiltro || Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  }

  var fechaObj = parsearFecha(fechaStr);
  if (!fechaObj) {
    fechaStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
    fechaObj = parsearFecha(fechaStr);
  }

  // Usar pipeline para un solo día (desde=hasta)
  var dataHistorico = obtenerHistoricoGestiones();
  var dataReestudios = obtenerHojaReestudios();

  // Resolver columnas de motivos por nombre de header
  var colsMotivo = _mapaColumnasPorNombre(dataHistorico, ["Motivo de negación", "Motivo de aplazamiento"]);
  var idxMotivoNeg = colsMotivo["Motivo de negación"];
  var idxMotivoApl = colsMotivo["Motivo de aplazamiento"];

  var analistaMap = {};

  // Procesar Historico_Gestiones para la fecha dada
  for (var i = 1; i < dataHistorico.length; i++) {
    var fila = dataHistorico[i];
    var fechaFinRawR = String(fila[COL_HISTORICO.FECHA_FIN] || "").trim();
    if (!fechaFinRawR) continue;
    var fechaGestionStr = fechaFinRawR.split(' ')[0];
    if (fechaGestionStr !== fechaStr) continue;

    var estado = String(fila[COL_HISTORICO.ESTADO_GENERAL] || "").toUpperCase().trim();
    var nombre = String(fila[COL_HISTORICO.NOMBRE_ANALISTA] || "Sin nombre").trim();
    var correo = String(fila[COL_HISTORICO.CORREO_ANALISTA] || "").toLowerCase().trim();
    var clave = correo || nombre;
    var tiempoGestionRaw = String(fila[COL_HISTORICO.MINUTOS_GESTION] || "").trim();
    var tiempoResolucionRaw = String(fila[COL_HISTORICO.MINUTOS_GENERAL] || "").trim();
    var fechaFinCompleta = String(fila[COL_HISTORICO.FECHA_FIN] || "").trim();
    var horaFin = fechaFinCompleta.split(' ')[1] || "";

    if (!analistaMap[clave]) {
      analistaMap[clave] = { nombre: nombre, correo: correo, total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, primera: "", ultima: "", count: 0, horasSlot: {}, motivosNegacion: {}, motivosAplazamiento: {} };
    }
    var a = analistaMap[clave];
    a.total++;
    a.count++;

    if (estado.includes("APROB") && !estado.includes("PENDIENTE")) a.aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) { a.negadas++; if (idxMotivoNeg >= 0) _tallyMotivo(a.motivosNegacion, fila[idxMotivoNeg]); }
    else if (estado.includes("APLAZ")) { a.aplazadas++; if (idxMotivoApl >= 0) _tallyMotivo(a.motivosAplazamiento, fila[idxMotivoApl]); }

    var tiempoGestion = parsearTiempoMinutos(tiempoGestionRaw);
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) { a.sumaTiempo += tiempoGestion; a.countTiempo++; }

    var tiempoResolucionMin = parsearTiempoMinutos(tiempoResolucionRaw);
    var tiempoResolucion = !isNaN(tiempoResolucionMin) ? tiempoResolucionMin / 60 : NaN;
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) { a.sumaTiempoResolucion += tiempoResolucion; a.countTiempoResolucion++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) a.fueraSLA++;

    if (horaFin) {
      var horaFinNorm = normalizarHora(horaFin);
      if (!a.primera || horaFinNorm < a.primera) a.primera = horaFinNorm;
      if (!a.ultima || horaFinNorm > a.ultima) a.ultima = horaFinNorm;
      var hSlot = parseInt(horaFin.split(':')[0], 10);
      if (!isNaN(hSlot)) a.horasSlot[hSlot] = (a.horasSlot[hSlot] || 0) + 1;
    }
  }

  // Procesar Reestudios para la fecha dada
  if (dataReestudios.length > 1) {
    for (var ri = 1; ri < dataReestudios.length; ri++) {
      var filaR = dataReestudios[ri];
      var fechaFinStr = String(filaR[COL_REESTUDIOS.FECHA_FIN] || "").trim();
      if (!fechaFinStr) continue;
      var fechaParte = fechaFinStr.split(' ')[0];
      if (fechaParte !== fechaStr) continue;

      var estadoR = String(filaR[COL_REESTUDIOS.ESTADO_GENERAL] || "").toUpperCase().trim();
      var nombreR = String(filaR[COL_REESTUDIOS.NOMBRE_ANALISTA] || "Sin nombre").trim();
      var correoR = String(filaR[COL_REESTUDIOS.CORREO_ANALISTA] || "").toLowerCase().trim();
      var claveR = correoR || nombreR;
      var tiempoResolucionReestRaw = String(filaR[COL_REESTUDIOS.MINUTOS_GENERAL] || "").trim();
      var tiempoGestionReestRaw = String(filaR[COL_REESTUDIOS.MINUTOS_GESTION] || "").trim();
      var horaFinR = fechaFinStr.split(' ')[1] || "";

      if (!analistaMap[claveR]) {
        analistaMap[claveR] = { nombre: nombreR, correo: correoR, total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, primera: "", ultima: "", count: 0, horasSlot: {}, motivosNegacion: {}, motivosAplazamiento: {} };
      }
      var aR = analistaMap[claveR];
      aR.total++;
      aR.count++;

      if (estadoR.includes("APROB") && !estadoR.includes("PENDIENTE")) aR.aprobadas++;
      else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) aR.negadas++;
      else if (estadoR.includes("APLAZ")) aR.aplazadas++;

      var tiempoGestionReest = parsearTiempoMinutos(tiempoGestionReestRaw);
      if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) { aR.sumaTiempo += tiempoGestionReest; aR.countTiempo++; }

      var tiempoResolucionReest = parsearTiempoMinutos(tiempoResolucionReestRaw);
      var tiempoResolucionReestHoras = !isNaN(tiempoResolucionReest) ? tiempoResolucionReest / 60 : NaN;
      if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) { aR.sumaTiempoResolucion += tiempoResolucionReestHoras; aR.countTiempoResolucion++; }
      if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) aR.fueraSLA++;

      if (horaFinR) {
        var horaFinRNorm = normalizarHora(horaFinR);
        if (!aR.primera || horaFinRNorm < aR.primera) aR.primera = horaFinRNorm;
        if (!aR.ultima || horaFinRNorm > aR.ultima) aR.ultima = horaFinRNorm;
        var hSlotR = parseInt(horaFinR.split(':')[0], 10);
        if (!isNaN(hSlotR)) aR.horasSlot[hSlotR] = (aR.horasSlot[hSlotR] || 0) + 1;
      }
    }
  }

  // Construir resultado por analista — misma estructura que el original
  var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  var inicioParts = HORA_INICIO_OPERACION.split(':');
  var inicioMin = parseInt(inicioParts[0], 10) * 60 + parseInt(inicioParts[1], 10);

  return Object.keys(analistaMap).map(function(clave) {
    var a = analistaMap[clave];
    var ritmoEfec = 0;
    if (a.count >= 2 && a.primera && a.ultima) {
      var pParts = a.primera.split(':');
      var uParts = a.ultima.split(':');
      var pMin = parseInt(pParts[0], 10) * 60 + parseInt(pParts[1], 10);
      var uMin = parseInt(uParts[0], 10) * 60 + parseInt(uParts[1], 10);
      var diffHoras = (uMin - pMin) / 60;
      ritmoEfec = diffHoras > 0 ? Math.round(a.count / diffHoras) : 0;
    }

    var corteMin;
    if (fechaStr === hoyStr) {
      var ahoraEnZona = Utilities.formatDate(new Date(), TIMEZONE, "HH:mm");
      var ahoraParts = ahoraEnZona.split(':');
      corteMin = parseInt(ahoraParts[0], 10) * 60 + parseInt(ahoraParts[1], 10);
    } else {
      var finParts = HORA_FIN_TURNO.split(':');
      corteMin = parseInt(finParts[0], 10) * 60 + parseInt(finParts[1], 10);
    }
    var startMin = inicioMin;
    if (a.primera) {
      var pInicioParts = a.primera.split(':');
      var primeroMin = parseInt(pInicioParts[0], 10) * 60 + parseInt(pInicioParts[1], 10);
      startMin = Math.max(inicioMin, primeroMin);
    }
    var horasTranscurridas = (corteMin - startMin) / 60;
    if (horasTranscurridas <= 0) horasTranscurridas = 1;
    var prodReal = Math.round(a.total / horasTranscurridas);

    return {
      nombre: a.nombre || clave,
      correo: a.correo || "",
      total: a.total,
      aprobadas: a.aprobadas,
      negadas: a.negadas,
      aplazadas: a.aplazadas,
      pctAprobacion: a.total > 0 ? Math.round((a.aprobadas / a.total) * 1000) / 10 : 0,
      pctNegacion: a.total > 0 ? Math.round((a.negadas / a.total) * 1000) / 10 : 0,
      pctAplazamiento: a.total > 0 ? Math.round((a.aplazadas / a.total) * 1000) / 10 : 0,
      motivosNegacion: a.motivosNegacion,
      motivosAplazamiento: a.motivosAplazamiento,
      motivoPrincipal: _motivoPrincipalCombinado(a.motivosNegacion, a.motivosAplazamiento),
      tiempoPromedio: a.countTiempo > 0 ? Math.round((a.sumaTiempo / a.countTiempo) * 10) / 10 : 0,
      tiempoPromedioGeneral: a.countTiempoResolucion > 0 ? Number((a.sumaTiempoResolucion / a.countTiempoResolucion).toFixed(2)) : 0,
      promedioPorHora: ritmoEfec,
      prodRealPorHora: prodReal,
      detalleHoras: (function() {
        var detalle = {};
        for (var hh = 6; hh <= 21; hh++) {
          detalle[hh] = a.horasSlot[hh] || 0;
        }
        return detalle;
      })(),
      fueraSLA: a.fueraSLA
    };
  }).sort(function(a, b) { return b.total - a.total; });
}

/**
 * _agente_leerDatosRango refactorizado — usa la Capa_de_Datos y pipeline.
 * Lee datos de gestiones para un rango de fechas, incluyendo backlog, registros
 * detallados, analistas activos y cupos. Retorna datos estructurados para el
 * agente coordinador.
 *
 * @param {string} fechaDesdeStr - dd/MM/yyyy
 * @param {string} fechaHastaStr - dd/MM/yyyy
 * @returns {object|null} Datos estructurados para el agente o null si fechas inválidas
 */
function _agente_leerDatosRango(fechaDesdeStr, fechaHastaStr) {
  var desde = parsearFecha(fechaDesdeStr);
  var hasta = parsearFecha(fechaHastaStr);
  if (!desde || !hasta) return null;

  var hastaFin = new Date(hasta.getTime());
  hastaFin.setHours(23, 59, 59, 999);

  // Obtener datos desde Capa_de_Datos (memoizados)
  var dataHistorico = obtenerHistoricoGestiones();
  var dataReestudios = obtenerHojaReestudios();
  var scoreMap = cargarDiccionarioScore();

  // Resolver columnas de motivos por nombre de header
  var colsMotivo = _mapaColumnasPorNombre(dataHistorico, ["Motivo de negación", "Motivo de aplazamiento"]);
  var idxMotivoNeg = colsMotivo["Motivo de negación"];
  var idxMotivoApl = colsMotivo["Motivo de aplazamiento"];

  var registros = [];
  var backlogDetalle = [];
  var ahora = new Date();

  // Procesar Historico_Gestiones
  for (var i = 1; i < dataHistorico.length; i++) {
    var fila = dataHistorico[i];
    var fechaFinAgent = String(fila[COL_HISTORICO.FECHA_FIN] || "").trim();
    var fechaGestionStr = fechaFinAgent ? fechaFinAgent.split(" ")[0] : "";
    var fechaAsig = String(fila[COL_HISTORICO.FECHA_ASIGNACION] || "").trim();

    // Backlog: asignada pero sin fecha_fin
    if (fechaAsig !== "" && fechaFinAgent === "") {
      var dtAsig = parsearFecha(fechaAsig);
      var minEspera = dtAsig ? Math.max(0, Math.round((ahora - dtAsig) / 60000)) : 0;
      var polB = String(fila[COL_HISTORICO.POLIZA] || "").trim();
      var infoB = obtenerSegmentoInmobiliaria(polB, scoreMap);
      backlogDetalle.push({
        solicitud: String(fila[COL_HISTORICO.SOLICITUD] || "").trim(),
        analista: String(fila[COL_HISTORICO.NOMBRE_ANALISTA] || "Sin nombre").trim(),
        minutosEspera: minEspera,
        alertaSLA: minEspera > 30 ? "rojo" : minEspera >= 15 ? "amarillo" : "verde",
        tipo: "Digital"
      });
    }

    if (!fechaGestionStr) continue;
    var fechaGestion = parsearFecha(fechaGestionStr);
    if (!fechaGestion || !fechaEnRango(fechaGestion, desde, hastaFin)) continue;

    var estado = String(fila[COL_HISTORICO.ESTADO_GENERAL] || "").toUpperCase().trim();
    var nombre = String(fila[COL_HISTORICO.NOMBRE_ANALISTA] || "Sin nombre").trim();
    var correo = String(fila[COL_HISTORICO.CORREO_ANALISTA] || "").toLowerCase().trim();
    var tGestionRaw = parsearTiempoMinutos(String(fila[COL_HISTORICO.MINUTOS_GESTION] || ""));
    var tResolucionRaw = parsearTiempoMinutos(String(fila[COL_HISTORICO.MINUTOS_GENERAL] || ""));
    var tColaRaw = parsearTiempoMinutos(String(fila[COL_HISTORICO.MINUTOS_COLA] || ""));
    var poliza = String(fila[COL_HISTORICO.POLIZA] || "").trim();
    var sucursal = obtenerSucursalPorPoliza(poliza);

    var estadoLabel = (estado.includes("APROB") && !estado.includes("PENDIENTE")) ? "APROBADO" :
                     (estado.includes("NEGAD") || estado.includes("RECHAZ")) ? "RECHAZADO" :
                     estado.includes("APLAZ") ? "APLAZADO" : "OTRO";

    registros.push({
      solicitud: String(fila[COL_HISTORICO.SOLICITUD] || "").trim(),
      fecha: fechaGestionStr,
      analista: nombre,
      correo: correo,
      estado: estadoLabel,
      sucursal: sucursal,
      motivoNegacion: (estadoLabel === "RECHAZADO" && idxMotivoNeg >= 0) ? String(fila[idxMotivoNeg] || "").trim() : "",
      motivoAplazamiento: (estadoLabel === "APLAZADO" && idxMotivoApl >= 0) ? String(fila[idxMotivoApl] || "").trim() : "",
      tGestion: !isNaN(tGestionRaw) && tGestionRaw >= 0 ? tGestionRaw : null,
      tResolucion: !isNaN(tResolucionRaw) ? tResolucionRaw / 60 : null,
      tCola: !isNaN(tColaRaw) && tColaRaw >= 0 ? tColaRaw : null,
      tieneId: String(fila[COL_HISTORICO.SOLICITUD] || "").trim() !== "",
      tieneEstado: estado !== "",
      tieneAnalista: nombre !== "Sin nombre" && nombre !== "",
      tieneFecha: fechaGestionStr !== ""
    });
  }

  // Procesar Reestudios
  if (dataReestudios.length > 1) {
    for (var j = 0; j < dataReestudios.length; j++) {
      // Skip header row (index 0 of data array includes headers for reestudios)
      if (j === 0) continue;
      var filaR = dataReestudios[j];
      var fAsig = String(filaR[COL_REESTUDIOS.FECHA_ASIGNACION] || "").trim();
      var fFin = String(filaR[COL_REESTUDIOS.FECHA_FIN] || "").trim();

      // Backlog reestudios
      if (fAsig !== "" && fFin === "") {
        var dtAsigR = parsearFecha(fAsig);
        var minEsperaR = dtAsigR ? Math.max(0, Math.round((ahora - dtAsigR) / 60000)) : 0;
        backlogDetalle.push({
          solicitud: String(filaR[COL_REESTUDIOS.SOLICITUD] || "").trim(),
          analista: String(filaR[COL_REESTUDIOS.NOMBRE_ANALISTA] || "Sin nombre").trim(),
          minutosEspera: minEsperaR,
          alertaSLA: minEsperaR > 30 ? "rojo" : minEsperaR >= 15 ? "amarillo" : "verde",
          tipo: "Reestudio"
        });
      }

      if (!fFin) continue;
      var fechaParte = fFin.split(" ")[0];
      var fechaR = parsearFecha(fechaParte);
      if (!fechaR || !fechaEnRango(fechaR, desde, hastaFin)) continue;

      var estadoR = String(filaR[COL_REESTUDIOS.ESTADO_GENERAL] || "").toUpperCase().trim();
      var nombreR = String(filaR[COL_REESTUDIOS.NOMBRE_ANALISTA] || "Sin nombre").trim();
      var correoR = String(filaR[COL_REESTUDIOS.CORREO_ANALISTA] || "").toLowerCase().trim();
      var tGestionR = parsearTiempoMinutos(String(filaR[COL_REESTUDIOS.MINUTOS_GESTION] || ""));
      var tResolucionR = parsearTiempoMinutos(String(filaR[COL_REESTUDIOS.MINUTOS_GENERAL] || ""));
      var tColaR = parsearTiempoMinutos(String(filaR[COL_REESTUDIOS.MINUTOS_COLA] || ""));
      var polizaR = String(filaR[COL_REESTUDIOS.POLIZA] || filaR[COL_REESTUDIOS.POLIZA_ALT] || "").trim();
      var sucursalR = obtenerSucursalPorPoliza(polizaR);

      var estadoLabelR = (estadoR.includes("APROB") && !estadoR.includes("PENDIENTE")) ? "APROBADO" :
                        (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) ? "RECHAZADO" :
                        estadoR.includes("APLAZ") ? "APLAZADO" : "OTRO";

      registros.push({
        solicitud: String(filaR[COL_REESTUDIOS.SOLICITUD] || "").trim(),
        fecha: fechaParte,
        analista: nombreR,
        correo: correoR,
        estado: estadoLabelR,
        sucursal: sucursalR,
        tGestion: !isNaN(tGestionR) && tGestionR >= 0 ? tGestionR : null,
        tResolucion: !isNaN(tResolucionR) ? tResolucionR / 60 : null,
        tCola: !isNaN(tColaR) && tColaR >= 0 ? tColaR : null,
        tieneId: String(filaR[COL_REESTUDIOS.SOLICITUD] || "").trim() !== "",
        tieneEstado: estadoR !== "",
        tieneAnalista: nombreR !== "Sin nombre" && nombreR !== "",
        tieneFecha: fechaParte !== ""
      });
    }
  }

  // Todos los analistas + equipo (desde Capa_de_Datos)
  var analistasActivos = [];
  var todosAnalistas = [];
  var equipoPorCorreo = {};
  try {
    var dataUser = obtenerHojaUsuarios();
    if (dataUser && dataUser.length > 1) {
      for (var u = 1; u < dataUser.length; u++) {
        var estUser = String(dataUser[u][COL_USUARIOS.ESTADO] || "").toUpperCase().trim();
        var correoUser = String(dataUser[u][COL_USUARIOS.CORREO] || "").toLowerCase().trim();
        var equipoUser = String(dataUser[u][COL_USUARIOS.ESPECIALIDAD] || "").trim();
        var nombreUser = String(dataUser[u][COL_USUARIOS.NOMBRE] || "").trim();
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
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hojaCupos = ss.getSheetByName("historico_cupos");
    if (hojaCupos) {
      var dataCupos = hojaCupos.getDataRange().getDisplayValues();
      for (var c = 1; c < dataCupos.length; c++) {
        var fechaCupo = String(dataCupos[c][0] || "").trim().split(" ")[0];
        var fechaCupoP = parsearFecha(fechaCupo);
        if (!fechaCupoP || !fechaEnRango(fechaCupoP, desde, hastaFin)) continue;

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
