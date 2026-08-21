/**
 * 05_Administracion.js — Control de Acceso, Seguimiento de Analistas y Agente Coordinador
 *
 * Funciones de administración expuestas a google.script.run desde el cliente.
 * Usa la Capa de Datos (01_Datos.js), helpers de 02_Utilidades.js y 03_Metricas.js.
 *
 * Dependencias (scope global desde 00_Config.js):
 *   COL_HISTORICO, COL_REESTUDIOS, COL_SOLICITUD, COL_USUARIOS, TIMEZONE,
 *   ACCESS_COORD_KEY, ACCESS_BIO_KEY, COORD_FIJO, AGENT_CONFIG_KEY,
 *   AGENT_HISTORY_KEY, AGENT_HIST_CACHE_KEY, AGENT_DIAG_CACHE_KEY,
 *   MAX_ALERT_HISTORY, AGENT_TRIGGER_FNS, AGENT_RAZONES_NO_ALERTAR,
 *   DEFAULT_AGENT_CONFIG, BCC_REPORTES_AGENTE, NOMBRE_REMITENTE_AGENTE,
 *   HORA_INICIO_OPERACION, HORA_FIN_TURNO,
 *   TARGET_SOLICITUDES_SS_ID, SHEET_NAME_SOLICITUDES,
 *   ID_HOJA_REESTUDIOS, NOMBRE_PESTANA_REESTUDIOS
 *
 * Dependencias (scope global desde 01_Datos.js):
 *   obtenerHistoricoGestiones, obtenerHojaReestudios, obtenerHojaSolicitud,
 *   obtenerHojaUsuarios, obtenerHojaBiometria, cargarDiccionarioScore
 *
 * Dependencias (scope global desde 02_Utilidades.js):
 *   parsearFecha, clasificarEstado, parsearTiempoMinutos, fechaEnRango,
 *   normalizarTipoAsignado, normalizarHora, obtenerSucursalPorPoliza,
 *   obtenerSegmentoInmobiliaria
 *
 * Dependencias (scope global desde 03_Metricas.js):
 *   _filtrarFilasPorFechaExacta, _filtrarFilasPorRango, _resolverAnalista,
 *   _tallyMotivo, _motivoPrincipal, _motivoPrincipalCombinado
 */

// ============================================================================
// HELPERS INTERNOS — Compatibilidad con lógica original
// ============================================================================

/**
 * Normaliza una cadena de fecha dd/MM/yyyy a formato con ceros dd/MM/yyyy.
 * Replicado aquí para compatibilidad con coincideFecha.
 */
function _admin_normalizarFechaDDMMYYYY(fechaRaw) {
  if (!fechaRaw || typeof fechaRaw !== 'string') return "";
  var soloFecha = fechaRaw.trim().split(' ')[0];
  var partes = soloFecha.split('/');
  if (partes.length !== 3) return "";
  var dia = parseInt(partes[0], 10);
  var mes = parseInt(partes[1], 10);
  var anio = parseInt(partes[2], 10);
  if (isNaN(dia) || isNaN(mes) || isNaN(anio)) return "";
  return String(dia).padStart(2, '0') + "/" + String(mes).padStart(2, '0') + "/" + anio;
}

/**
 * Compara si la parte de fecha de un datetime coincide exactamente con la fecha objetivo.
 */
function _admin_coincideFecha(fechaRaw, fechaObjetivo) {
  return _admin_normalizarFechaDDMMYYYY(fechaRaw) === fechaObjetivo;
}



// ============================================================================
// CONTROL DE ACCESO POR SECCIONES
// ============================================================================

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
// SEGUIMIENTO DE ANALISTAS
// ============================================================================

/**
 * Lista de analistas activos con la hora de su primer resultado del día.
 * Usa Capa de Datos y helpers compartidos.
 */
function admin_obtenerAsesoresActivosPrimerResultado(fechaFiltro) {
  var dataUser = obtenerHojaUsuarios();
  var dataSol = obtenerHistoricoGestiones();

  var hoyRealStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  var fechaStr;
  if (fechaFiltro && /^\d{4}-\d{2}-\d{2}$/.test(fechaFiltro)) {
    var partesFecha = fechaFiltro.split("-");
    fechaStr = partesFecha[2] + "/" + partesFecha[1] + "/" + partesFecha[0];
  } else {
    fechaStr = hoyRealStr;
  }
  var esHoy = (fechaStr === hoyRealStr);

  var dataReest = obtenerHojaReestudios();
  var tieneReestudios = dataReest && dataReest.length > 1;

  var primerResultadoMap = {};
  var ultimoResultadoMap = {};
  var gestionadasMap = {};
  var pendientesMap = {};
  var tiemposGestionMap = {};
  var tiemposGeneralMap = {};

  // Procesar Historico_Gestiones
  for (var i = 1; i < dataSol.length; i++) {
    var asignado = String(dataSol[i][COL_HISTORICO.CORREO_ANALISTA] || "").toLowerCase().trim();
    var fechaFinRaw = String(dataSol[i][COL_HISTORICO.FECHA_FIN] || "").trim();
    var tiempoGestionVal = String(dataSol[i][COL_HISTORICO.MINUTOS_GESTION] || "").trim();
    var tiempoGeneralVal = String(dataSol[i][COL_HISTORICO.MINUTOS_GENERAL] || "").trim();
    if (!asignado) continue;
    if (fechaFinRaw && _admin_coincideFecha(fechaFinRaw, fechaStr)) {
      gestionadasMap[asignado] = (gestionadasMap[asignado] || 0) + 1;
      var tg = parseFloat(tiempoGestionVal.replace(',', '.'));
      if (!isNaN(tg) && tg > 0) {
        if (!tiemposGestionMap[asignado]) tiemposGestionMap[asignado] = [];
        tiemposGestionMap[asignado].push(tg);
      }
      var tGenMin = parseFloat(tiempoGeneralVal.replace(',', '.'));
      if (!isNaN(tGenMin) && tGenMin > 0) {
        if (!tiemposGeneralMap[asignado]) tiemposGeneralMap[asignado] = [];
        tiemposGeneralMap[asignado].push(Number((tGenMin / 60).toFixed(2)));
      }
      var partes = fechaFinRaw.split(" ");
      var hora = partes.length > 1 ? normalizarHora(partes[1]) : "";
      if (hora) {
        if (!primerResultadoMap[asignado] || hora < primerResultadoMap[asignado]) primerResultadoMap[asignado] = hora;
        if (!ultimoResultadoMap[asignado] || hora > ultimoResultadoMap[asignado]) ultimoResultadoMap[asignado] = hora;
      }
    }
  }

  // Procesar Reestudios
  if (tieneReestudios) {
    for (var i = 1; i < dataReest.length; i++) {
      var asignado = String(dataReest[i][COL_REESTUDIOS.CORREO_ANALISTA] || "").trim().toLowerCase();
      var fechaFinRaw = String(dataReest[i][COL_REESTUDIOS.FECHA_FIN] || "").trim();
      var tiempoTotalReest = String(dataReest[i][COL_REESTUDIOS.MINUTOS_GENERAL] || "").trim();
      var tiempoGestionReest = String(dataReest[i][COL_REESTUDIOS.MINUTOS_GESTION] || "").trim();

      if (!asignado) continue;
      if (fechaFinRaw && _admin_coincideFecha(fechaFinRaw, fechaStr)) {
        gestionadasMap[asignado] = (gestionadasMap[asignado] || 0) + 1;
        var tgReest = parseFloat(tiempoGestionReest);
        if (!isNaN(tgReest) && tgReest > 0) {
          if (!tiemposGestionMap[asignado]) tiemposGestionMap[asignado] = [];
          tiemposGestionMap[asignado].push(tgReest);
        }
        var tGenReest = parseFloat(tiempoTotalReest);
        if (!isNaN(tGenReest) && tGenReest > 0) {
          if (!tiemposGeneralMap[asignado]) tiemposGeneralMap[asignado] = [];
          tiemposGeneralMap[asignado].push(Number((tGenReest / 60).toFixed(2)));
        }
        var partes = fechaFinRaw.split(" ");
        var hora = partes.length > 1 ? normalizarHora(partes[1]) : "";
        if (hora) {
          if (!primerResultadoMap[asignado] || hora < primerResultadoMap[asignado]) primerResultadoMap[asignado] = hora;
          if (!ultimoResultadoMap[asignado] || hora > ultimoResultadoMap[asignado]) ultimoResultadoMap[asignado] = hora;
        }
      }
    }
  }

  // Pendientes desde hoja "solicitud"
  var dataSolicitud = obtenerHojaSolicitud();
  if (dataSolicitud && dataSolicitud.length > 1) {
    for (var i = 1; i < dataSolicitud.length; i++) {
      var asignado = String(dataSolicitud[i][COL_SOLICITUD.NOMBRE_ANALISTA] || "").toLowerCase().trim();
      var fechaAsig = String(dataSolicitud[i][COL_SOLICITUD.FECHA_FIN] || "").trim();
      var fechaFin = String(dataSolicitud[i][COL_SOLICITUD.FECHA_FIN_SOLICITUD] || "").trim();
      if (!asignado || fechaAsig === "") continue;
      if (fechaFin === "") {
        pendientesMap[asignado] = (pendientesMap[asignado] || 0) + 1;
      }
    }
  }

  // Pendientes desde Reestudios
  if (tieneReestudios) {
    for (var i = 1; i < dataReest.length; i++) {
      var asignado = String(dataReest[i][COL_REESTUDIOS.CORREO_ANALISTA] || "").trim().toLowerCase();
      var fechaAsig = String(dataReest[i][COL_REESTUDIOS.FECHA_ASIGNACION] || "").trim();
      var fechaFin = String(dataReest[i][COL_REESTUDIOS.FECHA_FIN] || "").trim();
      if (!asignado || fechaAsig === "") continue;
      if (fechaFin === "") {
        pendientesMap[asignado] = (pendientesMap[asignado] || 0) + 1;
      }
    }
  }

  // Construir resultado
  var resultado = [];
  for (var j = 1; j < dataUser.length; j++) {
    var estadoUser = String(dataUser[j][COL_USUARIOS.ESTADO] || "").toUpperCase().trim();
    if (estadoUser === "") continue;

    var correo = String(dataUser[j][COL_USUARIOS.CORREO] || "").toLowerCase().trim();
    var nombre = String(dataUser[j][COL_USUARIOS.NOMBRE] || "").trim();
    var especialidad = String(dataUser[j][COL_USUARIOS.ESPECIALIDAD] || "").trim();
    var arrGestion = tiemposGestionMap[correo] || [];
    var arrGeneral = tiemposGeneralMap[correo] || [];
    var promedioGestion = arrGestion.length > 0 ? Number((arrGestion.reduce(function(a, b) { return a + b; }, 0) / arrGestion.length).toFixed(1)) : null;
    var promedioGeneral = arrGeneral.length > 0 ? Number((arrGeneral.reduce(function(a, b) { return a + b; }, 0) / arrGeneral.length).toFixed(2)) : null;

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

  resultado.sort(function(a, b) {
    if (!a.primerResultado && !b.primerResultado) return a.nombre.localeCompare(b.nombre);
    if (!a.primerResultado) return -1;
    if (!b.primerResultado) return 1;
    return a.primerResultado.localeCompare(b.primerResultado);
  });

  return { esHoy: esHoy, fecha: fechaStr, datos: resultado };
}

/**
 * Obtiene el detalle de solicitudes de un analista para una fecha específica.
 * Usa Capa de Datos y constantes de columna.
 */
function admin_obtenerDetallePorAnalista(correoAnalista, fechaFiltro) {
  correoAnalista = String(correoAnalista || "").toLowerCase().trim();
  if (!correoAnalista) return { success: false, message: "Correo no proporcionado." };

  var dataSol = obtenerHistoricoGestiones();
  var hoyRealStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");

  var fechaStr;
  if (fechaFiltro && /^\d{4}-\d{2}-\d{2}$/.test(fechaFiltro)) {
    var partesFecha = fechaFiltro.split("-");
    fechaStr = partesFecha[2] + "/" + partesFecha[1] + "/" + partesFecha[0];
  } else {
    fechaStr = hoyRealStr;
  }
  var esHoy = (fechaStr === hoyRealStr);

  // Resolver nombre del analista
  var infoAnalista = _resolverAnalista(correoAnalista);
  var nombreAnalista = infoAnalista.nombre || correoAnalista;

  var gestionadas = [];
  var pendientes = [];

  // Procesar Historico_Gestiones
  for (var i = 1; i < dataSol.length; i++) {
    var asignado = String(dataSol[i][COL_HISTORICO.CORREO_ANALISTA] || "").toLowerCase().trim();
    if (asignado !== correoAnalista) continue;

    var solicitudId = String(dataSol[i][COL_HISTORICO.SOLICITUD] || "").trim();
    var poliza = String(dataSol[i][COL_HISTORICO.POLIZA] || "");
    var estado = String(dataSol[i][COL_HISTORICO.ESTADO_GENERAL] || "").toUpperCase();
    var fechaRadicacion = String(dataSol[i][COL_HISTORICO.FECHA_RADICACION] || "").trim();
    var fechaAsignacion = String(dataSol[i][COL_HISTORICO.FECHA_ASIGNACION] || "").trim();
    var fechaFin = String(dataSol[i][COL_HISTORICO.FECHA_FIN] || "").trim();
    var tiempoGestion = String(dataSol[i][COL_HISTORICO.MINUTOS_GESTION] || "").trim();
    var tiempoGeneralMin = parseFloat(String(dataSol[i][COL_HISTORICO.MINUTOS_GENERAL] || "").replace(',', '.'));
    var tiempoSLA = !isNaN(tiempoGeneralMin) && tiempoGeneralMin > 0 ? String(Number((tiempoGeneralMin / 60).toFixed(2))) : "";
    var tiempoGeneral = tiempoSLA;

    if (!solicitudId) continue;
    var tipo = normalizarTipoAsignado(dataSol[i][COL_HISTORICO.TIPO_ASIGNADO]) || 'Digital';

    if (fechaFin !== "" && _admin_coincideFecha(fechaFin, fechaStr)) {
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
      if (fechaAsignacion && _admin_coincideFecha(fechaAsignacion, fechaStr)) {
        pendientes.push({ id: solicitudId, poliza: poliza, tipo: tipo, estado: estado, fechaRadicacion: fechaRadicacion, fechaAsignacion: fechaAsignacion });
      }
    }
  }

  // Procesar Reestudios
  var dataReest = obtenerHojaReestudios();
  if (dataReest && dataReest.length > 1) {
    for (var i = 1; i < dataReest.length; i++) {
      var asignado = String(dataReest[i][COL_REESTUDIOS.CORREO_ANALISTA] || "").toLowerCase().trim();
      if (asignado !== correoAnalista) continue;

      var solicitud = String(dataReest[i][COL_REESTUDIOS.SOLICITUD] || "").trim();
      var origen = String(dataReest[i][COL_REESTUDIOS.ORIGEN] || "").trim();
      var tipoProceso = String(dataReest[i][COL_REESTUDIOS.TIPO_PROCESO] || "").trim();
      var fechaRadicR = String(dataReest[i][COL_REESTUDIOS.FECHA_RADICACION] || "").trim();
      var fechaAsig = String(dataReest[i][COL_REESTUDIOS.FECHA_ASIGNACION] || "").trim();
      var fechaFin = String(dataReest[i][COL_REESTUDIOS.FECHA_FIN] || "").trim();
      var estadoG = String(dataReest[i][COL_REESTUDIOS.ESTADO_GENERAL] || "").trim();
      var tiempoTotalR = String(dataReest[i][COL_REESTUDIOS.MINUTOS_GENERAL] || "").trim();
      var tiempoG = String(dataReest[i][COL_REESTUDIOS.MINUTOS_GESTION] || "").trim();

      if (!solicitud) continue;
      var origenUp = origen.toUpperCase();
      var tipoUp = tipoProceso.toUpperCase();
      var esUar = origenUp === "CORREO" && (tipoUp.indexOf("ADICIONAL") >= 0 || tipoUp.indexOf("NUEVA") >= 0);
      var tipoLabel = esUar ? 'UAR' : 'Reestudio';

      if (fechaFin !== "" && _admin_coincideFecha(fechaFin, fechaStr)) {
        var tGenReestH = "";
        var tResFloat = parseFloat(tiempoTotalR.replace(',', '.'));
        if (!isNaN(tResFloat) && tResFloat > 0) tGenReestH = String(Number((tResFloat / 60).toFixed(2)));
        gestionadas.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: estadoG, fechaRadicacion: fechaRadicR, fechaAsignacion: fechaAsig, fechaFin: fechaFin, duracion: tiempoG, tiempoSLA: tiempoTotalR, tiempoGeneral: tGenReestH });
      }

      if (esHoy) {
        if (fechaAsig !== "" && fechaFin === "") {
          pendientes.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: "En gestión", fechaRadicacion: fechaRadicR, fechaAsignacion: fechaAsig });
        }
      } else {
        if (fechaAsig && _admin_coincideFecha(fechaAsig, fechaStr)) {
          pendientes.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: estadoG || "En gestión", fechaRadicacion: fechaRadicR, fechaAsignacion: fechaAsig });
        }
      }
    }
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
// AGENTE COORDINADOR — CONFIGURACIÓN
// ============================================================================

function agente_obtenerConfig() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(AGENT_CONFIG_KEY);
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (!parsed.horarioReporte) {
        parsed.horarioReporte = JSON.parse(JSON.stringify(DEFAULT_AGENT_CONFIG.horarioReporte));
      } else if (Array.isArray(parsed.horarioReporte.dias)) {
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
      if (parsed.horarioReporte.dias) {
        Object.keys(parsed.horarioReporte.dias).forEach(function(dk) {
          var dcfg = parsed.horarioReporte.dias[dk];
          if (typeof dcfg.horaInicio === "number") dcfg.horaInicio = String(dcfg.horaInicio).padStart(2, "0") + ":00";
          if (typeof dcfg.horaFin === "number") dcfg.horaFin = String(dcfg.horaFin).padStart(2, "0") + ":00";
        });
      }
      if (!parsed.notificaciones) parsed.notificaciones = JSON.parse(JSON.stringify(DEFAULT_AGENT_CONFIG.notificaciones));
      if (parsed.notificaciones.enviarInicioOperacion === undefined) parsed.notificaciones.enviarInicioOperacion = true;
      if (parsed.notificaciones.enviarChequeoConexion === undefined) parsed.notificaciones.enviarChequeoConexion = true;
      if (parsed.notificaciones.chequeoConexionOffsetMin === undefined) parsed.notificaciones.chequeoConexionOffsetMin = 30;
      if (parsed.notificaciones.enviarFotoMomento === undefined) parsed.notificaciones.enviarFotoMomento = true;
      if (parsed.notificaciones.fotoMomentoFrecuenciaHoras === undefined) {
        parsed.notificaciones.fotoMomentoFrecuenciaHoras = (parsed.horarioReporte && parsed.horarioReporte.frecuenciaHoras) || 2;
      }
      if (parsed.notificaciones.alertasCriticasFrecuenciaHoras === undefined) parsed.notificaciones.alertasCriticasFrecuenciaHoras = 1;
      if (parsed.notificaciones.enviarInformeIndividual === undefined) parsed.notificaciones.enviarInformeIndividual = false;
      if (parsed.notificaciones.informeIndividualDiaISO === undefined) parsed.notificaciones.informeIndividualDiaISO = 5;
      if (parsed.metas && parsed.metas.umbralMinutosPausa === undefined) parsed.metas.umbralMinutosPausa = 90;
      if (parsed.metas && parsed.metas.maxTasaNegacionPct === undefined) parsed.metas.maxTasaNegacionPct = 25;
      if (parsed.metas && parsed.metas.maxTasaAplazamientoPct === undefined) parsed.metas.maxTasaAplazamientoPct = 30;
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

function agente_obtenerMetasDecision() {
  var metas = agente_obtenerConfig().metas;
  return {
    maxTasaNegacionPct: metas.maxTasaNegacionPct,
    maxTasaAplazamientoPct: metas.maxTasaAplazamientoPct
  };
}

// ============================================================================
// AGENTE COORDINADOR — LECTURA DE DATOS
// ============================================================================

function _agente_leerDatosHoy() {
  var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  return _agente_leerDatosRango(hoyStr, hoyStr);
}

// ============================================================================
// AGENTE COORDINADOR — PROMEDIOS HISTÓRICOS
// ============================================================================

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

// ============================================================================
// AGENTE COORDINADOR — HISTORIAL DE ALERTAS
// ============================================================================

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

// ============================================================================
// AGENTE COORDINADOR — REGLAS DE DETECCIÓN (7 reglas)
// ============================================================================

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

  var inactivos = [];
  Object.keys(cuposMap || {}).forEach(function(correo) {
    var count = gestionesPorCorreo[correo] || 0;
    if (count === 0 && cuposMap[correo].total > 0) {
      inactivos.push(cuposMap[correo].nombre + " (" + cuposMap[correo].total + " cupos asignados)");
    }
  });

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


// ============================================================================
// AGENTE COORDINADOR — HEALTH SCORE
// ============================================================================

function _calcularHealthScore(registros, config, historicos, alertas, backlogDetalle, analistasActivos, cuposMap) {
  var components = {};
  var ahora = new Date();
  var horaActual = parseInt(Utilities.formatDate(ahora, TIMEZONE, "HH"), 10);
  var minActual = parseInt(Utilities.formatDate(ahora, TIMEZONE, "mm"), 10);
  var horasTranscurridasReales = horaActual - 8;
  var ventanaEvaluable = horaActual >= 9 && horaActual < 17;
  var sinActividad = registros.length === 0 && ventanaEvaluable;

  // 1. SLA Cumplimiento (25%)
  var dentroSLA = 0, totalSLA = 0;
  registros.forEach(function(r) {
    if (r.tResolucion !== null && r.tResolucion > 0) { totalSLA++; if (r.tResolucion <= 2) dentroSLA++; }
  });
  var pctSLA = totalSLA > 0 ? (dentroSLA / totalSLA) * 100 : (sinActividad ? 0 : 100);
  var scoreSLA = Math.min(100, (pctSLA / config.metas.slaPct) * 100);
  components.slaCumplimiento = { value: Math.round(scoreSLA), weight: 25 };

  // 2. Productividad (20%)
  var horasT = horaActual >= 17 ? 9 : Math.max(1, horasTranscurridasReales + minActual / 60);
  var totalCupos = 0;
  Object.keys(cuposMap || {}).forEach(function(k) { totalCupos += (cuposMap[k].total || 0); });
  var esperado;
  if (totalCupos > 0) { esperado = Math.max(1, totalCupos * (horasT / 9)); }
  else { var numAn = Math.max(1, analistasActivos.length); esperado = Math.max(1, config.metas.solicitudesPorDiaPorAnalista * numAn * (horasT / 9)); }
  var scoreProd = Math.min(100, (registros.length / esperado) * 100);
  components.productividad = { value: Math.round(scoreProd), weight: 20 };

  // 3. Tiempo Gestión (15%)
  var sumaG = 0, cG = 0;
  registros.forEach(function(r) { if (r.tGestion !== null) { sumaG += r.tGestion; cG++; } });
  var metaG = config.metas.maxTiempoGestionMin;
  var scoreG;
  if (cG > 0) { var avgG = sumaG / cG; scoreG = avgG <= metaG ? 100 : Math.max(0, 100 - ((avgG - metaG) / metaG * 100)); }
  else { scoreG = sinActividad ? 0 : 100; }
  components.tiempoGestion = { value: Math.round(scoreG), weight: 15 };

  // 4. Backlog Salud (15%)
  var totalBack = backlogDetalle.length;
  var rojos = backlogDetalle.filter(function(b) { return b.alertaSLA === "rojo"; }).length;
  var metaBack = Math.max(1, config.metas.maxBacklog);
  var scoreBack = Math.max(0, 100 - (totalBack / metaBack * 50) - (totalBack > 0 ? (rojos / totalBack * 50) : 0));
  components.backlogSalud = { value: Math.round(Math.min(100, scoreBack)), weight: 15 };

  // 5. Actividad del equipo (25%)
  var gestionesPorCorreo = {};
  registros.forEach(function(r) { if (r.correo) gestionesPorCorreo[r.correo] = true; });
  var totalConCupo = Object.keys(cuposMap || {}).length;
  var scoreInact;
  if (totalConCupo > 0) {
    var conCupoYGestion = 0;
    Object.keys(cuposMap || {}).forEach(function(correo) { if (gestionesPorCorreo[correo]) conCupoYGestion++; });
    scoreInact = (conCupoYGestion / totalConCupo) * 100;
  } else if ((analistasActivos || []).length > 0) {
    var conGestionDeActivos = analistasActivos.filter(function(a) { return gestionesPorCorreo[a.correo]; }).length;
    scoreInact = (conGestionDeActivos / analistasActivos.length) * 100;
  } else { scoreInact = sinActividad ? 0 : 100; }
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

// ============================================================================
// AGENTE COORDINADOR — DIAGNÓSTICO PRINCIPAL
// ============================================================================

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

  // Data quality
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

  // KPIs
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

  var horaKpi = parseInt(Utilities.formatDate(new Date(), TIMEZONE, "HH"), 10);
  var minKpi = parseInt(Utilities.formatDate(new Date(), TIMEZONE, "mm"), 10);
  var horasTranscurridasKpi = horaKpi >= 17 ? 9 : Math.max(1, (horaKpi - 8) + minKpi / 60);
  var totalCuposKpi = 0;
  Object.keys(cuposMap || {}).forEach(function(ck) { totalCuposKpi += (cuposMap[ck].total || 0); });

  var kpis = {
    totalGestionadas: regs.length,
    tiempoGestionProm: cG > 0 ? Math.round(sumaG / cG * 10) / 10 : 0,
    tiempoGeneralProm: cR > 0 ? Number((sumaR / cR).toFixed(2)) : 0,
    tiempoColaProm: cCola > 0 ? Math.round(sumaCola / cCola * 10) / 10 : 0,
    tasaAprobacion: regs.length > 0 ? Math.round(aprobadas / regs.length * 1000) / 10 : 0,
    tasaNegacion: regs.length > 0 ? Math.round(negadas / regs.length * 1000) / 10 : 0,
    backlog: backlog.length,
    backlogVerde: backlog.filter(function(b) { return b.alertaSLA === "verde"; }).length,
    backlogAmarillo: backlog.filter(function(b) { return b.alertaSLA === "amarillo"; }).length,
    backlogRojo: backlog.filter(function(b) { return b.alertaSLA === "rojo"; }).length,
    aprobadas: aprobadas,
    negadas: negadas,
    aplazadas: aplazadas,
    slaPct: slaPct,
    fueraSLA: fueraSLA,
    prodPorTipo: prodPorTipo,
    esperadoHoyEquipo: totalCuposKpi > 0
      ? Math.round(totalCuposKpi * (horasTranscurridasKpi / 9))
      : Math.round(config.metas.solicitudesPorDiaPorAnalista * Math.max(1, analistas.length) * (horasTranscurridasKpi / 9))
  };

  // Seguimiento de personas (simplificado — la lógica completa se delega al diagnóstico)
  var seguimientoPersonas = _agente_construirSeguimientoPersonas(regs, analistas, cuposMap, equipoPorCorreo, config);

  // Rank analistas
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

  var rankAnalistas = Object.keys(porAn).map(function(n) {
    var a = porAn[n];
    return { nombre: n, total: a.total, aprobadas: a.aprobadas, negadas: a.negadas, aplazadas: a.aplazadas, tGestionProm: a.cG > 0 ? Math.round(a.sumaG / a.cG * 10) / 10 : 0, fueraSLA: a.fueraSLA || 0 };
  }).sort(function(a, b) { return b.total - a.total; });

  var ahora = new Date();
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

  var resultado = { alerts: alertas, healthScore: healthScore, dataQuality: dataQuality, kpis: kpis, rankAnalistas: rankAnalistas, seguimientoPersonas: seguimientoPersonas, historicos: historicos, timestamp: timestamp };

  try {
    var json = JSON.stringify(resultado);
    if (json.length < 90000) CacheService.getScriptCache().put(AGENT_DIAG_CACHE_KEY, json, 3600);
  } catch (e) {}

  return resultado;
}

// ============================================================================
// AGENTE — SEGUIMIENTO DE PERSONAS (helper interno)
// ============================================================================

function _agente_construirSeguimientoPersonas(regs, analistas, cuposMap, equipoPorCorreo, config) {
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
    if (!prodPorCorreo[r.correo]) prodPorCorreo[r.correo] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaG: 0, cG: 0, sumaR: 0, cR: 0, sumaCola: 0, cCola: 0, fueraSLA: 0, nombre: r.analista, tipos: {}, motivosNegacion: {}, motivosAplazamiento: {} };
    var p = prodPorCorreo[r.correo];
    p.total++;
    var tipoR = r.tipo || "Otro";
    p.tipos[tipoR] = (p.tipos[tipoR] || 0) + 1;
    if (r.estado === "APROBADO") p.aprobadas++;
    if (r.estado === "RECHAZADO") { p.negadas++; _tallyMotivo(p.motivosNegacion, r.motivoNegacion); }
    if (r.estado === "APLAZADO") { p.aplazadas++; _tallyMotivo(p.motivosAplazamiento, r.motivoAplazamiento); }
    if (r.tGestion !== null) { p.sumaG += r.tGestion; p.cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) { p.sumaR += r.tResolucion; p.cR++; if (r.tResolucion > 2) p.fueraSLA++; }
    if (r.tCola !== null && r.tCola >= 0) { p.sumaCola += r.tCola; p.cCola++; }
  });

  var correosConProd = {};
  Object.keys(prodPorCorreo).forEach(function(k) { correosConProd[k] = true; });

  // Inactivos con cupo
  Object.keys(cuposMap).forEach(function(correo) {
    if (correosConProd[correo]) return;
    var cupo = cuposMap[correo];
    var equipoAn = cupo.equipo || equipoPorCorreo[correo] || "—";
    seguimientoPersonas.push({
      nombre: cupo.nombre || correo,
      tipo: "inactividad",
      severidad: horasOp >= 2 ? "critico" : "advertencia",
      resumen: "Sin gestiones hoy",
      datos: [
        { label: "Gestiones hoy", valor: "0", meta: "de " + cupo.total + " asignadas" },
        { label: "Cupos asignados", valor: String(cupo.total), meta: "" },
        { label: "Equipo", valor: equipoAn, meta: "" },
        { label: "Horas de operación", valor: _admin_fmtMin(horasOp * 60), meta: "" }
      ],
      puntoConversacion: "No ha registrado ninguna gestión en " + Math.round(horasOp) + " horas de operación. Tiene " + cupo.total + " cupos asignados para hoy. Verificar si tiene solicitudes asignadas o si necesita apoyo."
    });
  });

  // Activos sin gestiones NI cupos
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

  // Promedio equipo
  var numAnalistasConDatos = Object.keys(prodPorCorreo).length;
  var promEquipoG = 0;
  if (numAnalistasConDatos > 0) {
    var sTG = 0, sCG = 0;
    Object.keys(prodPorCorreo).forEach(function(k) { var a = prodPorCorreo[k]; if (a.cG > 0) { sTG += a.sumaG; sCG += a.cG; } });
    promEquipoG = sCG > 0 ? Math.round(sTG / sCG * 10) / 10 : 0;
  }

  // Evaluar analistas con producción
  Object.keys(prodPorCorreo).forEach(function(correo) {
    var prod = prodPorCorreo[correo];
    var cupo = cuposMap[correo];
    var nombre = prod.nombre;
    var totalHoy = prod.total;
    var equipoAn2 = cupo ? cupo.equipo : (equipoPorCorreo[correo] || "");
    var motivos = [];

    if (cupo && cupo.total > 0) {
      var esperadoAhora = Math.round(cupo.total * pctJornada);
      var pctCumplido = Math.round(totalHoy / cupo.total * 100);
      if (totalHoy < esperadoAhora * 0.6 && esperadoAhora >= 2) {
        motivos.push({ tipo: "productividad", datos: [{ label: "Gestionadas / Asignadas", valor: totalHoy + " / " + cupo.total, meta: "~" + esperadoAhora + " esperadas a esta hora" }, { label: "Avance", valor: pctCumplido + "%", meta: "de sus cupos del día" }], punto: "Lleva " + totalHoy + " de " + cupo.total + " cupos asignados (" + pctCumplido + "%). A esta hora debería llevar ~" + esperadoAhora + "." });
      }
    }

    if (prod.cG >= 2) {
      var tGProm = Math.round(prod.sumaG / prod.cG * 10) / 10;
      if (tGProm > config.metas.maxTiempoGestionMin) {
        motivos.push({ tipo: "tiempos", datos: [{ label: "T. Gestión promedio", valor: _admin_fmtMin(tGProm), meta: "Meta: " + _admin_fmtMin(config.metas.maxTiempoGestionMin) }, { label: "Promedio equipo", valor: _admin_fmtMin(promEquipoG), meta: "" }], punto: "Su tiempo de gestión promedio (" + _admin_fmtMin(tGProm) + ") supera la meta de " + _admin_fmtMin(config.metas.maxTiempoGestionMin) + "." });
      }
    }

    if (prod.fueraSLA > 0 && prod.cR >= 2) {
      var pctFuera = Math.round(prod.fueraSLA / prod.cR * 1000) / 10;
      motivos.push({ tipo: "sla", datos: [{ label: "Fuera de SLA", valor: prod.fueraSLA + " solicitudes", meta: ">" + config.metas.maxTiempoGeneralHoras + "h" }], punto: prod.fueraSLA + " solicitud(es) superaron las " + config.metas.maxTiempoGeneralHoras + " horas de tiempo general." });
    }

    if (prod.negadas > 0 && prod.total >= 3) {
      var pctNeg = Math.round(prod.negadas / prod.total * 100);
      if (pctNeg > config.metas.maxTasaNegacionPct) {
        var topMotivoNeg = _motivoPrincipal(prod.motivosNegacion);
        motivos.push({ tipo: "negacion", datos: [{ label: "Tasa negación", valor: pctNeg + "%", meta: "Meta: <" + config.metas.maxTasaNegacionPct + "%" }], punto: "Tasa de negación del " + pctNeg + "%." });
      }
    }

    if (prod.aplazadas > 0 && prod.total >= 3) {
      var pctApl = Math.round(prod.aplazadas / prod.total * 100);
      if (pctApl > config.metas.maxTasaAplazamientoPct) {
        motivos.push({ tipo: "aplazamiento", datos: [{ label: "Tasa aplazamiento", valor: pctApl + "%", meta: "Meta: <" + config.metas.maxTasaAplazamientoPct + "%" }], punto: "Tasa de aplazamiento del " + pctApl + "%." });
      }
    }

    if (motivos.length > 0) {
      var sevMax = motivos.some(function(m) { return m.tipo === "inactividad"; }) ? "critico" :
                   motivos.some(function(m) { return m.tipo === "sla" || m.tipo === "productividad" || m.tipo === "negacion"; }) ? "advertencia" : "info";
      seguimientoPersonas.push({
        nombre: nombre,
        tipo: motivos.map(function(m) { return m.tipo; }).join(", "),
        severidad: sevMax,
        equipo: equipoAn2 || "—",
        hallazgos: motivos.map(function(m) { return { tipo: m.tipo, detalle: m.punto }; }),
        datos: motivos.reduce(function(acc, m) { m.datos.forEach(function(d) { var e = acc.some(function(x) { return x.label === d.label; }); if (!e) acc.push(d); }); return acc; }, []),
        puntoConversacion: motivos.map(function(m, i) { return (i + 1) + ". " + m.punto; }).join("\n")
      });
    }
  });

  seguimientoPersonas.sort(function(a, b) {
    var ord = { critico: 0, advertencia: 1, info: 2 };
    return (ord[a.severidad] || 3) - (ord[b.severidad] || 3);
  });

  return seguimientoPersonas;
}

// ============================================================================
// AGENTE — HELPERS DE FORMATO
// ============================================================================

function _admin_fmtMin(min) {
  if (!min || min === 0) return "0m";
  var h = Math.floor(min / 60);
  var m = Math.round(min % 60);
  if (m === 60) { h++; m = 0; }
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  return m + "m";
}

function _admin_fmtHoras(horas) {
  if (!horas || horas === 0) return "0m";
  var totalMin = Math.round(horas * 60);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  return m + "m";
}

function _admin_escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _admin_gradeColor(grade) {
  return grade === "A" ? "#166534" : grade === "B" ? "#253150" : grade === "C" ? "#a16207" : grade === "D" ? "#c2410c" : "#BD0F14";
}

function _admin_gradeBg(grade) {
  return grade === "A" ? "#d1fae5" : grade === "B" ? "#e8edf6" : grade === "C" ? "#fef9c3" : grade === "D" ? "#fed7aa" : "#fde8e8";
}

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

// ============================================================================
// AGENTE — TRIGGERS Y OPERACIÓN PROGRAMADA
// ============================================================================

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

function _agente_tocaPorFrecuencia(bucketAhora, bucketInicio, frecuenciaHoras) {
  var bucketsPorCiclo = Math.max(1, Math.round((frecuenciaHoras || 1) * 2));
  var bucketsDesdeInicio = (bucketAhora - bucketInicio) / 30;
  return bucketsDesdeInicio >= 0 && (bucketsDesdeInicio % bucketsPorCiclo) === 0;
}

function _agente_notificarSiFallo(nombreCorreo, resultado) {
  if (!resultado || resultado.sent) return;
  if (AGENT_RAZONES_NO_ALERTAR.indexOf(resultado.reason) !== -1) return;
  try {
    MailApp.sendEmail({
      to: BCC_REPORTES_AGENTE,
      subject: "⚠ Agente Coordinador: \"" + nombreCorreo + "\" no se envió",
      htmlBody: '<p style="font-family:Arial,sans-serif;font-size:14px;">El correo automático <b>' + _admin_escHtml(nombreCorreo) + '</b> no se pudo enviar.</p>' +
        '<p style="font-family:Arial,sans-serif;font-size:14px;"><b>Motivo:</b> ' + _admin_escHtml(String(resultado.reason || "desconocido")) + '</p>' +
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

  var bucketAhora = Math.floor(minutosAhora / 30) * 30;
  var bucketInicio = Math.floor(minutosInicio / 30) * 30;
  var bucketFin = Math.floor(minutosFin / 30) * 30;

  // 0) Inicio de Operación
  if (bucketAhora === bucketInicio && noti.enviarInicioOperacion) {
    try { _agente_notificarSiFallo("Inicio de Operación", agente_enviarInicioOperacion()); }
    catch (e) { Logger.log("Error en inicio de operación: " + e.message); _agente_notificarSiFallo("Inicio de Operación", { sent: false, reason: e.message }); }
  }

  // 0b) Chequeo de Conexión
  var bucketChequeo = bucketInicio + Math.max(30, Math.round((noti.chequeoConexionOffsetMin || 30) / 30) * 30);
  if (bucketAhora === bucketChequeo && noti.enviarChequeoConexion) {
    try { _agente_notificarSiFallo("Chequeo de Conexión", agente_enviarChequeoConexion()); }
    catch (e) { Logger.log("Error en chequeo de conexión: " + e.message); _agente_notificarSiFallo("Chequeo de Conexión", { sent: false, reason: e.message }); }
  }

  // 1) Alertas críticas
  if (dentroDeVentana && noti.enviarAlertasCriticas && _agente_tocaPorFrecuencia(bucketAhora, bucketInicio, noti.alertasCriticasFrecuenciaHoras)) {
    try {
      var diagnostico = agente_ejecutarDiagnostico();
      var criticas = diagnostico.alerts.filter(function(a) { return a.severity === "critico"; });
      if (criticas.length > 0) _agente_notificarSiFallo("Alertas Críticas", agente_enviarAlertasCriticas(diagnostico));
    } catch (e) { Logger.log("Error en revisión de alertas críticas: " + e.message); _agente_notificarSiFallo("Alertas Críticas", { sent: false, reason: e.message }); }
  }

  // 2) Foto del Momento
  if (dentroDeVentana && noti.enviarFotoMomento && _agente_tocaPorFrecuencia(bucketAhora, bucketInicio, noti.fotoMomentoFrecuenciaHoras)) {
    try { _agente_notificarSiFallo("Foto del Momento", agente_enviarSnapshotActual()); }
    catch (e) { Logger.log("Error en Foto del Momento: " + e.message); _agente_notificarSiFallo("Foto del Momento", { sent: false, reason: e.message }); }
  }

  // 3) Resumen Diario + Reporte de Biometría
  if (bucketAhora === bucketFin) {
    if (noti.enviarResumenDiario) {
      try { _agente_notificarSiFallo("Resumen Diario", agente_enviarResumenDiario()); }
      catch (e) { Logger.log("Error en resumen diario: " + e.message); _agente_notificarSiFallo("Resumen Diario", { sent: false, reason: e.message }); }
    }
    if (noti.enviarResumenBiometria) {
      try { _agente_notificarSiFallo("Reporte de Biometría", agente_enviarReporteBiometria()); }
      catch (e) { Logger.log("Error en reporte de biometría: " + e.message); _agente_notificarSiFallo("Reporte de Biometría", { sent: false, reason: e.message }); }
    }
    // Informe Individual Semanal
    if (noti.enviarInformeIndividual && dia === (noti.informeIndividualDiaISO || 5)) {
      try { _agente_notificarSiFallo("Informe Individual Semanal", agente_enviarInformeIndividualAnalistas()); }
      catch (e) { Logger.log("Error en informe individual semanal: " + e.message); _agente_notificarSiFallo("Informe Individual Semanal", { sent: false, reason: e.message }); }
    }
  }
}

function agente_instalarTriggers() {
  agente_desinstalarTriggers();
  ScriptApp.newTrigger("agente_triggerOperacion").timeBased().everyMinutes(30).create();
  return { success: true, message: "Trigger instalado: Inicio de Operación, Chequeo de Conexión, alertas críticas, Foto del Momento y Resumen Diario, según Horario de Reporte configurado." };
}

function agente_desinstalarTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (AGENT_TRIGGER_FNS.indexOf(fn) !== -1) { ScriptApp.deleteTrigger(t); }
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

// ============================================================================
// AGENTE — ENVÍO DE EMAILS (stubs que delegan a las funciones de email originales)
// Las funciones de construcción de HTML de correo (_construirEmailAlertas,
// _construirEmailResumenDiario, etc.) permanecen en Código.js ya que son puramente
// de presentación y no interactúan con la capa de datos.
// ============================================================================

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
    MailApp.sendEmail({ to: email, bcc: BCC_REPORTES_AGENTE, subject: "ALERTA CRÍTICA | " + criticas.length + " situación(es) requiere(n) atención | " + fecha + " " + hora, htmlBody: html, name: NOMBRE_REMITENTE_AGENTE, noReply: true });
    return { sent: true, to: email, alertCount: criticas.length };
  } catch (e) { Logger.log("Error enviando email de alertas: " + e.message); return { sent: false, reason: e.message }; }
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
  var datosBio = null; try { datosBio = obtenerDatosBiometria(hoy, hoy); } catch (e) {}
  var datosCola = null; try { datosCola = obtenerColaAsignacion(); } catch (e) {}
  var datosRadicado = null; try { datosRadicado = obtenerDatosMetricas(fecha, fecha); } catch (e) {}
  var datosCierre = null; try { datosCierre = obtenerResumenEstadoSAICierre(hoy, hoy); } catch (e) {}
  var html = _construirEmailResumenDiario(diagnostico, datosBio, datosCola, null, datosRadicado, null, datosCierre);
  try {
    MailApp.sendEmail({ to: email, bcc: BCC_REPORTES_AGENTE, subject: "Cierre del Día | Salud " + (hs.score || "—") + "/100 (" + (hs.grade || "—") + ") | " + fecha, htmlBody: html, name: NOMBRE_REMITENTE_AGENTE, noReply: true });
    return { sent: true, to: email };
  } catch (e) { Logger.log("Error enviando resumen diario: " + e.message); return { sent: false, reason: e.message }; }
}

function agente_enviarResumenManual() { return agente_enviarResumenDiario(); }

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
  var datosBio = null; try { datosBio = obtenerDatosBiometria(hoy, hoy); } catch (e) {}
  var datosCola = null; try { datosCola = obtenerColaAsignacion(); } catch (e) {}
  var datosRadicado = null; try { datosRadicado = obtenerDatosMetricas(fecha, fecha); } catch (e) {}
  var datosCorteGestion = null; try { datosCorteGestion = agente_obtenerCorteGestion(); } catch (e) {}
  var datosCierre = null; try { datosCierre = obtenerResumenEstadoSAICierre(hoy, hoy); } catch (e) {}
  var html = _construirEmailResumenDiario(diagnostico, datosBio, datosCola, "Foto del Momento", datosRadicado, datosCorteGestion, datosCierre);
  var atencion = datosCorteGestion && datosCorteGestion.analistas ? datosCorteGestion.analistas.filter(function(a) { return a.semaforo === "rojo" || a.semaforo === "amarillo"; }).length : null;
  var subject = "Foto del Momento | Salud " + (hs.score || "—") + "/100 (" + (hs.grade || "—") + ")" + (atencion !== null ? " | " + atencion + " requieren atención" : "") + " | " + fecha + " " + hora;
  try {
    MailApp.sendEmail({ to: email, bcc: BCC_REPORTES_AGENTE, subject: subject, htmlBody: html, name: NOMBRE_REMITENTE_AGENTE, noReply: true });
    return { sent: true, to: email };
  } catch (e) { Logger.log("Error enviando foto del momento: " + e.message); return { sent: false, reason: e.message }; }
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
  try { datosBio = obtenerDatosBiometria(hoy, hoy); } catch (e) { return { sent: false, reason: e.message }; }
  if (!datosBio || datosBio.totalConsultadas === 0) return { sent: false, reason: "sin datos de biometría hoy" };
  var datosCierre;
  try { datosCierre = obtenerResumenEstadoSAICierre(hoy, hoy); } catch (e) { datosCierre = null; }
  var topPolizas;
  try { topPolizas = obtenerTopPolizasPendientesBiometria(); } catch (e) { topPolizas = []; }
  var datosCanon;
  try { datosCanon = obtenerPendientesPorRangoCanon(hoy, hoy); } catch (e) { datosCanon = null; }
  var html = _construirEmailReporteBiometria(datosBio, fecha, datosCierre, topPolizas, datosCanon);
  try {
    MailApp.sendEmail({ to: email, bcc: BCC_REPORTES_AGENTE, subject: "Reporte Biometría del Día | " + datosBio.totalConsultadas + " consultadas · " + datosBio.tasaConversion + "% conversión | " + fecha, htmlBody: html, name: NOMBRE_REMITENTE_AGENTE, noReply: true });
    return { sent: true, to: email };
  } catch (e) { Logger.log("Error enviando reporte de biometría: " + e.message); return { sent: false, reason: e.message }; }
}

function agente_enviarReporteBiometriaManual() { return agente_enviarReporteBiometria(); }

function agente_enviarInicioOperacion() {
  var config = agente_obtenerConfig();
  var emails = _obtenerDestinatarios(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");
  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hora = Utilities.formatDate(ahora, TIMEZONE, "HH:mm");
  var datosCola = null; try { datosCola = obtenerColaAsignacion(); } catch (e) {}
  var datosRadicado = null; try { datosRadicado = obtenerDatosMetricas(fecha, fecha); } catch (e) {}
  var html = _construirEmailInicioOperacion(datosCola, datosRadicado, fecha);
  try {
    MailApp.sendEmail({ to: email, bcc: BCC_REPORTES_AGENTE, subject: "Inicio de Operación | " + ((datosCola && datosCola.total) || 0) + " en cola, " + ((datosRadicado && datosRadicado.totalRadicadas) || 0) + " radicadas | " + fecha + " " + hora, htmlBody: html, name: NOMBRE_REMITENTE_AGENTE, noReply: true });
    return { sent: true, to: email };
  } catch (e) { Logger.log("Error enviando inicio de operación: " + e.message); return { sent: false, reason: e.message }; }
}

function agente_enviarInicioOperacionManual() { return agente_enviarInicioOperacion(); }

function agente_enviarChequeoConexion() {
  var config = agente_obtenerConfig();
  var emails = _obtenerDestinatarios(config);
  if (emails.length === 0) return { sent: false, reason: "sin destinatarios" };
  var email = emails.join(",");
  var ahora = new Date();
  var fecha = Utilities.formatDate(ahora, TIMEZONE, "dd/MM/yyyy");
  var hora = Utilities.formatDate(ahora, TIMEZONE, "HH:mm");
  var seguimiento;
  try { seguimiento = admin_obtenerAsesoresActivosPrimerResultado(); }
  catch (e) { return { sent: false, reason: e.message }; }
  var todos = seguimiento.datos || [];
  if (todos.length === 0) return { sent: false, reason: "sin analistas registrados en Usuarios" };
  var primeraAsignacion = {};
  try { primeraAsignacion = _agente_obtenerPrimeraAsignacionHoy(); } catch (e) {}
  var listaActivos = [];
  var porEstado = {};
  todos.forEach(function(a) {
    if (String(a.estado || "").toUpperCase() === "ACTIVO") {
      listaActivos.push({ nombre: a.nombre, correo: a.correo, primeraAsignacion: primeraAsignacion[a.correo] || null, primerResultado: a.primerResultado || null, gestionadas: a.gestionadas || 0 });
    } else {
      var estado = a.estado || "SIN ESTADO";
      if (!porEstado[estado]) porEstado[estado] = [];
      porEstado[estado].push(a.nombre);
    }
  });
  var totalNoActivos = Object.keys(porEstado).reduce(function(acc, k) { return acc + porEstado[k].length; }, 0);
  var html = _construirEmailChequeoConexion(listaActivos, porEstado, fecha, hora, config.notificaciones.chequeoConexionOffsetMin);
  try {
    MailApp.sendEmail({ to: email, bcc: BCC_REPORTES_AGENTE, subject: "Chequeo de Conexión | " + listaActivos.length + " activos, " + totalNoActivos + " no activos | " + fecha + " " + hora, htmlBody: html, name: NOMBRE_REMITENTE_AGENTE, noReply: true });
    return { sent: true, to: email, activos: listaActivos.length, noActivos: totalNoActivos };
  } catch (e) { Logger.log("Error enviando chequeo de conexión: " + e.message); return { sent: false, reason: e.message }; }
}

function agente_enviarChequeoConexionManual() { return agente_enviarChequeoConexion(); }

// ============================================================================
// AGENTE — PRIMERA ASIGNACIÓN HOY
// ============================================================================

function _agente_obtenerPrimeraAsignacionHoy() {
  var hoyStr = Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy");
  var primeraAsignacion = {};

  var data = obtenerHistoricoGestiones();
  for (var i = 1; i < data.length; i++) {
    var fila = data[i];
    var correo = String(fila[COL_HISTORICO.CORREO_ANALISTA] || "").toLowerCase().trim();
    var fechaAsigRaw = String(fila[COL_HISTORICO.FECHA_ASIGNACION] || "").trim();
    if (!correo || !fechaAsigRaw || !_admin_coincideFecha(fechaAsigRaw, hoyStr)) continue;
    var partes = fechaAsigRaw.split(" ");
    var hora = normalizarHora(partes[1] || "");
    if (!hora) continue;
    if (!primeraAsignacion[correo] || hora < primeraAsignacion[correo]) primeraAsignacion[correo] = hora;
  }

  var dataReest = obtenerHojaReestudios();
  if (dataReest && dataReest.length > 1) {
    for (var j = 1; j < dataReest.length; j++) {
      var correoR = String(dataReest[j][COL_REESTUDIOS.CORREO_ANALISTA] || "").toLowerCase().trim();
      var fechaAsigR = String(dataReest[j][COL_REESTUDIOS.FECHA_ASIGNACION] || "").trim();
      if (!correoR || !fechaAsigR || !_admin_coincideFecha(fechaAsigR, hoyStr)) continue;
      var partesR = fechaAsigR.split(" ");
      var horaR = normalizarHora(partesR[1] || "");
      if (!horaR) continue;
      if (!primeraAsignacion[correoR] || horaR < primeraAsignacion[correoR]) primeraAsignacion[correoR] = horaR;
    }
  }

  return primeraAsignacion;
}

// ============================================================================
// AGENTE — INFORME INDIVIDUAL SEMANAL
// ============================================================================

function _agente_calcularRendimientoSemanal() {
  var hoy = new Date();
  var diaISOHoy = parseInt(Utilities.formatDate(hoy, TIMEZONE, "u"), 10);
  var lunesActual = new Date(hoy);
  lunesActual.setDate(hoy.getDate() - (diaISOHoy - 1));
  lunesActual.setHours(0, 0, 0, 0);
  var lunesAnterior = new Date(lunesActual);
  lunesAnterior.setDate(lunesActual.getDate() - 7);

  var desdeStr = Utilities.formatDate(lunesAnterior, TIMEZONE, "dd/MM/yyyy");
  var hastaStr = Utilities.formatDate(hoy, TIMEZONE, "dd/MM/yyyy");
  var datos = _agente_leerDatosRango(desdeStr, hastaStr);
  var registros = (datos && datos.registros) || [];

  var topDiaISO = Math.min(diaISOHoy, 5);
  var diasActual = [];
  for (var d = 1; d <= topDiaISO; d++) {
    var f = new Date(lunesActual);
    f.setDate(lunesActual.getDate() + (d - 1));
    diasActual.push(Utilities.formatDate(f, TIMEZONE, "dd/MM/yyyy"));
  }
  var diasPrev = diasActual.map(function(fStr) {
    var dt = parsearFecha(fStr);
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
      porAnalista[r.correo] = { nombre: r.analista, correo: r.correo, actual: { total: 0, sumaG: 0, cG: 0, dentroSLA: 0, totalSLA: 0 }, prev: { total: 0, sumaG: 0, cG: 0, dentroSLA: 0, totalSLA: 0 }, porDia: {} };
    }
    var a = porAnalista[r.correo];
    a.porDia[r.fecha] = (a.porDia[r.fecha] || 0) + 1;
    if (!enActual && !enPrev) return;
    var bucket = enActual ? a.actual : a.prev;
    bucket.total++;
    if (r.tGestion !== null) { bucket.sumaG += r.tGestion; bucket.cG++; }
    if (r.tResolucion !== null && r.tResolucion > 0) { bucket.totalSLA++; if (r.tResolucion <= 2) bucket.dentroSLA++; }
  });

  var config = agente_obtenerConfig();
  var diasHabiles = (config.horarioReporte && config.horarioReporte.dias) || {};

  var resultado = Object.keys(porAnalista).map(function(correo) {
    var a = porAnalista[correo];
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
      nombre: a.nombre, correo: a.correo, gestionadas: a.actual.total, gestionadasPrev: a.prev.total,
      tiempoProm: a.actual.cG > 0 ? Math.round(a.actual.sumaG / a.actual.cG * 10) / 10 : null,
      tiempoPromPrev: a.prev.cG > 0 ? Math.round(a.prev.sumaG / a.prev.cG * 10) / 10 : null,
      slaPct: a.actual.totalSLA > 0 ? Math.round(a.actual.dentroSLA / a.actual.totalSLA * 1000) / 10 : null,
      slaPctPrev: a.prev.totalSLA > 0 ? Math.round(a.prev.dentroSLA / a.prev.totalSLA * 1000) / 10 : null,
      racha: racha
    };
  });

  return { fechaDesdeActual: diasActual[0], fechaHastaActual: diasActual[diasActual.length - 1], fechaDesdePrev: diasPrev[0], fechaHastaPrev: diasPrev[diasPrev.length - 1], porAnalista: resultado };
}

function agente_contarCandidatosInformeIndividual() {
  var rendimiento = _agente_calcularRendimientoSemanal();
  var candidatos = rendimiento.porAnalista.filter(function(m) { return m.gestionadas > 0 && m.correo; });
  return { total: candidatos.length, fechaDesdeActual: rendimiento.fechaDesdeActual, fechaHastaActual: rendimiento.fechaHastaActual };
}

function agente_enviarInformeIndividualAnalistas(correoPrueba) {
  var rendimiento = _agente_calcularRendimientoSemanal();
  var rango = { fechaDesdeActual: rendimiento.fechaDesdeActual, fechaHastaActual: rendimiento.fechaHastaActual };
  var candidatos = rendimiento.porAnalista.filter(function(m) { return m.gestionadas > 0 && m.correo; });

  if (!correoPrueba && candidatos.length === 0) {
    return { sent: false, modo: "masivo", enviados: 0, totalCandidatos: 0, fallidos: [], reason: "sin analistas con gestiones esta semana" };
  }

  if (correoPrueba) {
    var muestra = candidatos[0] || { nombre: "Analista", correo: correoPrueba, gestionadas: 0, gestionadasPrev: null, tiempoProm: null, tiempoPromPrev: null, slaPct: null, slaPctPrev: null, racha: 0 };
    try {
      MailApp.sendEmail({ to: correoPrueba, subject: "[PRUEBA] Tu resumen de la semana · " + rango.fechaDesdeActual + " al " + rango.fechaHastaActual, htmlBody: _construirEmailInformeIndividual(muestra, rango), name: NOMBRE_REMITENTE_AGENTE, noReply: true });
      return { sent: true, modo: "prueba", to: correoPrueba, muestraDe: muestra.nombre };
    } catch (e) { return { sent: false, modo: "prueba", reason: e.message }; }
  }

  var enviados = 0, fallidos = [];
  candidatos.forEach(function(m) {
    try {
      MailApp.sendEmail({ to: m.correo, subject: "Tu resumen de la semana · " + rango.fechaDesdeActual + " al " + rango.fechaHastaActual, htmlBody: _construirEmailInformeIndividual(m, rango), name: NOMBRE_REMITENTE_AGENTE, noReply: true });
      enviados++;
    } catch (e) { fallidos.push({ correo: m.correo, reason: e.message }); }
  });
  return { sent: enviados > 0, modo: "masivo", enviados: enviados, totalCandidatos: candidatos.length, fallidos: fallidos };
}

function agente_enviarInformeIndividualManual(correoPrueba) {
  if (!correoPrueba) throw new Error("agente_enviarInformeIndividualManual requiere un correo de prueba.");
  return agente_enviarInformeIndividualAnalistas(correoPrueba);
}

// ============================================================================
// AGENTE — CORTE DE GESTIÓN
// ============================================================================

function agente_obtenerCorteGestion() {
  var config = agente_obtenerConfig();
  var seguimiento;
  try { seguimiento = admin_obtenerAsesoresActivosPrimerResultado(); }
  catch (e) { seguimiento = { datos: [] }; }
  var activos = (seguimiento.datos || []).filter(function(a) { return String(a.estado || "").toUpperCase() === "ACTIVO"; });

  var historicos;
  try { historicos = agente_calcularPromediosHistoricos(); }
  catch (e) { historicos = { porAnalista: {} }; }

  var estadosPorCorreo = {};
  try { estadosPorCorreo = _agente_leerHistoricoEstadosHoy(); } catch (e) {}

  var umbralPausaMin = (config.metas && config.metas.umbralMinutosPausa) || 90;
  var hr = config.horarioReporte || DEFAULT_AGENT_CONFIG.horarioReporte;
  var diaHoy = parseInt(Utilities.formatDate(new Date(), TIMEZONE, "u"), 10);
  var diaCfgHoy = (hr.dias || {})[String(diaHoy)];
  var minutosInicioHoy = _horaMinToMinutos(diaCfgHoy && diaCfgHoy.horaInicio, 8 * 60);

  var analistas = activos.map(function(a) {
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
    var gestionadas = a.gestionadas || 0;
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
      nombre: a.nombre, correo: a.correo, equipo: a.especialidad || "Sin Equipo",
      gestionadas: gestionadas, aprobadas: 0, negadas: 0, aplazadas: 0,
      tiempoGestionProm: a.promedioGestion || 0,
      estadoActual: estadosInfo.estadoActual || "ACTIVO",
      minutosProductivos: Math.round(minutosProductivos),
      minutosNoProductivos: Math.round(minutosNoProductivos),
      desglosePausas: desglosePausas,
      pausaExcedida: minutosNoProductivos > umbralPausaMin,
      esperado: esperado, pctCumplimiento: pctCumplimiento, semaforo: semaforo,
      horaPrimeraConexion: horaPrimeraConexion, conectadoAntesDeHorario: conectadoAntesDeHorario
    };
  });

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

  return { fecha: Utilities.formatDate(new Date(), TIMEZONE, "dd/MM/yyyy"), hora: Utilities.formatDate(new Date(), TIMEZONE, "HH:mm"), umbralPausaMin: umbralPausaMin, analistas: analistas, equipos: equipos };
}

// ============================================================================
// AGENTE — HISTORICO DE ESTADOS (lectura desde hoja Historico_Estados)
// ============================================================================

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
      if (!fecha || !_admin_coincideFecha(fecha, hoyStr)) continue;
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

      var horaInicioNorm = normalizarHora(horaInicio);
      if (horaInicioNorm && (!reg.horaPrimeraConexion || horaInicioNorm < reg.horaPrimeraConexion)) {
        reg.horaPrimeraConexion = horaInicioNorm;
      }
      if (!horaFin) {
        if (!reg.horaInicioActual || horaInicioNorm > reg.horaInicioActual) {
          reg.estadoActual = estado;
          reg.horaInicioActual = horaInicioNorm;
        }
      }
    }
  } catch (e) { Logger.log("Aviso: No se pudo leer Historico_Estados: " + e.message); }
  return porAnalista;
}

// ============================================================================
// AGENTE — FUNCIÓN PRINCIPAL PARA FRONTEND
// ============================================================================

function agente_obtenerDatosDashboard() {
  var cache = CacheService.getScriptCache();
  var diagnostico = null;
  try {
    var cached = cache.get(AGENT_DIAG_CACHE_KEY);
    if (cached) diagnostico = JSON.parse(cached);
  } catch (e) {}

  if (!diagnostico) { diagnostico = agente_ejecutarDiagnostico(); }

  var config = agente_obtenerConfig();
  var history = agente_obtenerHistorialAlertas();
  var triggerStatus = { installed: false, triggers: [], count: 0 };
  try { triggerStatus = agente_obtenerEstadoTriggers(); } catch (e) {}

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
