/**
 * 06_WebApp.js — Punto de entrada de la WebApp y Endpoint Batch
 *
 * Contiene doGet, getEmailUsuario, include (helper de templates) y el
 * endpoint batch (obtenerDatosBatch) que consolida 6 round-trips en 1.
 *
 * Dependencias (scope global):
 *   obtenerPermisoUsuario (05_Administracion.js)
 *   agente_obtenerMetasDecision (05_Administracion.js)
 *   obtenerDatosMetricas (03_Metricas.js)
 *   obtenerColaAsignacion (04_Biometria.js)
 *   agente_obtenerDatosDashboard (05_Administracion.js)
 *   _cacheGet, _cachePut (01_Datos.js)
 *   TIMEZONE (00_Config.js)
 */

// ============================================================================
// WEBAPP — Punto de entrada
// ============================================================================

/**
 * Punto de entrada de la webapp. Sirve el template HTML principal.
 * @param {object} e - Evento de doGet
 * @returns {HtmlOutput}
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('MetricasPanel')
    .evaluate()
    .setTitle('Métricas Análisis')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Retorna el email del usuario autenticado.
 * Invocado por google.script.run desde el cliente.
 * @returns {string}
 */
function getEmailUsuario() {
  return Session.getActiveUser().getEmail();
}

/**
 * Helper para incluir archivos HTML parciales dentro de templates.
 * Uso en template: <?!= include('Estilos'); ?>
 * @param {string} filename - Nombre del archivo HTML (sin extensión .html)
 * @returns {string} Contenido HTML del archivo
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================================
// ENDPOINT BATCH — Carga inicial del dashboard
// ============================================================================

/**
 * Endpoint batch para carga inicial del dashboard.
 * Retorna todas las secciones necesarias en una sola invocación,
 * reduciendo de 6 round-trips a 1.
 *
 * @returns {object} {permisos, email, metas?, metricas?, cola?, salud?, errores?}
 */
function obtenerDatosBatch() {
  var resultado = {};

  // 1. Permisos (obligatorio — envuelto en try/catch para al menos retornar email)
  try {
    var permiso = obtenerPermisoUsuario();
    resultado.permisos = permiso;
  } catch (e) {
    Logger.log("Error obteniendo permisos: " + e.message);
    resultado.permisos = { rol: "coordinador", email: "" };
  }
  resultado.email = Session.getActiveUser().getEmail();

  // Si no tiene acceso, retornar solo permisos sin cargar datos
  if (resultado.permisos.rol === "sin_acceso") {
    return resultado;
  }

  // 2. Verificar CacheService primero
  var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  var claveCache = "batch_" + hoyStr;
  var cacheado = _cacheGet(claveCache);

  if (cacheado != null) {
    // Merge datos cacheados con permisos/email ya obtenidos
    resultado.metas = cacheado.metas;
    resultado.metricas = cacheado.metricas;
    resultado.cola = cacheado.cola;
    resultado.salud = cacheado.salud;
    return resultado;
  }

  // 3. Cargar cada sección con manejo de errores independiente
  var errores = {};

  // Metas
  try {
    resultado.metas = agente_obtenerMetasDecision();
  } catch (e) {
    Logger.log("Error en sección metas: " + e.message);
    errores.metas = e.message;
  }

  // Métricas del día actual
  try {
    resultado.metricas = obtenerDatosMetricas(hoyStr, hoyStr);
  } catch (e) {
    Logger.log("Error en sección metricas: " + e.message);
    errores.metricas = e.message;
  }

  // Cola de asignación
  try {
    resultado.cola = obtenerColaAsignacion();
  } catch (e) {
    Logger.log("Error en sección cola: " + e.message);
    errores.cola = e.message;
  }

  // Salud operativa
  try {
    resultado.salud = agente_obtenerDatosDashboard();
  } catch (e) {
    Logger.log("Error en sección salud: " + e.message);
    errores.salud = e.message;
  }

  // 4. Cachear solo secciones exitosas (sin permisos ni errores)
  var datosACachear = {};
  if (resultado.metas !== undefined) datosACachear.metas = resultado.metas;
  if (resultado.metricas !== undefined) datosACachear.metricas = resultado.metricas;
  if (resultado.cola !== undefined) datosACachear.cola = resultado.cola;
  if (resultado.salud !== undefined) datosACachear.salud = resultado.salud;

  // Solo cachear si al menos una sección fue exitosa
  if (Object.keys(datosACachear).length > 0) {
    _cachePut(claveCache, datosACachear);
  }

  // Incluir errores solo si hay alguno
  if (Object.keys(errores).length > 0) {
    resultado.errores = errores;
  }

  return resultado;
}
