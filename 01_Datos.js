/**
 * 01_Datos.js — Capa de Datos (Data Layer)
 *
 * Memoización por ciclo de ejecución + CacheService.
 *
 * Patrón: Cada función de lectura usa una variable de módulo como caché
 * en memoria. Dentro de una misma invocación del servidor, la primera
 * llamada lee el spreadsheet; las siguientes retornan la referencia
 * almacenada. Entre invocaciones, el runtime destruye las variables,
 * garantizando datos frescos.
 *
 * Dependencias (scope global desde 00_Config.js):
 *   TARGET_SOLICITUDES_SS_ID, SHEET_NAME_SOLICITUDES,
 *   ID_HOJA_REESTUDIOS, NOMBRE_PESTANA_REESTUDIOS,
 *   ID_HOJA_BIOMETRIA, CACHE_TTL_SEGUNDOS,
 *   CACHE_MAX_FRAGMENTO_KB, CACHE_MAX_FRAGMENTOS
 *
 * Dependencias (scope global desde 02_Utilidades.js):
 *   normalizarSegmento
 */

// ============================================================================
// VARIABLES DE MÓDULO — Caché intra-ejecución
// ============================================================================

var _historicoGestiones = null;
var _hojaReestudios = null;
var _hojaOrigen = null;
var _hojaBiometria = null;
var _hojaSolicitud = null;
var _hojaUsuarios = null;
var _ssReestudios = null; // instancia del spreadsheet compartida entre Reestudios y ORIGEN

// El cache entre ejecuciones (CacheService) es opt-in por ejecución: solo lo activan los
// puntos de entrada del tablero de Biometría (ver _activarCacheHojas). Alertas, correos y
// métricas siguen leyendo siempre datos frescos.
var _usarCacheHojas = false;

/** Activa el cache de hojas durante esta ejecución del servidor. */
function _activarCacheHojas() {
  _usarCacheHojas = true;
}

// ============================================================================
// FUNCIONES DE LECTURA MEMOIZADAS
// ============================================================================

/**
 * Lee Historico_Gestiones desde TARGET_SOLICITUDES_SS_ID.
 * Lanza error descriptivo si la hoja no existe o el spreadsheet no es accesible.
 *
 * @returns {string[][]} Arreglo bidimensional incluyendo encabezados.
 * @throws {Error} Si la hoja no existe o el spreadsheet no es accesible.
 */
function obtenerHistoricoGestiones() {
  if (_historicoGestiones !== null) return _historicoGestiones;

  _historicoGestiones = _leerHojaCacheada(CACHE_CLAVE_HOJA_HISTORICO, function() {
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hoja = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
    if (!hoja) {
      throw new Error("Hoja " + SHEET_NAME_SOLICITUDES + " no encontrada en spreadsheet " + TARGET_SOLICITUDES_SS_ID);
    }
    return hoja.getDataRange().getDisplayValues();
  });
  return _historicoGestiones;
}

/**
 * Lee la pestaña Historico_Gestiones del spreadsheet de Reestudios (ID_HOJA_REESTUDIOS).
 * Retorna [] si hay error (degradación graceful).
 * Almacena la instancia del spreadsheet en _ssReestudios para reutilización por obtenerHojaOrigen.
 *
 * @returns {string[][]} Arreglo bidimensional o [] en caso de error.
 */
function obtenerHojaReestudios() {
  if (_hojaReestudios !== null) return _hojaReestudios;

  try {
    _ssReestudios = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    var hoja = _ssReestudios.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (!hoja) {
      Logger.log("Pestaña " + NOMBRE_PESTANA_REESTUDIOS + " no encontrada en spreadsheet " + ID_HOJA_REESTUDIOS);
      _hojaReestudios = [];
      return _hojaReestudios;
    }

    if (hoja.getLastRow() <= 1) {
      _hojaReestudios = [];
      return _hojaReestudios;
    }

    _hojaReestudios = hoja.getDataRange().getDisplayValues();
    return _hojaReestudios;
  } catch (e) {
    Logger.log("Error leyendo Reestudios (" + ID_HOJA_REESTUDIOS + "): " + e.message);
    _hojaReestudios = [];
    return _hojaReestudios;
  }
}

/**
 * Lee la pestaña "ORIGEN" del spreadsheet de Reestudios (ID_HOJA_REESTUDIOS).
 * Reutiliza la instancia _ssReestudios ya abierta por obtenerHojaReestudios.
 * Retorna [] si hay error.
 *
 * @returns {string[][]} Arreglo bidimensional o [] en caso de error.
 */
function obtenerHojaOrigen() {
  if (_hojaOrigen !== null) return _hojaOrigen;

  try {
    // Si _ssReestudios no ha sido abierto aún, abrirlo ahora
    if (!_ssReestudios) {
      _ssReestudios = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    }

    var hoja = _ssReestudios.getSheetByName("ORIGEN");
    if (!hoja) {
      Logger.log("Pestaña ORIGEN no encontrada en spreadsheet " + ID_HOJA_REESTUDIOS);
      _hojaOrigen = [];
      return _hojaOrigen;
    }

    if (hoja.getLastRow() <= 1) {
      _hojaOrigen = [];
      return _hojaOrigen;
    }

    _hojaOrigen = hoja.getDataRange().getDisplayValues();
    return _hojaOrigen;
  } catch (e) {
    Logger.log("Error leyendo ORIGEN (" + ID_HOJA_REESTUDIOS + "): " + e.message);
    _hojaOrigen = [];
    return _hojaOrigen;
  }
}

/**
 * Lee la pestaña "pendiente_biometria" del spreadsheet ID_HOJA_BIOMETRIA.
 * Retorna [] si la hoja no existe o tiene menos de 2 filas (solo headers o vacía).
 *
 * @returns {string[][]} Arreglo bidimensional o [] si no hay datos útiles.
 */
function obtenerHojaBiometria() {
  if (_hojaBiometria !== null) return _hojaBiometria;

  try {
    _hojaBiometria = _leerHojaCacheada(CACHE_CLAVE_HOJA_BIOMETRIA, function() {
      var ss = SpreadsheetApp.openById(ID_HOJA_BIOMETRIA);
      var hoja = ss.getSheetByName("pendiente_biometria");
      if (!hoja) {
        Logger.log("Pestaña pendiente_biometria no encontrada en spreadsheet " + ID_HOJA_BIOMETRIA);
        return [];
      }
      if (hoja.getLastRow() < 2) return [];
      return hoja.getDataRange().getDisplayValues();
    });
    return _hojaBiometria;
  } catch (e) {
    Logger.log("Error leyendo pendiente_biometria (" + ID_HOJA_BIOMETRIA + "): " + e.message);
    _hojaBiometria = [];
    return _hojaBiometria;
  }
}

/**
 * Lee la hoja "solicitud" del spreadsheet TARGET_SOLICITUDES_SS_ID.
 * Retorna [] si hay error.
 *
 * @returns {string[][]} Arreglo bidimensional o [] en caso de error.
 */
function obtenerHojaSolicitud() {
  if (_hojaSolicitud !== null) return _hojaSolicitud;

  try {
    _hojaSolicitud = _leerHojaCacheada(CACHE_CLAVE_HOJA_SOLICITUD, function() {
      var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
      var hoja = ss.getSheetByName("solicitud");
      if (!hoja) {
        Logger.log("Pestaña solicitud no encontrada en spreadsheet " + TARGET_SOLICITUDES_SS_ID);
        return [];
      }
      if (hoja.getLastRow() <= 1) return [];
      return hoja.getDataRange().getDisplayValues();
    });
    return _hojaSolicitud;
  } catch (e) {
    Logger.log("Error leyendo solicitud (" + TARGET_SOLICITUDES_SS_ID + "): " + e.message);
    _hojaSolicitud = [];
    return _hojaSolicitud;
  }
}

/**
 * Lee la hoja "Usuarios" del spreadsheet TARGET_SOLICITUDES_SS_ID.
 * Retorna [] si hay error.
 *
 * @returns {string[][]} Arreglo bidimensional o [] en caso de error.
 */
function obtenerHojaUsuarios() {
  if (_hojaUsuarios !== null) return _hojaUsuarios;

  try {
    var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
    var hoja = ss.getSheetByName("Usuarios");
    if (!hoja) {
      Logger.log("Pestaña Usuarios no encontrada en spreadsheet " + TARGET_SOLICITUDES_SS_ID);
      _hojaUsuarios = [];
      return _hojaUsuarios;
    }

    if (hoja.getLastRow() <= 1) {
      _hojaUsuarios = [];
      return _hojaUsuarios;
    }

    _hojaUsuarios = hoja.getDataRange().getDisplayValues();
    return _hojaUsuarios;
  } catch (e) {
    Logger.log("Error leyendo Usuarios (" + TARGET_SOLICITUDES_SS_ID + "): " + e.message);
    _hojaUsuarios = [];
    return _hojaUsuarios;
  }
}

// ============================================================================
// DICCIONARIO SCORE — Migrado de Código.js (usa CacheService propio)
// ============================================================================

/**
 * Carga el diccionario de score (póliza → {inmobiliaria, segmento}).
 * Usa CacheService con clave 'scoreMap' y TTL de 6 horas (21600s).
 * Fallback transparente: si CacheService falla, lee directamente del spreadsheet.
 *
 * @returns {Object} Mapa {poliza: {inmobiliaria: string, segmento: string}}
 */
function cargarDiccionarioScore() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get('scoreMap');
    if (cached) return JSON.parse(cached);
  } catch (e) { /* fallback a lectura directa */ }

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
  } catch (e) { /* no-op: cache es optimización, no dependencia */ }

  return scoreMap;
}


// ============================================================================
// CACHESERVICE — Particionamiento automático
// ============================================================================

/**
 * Almacena datos en CacheService con particionamiento automático.
 * Si los datos serializados superan 100KB, se fragmentan en partes de ≤95KB.
 * Nunca lanza excepción — falla silenciosamente si CacheService tiene problemas.
 *
 * @param {string} claveBase - Clave base (ej. "metricas_01/01/2024_31/01/2024")
 * @param {object} datos - Objeto serializable a JSON
 * @param {number} [ttl] - Segundos de vida. Por defecto CACHE_TTL_SEGUNDOS.
 * @returns {boolean} true si quedó guardado, false si no cupo o hubo error.
 */
function _cachePut(claveBase, datos, ttl) {
  ttl = ttl || CACHE_TTL_SEGUNDOS;
  try {
    var json = JSON.stringify(datos);
    var cache = CacheService.getScriptCache();

    if (json.length <= 100000) {
      // Cabe en una sola clave (≤100KB)
      cache.put(claveBase, json, ttl);
      cache.put(claveBase + "_idx", "1", ttl);
      return true;
    }

    // Particionar en fragmentos de ≤95KB
    var tamanoFragmento = CACHE_MAX_FRAGMENTO_KB * 1000;
    var fragmentos = [];
    for (var i = 0; i < json.length; i += tamanoFragmento) {
      fragmentos.push(json.substring(i, i + tamanoFragmento));
    }

    if (fragmentos.length > CACHE_MAX_FRAGMENTOS) {
      Logger.log("Dataset excede límite de fragmentos (" + fragmentos.length + " > " + CACHE_MAX_FRAGMENTOS + "), no se cachea: " + claveBase);
      return false;
    }

    // Construir mapa de pares clave-valor para putAll
    var pares = {};
    for (var idx = 0; idx < fragmentos.length; idx++) {
      pares[claveBase + "_part" + idx] = fragmentos[idx];
    }
    pares[claveBase + "_idx"] = String(fragmentos.length);

    cache.putAll(pares, ttl);
    return true;
  } catch (e) {
    Logger.log("Error escribiendo cache " + claveBase + ": " + e.message);
    return false;
  }
}

/**
 * Lee una hoja completa pasando primero por CacheService, para que varias invocaciones
 * seguidas del servidor (cada google.script.run es una ejecución nueva y pierde las
 * variables de módulo) no relean el spreadsheet. Si el dataset no cabe en el cache se
 * deja una marca corta para no volver a serializarlo en cada llamada. Solo se cachean
 * resultados con datos (más de la fila de encabezados). Sin _activarCacheHojas() lee directo.
 *
 * @param {string} clave - Clave base del cache
 * @param {function(): string[][]} leerFn - Lectura directa del spreadsheet
 * @returns {string[][]}
 * @private
 */
function _leerHojaCacheada(clave, leerFn) {
  if (!_usarCacheHojas) return leerFn();
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    if (cache.get(clave + "_nocache")) return leerFn();
  } catch (e) {
    return leerFn();
  }

  var cacheado = _cacheGet(clave);
  if (cacheado) return cacheado;

  var datos = leerFn();
  if (datos && datos.length > 1) {
    if (!_cachePut(clave, datos, CACHE_TTL_HOJAS_SEGUNDOS)) {
      try { cache.put(clave + "_nocache", "1", CACHE_TTL_HOJAS_SEGUNDOS); } catch (e) { /* no-op */ }
    }
  }
  return datos;
}

/**
 * Descarta el cache de la hoja pendiente_biometria. Llamar después de escribir en ella
 * desde este proyecto, para que el tablero no muestre datos anteriores a la escritura.
 */
function invalidarCacheHojaBiometria() {
  invalidarCache(CACHE_CLAVE_HOJA_BIOMETRIA);
}

/**
 * Lee y reconstruye datos particionados desde CacheService.
 * Retorna null si hay cache miss, fragmento faltante, o cualquier error.
 *
 * @param {string} claveBase - Clave base usada en _cachePut
 * @returns {object|null} Datos deserializados o null si cache miss/error
 */
function _cacheGet(claveBase) {
  try {
    var cache = CacheService.getScriptCache();
    var idxStr = cache.get(claveBase + "_idx");

    if (idxStr == null) return null;

    var numParts = parseInt(idxStr, 10);

    if (numParts === 1) {
      // Dato almacenado en una sola clave
      var json = cache.get(claveBase);
      return json ? JSON.parse(json) : null;
    }

    // Leer todos los fragmentos con getAll
    var claves = [];
    for (var i = 0; i < numParts; i++) {
      claves.push(claveBase + "_part" + i);
    }

    var partes = cache.getAll(claves);

    // Verificar que todos los fragmentos existan y concatenar en orden
    var json = "";
    for (var i = 0; i < numParts; i++) {
      var parte = partes[claveBase + "_part" + i];
      if (parte == null) return null; // Fragmento faltante → cache miss
      json += parte;
    }

    return JSON.parse(json);
  } catch (e) {
    Logger.log("Error leyendo cache " + claveBase + ": " + e.message);
    return null;
  }
}

/**
 * Invalida todas las claves asociadas a un dataset en CacheService.
 * Elimina la clave índice y todas las claves de fragmentos (o la clave única).
 * Nunca lanza excepción.
 *
 * @param {string} claveBase - Clave base del dataset a invalidar
 */
function invalidarCache(claveBase) {
  try {
    var cache = CacheService.getScriptCache();
    var idxStr = cache.get(claveBase + "_idx");

    if (idxStr == null) return;

    var numParts = parseInt(idxStr, 10);
    var clavesAEliminar = [claveBase + "_idx"];

    if (numParts === 1) {
      clavesAEliminar.push(claveBase);
    } else {
      for (var i = 0; i < numParts; i++) {
        clavesAEliminar.push(claveBase + "_part" + i);
      }
    }

    cache.removeAll(clavesAEliminar);
  } catch (e) {
    Logger.log("Error invalidando cache " + claveBase + ": " + e.message);
  }
}
