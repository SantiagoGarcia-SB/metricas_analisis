/**
 * BigQuerySync.js — Sincronización de gestiones unificadas a BigQuery.
 *
 * Une Historico_Gestiones (general), Historico_Gestiones (reestudios),
 * rechazado_gestion_directa y pendiente_biometria en una sola tabla.
 *
 * Refactorizado para:
 *   - Usar Capa_de_Datos (01_Datos.js) con memoización y CacheService
 *   - Soportar sincronización incremental (WRITE_APPEND) con fallback a completa (WRITE_TRUNCATE)
 *   - Almacenar marca de tiempo de última sync exitosa en PropertiesService
 *
 * Dependencias (scope global):
 *   - 00_Config.js: BQ_CONFIG, BQ_SCHEMA, SAI_CONFIG, COL_HISTORICO, COL_REESTUDIOS, COL_BIOMETRIA,
 *                   TARGET_SOLICITUDES_SS_ID, SHEET_NAME_SOLICITUDES, ID_HOJA_REESTUDIOS,
 *                   NOMBRE_PESTANA_REESTUDIOS, ID_HOJA_BIOMETRIA
 *   - 01_Datos.js: obtenerHistoricoGestiones(), obtenerHojaReestudios(), obtenerHojaBiometria(),
 *                  cargarDiccionarioScore()
 *   - 02_Utilidades.js: obtenerSucursalPorPoliza(), obtenerSegmentoInmobiliaria()
 */

// ── Constante de PropertiesService ──

var BQ_PROP_ULTIMA_SYNC = "BQ_ULTIMA_SYNC";

// ── Helpers de limpieza ──

function _limpiarNumero(val) {
  if (!val) return '0';
  var n = String(val).trim().replace(',', '.');
  var parsed = parseFloat(n);
  return isNaN(parsed) ? '0' : String(parsed);
}

function _limpiarFecha(val) {
  if (!val) return '';
  var s = String(val).trim().split(' ')[0];
  var d, m, y, p;
  if (s.indexOf('/') > -1) {
    p = s.split('/');
    if (p.length !== 3) return s;
    d = p[0]; m = p[1]; y = p[2];
  } else if (s.indexOf('-') > -1) {
    p = s.split('-');
    if (p.length !== 3) return s;
    if (p[0].length === 4) { y = p[0]; m = p[1]; d = p[2]; }
    else { d = p[0]; m = p[1]; y = p[2]; }
  } else {
    return s;
  }
  if (y.length === 2) y = '20' + y;
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function _formatearDuracion(minutos) {
  if (isNaN(minutos) || minutos <= 0) return '0 min';
  if (minutos < 60) return Math.round(minutos) + ' min';
  var h = Math.floor(minutos / 60);
  var m = Math.round(minutos % 60);
  return h + 'h ' + m + 'min';
}

function _trim(val) {
  return val ? String(val).trim() : '';
}

// ── Campos derivados y estado definitivo ──

function _calcularCamposDerivados(fila, scoreMap) {
  var estado = String(fila.estado || '').toUpperCase();
  var fechaFin = String(fila.fecha_fin || '').trim();
  var origen = fila.origen;

  var esGestionada = (fechaFin !== '' && (origen === 'GENERAL' || origen === 'REESTUDIO')) ? '1' : '0';

  var estadoLabel = '';
  if (estado.indexOf('APROB') > -1 && estado.indexOf('PENDIENTE') === -1) estadoLabel = 'APROBADO';
  else if (estado.indexOf('NEGAD') > -1 || estado.indexOf('RECHAZ') > -1) estadoLabel = 'RECHAZADO';
  else if (estado.indexOf('APLAZ') > -1) estadoLabel = 'APLAZADO';
  else if (estado !== '') estadoLabel = 'OTRO';

  var fechaCierre = _limpiarFecha(fila.fecha_fin);

  var minutosGen = parseFloat(fila.minutos_general);
  var horasGen = !isNaN(minutosGen) ? minutosGen / 60 : NaN;
  var fueraSla = (!isNaN(horasGen) && horasGen > 2 && esGestionada === '1') ? '1' : '0';

  var fechaAsig = String(fila.fecha_asignacion || '').trim();
  var esBacklog = (fechaAsig !== '' && fechaFin === '' && (origen === 'GENERAL' || origen === 'REESTUDIO')) ? '1' : '0';

  var clase = String(fila.clase || '').toUpperCase();
  var tipoSol = '';
  if (origen === 'REESTUDIO') tipoSol = 'Reestudio';
  else if (origen === 'NEGACION_DIRECTA') tipoSol = 'Negación Directa';
  else if (origen === 'BIOMETRIA') tipoSol = 'Biometría';
  else if (estado.indexOf('BIOMETRIA') > -1) tipoSol = 'Biometría';
  else if (clase === 'INDUCCION' || clase === 'INDUCCIÓN') tipoSol = 'Inducción';
  else tipoSol = 'Digital';

  var horasGeneralStr = !isNaN(minutosGen) && minutosGen > 0 ? String(Math.round(minutosGen / 60 * 100) / 100) : '0';
  var dentroSla = (!isNaN(horasGen) && horasGen <= 2 && esGestionada === '1') ? '1' : '0';

  var esAprobadoNum = estadoLabel === 'APROBADO' ? '1' : '0';
  var esRechazadoNum = estadoLabel === 'RECHAZADO' ? '1' : '0';
  var esAplazadoNum = estadoLabel === 'APLAZADO' ? '1' : '0';

  fila.es_gestionada = esGestionada;
  fila.estado_label = estadoLabel;
  fila.fecha_cierre = fechaCierre;
  fila.fuera_sla = fueraSla;
  fila.es_backlog = esBacklog;
  fila.tipo_solicitud = tipoSol;
  fila.horas_general = horasGeneralStr;
  fila.dentro_sla = dentroSla;
  fila.es_aprobado_num = esAprobadoNum;
  fila.es_rechazado_num = esRechazadoNum;
  fila.es_aplazado_num = esAplazadoNum;

  var poliza = String(fila.poliza || '').trim();
  var infoSeg = obtenerSegmentoInmobiliaria(poliza, scoreMap);
  fila.inmobiliaria = infoSeg.inmobiliaria;
  fila.segmento = infoSeg.segmento;

  var fechaFinCompleta = String(fila._fecha_fin_raw || fila.fecha_fin || '').trim();
  var horaCierre = '';
  if (fechaFinCompleta.indexOf(' ') > -1) {
    var partes = fechaFinCompleta.split(' ');
    if (partes.length >= 2) {
      var hm = partes[1].split(':');
      if (hm.length >= 1) horaCierre = hm[0];
    }
  }
  fila.hora_cierre = horaCierre || '0';
  fila.fecha_fin_completa = fechaFinCompleta;

  var mgNum = parseFloat(fila.minutos_gestion);
  var mcNum = parseFloat(fila.minutos_cola);
  var mgralNum = parseFloat(fila.minutos_general);
  fila.t_gestion_fmt = _formatearDuracion(mgNum);
  fila.t_cola_fmt = _formatearDuracion(mcNum);
  fila.t_general_fmt = _formatearDuracion(mgralNum);

  fila.es_rechazado_sai = (origen === 'NEGACION_DIRECTA') ? '1' : '0';

  return fila;
}

function _marcarEstadoDefinitivo(filas) {
  var grupos = {};
  for (var i = 0; i < filas.length; i++) {
    filas[i].es_estado_definitivo = '0';
    if (filas[i].es_gestionada !== '1') continue;

    var key = String(filas[i].solicitud).trim();
    if (!key) continue;

    if (!grupos[key]) {
      grupos[key] = { idx: i, fecha: filas[i].fecha_cierre || '' };
    } else {
      if ((filas[i].fecha_cierre || '') > grupos[key].fecha) {
        grupos[key] = { idx: i, fecha: filas[i].fecha_cierre || '' };
      }
    }
  }

  var keys = Object.keys(grupos);
  for (var j = 0; j < keys.length; j++) {
    filas[grupos[keys[j]].idx].es_estado_definitivo = '1';
  }
}

// ── Función principal refactorizada ──

function sincronizarBigQuery() {
  _crearDatasetSiNoExiste();

  var inicioSync = Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd'T'HH:mm:ss");
  var props = PropertiesService.getScriptProperties();
  var ultimaSync = props.getProperty(BQ_PROP_ULTIMA_SYNC);

  var modo = _determinarModoSync(ultimaSync);
  var exito = false;

  if (modo === 'incremental') {
    exito = _syncIncremental(ultimaSync);
    if (!exito) {
      Logger.log('Sync incremental falló, ejecutando completa como fallback.');
      exito = _syncCompleta();
    }
  } else {
    exito = _syncCompleta();
  }

  if (exito) {
    props.setProperty(BQ_PROP_ULTIMA_SYNC, inicioSync);
    Logger.log('Marca de sync almacenada: ' + inicioSync);
  }
}

// ── Determinación de modo de sincronización ──

/**
 * Determina si debe ejecutar sync incremental o completa.
 * - Si no hay marca previa → completa
 * - Si >50% de filas son nuevas/modificadas → completa
 * - En otro caso → incremental
 *
 * @param {string|null} ultimaSync - ISO timestamp de última sync o null
 * @returns {'incremental'|'completa'}
 */
function _determinarModoSync(ultimaSync) {
  if (!ultimaSync) return 'completa';

  try {
    var dataHistorico = obtenerHistoricoGestiones();
    var totalFilas = dataHistorico.length - 1; // sin encabezados
    if (totalFilas <= 0) return 'completa';

    var filasNuevas = 0;
    for (var i = 1; i < dataHistorico.length; i++) {
      var fechaFinRaw = String(dataHistorico[i][COL_HISTORICO.FECHA_FIN] || '').trim();
      var fechaFinLimpia = _limpiarFecha(fechaFinRaw);
      // Filas sin fecha_fin o con fecha_fin posterior a la última sync
      if (fechaFinLimpia === '' || fechaFinLimpia > ultimaSync.substring(0, 10)) {
        filasNuevas++;
      }
    }

    // Si >50% son nuevas, sync completa es más eficiente
    if (filasNuevas > totalFilas * 0.5) return 'completa';
    return 'incremental';
  } catch (e) {
    Logger.log('Error determinando modo sync: ' + e.message + '. Usando completa.');
    return 'completa';
  }
}

// ── Sincronización incremental ──

/**
 * Ejecuta sincronización incremental: solo filas con fecha_fin > últimaSync o sin fecha_fin.
 * Usa WRITE_APPEND.
 *
 * @param {string} ultimaSyncISO - Marca de tiempo ISO de última sync exitosa
 * @returns {boolean} true si exitosa
 */
function _syncIncremental(ultimaSyncISO) {
  try {
    var scoreMap = cargarDiccionarioScore();
    var umbralFecha = ultimaSyncISO.substring(0, 10); // yyyy-MM-dd

    var general = _leerGeneral(scoreMap);
    var dictClientes = _construirDiccionarioClientes(general);
    var reestudios = _leerReestudios(dictClientes, scoreMap);
    var rechazados = _leerRechazados(scoreMap);
    var biometrias = _leerBiometria(scoreMap);

    var todas = general.concat(reestudios).concat(rechazados).concat(biometrias);

    // Filtrar solo filas con fecha_fin posterior a la última sync o sin fecha_fin
    var filasIncremental = [];
    for (var i = 0; i < todas.length; i++) {
      todas[i] = _calcularCamposDerivados(todas[i], scoreMap);
      var fechaFinLimpia = String(todas[i].fecha_cierre || '').trim();
      if (fechaFinLimpia === '' || fechaFinLimpia > umbralFecha) {
        filasIncremental.push(todas[i]);
      }
    }

    _marcarEstadoDefinitivo(todas);

    // Re-filtrar después de marcar estado definitivo (para que el campo esté actualizado)
    var filasAEnviar = [];
    for (var j = 0; j < todas.length; j++) {
      var fc = String(todas[j].fecha_cierre || '').trim();
      if (fc === '' || fc > umbralFecha) {
        filasAEnviar.push(todas[j]);
      }
    }

    if (filasAEnviar.length === 0) {
      Logger.log('Sync incremental: 0 filas nuevas.');
      return true;
    }

    _cargarEnBigQuery(filasAEnviar, 'WRITE_APPEND');
    Logger.log('Sync incremental completada: ' + filasAEnviar.length + ' filas.');
    return true;
  } catch (e) {
    Logger.log('Error en sync incremental: ' + e.message);
    return false;
  }
}

// ── Sincronización completa ──

/**
 * Ejecuta sincronización completa con WRITE_TRUNCATE.
 *
 * @returns {boolean} true si exitosa
 */
function _syncCompleta() {
  try {
    var scoreMap = cargarDiccionarioScore();
    var general = _leerGeneral(scoreMap);
    var dictClientes = _construirDiccionarioClientes(general);
    var reestudios = _leerReestudios(dictClientes, scoreMap);
    var rechazados = _leerRechazados(scoreMap);
    var biometrias = _leerBiometria(scoreMap);

    var todas = general.concat(reestudios).concat(rechazados).concat(biometrias);
    for (var i = 0; i < todas.length; i++) {
      todas[i] = _calcularCamposDerivados(todas[i], scoreMap);
    }
    _marcarEstadoDefinitivo(todas);

    if (todas.length === 0) {
      Logger.log('Sin datos para sincronizar.');
      return true;
    }

    _cargarEnBigQuery(todas, 'WRITE_TRUNCATE');
    Logger.log('Sync completa finalizada: ' + todas.length + ' filas.');
    return true;
  } catch (e) {
    Logger.log('Error en sync completa: ' + e.message);
    return false;
  }
}

// ── Lectura de hojas (usa Capa_de_Datos donde corresponde) ──

/**
 * Lee datos de Historico_Gestiones usando la Capa_de_Datos (memoizado/cache).
 */
function _leerGeneral(scoreMap) {
  var data = obtenerHistoricoGestiones();
  if (!data || data.length < 2) return [];

  var filas = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    filas.push({
      solicitud: r[0] || '',
      poliza: r[1] || '',
      identificacion: r[2] || '',
      tipo_identificacion: r[3] || '',
      nombre_inquilino: r[4] || '',
      correo_inquilino: r[5] || '',
      telefono_inquilino: r[6] || '',
      ingresos: r[7] || '',
      fecha_expedicion: r[8] || '',
      canon: r[9] || '',
      cuota: r[10] || '',
      direccion: r[11] || '',
      destino_inmueble: r[12] || '',
      ciudad: r[13] || '',
      nombre_asesor: r[14] || '',
      correo_asesor: r[15] || '',
      estado: _trim(r[COL_HISTORICO.ESTADO_GENERAL]),
      fecha_radicacion: _limpiarFecha(r[COL_HISTORICO.FECHA_RADICACION]),
      fecha_resultado: _limpiarFecha(r[COL_HISTORICO.FECHA_RESULTADO]),
      descripcion_resultado: r[COL_HISTORICO.DESCRIPCION_RESULTADO] || '',
      clase: _trim(r[COL_HISTORICO.CLASE]),
      digital_uar: _trim(r[COL_HISTORICO.DIGITAL_UAR]),
      biometria: _trim(r[COL_HISTORICO.BIOMETRIA]),
      observaciones: r[COL_HISTORICO.OBSERVACIONES] || '',
      fecha_asignacion: _limpiarFecha(r[COL_HISTORICO.FECHA_ASIGNACION]),
      correo_analista: _trim(r[COL_HISTORICO.CORREO_ANALISTA]),
      fecha_fin: _limpiarFecha(r[COL_HISTORICO.FECHA_FIN]),
      _fecha_fin_raw: r[COL_HISTORICO.FECHA_FIN] || '',
      nombre_analista: _trim(r[COL_HISTORICO.NOMBRE_ANALISTA]),
      motivo_aplazamiento: r[COL_HISTORICO.MOTIVO_APLAZAMIENTO] || '',
      motivo_negacion: r[COL_HISTORICO.MOTIVO_NEGACION] || '',
      canal: _trim(r[COL_HISTORICO.CANAL]),
      minutos_cola: _limpiarNumero(r[COL_HISTORICO.MINUTOS_COLA]),
      minutos_gestion: _limpiarNumero(r[COL_HISTORICO.MINUTOS_GESTION]),
      minutos_general: _limpiarNumero(r[COL_HISTORICO.MINUTOS_GENERAL]),
      reasignacion: r[COL_HISTORICO.REASIGNACION] || '',
      tipo_asignado: r[COL_HISTORICO.TIPO_ASIGNADO] || '',
      codeudor1_nombre: r[COL_HISTORICO.CODEUDOR1_NOMBRE] || '',
      codeudor1_documento: r[COL_HISTORICO.CODEUDOR1_DOCUMENTO] || '',
      codeudor1_tipo_doc: r[COL_HISTORICO.CODEUDOR1_TIPO_DOC] || '',
      codeudor1_email: r[COL_HISTORICO.CODEUDOR1_EMAIL] || '',
      codeudor1_telefono: r[COL_HISTORICO.CODEUDOR1_TELEFONO] || '',
      codeudor1_estado: r[COL_HISTORICO.CODEUDOR1_ESTADO] || '',
      codeudor1_resultado: r[COL_HISTORICO.CODEUDOR1_RESULTADO] || '',
      codeudor2_nombre: r[COL_HISTORICO.CODEUDOR2_NOMBRE] || '',
      codeudor2_documento: r[COL_HISTORICO.CODEUDOR2_DOCUMENTO] || '',
      codeudor2_tipo_doc: r[COL_HISTORICO.CODEUDOR2_TIPO_DOC] || '',
      codeudor2_email: r[COL_HISTORICO.CODEUDOR2_EMAIL] || '',
      codeudor2_telefono: r[COL_HISTORICO.CODEUDOR2_TELEFONO] || '',
      codeudor2_estado: r[COL_HISTORICO.CODEUDOR2_ESTADO] || '',
      codeudor2_resultado: r[COL_HISTORICO.CODEUDOR2_RESULTADO] || '',
      codeudor3_nombre: r[COL_HISTORICO.CODEUDOR3_NOMBRE] || '',
      codeudor3_documento: r[COL_HISTORICO.CODEUDOR3_DOCUMENTO] || '',
      codeudor3_tipo_doc: r[COL_HISTORICO.CODEUDOR3_TIPO_DOC] || '',
      codeudor3_email: r[COL_HISTORICO.CODEUDOR3_EMAIL] || '',
      codeudor3_telefono: r[COL_HISTORICO.CODEUDOR3_TELEFONO] || '',
      codeudor3_estado: r[COL_HISTORICO.CODEUDOR3_ESTADO] || '',
      codeudor3_resultado: r[COL_HISTORICO.CODEUDOR3_RESULTADO] || '',
      origen: 'GENERAL',
      sucursal: obtenerSucursalPorPoliza(r[1]),
      tracking: '', fecha_consulta_sai: '', fecha_envio_broadcast: '', estado_broadcast: '', nuevo_estado_sai: '',
      bio_destino_1_rol: '', bio_destino_1_nombre: '', bio_destino_1_telefono: '',
      bio_destino_2_rol: '', bio_destino_2_nombre: '', bio_destino_2_telefono: '',
      bio_destino_3_rol: '', bio_destino_3_nombre: '', bio_destino_3_telefono: '',
      bio_destino_4_rol: '', bio_destino_4_nombre: '', bio_destino_4_telefono: ''
    });
  }
  return filas;
}

function _construirDiccionarioClientes(general) {
  var dict = {};
  for (var i = 0; i < general.length; i++) {
    var g = general[i];
    var key = String(g.solicitud).trim();
    if (key && !dict[key]) {
      dict[key] = {
        identificacion: g.identificacion,
        tipo_identificacion: g.tipo_identificacion,
        nombre_inquilino: g.nombre_inquilino,
        correo_inquilino: g.correo_inquilino,
        telefono_inquilino: g.telefono_inquilino,
        ingresos: g.ingresos,
        fecha_expedicion: g.fecha_expedicion,
        canon: g.canon,
        cuota: g.cuota,
        direccion: g.direccion,
        destino_inmueble: g.destino_inmueble,
        ciudad: g.ciudad,
        nombre_asesor: g.nombre_asesor,
        correo_asesor: g.correo_asesor,
        codeudor1_nombre: g.codeudor1_nombre,
        codeudor1_documento: g.codeudor1_documento,
        codeudor1_tipo_doc: g.codeudor1_tipo_doc,
        codeudor1_email: g.codeudor1_email,
        codeudor1_telefono: g.codeudor1_telefono,
        codeudor1_estado: g.codeudor1_estado,
        codeudor1_resultado: g.codeudor1_resultado,
        codeudor2_nombre: g.codeudor2_nombre,
        codeudor2_documento: g.codeudor2_documento,
        codeudor2_tipo_doc: g.codeudor2_tipo_doc,
        codeudor2_email: g.codeudor2_email,
        codeudor2_telefono: g.codeudor2_telefono,
        codeudor2_estado: g.codeudor2_estado,
        codeudor2_resultado: g.codeudor2_resultado,
        codeudor3_nombre: g.codeudor3_nombre,
        codeudor3_documento: g.codeudor3_documento,
        codeudor3_tipo_doc: g.codeudor3_tipo_doc,
        codeudor3_email: g.codeudor3_email,
        codeudor3_telefono: g.codeudor3_telefono,
        codeudor3_estado: g.codeudor3_estado,
        codeudor3_resultado: g.codeudor3_resultado
      };
    }
  }
  return dict;
}

/**
 * Lee datos de Reestudios usando la Capa_de_Datos (memoizado/cache).
 */
function _leerReestudios(dictClientes, scoreMap) {
  var data = obtenerHojaReestudios();
  if (!data || data.length < 2) return [];

  var filas = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var solicitud = String(r[COL_REESTUDIOS.SOLICITUD] || '').trim();
    var cliente = dictClientes[solicitud] || {};

    filas.push({
      solicitud: r[COL_REESTUDIOS.SOLICITUD] || '',
      poliza: r[COL_REESTUDIOS.POLIZA] || '',
      identificacion: cliente.identificacion || '',
      tipo_identificacion: cliente.tipo_identificacion || '',
      nombre_inquilino: cliente.nombre_inquilino || '',
      correo_inquilino: cliente.correo_inquilino || '',
      telefono_inquilino: cliente.telefono_inquilino || '',
      ingresos: cliente.ingresos || '',
      fecha_expedicion: cliente.fecha_expedicion || '',
      canon: cliente.canon || '',
      cuota: cliente.cuota || '',
      direccion: cliente.direccion || '',
      destino_inmueble: cliente.destino_inmueble || '',
      ciudad: cliente.ciudad || '',
      nombre_asesor: cliente.nombre_asesor || '',
      correo_asesor: cliente.correo_asesor || '',
      estado: _trim(r[COL_REESTUDIOS.ESTADO_GENERAL]),
      fecha_radicacion: _limpiarFecha(r[COL_REESTUDIOS.FECHA_RADICACION]),
      fecha_resultado: '',
      descripcion_resultado: '',
      clase: _trim(r[COL_REESTUDIOS.CLASE]),
      digital_uar: '',
      biometria: '',
      observaciones: r[COL_REESTUDIOS.OBSERVACIONES] || '',
      fecha_asignacion: _limpiarFecha(r[COL_REESTUDIOS.FECHA_ASIGNACION]),
      correo_analista: _trim(r[COL_REESTUDIOS.CORREO_ANALISTA]),
      fecha_fin: _limpiarFecha(r[COL_REESTUDIOS.FECHA_FIN]),
      _fecha_fin_raw: r[COL_REESTUDIOS.FECHA_FIN] || '',
      nombre_analista: _trim(r[COL_REESTUDIOS.NOMBRE_ANALISTA]),
      motivo_aplazamiento: r[COL_REESTUDIOS.MOTIVO_APLAZAMIENTO] || '',
      motivo_negacion: r[COL_REESTUDIOS.MOTIVO_NEGACION] || '',
      canal: '',
      minutos_cola: _limpiarNumero(r[COL_REESTUDIOS.MINUTOS_COLA]),
      minutos_gestion: _limpiarNumero(r[COL_REESTUDIOS.MINUTOS_GESTION]),
      minutos_general: _limpiarNumero(r[COL_REESTUDIOS.MINUTOS_GENERAL]),
      reasignacion: r[COL_REESTUDIOS.REASIGNACION] || '',
      tipo_asignado: r[COL_REESTUDIOS.TIPO_ASIGNADO] || '',
      codeudor1_nombre: cliente.codeudor1_nombre || '',
      codeudor1_documento: cliente.codeudor1_documento || '',
      codeudor1_tipo_doc: cliente.codeudor1_tipo_doc || '',
      codeudor1_email: cliente.codeudor1_email || '',
      codeudor1_telefono: cliente.codeudor1_telefono || '',
      codeudor1_estado: cliente.codeudor1_estado || '',
      codeudor1_resultado: cliente.codeudor1_resultado || '',
      codeudor2_nombre: cliente.codeudor2_nombre || '',
      codeudor2_documento: cliente.codeudor2_documento || '',
      codeudor2_tipo_doc: cliente.codeudor2_tipo_doc || '',
      codeudor2_email: cliente.codeudor2_email || '',
      codeudor2_telefono: cliente.codeudor2_telefono || '',
      codeudor2_estado: cliente.codeudor2_estado || '',
      codeudor2_resultado: cliente.codeudor2_resultado || '',
      codeudor3_nombre: cliente.codeudor3_nombre || '',
      codeudor3_documento: cliente.codeudor3_documento || '',
      codeudor3_tipo_doc: cliente.codeudor3_tipo_doc || '',
      codeudor3_email: cliente.codeudor3_email || '',
      codeudor3_telefono: cliente.codeudor3_telefono || '',
      codeudor3_estado: cliente.codeudor3_estado || '',
      codeudor3_resultado: cliente.codeudor3_resultado || '',
      origen: 'REESTUDIO',
      sucursal: obtenerSucursalPorPoliza(r[COL_REESTUDIOS.POLIZA]),
      tracking: '', fecha_consulta_sai: '', fecha_envio_broadcast: '', estado_broadcast: '', nuevo_estado_sai: '',
      bio_destino_1_rol: '', bio_destino_1_nombre: '', bio_destino_1_telefono: '',
      bio_destino_2_rol: '', bio_destino_2_nombre: '', bio_destino_2_telefono: '',
      bio_destino_3_rol: '', bio_destino_3_nombre: '', bio_destino_3_telefono: '',
      bio_destino_4_rol: '', bio_destino_4_nombre: '', bio_destino_4_telefono: ''
    });
  }
  return filas;
}

/**
 * Lee datos de rechazados directamente de SAI_CONFIG.SHEET_ID.
 * Esta hoja NO está en la Capa_de_Datos ya que es de un spreadsheet externo (SAI).
 */
function _leerRechazados(scoreMap) {
  var ss, hoja;
  try {
    ss = SpreadsheetApp.openById(SAI_CONFIG.SHEET_ID);
    hoja = ss.getSheetByName('rechazado_gestion_directa');
  } catch (e) {
    Logger.log('No se pudo abrir rechazado_gestion_directa: ' + e.message);
    return [];
  }
  if (!hoja || hoja.getLastRow() < 2) return [];

  var data = hoja.getDataRange().getDisplayValues();
  var filas = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    filas.push({
      solicitud: r[0] || '',
      poliza: r[1] || '',
      identificacion: r[2] || '',
      tipo_identificacion: r[3] || '',
      nombre_inquilino: r[4] || '',
      correo_inquilino: r[5] || '',
      telefono_inquilino: r[6] || '',
      ingresos: r[7] || '',
      fecha_expedicion: r[8] || '',
      canon: r[9] || '',
      cuota: r[10] || '',
      direccion: r[11] || '',
      destino_inmueble: r[12] || '',
      ciudad: r[13] || '',
      nombre_asesor: r[14] || '',
      correo_asesor: r[15] || '',
      estado: _trim(r[16]),
      fecha_radicacion: _limpiarFecha(r[17]),
      fecha_resultado: _limpiarFecha(r[18]),
      descripcion_resultado: r[19] || '',
      clase: _trim(r[20]),
      digital_uar: _trim(r[21]),
      biometria: '',
      observaciones: '',
      fecha_asignacion: '',
      correo_analista: '',
      fecha_fin: '',
      nombre_analista: '',
      motivo_aplazamiento: '',
      motivo_negacion: '',
      canal: _trim(r[43]),
      minutos_cola: '',
      minutos_gestion: '',
      minutos_general: '',
      reasignacion: '',
      tipo_asignado: '',
      codeudor1_nombre: r[22] || '',
      codeudor1_documento: r[23] || '',
      codeudor1_tipo_doc: r[24] || '',
      codeudor1_email: r[25] || '',
      codeudor1_telefono: r[26] || '',
      codeudor1_estado: r[27] || '',
      codeudor1_resultado: r[28] || '',
      codeudor2_nombre: r[29] || '',
      codeudor2_documento: r[30] || '',
      codeudor2_tipo_doc: r[31] || '',
      codeudor2_email: r[32] || '',
      codeudor2_telefono: r[33] || '',
      codeudor2_estado: r[34] || '',
      codeudor2_resultado: r[35] || '',
      codeudor3_nombre: r[36] || '',
      codeudor3_documento: r[37] || '',
      codeudor3_tipo_doc: r[38] || '',
      codeudor3_email: r[39] || '',
      codeudor3_telefono: r[40] || '',
      codeudor3_estado: r[41] || '',
      codeudor3_resultado: r[42] || '',
      origen: 'NEGACION_DIRECTA',
      sucursal: obtenerSucursalPorPoliza(r[1]),
      tracking: '', fecha_consulta_sai: '', fecha_envio_broadcast: '', estado_broadcast: '', nuevo_estado_sai: '',
      bio_destino_1_rol: '', bio_destino_1_nombre: '', bio_destino_1_telefono: '',
      bio_destino_2_rol: '', bio_destino_2_nombre: '', bio_destino_2_telefono: '',
      bio_destino_3_rol: '', bio_destino_3_nombre: '', bio_destino_3_telefono: '',
      bio_destino_4_rol: '', bio_destino_4_nombre: '', bio_destino_4_telefono: ''
    });
  }
  return filas;
}

/**
 * Lee datos de biometría usando la Capa_de_Datos (memoizado/cache).
 */
function _leerBiometria(scoreMap) {
  var data = obtenerHojaBiometria();
  if (!data || data.length < 2) return [];

  var filas = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    filas.push({
      solicitud: r[COL_BIOMETRIA.SOLICITUD] || '',
      poliza: r[COL_BIOMETRIA.POLIZA] || '',
      identificacion: r[COL_BIOMETRIA.IDENTIFICACION] || '',
      tipo_identificacion: r[COL_BIOMETRIA.TIPO_IDENTIFICACION] || '',
      nombre_inquilino: r[COL_BIOMETRIA.NOMBRE_INQUILINO] || '',
      correo_inquilino: r[COL_BIOMETRIA.CORREO_INQUILINO] || '',
      telefono_inquilino: r[COL_BIOMETRIA.TELEFONO_INQUILINO] || '',
      ingresos: r[COL_BIOMETRIA.INGRESOS] || '',
      fecha_expedicion: r[COL_BIOMETRIA.FECHA_EXPEDICION] || '',
      canon: r[COL_BIOMETRIA.CANON] || '',
      cuota: r[COL_BIOMETRIA.CUOTA] || '',
      direccion: r[COL_BIOMETRIA.DIRECCION] || '',
      destino_inmueble: r[COL_BIOMETRIA.DESTINO_INMUEBLE] || '',
      ciudad: r[COL_BIOMETRIA.CIUDAD] || '',
      nombre_asesor: r[COL_BIOMETRIA.NOMBRE_ASESOR] || '',
      correo_asesor: r[COL_BIOMETRIA.CORREO_ASESOR] || '',
      estado: _trim(r[COL_BIOMETRIA.ESTADO_GENERAL]),
      fecha_radicacion: _limpiarFecha(r[COL_BIOMETRIA.FECHA_RADICACION]),
      fecha_resultado: _limpiarFecha(r[COL_BIOMETRIA.FECHA_RESULTADO]),
      descripcion_resultado: r[COL_BIOMETRIA.DESCRIPCION_RESULTADO] || '',
      clase: _trim(r[COL_BIOMETRIA.CLASE]),
      digital_uar: _trim(r[COL_BIOMETRIA.DIGITAL_UAR]),
      biometria: _trim(r[COL_BIOMETRIA.BIOMETRIA]),
      observaciones: r[COL_BIOMETRIA.OBSERVACIONES] || '',
      fecha_asignacion: _limpiarFecha(r[COL_BIOMETRIA.FECHA_ASIGNACION]),
      correo_analista: _trim(r[COL_BIOMETRIA.CORREO_ANALISTA]),
      fecha_fin: _limpiarFecha(r[COL_BIOMETRIA.FECHA_FIN]),
      _fecha_fin_raw: r[COL_BIOMETRIA.FECHA_FIN] || '',
      nombre_analista: _trim(r[COL_BIOMETRIA.NOMBRE_ANALISTA]),
      motivo_aplazamiento: r[COL_BIOMETRIA.MOTIVO_APLAZAMIENTO] || '',
      motivo_negacion: r[COL_BIOMETRIA.MOTIVO_NEGACION] || '',
      canal: _trim(r[COL_BIOMETRIA.CANAL]),
      minutos_cola: '',
      minutos_gestion: _limpiarNumero(r[COL_BIOMETRIA.MINUTOS_GESTION]),
      minutos_general: _limpiarNumero(r[COL_BIOMETRIA.MINUTOS_GENERAL]),
      reasignacion: r[COL_BIOMETRIA.REASIGNACION] || '',
      tipo_asignado: '',
      codeudor1_nombre: r[COL_BIOMETRIA.CODEUDOR1_NOMBRE] || '',
      codeudor1_documento: r[COL_BIOMETRIA.CODEUDOR1_DOCUMENTO] || '',
      codeudor1_tipo_doc: r[COL_BIOMETRIA.CODEUDOR1_TIPO_DOC] || '',
      codeudor1_email: r[COL_BIOMETRIA.CODEUDOR1_EMAIL] || '',
      codeudor1_telefono: r[COL_BIOMETRIA.CODEUDOR1_TELEFONO] || '',
      codeudor1_estado: r[COL_BIOMETRIA.CODEUDOR1_ESTADO] || '',
      codeudor1_resultado: r[COL_BIOMETRIA.CODEUDOR1_RESULTADO] || '',
      codeudor2_nombre: r[COL_BIOMETRIA.CODEUDOR2_NOMBRE] || '',
      codeudor2_documento: r[COL_BIOMETRIA.CODEUDOR2_DOCUMENTO] || '',
      codeudor2_tipo_doc: r[COL_BIOMETRIA.CODEUDOR2_TIPO_DOC] || '',
      codeudor2_email: r[COL_BIOMETRIA.CODEUDOR2_EMAIL] || '',
      codeudor2_telefono: r[COL_BIOMETRIA.CODEUDOR2_TELEFONO] || '',
      codeudor2_estado: r[COL_BIOMETRIA.CODEUDOR2_ESTADO] || '',
      codeudor2_resultado: r[COL_BIOMETRIA.CODEUDOR2_RESULTADO] || '',
      codeudor3_nombre: r[COL_BIOMETRIA.CODEUDOR3_NOMBRE] || '',
      codeudor3_documento: r[COL_BIOMETRIA.CODEUDOR3_DOCUMENTO] || '',
      codeudor3_tipo_doc: r[COL_BIOMETRIA.CODEUDOR3_TIPO_DOC] || '',
      codeudor3_email: r[COL_BIOMETRIA.CODEUDOR3_EMAIL] || '',
      codeudor3_telefono: r[COL_BIOMETRIA.CODEUDOR3_TELEFONO] || '',
      codeudor3_estado: r[COL_BIOMETRIA.CODEUDOR3_ESTADO] || '',
      codeudor3_resultado: r[COL_BIOMETRIA.CODEUDOR3_RESULTADO] || '',
      origen: 'BIOMETRIA',
      sucursal: obtenerSucursalPorPoliza(r[COL_BIOMETRIA.POLIZA]),
      tracking: _trim(r[COL_BIOMETRIA.TRACKING]),
      fecha_consulta_sai: _limpiarFecha(r[COL_BIOMETRIA.FECHA_CONSULTA_SAI]),
      fecha_envio_broadcast: _limpiarFecha(r[COL_BIOMETRIA.FECHA_ENVIO_BROADCAST]),
      estado_broadcast: _trim(r[COL_BIOMETRIA.ESTADO_BROADCAST]),
      nuevo_estado_sai: _trim(r[COL_BIOMETRIA.NUEVO_ESTADO_SAI]),
      bio_destino_1_rol: r[COL_BIOMETRIA.BIO_DESTINO_1_ROL] || '',
      bio_destino_1_nombre: r[COL_BIOMETRIA.BIO_DESTINO_1_NOMBRE] || '',
      bio_destino_1_telefono: r[COL_BIOMETRIA.BIO_DESTINO_1_TELEFONO] || '',
      bio_destino_2_rol: r[COL_BIOMETRIA.BIO_DESTINO_2_ROL] || '',
      bio_destino_2_nombre: r[COL_BIOMETRIA.BIO_DESTINO_2_NOMBRE] || '',
      bio_destino_2_telefono: r[COL_BIOMETRIA.BIO_DESTINO_2_TELEFONO] || '',
      bio_destino_3_rol: r[COL_BIOMETRIA.BIO_DESTINO_3_ROL] || '',
      bio_destino_3_nombre: r[COL_BIOMETRIA.BIO_DESTINO_3_NOMBRE] || '',
      bio_destino_3_telefono: r[COL_BIOMETRIA.BIO_DESTINO_3_TELEFONO] || '',
      bio_destino_4_rol: r[COL_BIOMETRIA.BIO_DESTINO_4_ROL] || '',
      bio_destino_4_nombre: r[COL_BIOMETRIA.BIO_DESTINO_4_NOMBRE] || '',
      bio_destino_4_telefono: r[COL_BIOMETRIA.BIO_DESTINO_4_TELEFONO] || ''
    });
  }
  return filas;
}

// ── BigQuery: crear dataset y cargar datos ──

function _crearDatasetSiNoExiste() {
  try {
    BigQuery.Datasets.get(BQ_CONFIG.PROJECT_ID, BQ_CONFIG.DATASET_ID);
    Logger.log('Dataset ya existe: ' + BQ_CONFIG.DATASET_ID);
  } catch (e) {
    try {
      BigQuery.Datasets.insert({
        datasetReference: {
          projectId: BQ_CONFIG.PROJECT_ID,
          datasetId: BQ_CONFIG.DATASET_ID
        },
        location: 'US'
      }, BQ_CONFIG.PROJECT_ID);
      Logger.log('Dataset creado: ' + BQ_CONFIG.DATASET_ID);
    } catch (e2) {
      Logger.log('Dataset ya existía o error: ' + e2.message);
    }
  }
}

/**
 * Carga filas en BigQuery con el writeDisposition especificado.
 *
 * @param {Array<Object>} filas - Arreglo de objetos fila
 * @param {string} writeDisposition - 'WRITE_TRUNCATE' o 'WRITE_APPEND'
 */
function _cargarEnBigQuery(filas, writeDisposition) {
  var csvLines = [];
  for (var i = 0; i < filas.length; i++) {
    var row = BQ_SCHEMA.map(function(col) {
      var val = String(filas[i][col] || '').replace(/"/g, '""');
      return '"' + val + '"';
    });
    csvLines.push(row.join(','));
  }
  var blob = Utilities.newBlob(csvLines.join('\n'), 'application/octet-stream');

  var job = BigQuery.Jobs.insert({
    configuration: {
      load: {
        destinationTable: {
          projectId: BQ_CONFIG.PROJECT_ID,
          datasetId: BQ_CONFIG.DATASET_ID,
          tableId: BQ_CONFIG.TABLE_ID
        },
        createDisposition: 'CREATE_IF_NEEDED',
        writeDisposition: writeDisposition || 'WRITE_TRUNCATE',
        sourceFormat: 'CSV',
        schema: {
          fields: BQ_SCHEMA.map(function(name) {
            return { name: name, type: 'STRING', mode: 'NULLABLE' };
          })
        }
      }
    }
  }, BQ_CONFIG.PROJECT_ID, blob);

  var jobId = job.jobReference.jobId;
  for (var k = 0; k < 60; k++) {
    var status = BigQuery.Jobs.get(BQ_CONFIG.PROJECT_ID, jobId);
    if (status.status.state === 'DONE') {
      if (status.status.errorResult) {
        Logger.log('Error en carga BQ: ' + status.status.errorResult.message);
      } else {
        Logger.log('Datos cargados en BQ: ' + filas.length + ' filas (' + writeDisposition + ').');
      }
      return;
    }
    Utilities.sleep(2000);
  }
  Logger.log('Timeout esperando finalización del job BQ: ' + jobId);
}

// ── Triggers ──

function crearTriggerBigQuery() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sincronizarBigQuery') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sincronizarBigQuery')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('Trigger creado: sincronizarBigQuery cada 15 minutos.');
}

function eliminarTriggerBigQuery() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sincronizarBigQuery') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('Trigger eliminado.');
}
