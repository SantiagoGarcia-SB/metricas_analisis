/**
 * 04_Biometria.js — Módulo de Biometría
 *
 * Funciones de biometría para el dashboard. Usa Capa_de_Datos (01_Datos.js)
 * para obtener los datos de pendiente_biometria, solicitud y Historico_Gestiones,
 * eliminando lecturas directas redundantes a SpreadsheetApp.
 *
 * Dependencias (scope global):
 *   - 00_Config.js: COL_BIOMETRIA, COL_SOLICITUD, COL_HISTORICO, COL_ORIGEN,
 *                   TARGET_SOLICITUDES_SS_ID, SHEET_NAME_SOLICITUDES, ID_HOJA_BIOMETRIA
 *   - 01_Datos.js:  obtenerHojaBiometria(), obtenerHojaSolicitud(),
 *                   obtenerHistoricoGestiones(), obtenerHojaOrigen(),
 *                   cargarDiccionarioScore()
 *   - 02_Utilidades.js: normalizarFechaISO(), parsearFecha(), obtenerSegmentoInmobiliaria()
 *
 * Todas las funciones mantienen sus firmas y estructuras de retorno originales
 * para compatibilidad con JSClient.html (google.script.run).
 */

// ============================================================================
// HELPERS INTERNOS
// ============================================================================

/**
 * Construye el mapa de columnas dinámico a partir de los headers de la hoja
 * de biometría. Los campos como fecha_consulta_sai, fecha_envio_brodcast, etc.
 * se resuelven por nombre de header porque pueden cambiar de posición.
 *
 * @param {string[]} headers - Fila de encabezados
 * @returns {Object} Mapa {headerNormalizado: índice}
 * @private
 */
function _construirColMapBiometria(headers) {
  var colMap = {};
  for (var h = 0; h < headers.length; h++) {
    var hNorm = String(headers[h] || "").toLowerCase().replace(/\s+/g, '_').trim();
    colMap[hNorm] = h;
    // También registrar sin trailing/leading underscores
    var hClean = hNorm.replace(/^_+|_+$/g, '');
    if (hClean !== hNorm) colMap[hClean] = h;
  }
  return colMap;
}

/**
 * Extrae la parte de fecha de un string raw (antes del espacio si hay hora)
 * y la convierte a formato ISO yyyy-MM-dd usando normalizarFechaISO.
 *
 * @param {string} raw - Valor raw de la celda (ej. "15/03/2024 10:30:00")
 * @returns {string} Fecha ISO yyyy-MM-dd o cadena vacía
 * @private
 */
function _fechaParteISO(raw) {
  if (!raw) return "";
  var parte = String(raw).trim().split(" ")[0];
  if (!parte) return "";
  // Si ya tiene formato yyyy-MM-dd, retornar directamente
  if (parte.indexOf('-') > -1 && parte.split('-')[0].length === 4) {
    return parte;
  }
  // normalizarFechaISO espera dd/MM/yyyy
  var iso = normalizarFechaISO(parte);
  return iso || "";
}

/**
 * Compara una fecha normalizada (sin guiones, YYYYMMDD) contra un rango.
 *
 * @param {string} norm - Fecha en formato YYYYMMDD (sin guiones)
 * @param {string} filtroDesde - Límite inferior YYYYMMDD (vacío = sin límite)
 * @param {string} filtroHasta - Límite superior YYYYMMDD (vacío = sin límite)
 * @returns {boolean}
 * @private
 */
function _enRangoBio(norm, filtroDesde, filtroHasta) {
  if (!filtroDesde && !filtroHasta) return true;
  if (!norm) return false;
  if (filtroDesde && norm < filtroDesde) return false;
  if (filtroHasta && norm > filtroHasta) return false;
  return true;
}

/**
 * Determina si el estado de broadcast indica envío exitoso.
 *
 * @param {string} estadoBrod - Estado broadcast normalizado a mayúsculas
 * @returns {boolean}
 * @private
 */
function _fueEnviadoBio(estadoBrod) {
  return estadoBrod === "ENVIADO" || estadoBrod === "SI" || estadoBrod === "OK" || estadoBrod === "TRUE" || estadoBrod === "1";
}

/**
 * Retorna un objeto de gestión vacío con la estructura esperada por el cliente.
 * @returns {Object}
 * @private
 */
function _gestionVacia() {
  return {
    total: 0, okLlamada: 0, noContesto: 0, aprobadas: 0, negadas: 0,
    aplazadas: 0, aprobadasConLlamada: 0, motivos: {}, tendencia: [],
    tasaContacto: 0, tasaConversionLlamada: 0
  };
}

/**
 * Motor común del panel "Resultados de Gestión": agrega Historico_Gestiones
 * filtrado por tipoAsignado=DESAPLAZAMIENTO.
 * `incluirFila(fila, fechaDia)` decide qué filas cuentan.
 *
 * @param {string[][]} dataH - Datos de Historico_Gestiones (con headers)
 * @param {function} incluirFila - Función filtro (fila, fechaDiaISO) → boolean
 * @returns {Object} Objeto de gestión con KPIs y tendencia
 * @private
 */
function _agregarGestionBiometria(dataH, incluirFila) {
  var gestion = _gestionVacia();
  var gesTendMap = {};

  for (var g = 1; g < dataH.length; g++) {
    var tipoAsignadoH = String(dataH[g][COL_HISTORICO.TIPO_ASIGNADO] || "").toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
      return { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U" }[c] || c;
    }).trim();
    if (tipoAsignadoH !== "DESAPLAZAMIENTO") continue;

    var fechaFinH = String(dataH[g][COL_HISTORICO.FECHA_FIN] || "").trim();
    if (!fechaFinH) continue;

    var fechaFinParte = fechaFinH.split(" ")[0];
    var fechaDia = normalizarFechaISO(fechaFinParte);
    if (!fechaDia) continue;

    if (!incluirFila(dataH[g], fechaDia)) continue;

    gestion.total++;

    if (!gesTendMap[fechaDia]) gesTendMap[fechaDia] = { okLlamada: 0, noContesto: 0, aprobadas: 0, negadas: 0, aplazadas: 0 };

    // Columna 38 es resultado de llamada (no está en COL_HISTORICO por ser específica de biometría)
    var resLlamada = String(dataH[g][38] || "").toUpperCase().trim();
    if (resLlamada === "OK LLAMADA") { gestion.okLlamada++; gesTendMap[fechaDia].okLlamada++; }
    else if (resLlamada === "NO CONTESTO") { gestion.noContesto++; gesTendMap[fechaDia].noContesto++; }

    var resFinal = String(dataH[g][COL_HISTORICO.ESTADO_GENERAL] || "").toUpperCase().trim();
    if (resLlamada === "OK LLAMADA" && resFinal === "APROBADO") gestion.aprobadasConLlamada++;
    if (resFinal === "APROBADO") { gestion.aprobadas++; gesTendMap[fechaDia].aprobadas++; }
    else if (resFinal === "RECHAZADO") { gestion.negadas++; gesTendMap[fechaDia].negadas++; }
    else if (resFinal === "APLAZADO") {
      gestion.aplazadas++; gesTendMap[fechaDia].aplazadas++;
      var motivo = String(dataH[g][COL_HISTORICO.MOTIVO_APLAZAMIENTO] || "").trim();
      if (motivo) gestion.motivos[motivo] = (gestion.motivos[motivo] || 0) + 1;
    }
  }

  gestion.tendencia = Object.keys(gesTendMap).sort().map(function(f) {
    var d = gesTendMap[f];
    return { fecha: f, okLlamada: d.okLlamada, noContesto: d.noContesto, aprobadas: d.aprobadas, negadas: d.negadas, aplazadas: d.aplazadas };
  });

  gestion.tasaContacto = gestion.total > 0 ? Math.round((gestion.okLlamada / gestion.total) * 1000) / 10 : 0;
  gestion.tasaConversionLlamada = gestion.okLlamada > 0 ? Math.round((gestion.aprobadasConLlamada / gestion.okLlamada) * 1000) / 10 : 0;

  return gestion;
}

/**
 * Cuenta solicitudes con estado APROBADO_PENDIENTE_BIOMETRIA en la hoja solicitud.
 * Reemplaza la llamada a obtenerColaAsignacion().desplazamiento dentro de obtenerDatosBiometria.
 *
 * @param {string[][]} dataSolicitud - Datos de la hoja solicitud (desde Capa_de_Datos)
 * @returns {number} Conteo de desplazamiento
 * @private
 */
function _contarDesplazamientoDesdeHojaSolicitud(dataSolicitud) {
  var desplazamiento = 0;
  for (var i = 1; i < dataSolicitud.length; i++) {
    var estadoGen = String(dataSolicitud[i][COL_SOLICITUD.ESTADO_GENERAL] || "").toUpperCase().replace(/\s+/g, '_').trim();
    if (estadoGen.indexOf("APROBADO_PENDIENTE_BIOMETRIA") !== -1) {
      desplazamiento++;
    }
  }
  return desplazamiento;
}

// ============================================================================
// FUNCIONES PÚBLICAS — Firmas originales mantenidas
// ============================================================================

/**
 * Cola de asignación. Usa datos de solicitud y ORIGEN desde Capa_de_Datos.
 * Retorna el desglose de solicitudes pendientes por tipo.
 *
 * @returns {{total: number, desplazamiento: number, induccion: number, digital: number, biometriaFallida: number, nuevaUar: number, deudorUar: number, reestudio: number}}
 */
function obtenerColaAsignacion() {
  var desplazamiento = 0, induccion = 0, digital = 0;
  var reestudio = 0, nuevaUar = 0, deudorUar = 0, biometriaFallida = 0;

  try {
    var dataSol = obtenerHojaSolicitud();
    for (var i = 1; i < dataSol.length; i++) {
      var estadoGen = String(dataSol[i][COL_SOLICITUD.ESTADO_GENERAL] || "").toUpperCase().replace(/\s+/g, '_').trim();
      var clase = String(dataSol[i][COL_SOLICITUD.CLASE] || "").toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
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
  } catch (e) {
    Logger.log("Aviso: Error leyendo hoja solicitud: " + e.message);
  }

  try {
    var dataO = obtenerHojaOrigen();
    for (var j = 1; j < dataO.length; j++) {
      var analistaAsig = String(dataO[j][COL_ORIGEN.CORREO_ANALISTA] || "").trim();
      var fechaFinG = String(dataO[j][COL_ORIGEN.FECHA_FIN] || "").trim();
      if (analistaAsig !== "" || fechaFinG !== "") continue;

      var origen = String(dataO[j][COL_ORIGEN.ORIGEN] || "").toUpperCase().trim();
      var tipoP = String(dataO[j][COL_ORIGEN.TIPO_PROCESO] || "").toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
        return { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U" }[c] || c;
      }).trim();

      if (tipoP.indexOf("BIOMETRIA FALLIDA") !== -1) biometriaFallida++;
      else if (origen === "CORREO" && tipoP === "NUEVA") nuevaUar++;
      else if (origen === "CORREO" && tipoP === "ADICIONAL") deudorUar++;
      else if (tipoP === "REESTUDIO") reestudio++;
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

/**
 * Datos de biometría para el dashboard.
 * Usa Capa_de_Datos para pendiente_biometria, solicitud y Historico_Gestiones.
 *
 * @param {string} fechaDesde - Fecha inicio en formato yyyy-MM-dd (desde input type="date")
 * @param {string} fechaHasta - Fecha fin en formato yyyy-MM-dd
 * @returns {Object} Métricas completas de biometría
 */
function obtenerDatosBiometria(fechaDesde, fechaHasta) {
  var vacio = {
    totalConsultadas: 0, totalEnviados: 0, totalNoEnviados: 0, totalProcesadas: 0,
    totalSinIniciar: 0, faltanRevisar: 0, esperandoCorte: 0, totalEnEspera: 0,
    totalEscaladas: 0, totalAsignadas: 0, totalResueltasEnCola: 0, totalArchivadas: 0,
    totalEnColaPendiente: 0, tasaEfectividadCola: 0, colaActual: 0, totalResueltas: 0,
    resueltasConWA: 0, resueltasSinWA: 0, enviadasYResueltas: 0, enviadasYEscaladas: 0,
    cohorteResueltasSinWA: 0, cohorteEnviadas: 0, cohorteEnEspera: 0,
    cohorteResueltasConWA: 0, cohorteEscaladas: 0, cohorteAsignadas: 0,
    cohorteResueltasEnCola: 0, cohorteArchivadas: 0,
    tasaEnvio: 0, tasaConversion: 0, tendencia: [],
    gestion: _gestionVacia()
  };

  // Cola de asignación en vivo: conteo de desplazamiento directo desde hoja solicitud
  // (Capa_de_Datos), sin invocar obtenerColaAsignacion() que haría lectura redundante.
  var colaActual = 0;
  try {
    var dataSolicitud = obtenerHojaSolicitud();
    if (dataSolicitud.length > 1) {
      colaActual = _contarDesplazamientoDesdeHojaSolicitud(dataSolicitud);
    }
  } catch (e) {
    Logger.log("Aviso: No se pudo obtener cola de asignación para biometría: " + e.message);
  }
  vacio.colaActual = colaActual;

  try {
    var data = obtenerHojaBiometria();
    if (!data || data.length < 2) return vacio;

    var filtroDesde = fechaDesde ? fechaDesde.replace(/-/g, '') : '';
    var filtroHasta = fechaHasta ? fechaHasta.replace(/-/g, '') : '';

    var headers = data[0];
    var colMap = _construirColMapBiometria(headers);

    var cFC = colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] : -1;
    var cFE = colMap[COL_BIOMETRIA.HEADER_FECHA_ENVIO_BROADCAST] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_ENVIO_BROADCAST] : -1;
    var cFA = colMap[COL_BIOMETRIA.HEADER_FECHA_ACTUALIZACION_FASE] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_ACTUALIZACION_FASE] : -1;
    var cEB = colMap[COL_BIOMETRIA.HEADER_ESTADO_BROADCAST] != null ? colMap[COL_BIOMETRIA.HEADER_ESTADO_BROADCAST] : -1;
    var cFS = colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] != null ? colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] : -1;

    var totalConsultadas = 0, totalEnviados = 0, totalNoEnviados = 0;
    var totalSinIniciar = 0, totalEnEspera = 0, totalEscaladas = 0;
    var totalAsignadas = 0, totalResueltasEnCola = 0, totalArchivadas = 0, totalEnColaPendiente = 0;
    var resueltasConWA = 0, resueltasSinWA = 0;
    var enviadasYResueltas = 0;
    var enviadasYEscaladas = 0;

    var cohorteResueltasSinWA = 0;
    var cohorteEnviadas = 0;
    var cohorteEnEspera = 0;
    var cohorteResueltasConWA = 0;
    var cohorteEscaladas = 0;
    var cohorteAsignadas = 0;
    var cohorteResueltasEnCola = 0;
    var cohorteArchivadas = 0;

    var liveFaltanRevisar = 0;
    var liveEsperandoCorte = 0;

    var tendenciaMap = {};

    function _bucket(dayKey, campo) {
      if (!dayKey) return;
      if (!tendenciaMap[dayKey]) tendenciaMap[dayKey] = { consultadas: 0, enviados: 0, resueltasConWA: 0, resueltasSinWA: 0, escaladas: 0, asignadas: 0, resueltasEnCola: 0, archivadas: 0, enEspera: 0, sinIniciar: 0, enviadasYResueltas: 0 };
      tendenciaMap[dayKey][campo]++;
    }

    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_BIOMETRIA.SOLICITUD] || "").trim();
      if (!solicitud) continue;

      var consultaParte = cFC >= 0 ? _fechaParteISO(String(data[i][cFC] || "").trim()) : "";
      var envioParte = cFE >= 0 ? _fechaParteISO(String(data[i][cFE] || "").trim()) : "";
      var faseParte = cFA >= 0 ? _fechaParteISO(String(data[i][cFA] || "").trim()) : "";
      var estadoBrod = cEB >= 0 ? String(data[i][cEB] || "").toUpperCase().trim() : "";
      var fase = cFS >= 0 ? String(data[i][cFS] || "").toUpperCase().trim() : "";
      var fueEnviado = _fueEnviadoBio(estadoBrod);

      // Conteos en vivo (sin filtro de fecha)
      if (fase === "") liveFaltanRevisar++;
      else if (fase === "WA_ENVIADO") liveEsperandoCorte++;

      // --- Métricas por fecha de consulta (cohorte) ---
      var consultaNorm = consultaParte.replace(/-/g, '');
      if (_enRangoBio(consultaNorm, filtroDesde, filtroHasta)) {
        totalConsultadas++;
        _bucket(consultaParte, 'consultadas');
        if (fase === "") { totalSinIniciar++; _bucket(consultaParte, 'sinIniciar'); }
        else if (fase === "RESUELTA" && !fueEnviado) { cohorteResueltasSinWA++; }
        else {
          cohorteEnviadas++;
          if (fase === "WA_ENVIADO") cohorteEnEspera++;
          else if (fase === "RESUELTA") cohorteResueltasConWA++;
          else if (fase === "ESCALADA") cohorteEscaladas++;
          else if (fase === "ASIGNADA") { cohorteEscaladas++; cohorteAsignadas++; }
          else if (fase === "RESUELTA_EN_COLA") { cohorteEscaladas++; cohorteResueltasEnCola++; }
          else if (fase === "ARCHIVADA") { cohorteEscaladas++; cohorteArchivadas++; }
        }
      }

      // --- Métricas por fecha de envío ---
      var envioNorm = envioParte.replace(/-/g, '');
      if (_enRangoBio(envioNorm, filtroDesde, filtroHasta)) {
        if (fueEnviado) {
          totalEnviados++; _bucket(envioParte, 'enviados');
          if (fase === "RESUELTA") { enviadasYResueltas++; _bucket(envioParte, 'enviadasYResueltas'); }
          else if (fase === "ESCALADA" || fase === "ASIGNADA" || fase === "RESUELTA_EN_COLA" || fase === "ARCHIVADA") { enviadasYEscaladas++; }
        }
        else totalNoEnviados++;
      }

      // --- Métricas por fecha de actualización de fase ---
      var faseNorm = faseParte.replace(/-/g, '');
      if (_enRangoBio(faseNorm, filtroDesde, filtroHasta)) {
        if (fase === "WA_ENVIADO") { totalEnEspera++; _bucket(faseParte, 'enEspera'); }
        else if (fase === "ESCALADA") { totalEscaladas++; totalEnColaPendiente++; _bucket(faseParte, 'escaladas'); }
        else if (fase === "ASIGNADA") { totalEscaladas++; totalAsignadas++; _bucket(faseParte, 'escaladas'); _bucket(faseParte, 'asignadas'); }
        else if (fase === "RESUELTA_EN_COLA") { totalEscaladas++; totalResueltasEnCola++; _bucket(faseParte, 'escaladas'); _bucket(faseParte, 'resueltasEnCola'); }
        else if (fase === "ARCHIVADA") { totalEscaladas++; totalArchivadas++; _bucket(faseParte, 'escaladas'); _bucket(faseParte, 'archivadas'); }
        else if (fase === "RESUELTA") {
          if (fueEnviado) { resueltasConWA++; _bucket(faseParte, 'resueltasConWA'); }
          else { resueltasSinWA++; _bucket(faseParte, 'resueltasSinWA'); }
        }
      }
    }

    var tendenciaArr = Object.keys(tendenciaMap).sort().map(function(f) {
      var td = tendenciaMap[f];
      return {
        fecha: f, consultadas: td.consultadas, enviados: td.enviados,
        resueltasConWA: td.resueltasConWA, resueltasSinWA: td.resueltasSinWA,
        escaladas: td.escaladas, asignadas: td.asignadas,
        resueltasEnCola: td.resueltasEnCola, archivadas: td.archivadas,
        enEspera: td.enEspera, sinIniciar: td.sinIniciar,
        enviadasYResueltas: td.enviadasYResueltas
      };
    });

    var totalProcesadas = totalConsultadas - totalSinIniciar;
    var totalResueltas = resueltasConWA + resueltasSinWA;

    // --- Resultados de gestión desde Historico_Gestiones (tipoAsignado=DESAPLAZAMIENTO) ---
    var gestion = _gestionVacia();
    try {
      var dataH = obtenerHistoricoGestiones();
      if (dataH && dataH.length > 1) {
        gestion = _agregarGestionBiometria(dataH, function(fila, fechaDia) {
          if (!filtroDesde && !filtroHasta) return true;
          var fechaFinNorm = fechaDia.replace(/-/g, '');
          if (filtroDesde && fechaFinNorm < filtroDesde) return false;
          if (filtroHasta && fechaFinNorm > filtroHasta) return false;
          return true;
        });
      }
    } catch (e) {
      Logger.log("Aviso: Error leyendo gestión biometría: " + e.message);
    }

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
      totalAsignadas: totalAsignadas,
      totalResueltasEnCola: totalResueltasEnCola,
      totalArchivadas: totalArchivadas,
      totalEnColaPendiente: totalEnColaPendiente,
      tasaEfectividadCola: (totalAsignadas + totalResueltasEnCola + totalArchivadas) > 0 ? Math.round((totalAsignadas / (totalAsignadas + totalResueltasEnCola + totalArchivadas)) * 1000) / 10 : 0,
      colaActual: colaActual,
      totalResueltas: totalResueltas,
      resueltasConWA: resueltasConWA,
      resueltasSinWA: resueltasSinWA,
      enviadasYResueltas: enviadasYResueltas,
      enviadasYEscaladas: enviadasYEscaladas,
      cohorteResueltasSinWA: cohorteResueltasSinWA,
      cohorteEnviadas: cohorteEnviadas,
      cohorteEnEspera: cohorteEnEspera,
      cohorteResueltasConWA: cohorteResueltasConWA,
      cohorteEscaladas: cohorteEscaladas,
      cohorteAsignadas: cohorteAsignadas,
      cohorteResueltasEnCola: cohorteResueltasEnCola,
      cohorteArchivadas: cohorteArchivadas,
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

/**
 * Búsqueda unificada por número de Solicitud / Póliza en las 3 hojas del ciclo de biometría.
 *
 * @param {string} query - Texto de búsqueda (solicitud o póliza)
 * @returns {{broadcast: Array, cola: Array, gestion: Array}}
 */
function buscarBiometriaSolicitud(query) {
  var q = String(query || "").trim().toLowerCase();
  if (!q) return { broadcast: [], cola: [], gestion: [] };
  return {
    broadcast: _buscarBioBroadcast(q),
    cola: _buscarBioCola(q),
    gestion: _buscarBioGestion(q)
  };
}

/**
 * Busca en pendiente_biometria por solicitud o póliza.
 *
 * @param {string} q - Query normalizada a minúsculas
 * @returns {Array} Resultados de broadcast (máx 50)
 * @private
 */
function _buscarBioBroadcast(q) {
  try {
    var data = obtenerHojaBiometria();
    if (!data || data.length < 2) return [];

    var headers = data[0];
    var colMap = _construirColMapBiometria(headers);

    var cFC = colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] : -1;
    var cFE = colMap[COL_BIOMETRIA.HEADER_FECHA_ENVIO_BROADCAST] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_ENVIO_BROADCAST] : -1;
    var cFA = colMap[COL_BIOMETRIA.HEADER_FECHA_ACTUALIZACION_FASE] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_ACTUALIZACION_FASE] : -1;
    var cEB = colMap[COL_BIOMETRIA.HEADER_ESTADO_BROADCAST] != null ? colMap[COL_BIOMETRIA.HEADER_ESTADO_BROADCAST] : -1;
    var cNE = colMap[COL_BIOMETRIA.HEADER_NUEVO_ESTADO_SAI] != null ? colMap[COL_BIOMETRIA.HEADER_NUEVO_ESTADO_SAI] : -1;
    var cFS = colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] != null ? colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] : -1;

    var resultados = [];
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_BIOMETRIA.SOLICITUD] || "").trim();
      var poliza = String(data[i][COL_BIOMETRIA.POLIZA] || "").trim();
      var nombre = String(data[i][COL_BIOMETRIA.NOMBRE_INQUILINO] || "").trim();

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

      resultados.push({
        solicitud: solicitud, poliza: poliza, nombre: nombre,
        fechaConsulta: fechaConsulta, fechaEnvio: fechaEnvio,
        fechaActualizacionFase: fechaActualizacionFase,
        estadoBrodcast: estadoBrod, nuevoEstado: nuevoEstado,
        fase: fase, destinatarios: numDest
      });
      if (resultados.length >= 50) break;
    }

    return resultados;
  } catch (e) {
    Logger.log("Error en _buscarBioBroadcast: " + e.message);
    return [];
  }
}

/**
 * Busca en la hoja "solicitud" (cola de asignación) por solicitud o póliza.
 *
 * @param {string} q - Query normalizada a minúsculas
 * @returns {Array} Resultados de cola (máx 50)
 * @private
 */
function _buscarBioCola(q) {
  try {
    var data = obtenerHojaSolicitud();
    if (!data || data.length < 2) return [];

    var resultados = [];
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_SOLICITUD.SOLICITUD] || "").trim();
      var poliza = String(data[i][COL_SOLICITUD.POLIZA] || "").trim();
      if (!solicitud) continue;
      if (solicitud.toLowerCase().indexOf(q) === -1 && poliza.toLowerCase().indexOf(q) === -1) continue;

      var estadoGen = String(data[i][COL_SOLICITUD.ESTADO_GENERAL] || "").toUpperCase().replace(/\s+/g, '_').trim();
      if (estadoGen.indexOf("APROBADO_PENDIENTE_BIOMETRIA") === -1) continue;

      resultados.push({
        solicitud: solicitud,
        poliza: poliza,
        nombreInquilino: String(data[i][COL_SOLICITUD.NOMBRE_INQUILINO] || "").trim(),
        fechaConsulta: String(data[i][COL_SOLICITUD.FECHA_RADICACION] || "").trim(),
        fechaActualizacionFase: String(data[i][COL_SOLICITUD.FECHA_RESULTADO] || "").trim(),
        estadoGeneral: estadoGen
      });
      if (resultados.length >= 50) break;
    }
    return resultados;
  } catch (e) {
    Logger.log("Error en _buscarBioCola: " + e.message);
    return [];
  }
}

/**
 * Busca en Historico_Gestiones por solicitud o póliza (tipoAsignado=DESAPLAZAMIENTO).
 *
 * @param {string} q - Query normalizada a minúsculas
 * @returns {Array} Resultados de gestión (máx 50)
 * @private
 */
function _buscarBioGestion(q) {
  try {
    var data = obtenerHistoricoGestiones();
    if (!data || data.length < 2) return [];

    var resultados = [];
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_HISTORICO.SOLICITUD] || "").trim();
      var poliza = String(data[i][COL_HISTORICO.POLIZA] || "").trim();
      if (!solicitud) continue;
      if (solicitud.toLowerCase().indexOf(q) === -1 && poliza.toLowerCase().indexOf(q) === -1) continue;

      var tipoAsignado = String(data[i][COL_HISTORICO.TIPO_ASIGNADO] || "").toUpperCase().replace(/[ÁÉÍÓÚ]/g, function(c) {
        return { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U" }[c] || c;
      }).trim();
      if (tipoAsignado !== "DESAPLAZAMIENTO") continue;

      var minutosGestionRaw = String(data[i][COL_HISTORICO.MINUTOS_GESTION] || "").trim();
      var minutosGestionNum = parseFloat(minutosGestionRaw.replace(',', '.'));

      resultados.push({
        solicitud: solicitud,
        poliza: poliza,
        nombreInquilino: String(data[i][COL_HISTORICO.NOMBRE_INQUILINO] || "").trim(),
        fechaAsignacion: String(data[i][COL_HISTORICO.FECHA_ASIGNACION] || "").trim(),
        nombreAnalista: String(data[i][COL_HISTORICO.NOMBRE_ANALISTA] || "").trim(),
        minutosGestion: isNaN(minutosGestionNum) ? null : minutosGestionNum,
        estadoGeneral: String(data[i][COL_HISTORICO.ESTADO_GENERAL] || "").toUpperCase().trim()
      });
      if (resultados.length >= 50) break;
    }
    return resultados;
  } catch (e) {
    Logger.log("Error en _buscarBioGestion: " + e.message);
    return [];
  }
}

/**
 * Panel "Resultados de Gestión" filtrado por número de Solicitud / Póliza
 * en vez de por rango de fechas.
 *
 * @param {string} query - Solicitud o póliza a buscar
 * @returns {Object} Objeto de gestión con KPIs y tendencia
 */
function obtenerGestionBiometriaPorSolicitud(query) {
  var q = String(query || "").trim().toLowerCase();
  if (!q) return _gestionVacia();
  try {
    var data = obtenerHistoricoGestiones();
    if (!data || data.length < 2) return _gestionVacia();
    return _agregarGestionBiometria(data, function(fila) {
      var solicitud = String(fila[COL_HISTORICO.SOLICITUD] || "").trim().toLowerCase();
      var poliza = String(fila[COL_HISTORICO.POLIZA] || "").trim().toLowerCase();
      return solicitud.indexOf(q) !== -1 || poliza.indexOf(q) !== -1;
    });
  } catch (e) {
    Logger.log("Error en obtenerGestionBiometriaPorSolicitud: " + e.message);
    return _gestionVacia();
  }
}

/**
 * Drilldown de las tarjetas del tablero de biometría.
 * Reproduce el mismo criterio de conteo que obtenerDatosBiometria() para cada tipo.
 *
 * @param {string} tipo - Tipo de tarjeta clickeada
 * @param {string} fechaDesde - yyyy-MM-dd
 * @param {string} fechaHasta - yyyy-MM-dd
 * @returns {Array} Detalle de solicitudes (máx 200)
 */
function obtenerDetalleBiometriaPorTarjeta(tipo, fechaDesde, fechaHasta) {
  try {
    // Caso especial: cola de asignación (lee de hoja solicitud)
    if (tipo === "colaAsignacion") {
      var dataC = obtenerHojaSolicitud();
      var outC = [];
      if (dataC && dataC.length > 1) {
        for (var c = 1; c < dataC.length; c++) {
          var estadoGenC = String(dataC[c][COL_SOLICITUD.ESTADO_GENERAL] || "").toUpperCase().replace(/\s+/g, '_').trim();
          if (estadoGenC.indexOf("APROBADO_PENDIENTE_BIOMETRIA") === -1) continue;
          outC.push({
            solicitud: String(dataC[c][COL_SOLICITUD.SOLICITUD] || "").trim(),
            poliza: String(dataC[c][COL_SOLICITUD.POLIZA] || "").trim(),
            nombre: String(dataC[c][COL_SOLICITUD.NOMBRE_INQUILINO] || "").trim(),
            fechaConsulta: String(dataC[c][COL_SOLICITUD.FECHA_RADICACION] || "").trim(),
            fechaEnvio: "",
            fechaActualizacionFase: String(dataC[c][COL_SOLICITUD.FECHA_RESULTADO] || "").trim(),
            estadoBrodcast: "",
            fase: "ESCALADA",
            destinatarios: 0
          });
          if (outC.length >= 200) break;
        }
      }
      return outC;
    }

    // Todos los demás tipos leen de pendiente_biometria
    var data = obtenerHojaBiometria();
    if (!data || data.length < 2) return [];

    var filtroDesde = fechaDesde ? fechaDesde.replace(/-/g, '') : '';
    var filtroHasta = fechaHasta ? fechaHasta.replace(/-/g, '') : '';

    var headers = data[0];
    var colMap = _construirColMapBiometria(headers);
    var cFC = colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] : -1;
    var cFE = colMap[COL_BIOMETRIA.HEADER_FECHA_ENVIO_BROADCAST] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_ENVIO_BROADCAST] : -1;
    var cFA = colMap[COL_BIOMETRIA.HEADER_FECHA_ACTUALIZACION_FASE] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_ACTUALIZACION_FASE] : -1;
    var cEB = colMap[COL_BIOMETRIA.HEADER_ESTADO_BROADCAST] != null ? colMap[COL_BIOMETRIA.HEADER_ESTADO_BROADCAST] : -1;
    var cNE = colMap[COL_BIOMETRIA.HEADER_NUEVO_ESTADO_SAI] != null ? colMap[COL_BIOMETRIA.HEADER_NUEVO_ESTADO_SAI] : -1;
    var cFS = colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] != null ? colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] : -1;

    var resultados = [];
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_BIOMETRIA.SOLICITUD] || "").trim();
      if (!solicitud) continue;

      var consultaParte = cFC >= 0 ? _fechaParteISO(String(data[i][cFC] || "").trim()) : "";
      var envioParte = cFE >= 0 ? _fechaParteISO(String(data[i][cFE] || "").trim()) : "";
      var faseParte = cFA >= 0 ? _fechaParteISO(String(data[i][cFA] || "").trim()) : "";
      var estadoBrod = cEB >= 0 ? String(data[i][cEB] || "").toUpperCase().trim() : "";
      var fase = cFS >= 0 ? String(data[i][cFS] || "").toUpperCase().trim() : "";
      var fueEnviado = _fueEnviadoBio(estadoBrod);

      var incluir = false;
      if (tipo === "esperandoCorte") {
        incluir = (fase === "WA_ENVIADO");
      } else if (tipo === "cascadaSinIniciar") {
        incluir = _enRangoBio(consultaParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fase === "";
      } else if (tipo === "cascadaResueltasSinWA") {
        incluir = _enRangoBio(consultaParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fase === "RESUELTA" && !fueEnviado;
      } else if (tipo === "cascadaEnviadas") {
        incluir = _enRangoBio(consultaParte.replace(/-/g, ''), filtroDesde, filtroHasta) && !(fase === "") && !(fase === "RESUELTA" && !fueEnviado);
      } else if (tipo === "cicloConsultadas") {
        incluir = _enRangoBio(consultaParte.replace(/-/g, ''), filtroDesde, filtroHasta);
      } else if (tipo === "cicloResueltasSinWA") {
        incluir = _enRangoBio(faseParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fase === "RESUELTA" && !fueEnviado;
      } else if (tipo === "cicloEnviados") {
        incluir = _enRangoBio(envioParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fueEnviado;
      } else if (tipo === "cicloResueltasConWA") {
        incluir = _enRangoBio(faseParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fueEnviado && fase === "RESUELTA";
      } else if (tipo === "cicloEscaladas") {
        incluir = _enRangoBio(faseParte.replace(/-/g, ''), filtroDesde, filtroHasta) && (fase === "ESCALADA" || fase === "ASIGNADA" || fase === "RESUELTA_EN_COLA" || fase === "ARCHIVADA");
      } else if (tipo === "asignadas") {
        incluir = _enRangoBio(faseParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fase === "ASIGNADA";
      } else if (tipo === "enColaPendiente") {
        incluir = _enRangoBio(faseParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fase === "ESCALADA";
      } else if (tipo === "resueltasEnCola") {
        incluir = _enRangoBio(faseParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fase === "RESUELTA_EN_COLA";
      } else if (tipo === "archivadas") {
        incluir = _enRangoBio(faseParte.replace(/-/g, ''), filtroDesde, filtroHasta) && fase === "ARCHIVADA";
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
        poliza: String(data[i][COL_BIOMETRIA.POLIZA] || "").trim(),
        nombre: String(data[i][COL_BIOMETRIA.NOMBRE_INQUILINO] || "").trim(),
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

/**
 * Top 10 pólizas con más casos pendientes de biometría.
 * "Pendiente" = fase vacía, WA_ENVIADO o ESCALADA (no terminal).
 *
 * @returns {Array<{poliza: string, inmobiliaria: string, count: number}>}
 */
function obtenerTopPolizasPendientesBiometria() {
  var scoreMap = cargarDiccionarioScore();
  try {
    var data = obtenerHojaBiometria();
    if (!data || data.length < 2) return [];

    var headers = data[0];
    var colMap = _construirColMapBiometria(headers);
    var cFS = colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] != null ? colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] : -1;

    var polizaCount = {};
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_BIOMETRIA.SOLICITUD] || "").trim();
      if (!solicitud) continue;
      var fase = cFS >= 0 ? String(data[i][cFS] || "").toUpperCase().trim() : "";
      // Solo contar casos pendientes (no terminales)
      if (fase !== "" && fase !== "WA_ENVIADO" && fase !== "ESCALADA") continue;
      var poliza = String(data[i][COL_BIOMETRIA.POLIZA] || "").trim();
      if (!poliza) continue;
      polizaCount[poliza] = (polizaCount[poliza] || 0) + 1;
    }

    // Ordenar y tomar top 10
    var ranking = Object.keys(polizaCount).map(function(p) {
      var info = obtenerSegmentoInmobiliaria(p, scoreMap);
      return { poliza: p, inmobiliaria: info.inmobiliaria, count: polizaCount[p] };
    });
    ranking.sort(function(a, b) { return b.count - a.count; });
    return ranking.slice(0, 10);
  } catch (e) {
    Logger.log("Error en obtenerTopPolizasPendientesBiometria: " + e.message);
    return [];
  }
}

/**
 * Dado un número de póliza, devuelve el detalle de solicitudes pendientes de biometría.
 *
 * @param {string} poliza - Número de póliza
 * @returns {Array<{solicitud: string, nombre: string}>} Máximo 200 filas
 */
function obtenerDetallePendientesPorPoliza(poliza) {
  var q = String(poliza || "").trim();
  if (!q) return [];
  try {
    var data = obtenerHojaBiometria();
    if (!data || data.length < 2) return [];

    var headers = data[0];
    var colMap = _construirColMapBiometria(headers);
    var cFS = colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] != null ? colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] : -1;

    var resultados = [];
    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_BIOMETRIA.SOLICITUD] || "").trim();
      if (!solicitud) continue;
      var polizaFila = String(data[i][COL_BIOMETRIA.POLIZA] || "").trim();
      if (polizaFila !== q) continue;
      var fase = cFS >= 0 ? String(data[i][cFS] || "").toUpperCase().trim() : "";
      if (fase !== "" && fase !== "WA_ENVIADO" && fase !== "ESCALADA") continue;
      resultados.push({
        solicitud: solicitud,
        nombre: String(data[i][COL_BIOMETRIA.NOMBRE_INQUILINO] || "").trim()
      });
      if (resultados.length >= 200) break;
    }
    return resultados;
  } catch (e) {
    Logger.log("Error en obtenerDetallePendientesPorPoliza: " + e.message);
    return [];
  }
}


// ============================================================================
// RECONSULTA SAI AL CIERRE DEL DÍA — Con continuación automática (GAS 6 min)
// ============================================================================

/**
 * Clave en PropertiesService para guardar el estado de continuación.
 * @private
 */
var _RECONSULTA_STATE_KEY = 'RECONSULTA_CIERRE_STATE';

/**
 * Tiempo máximo de ejecución seguro (5 min = 300s). Se detiene antes del
 * límite real de 6 min para tener margen de escritura y programar continuación.
 * @private
 */
var _MAX_RUNTIME_MS = 300000;

/**
 * Reconsulta el estado actual en SAI de cada solicitud en la hoja de biometría
 * y escribe el resultado en las columnas `estado_sai_cierre`
 * y `fecha_resultado_cierre` (lastResultDate de la API).
 *
 * Reconsulta TODAS las solicitudes del rango de fechas que tengan fase asignada,
 * para saber al final del día cuáles se aprobaron y cuáles siguen pendientes.
 *
 * Maneja el límite de 6 minutos de GAS automáticamente:
 * - Guarda progreso en PropertiesService.
 * - Se auto-programa un trigger de continuación si no termina.
 * - Se invoca sin parámetros en ejecuciones de continuación.
 *
 * @param {number} [diasAtras=0] - Cantidad de días hacia atrás para incluir casos.
 *   0 = solo los consultados hoy. Usar >0 para reconsultar pendientes de días previos.
 *   Solo se usa en la primera ejecución; las continuaciones leen el estado guardado.
 */
function reconsultarEstadoSAICierre(diasAtras) {
  var SLEEP_MS = 500;
  var BATCH_SIZE = 30;

  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('API_KEY');
  if (!apiKey) {
    Logger.log('reconsultarEstadoSAICierre: API_KEY no configurada.');
    return;
  }

  var ENDPOINT = 'https://2n7hb4m6v7.execute-api.us-east-1.amazonaws.com/prod/flujo/flujo/v1/study/rental';

  // --- Recuperar o inicializar estado de continuación ---
  var state = _cargarEstadoReconsulta(props);
  var startIndex = 0;

  if (state && state.enProgreso) {
    // Continuación: usar estado guardado
    startIndex = state.ultimoIndice + 1;
    diasAtras = state.diasAtras;
    Logger.log('reconsultarEstadoSAICierre: Continuando desde índice ' + startIndex + ' (diasAtras=' + diasAtras + ')');
  } else {
    // Primera ejecución
    var DIAS = (typeof diasAtras === 'number' && diasAtras >= 0) ? diasAtras : 0;
    diasAtras = DIAS;
    Logger.log('reconsultarEstadoSAICierre: Primera ejecución (diasAtras=' + diasAtras + ')');
  }

  // Abrir la hoja directamente (necesitamos escribir, no solo leer)
  var ss = SpreadsheetApp.openById(ID_HOJA_BIOMETRIA);
  var hoja = ss.getSheetByName('pendiente_biometria');
  if (!hoja) {
    Logger.log('reconsultarEstadoSAICierre: Hoja pendiente_biometria no encontrada.');
    _limpiarEstadoReconsulta(props);
    return;
  }

  var lastRow = hoja.getLastRow();
  if (lastRow < 2) {
    Logger.log('reconsultarEstadoSAICierre: Hoja vacía.');
    _limpiarEstadoReconsulta(props);
    return;
  }

  // --- Resolver columnas por header ---
  var headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  var colMap = {};
  for (var h = 0; h < headers.length; h++) {
    var hNorm = String(headers[h] || '').toLowerCase().replace(/\s+/g, '_').trim();
    colMap[hNorm] = h;
  }

  var cFS = colMap['fase_seguimiento_biometria'] != null ? colMap['fase_seguimiento_biometria'] : -1;
  var cFC = colMap['fecha_consulta_sai'] != null ? colMap['fecha_consulta_sai'] : -1;

  // Buscar o crear columnas de cierre
  var cEstadoCierre = colMap['estado_sai_cierre'] != null ? colMap['estado_sai_cierre'] : -1;
  var cFechaResultado = colMap['fecha_resultado_cierre'] != null ? colMap['fecha_resultado_cierre'] : -1;

  if (cEstadoCierre === -1) {
    var nextCol = headers.length;
    hoja.getRange(1, nextCol + 1).setValue('estado_sai_cierre');
    hoja.getRange(1, nextCol + 2).setValue('fecha_resultado_cierre');
    cEstadoCierre = nextCol;
    cFechaResultado = nextCol + 1;
    SpreadsheetApp.flush();
  } else if (cFechaResultado === -1) {
    var nextCol2 = headers.length;
    hoja.getRange(1, nextCol2 + 1).setValue('fecha_resultado_cierre');
    cFechaResultado = nextCol2;
    SpreadsheetApp.flush();
  }

  // --- Leer datos y construir lista de filas a reconsultar ---
  var data = hoja.getDataRange().getDisplayValues();

  var hoy = new Date();
  var limite = new Date(hoy);
  limite.setDate(limite.getDate() - diasAtras);
  var limiteISO = Utilities.formatDate(limite, TIMEZONE, 'yyyy-MM-dd');

  var filasReconsultar = [];
  for (var i = 1; i < data.length; i++) {
    var consecutivo = String(data[i][COL_BIOMETRIA.SOLICITUD] || '').trim();
    if (!consecutivo) continue;

    var fase = cFS >= 0 ? String(data[i][cFS] || '').trim() : '';
    if (!fase) continue;

    if (cFC >= 0) {
      var fechaConsultaRaw = String(data[i][cFC] || '').trim();
      var fechaConsultaISO = _fechaParteISO(fechaConsultaRaw);
      if (fechaConsultaISO && fechaConsultaISO < limiteISO) continue;
    }

    filasReconsultar.push({ fila: i + 1, consecutivo: consecutivo });
  }

  Logger.log('reconsultarEstadoSAICierre: ' + filasReconsultar.length + ' casos totales, comenzando en índice ' + startIndex);

  if (startIndex >= filasReconsultar.length) {
    Logger.log('reconsultarEstadoSAICierre: Ya no quedan casos. Proceso finalizado.');
    _limpiarEstadoReconsulta(props);
    _eliminarTriggerContinuacion();
    return;
  }

  // --- Consultar API con control de tiempo ---
  var inicio = Date.now();
  var escrituras = [];
  var errores = 0;
  var ultimoProcesado = startIndex - 1;

  for (var j = startIndex; j < filasReconsultar.length; j++) {
    // Verificar si nos acercamos al límite de tiempo
    if (Date.now() - inicio > _MAX_RUNTIME_MS) {
      Logger.log('reconsultarEstadoSAICierre: Límite de tiempo alcanzado en índice ' + j + '. Guardando progreso...');
      // Escribir lo pendiente antes de salir
      if (escrituras.length > 0) {
        _escribirLoteCierre(hoja, escrituras, cEstadoCierre, cFechaResultado);
        escrituras = [];
      }
      SpreadsheetApp.flush();
      // Guardar estado para continuación
      _guardarEstadoReconsulta(props, { enProgreso: true, ultimoIndice: ultimoProcesado, diasAtras: diasAtras });
      _programarContinuacion();
      return;
    }

    var item = filasReconsultar[j];

    try {
      var url = ENDPOINT + '?consecutive=' + encodeURIComponent(item.consecutivo);
      var response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json'
        },
        muteHttpExceptions: true
      });

      var code = response.getResponseCode();
      if (code === 200) {
        var respData = JSON.parse(response.getContentText());
        var registro = null;
        if (respData && respData.content && respData.content.length > 0) {
          registro = respData.content[0];
        } else if (respData && respData.studyStatus) {
          registro = respData;
        }

        var estadoSAI = registro ? String(registro.studyStatus || 'SIN_DATO') : 'SIN_DATO';
        var fechaResultado = registro ? String(registro.lastResultDate || '') : '';
        escrituras.push({ fila: item.fila, estado: estadoSAI, fechaResultado: fechaResultado });
      } else if (code === 404) {
        escrituras.push({ fila: item.fila, estado: 'NO_ENCONTRADA', fechaResultado: '' });
      } else {
        escrituras.push({ fila: item.fila, estado: 'ERROR_HTTP_' + code, fechaResultado: '' });
        errores++;
      }
    } catch (e) {
      escrituras.push({ fila: item.fila, estado: 'ERROR_' + e.message.substring(0, 30), fechaResultado: '' });
      errores++;
    }

    ultimoProcesado = j;

    // Escribir en lotes
    if (escrituras.length >= BATCH_SIZE) {
      _escribirLoteCierre(hoja, escrituras, cEstadoCierre, cFechaResultado);
      escrituras = [];
    }

    // Pausa entre llamadas
    if (j < filasReconsultar.length - 1) {
      Utilities.sleep(SLEEP_MS);
    }
  }

  // Escribir remanente
  if (escrituras.length > 0) {
    _escribirLoteCierre(hoja, escrituras, cEstadoCierre, cFechaResultado);
  }

  SpreadsheetApp.flush();
  _limpiarEstadoReconsulta(props);
  _eliminarTriggerContinuacion();
  Logger.log('reconsultarEstadoSAICierre: COMPLETADO. Procesados: ' + (ultimoProcesado - startIndex + 1) + ', Errores: ' + errores);
}

// ── Helpers de estado y continuación ──

/**
 * @private
 */
function _cargarEstadoReconsulta(props) {
  var raw = props.getProperty(_RECONSULTA_STATE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * @private
 */
function _guardarEstadoReconsulta(props, state) {
  props.setProperty(_RECONSULTA_STATE_KEY, JSON.stringify(state));
}

/**
 * @private
 */
function _limpiarEstadoReconsulta(props) {
  props.deleteProperty(_RECONSULTA_STATE_KEY);
}

/**
 * Programa un trigger de continuación para ejecutar en 1 minuto.
 * @private
 */
function _programarContinuacion() {
  // Eliminar TODOS los triggers de esta función primero
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'reconsultarEstadoSAICierre') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('reconsultarEstadoSAICierre')
    .timeBased()
    .after(60 * 1000)
    .create();
  Logger.log('Trigger de continuación programado (1 minuto).');
}

/**
 * Elimina triggers de continuación (one-shot after triggers).
 * @private
 */
function _eliminarTriggerContinuacion() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'reconsultarEstadoSAICierre') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Escribe un lote de resultados de cierre en la hoja.
 * @private
 */
function _escribirLoteCierre(hoja, escrituras, colEstado, colFechaResultado) {
  for (var k = 0; k < escrituras.length; k++) {
    var e = escrituras[k];
    hoja.getRange(e.fila, colEstado + 1).setValue(e.estado);
    hoja.getRange(e.fila, colFechaResultado + 1).setValue(e.fechaResultado);
  }
}

// ── Triggers de reconsulta ──

/**
 * Crea un trigger diario a las 17:30 para la reconsulta de cierre.
 */
function crearTriggerReconsultaCierre() {
  // Eliminar triggers previos
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'reconsultarEstadoSAICierre') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('reconsultarEstadoSAICierre')
    .timeBased()
    .atHour(17)
    .nearMinute(30)
    .everyDays(1)
    .create();
  Logger.log('Trigger creado: reconsultarEstadoSAICierre diario a las 17:30.');
}

/**
 * Elimina todos los triggers de reconsulta (diario y continuaciones).
 */
function eliminarTriggerReconsultaCierre() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'reconsultarEstadoSAICierre') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Limpiar estado por si quedó a medias
  PropertiesService.getScriptProperties().deleteProperty(_RECONSULTA_STATE_KEY);
  Logger.log('Triggers de reconsulta eliminados y estado limpiado.');
}

/**
 * Fuerza reiniciar la reconsulta desde cero (limpia estado previo).
 * Útil si se quedó en un estado inconsistente.
 */
function resetReconsultaCierre() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(_RECONSULTA_STATE_KEY);
  Logger.log('Estado de reconsulta reiniciado. Ejecutar reconsultarEstadoSAICierre() para iniciar de nuevo.');
}

/**
 * Obtiene el resumen del estado SAI al cierre para el rango de fechas indicado.
 * Lee las columnas `estado_sai_cierre` y `fecha_resultado_cierre` de la hoja
 * de biometría y agrupa por estado.
 *
 * @param {string} fechaDesde - yyyy-MM-dd
 * @param {string} fechaHasta - yyyy-MM-dd
 * @returns {Object} { total, desglose: [{estado, cantidad, pct}], detalle: [...] }
 */
function obtenerResumenEstadoSAICierre(fechaDesde, fechaHasta) {
  var resultado = { total: 0, sinReconsulta: 0, desglose: [], detalle: [] };

  try {
    var data = obtenerHojaBiometria();
    if (!data || data.length < 2) return resultado;

    var headers = data[0];
    var colMap = _construirColMapBiometria(headers);

    var cFC = colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] != null ? colMap[COL_BIOMETRIA.HEADER_FECHA_CONSULTA_SAI] : -1;
    var cFS = colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] != null ? colMap[COL_BIOMETRIA.HEADER_FASE_SEGUIMIENTO] : -1;
    var cEstadoCierre = colMap['estado_sai_cierre'] != null ? colMap['estado_sai_cierre'] : -1;
    var cFechaResultado = colMap['fecha_resultado_cierre'] != null ? colMap['fecha_resultado_cierre'] : -1;

    if (cEstadoCierre === -1) return resultado;

    var filtroDesde = fechaDesde ? fechaDesde.replace(/-/g, '') : '';
    var filtroHasta = fechaHasta ? fechaHasta.replace(/-/g, '') : '';

    var conteoEstados = {};
    var detalles = [];

    for (var i = 1; i < data.length; i++) {
      var solicitud = String(data[i][COL_BIOMETRIA.SOLICITUD] || '').trim();
      if (!solicitud) continue;

      // Filtrar por fecha de consulta SAI dentro del rango (misma lógica que totalConsultadas)
      var consultaParte = cFC >= 0 ? _fechaParteISO(String(data[i][cFC] || '').trim()) : '';
      var consultaNorm = consultaParte.replace(/-/g, '');
      if (!_enRangoBio(consultaNorm, filtroDesde, filtroHasta)) continue;

      resultado.total++;

      var estadoCierre = cEstadoCierre >= 0 ? String(data[i][cEstadoCierre] || '').trim() : '';
      var fechaResultadoCierre = cFechaResultado >= 0 ? String(data[i][cFechaResultado] || '').trim() : '';

      if (!estadoCierre) {
        resultado.sinReconsulta++;
        continue;
      }

      // Normalizar estado para agrupación
      var estadoNorm = estadoCierre.toUpperCase().replace(/\s+/g, '_');
      conteoEstados[estadoNorm] = (conteoEstados[estadoNorm] || 0) + 1;

      // Detalle (máx 300)
      if (detalles.length < 300) {
        var fase = cFS >= 0 ? String(data[i][cFS] || '').toUpperCase().trim() : '';
        detalles.push({
          solicitud: solicitud,
          poliza: String(data[i][COL_BIOMETRIA.POLIZA] || '').trim(),
          nombre: String(data[i][COL_BIOMETRIA.NOMBRE_INQUILINO] || '').trim(),
          faseInterna: fase || 'SIN FASE',
          estadoSAI: estadoNorm,
          fechaResultado: fechaResultadoCierre
        });
      }
    }

    // Construir desglose ordenado por cantidad
    var totalConEstado = resultado.total - resultado.sinReconsulta;
    var desglose = Object.keys(conteoEstados).map(function(est) {
      return {
        estado: est,
        cantidad: conteoEstados[est],
        pct: totalConEstado > 0 ? Math.round((conteoEstados[est] / totalConEstado) * 1000) / 10 : 0
      };
    });
    desglose.sort(function(a, b) { return b.cantidad - a.cantidad; });

    resultado.desglose = desglose;
    resultado.detalle = detalles;
    return resultado;
  } catch (e) {
    Logger.log('Error en obtenerResumenEstadoSAICierre: ' + e.message);
    return resultado;
  }
}
