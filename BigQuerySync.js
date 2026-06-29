/**
 * Sincronización de gestiones unificadas a BigQuery.
 * Une Historico_Gestiones (general), Historico_Gestiones (reestudios),
 * rechazado_gestion_directa y pendiente_biometria en una sola tabla.
 */

var BQ_CONFIG = {
  PROJECT_ID: 'proyecto-ia-servicios-bolivar',
  DATASET_ID: 'analisis_arrendamiento',
  TABLE_ID: 'gestiones_unificadas'
};

var BQ_SCHEMA = [
  'solicitud','poliza','identificacion','tipo_identificacion',
  'nombre_inquilino','correo_inquilino','telefono_inquilino',
  'ingresos','fecha_expedicion','canon','cuota','direccion',
  'destino_inmueble','ciudad','nombre_asesor','correo_asesor',
  'estado','fecha_radicacion','fecha_resultado','descripcion_resultado',
  'clase','digital_uar','biometria','observaciones',
  'fecha_asignacion','correo_analista','fecha_fin','nombre_analista',
  'motivo_aplazamiento','motivo_negacion','canal',
  'minutos_cola','minutos_gestion','minutos_general',
  'reasignacion','tipo_asignado',
  'codeudor1_nombre','codeudor1_documento','codeudor1_tipo_doc',
  'codeudor1_email','codeudor1_telefono','codeudor1_estado','codeudor1_resultado',
  'codeudor2_nombre','codeudor2_documento','codeudor2_tipo_doc',
  'codeudor2_email','codeudor2_telefono','codeudor2_estado','codeudor2_resultado',
  'codeudor3_nombre','codeudor3_documento','codeudor3_tipo_doc',
  'codeudor3_email','codeudor3_telefono','codeudor3_estado','codeudor3_resultado',
  'origen','sucursal',
  'tracking','fecha_consulta_sai','fecha_envio_broadcast','estado_broadcast','nuevo_estado_sai',
  'bio_destino_1_rol','bio_destino_1_nombre','bio_destino_1_telefono',
  'bio_destino_2_rol','bio_destino_2_nombre','bio_destino_2_telefono',
  'bio_destino_3_rol','bio_destino_3_nombre','bio_destino_3_telefono',
  'bio_destino_4_rol','bio_destino_4_nombre','bio_destino_4_telefono',
  'es_gestionada','estado_label','fecha_cierre','fuera_sla','es_backlog',
  'tipo_solicitud','horas_general','dentro_sla','es_aprobada_num','es_negada_num','es_aplazada_num',
  'es_estado_definitivo','es_rechazado_sai',
  'inmobiliaria','segmento','hora_cierre','fecha_fin_completa',
  't_general_fmt','t_cola_fmt','t_gestion_fmt'
];

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

function _calcularCamposDerivados(fila, scoreMap) {
  var estado = String(fila.estado || '').toUpperCase();
  var fechaFin = String(fila.fecha_fin || '').trim();
  var origen = fila.origen;

  // es_gestionada: tiene fecha_fin y es GENERAL o REESTUDIO
  var esGestionada = (fechaFin !== '' && (origen === 'GENERAL' || origen === 'REESTUDIO')) ? '1' : '0';

  // estado_label: misma lógica del Apps Script
  var estadoLabel = '';
  if (estado.indexOf('APROB') > -1 && estado.indexOf('PENDIENTE') === -1) estadoLabel = 'APROBADA';
  else if (estado.indexOf('NEGAD') > -1 || estado.indexOf('RECHAZ') > -1) estadoLabel = 'NEGADA';
  else if (estado.indexOf('APLAZ') > -1) estadoLabel = 'APLAZADA';
  else if (estado !== '') estadoLabel = 'OTRO';

  // fecha_cierre: fecha_fin limpia para producción diaria
  var fechaCierre = _limpiarFecha(fila.fecha_fin);

  // fuera_sla: tiempo general > 2 horas
  var minutosGen = parseFloat(fila.minutos_general);
  var horasGen = !isNaN(minutosGen) ? minutosGen / 60 : NaN;
  var fueraSla = (!isNaN(horasGen) && horasGen > 2 && esGestionada === '1') ? '1' : '0';

  // es_backlog: tiene fecha_asignacion pero NO tiene fecha_fin
  var fechaAsig = String(fila.fecha_asignacion || '').trim();
  var esBacklog = (fechaAsig !== '' && fechaFin === '' && (origen === 'GENERAL' || origen === 'REESTUDIO')) ? '1' : '0';

  // tipo_solicitud: Digital, UAR, Reestudio, Biometría, Inducción (misma lógica Apps Script)
  var clase = String(fila.clase || '').toUpperCase();
  var tipoSol = '';
  if (origen === 'REESTUDIO') tipoSol = 'Reestudio';
  else if (origen === 'NEGACION_DIRECTA') tipoSol = 'Negación Directa';
  else if (origen === 'BIOMETRIA') tipoSol = 'Biometría';
  else if (estado.indexOf('BIOMETRIA') > -1) tipoSol = 'Biometría';
  else if (clase === 'INDUCCION' || clase === 'INDUCCIÓN') tipoSol = 'Inducción';
  else tipoSol = 'Digital';

  // horas_general: minutos_general / 60
  var horasGeneralStr = !isNaN(minutosGen) && minutosGen > 0 ? String(Math.round(minutosGen / 60 * 100) / 100) : '0';

  // dentro_sla: inverso de fuera_sla
  var dentroSla = (!isNaN(horasGen) && horasGen <= 2 && esGestionada === '1') ? '1' : '0';

  // Contadores numéricos para facilitar sumas en Looker
  var esAprobadaNum = estadoLabel === 'APROBADA' ? '1' : '0';
  var esNegadaNum = estadoLabel === 'NEGADA' ? '1' : '0';
  var esAplazadaNum = estadoLabel === 'APLAZADA' ? '1' : '0';

  fila.es_gestionada = esGestionada;
  fila.estado_label = estadoLabel;
  fila.fecha_cierre = fechaCierre;
  fila.fuera_sla = fueraSla;
  fila.es_backlog = esBacklog;
  fila.tipo_solicitud = tipoSol;
  fila.horas_general = horasGeneralStr;
  fila.dentro_sla = dentroSla;
  fila.es_aprobada_num = esAprobadaNum;
  fila.es_negada_num = esNegadaNum;
  fila.es_aplazada_num = esAplazadaNum;

  // Inmobiliaria y segmento desde diccionario score
  var poliza = String(fila.poliza || '').trim();
  var infoSeg = obtenerSegmentoInmobiliaria(poliza, scoreMap);
  fila.inmobiliaria = infoSeg.inmobiliaria;
  fila.segmento = infoSeg.segmento;

  // Hora de cierre y fecha_fin completa (para heatmap por hora)
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

  // Formato duración legible
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

// ── Función principal ──

function sincronizarBigQuery() {
  _crearDatasetSiNoExiste();

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
    return;
  }

  _cargarEnBigQuery(todas);
  Logger.log('Sincronización completada: ' + todas.length + ' filas.');
}

// ── Lectura de hojas ──

function _leerGeneral(scoreMap) {
  var ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  var hoja = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
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
      biometria: _trim(r[22]),
      observaciones: r[23] || '',
      fecha_asignacion: _limpiarFecha(r[24]),
      correo_analista: _trim(r[25]),
      fecha_fin: _limpiarFecha(r[26]),
      _fecha_fin_raw: r[26] || '',
      nombre_analista: _trim(r[27]),
      motivo_aplazamiento: r[28] || '',
      motivo_negacion: r[29] || '',
      canal: _trim(r[32]),
      minutos_cola: _limpiarNumero(r[34]),
      minutos_gestion: _limpiarNumero(r[35]),
      minutos_general: _limpiarNumero(r[36]),
      reasignacion: r[37] || '',
      tipo_asignado: r[60] || '',
      codeudor1_nombre: r[39] || '',
      codeudor1_documento: r[40] || '',
      codeudor1_tipo_doc: r[41] || '',
      codeudor1_email: r[42] || '',
      codeudor1_telefono: r[43] || '',
      codeudor1_estado: r[44] || '',
      codeudor1_resultado: r[45] || '',
      codeudor2_nombre: r[46] || '',
      codeudor2_documento: r[47] || '',
      codeudor2_tipo_doc: r[48] || '',
      codeudor2_email: r[49] || '',
      codeudor2_telefono: r[50] || '',
      codeudor2_estado: r[51] || '',
      codeudor2_resultado: r[52] || '',
      codeudor3_nombre: r[53] || '',
      codeudor3_documento: r[54] || '',
      codeudor3_tipo_doc: r[55] || '',
      codeudor3_email: r[56] || '',
      codeudor3_telefono: r[57] || '',
      codeudor3_estado: r[58] || '',
      codeudor3_resultado: r[59] || '',
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

function _leerReestudios(dictClientes, scoreMap) {
  var ss, hoja;
  try {
    ss = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    hoja = ss.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
  } catch (e) {
    Logger.log('No se pudo abrir hoja de reestudios: ' + e.message);
    return [];
  }
  if (!hoja || hoja.getLastRow() < 2) return [];

  var data = hoja.getDataRange().getDisplayValues();
  var filas = [];

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var solicitud = String(r[1] || '').trim();
    var cliente = dictClientes[solicitud] || {};

    filas.push({
      solicitud: r[1] || '',
      poliza: r[17] || '',
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
      estado: _trim(r[10]),
      fecha_radicacion: _limpiarFecha(r[0]),
      fecha_resultado: '',
      descripcion_resultado: '',
      clase: _trim(r[5]),
      digital_uar: '',
      biometria: '',
      observaciones: r[13] || '',
      fecha_asignacion: _limpiarFecha(r[8]),
      correo_analista: _trim(r[6]),
      fecha_fin: _limpiarFecha(r[9]),
      _fecha_fin_raw: r[9] || '',
      nombre_analista: _trim(r[7]),
      motivo_aplazamiento: r[11] || '',
      motivo_negacion: r[12] || '',
      canal: '',
      minutos_cola: _limpiarNumero(r[14]),
      minutos_gestion: _limpiarNumero(r[15]),
      minutos_general: _limpiarNumero(r[16]),
      reasignacion: r[19] || '',
      tipo_asignado: r[18] || '',
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
      sucursal: obtenerSucursalPorPoliza(r[17]),
      tracking: '', fecha_consulta_sai: '', fecha_envio_broadcast: '', estado_broadcast: '', nuevo_estado_sai: '',
      bio_destino_1_rol: '', bio_destino_1_nombre: '', bio_destino_1_telefono: '',
      bio_destino_2_rol: '', bio_destino_2_nombre: '', bio_destino_2_telefono: '',
      bio_destino_3_rol: '', bio_destino_3_nombre: '', bio_destino_3_telefono: '',
      bio_destino_4_rol: '', bio_destino_4_nombre: '', bio_destino_4_telefono: ''
    });
  }
  return filas;
}

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

function _leerBiometria(scoreMap) {
  var ss, hoja;
  try {
    ss = SpreadsheetApp.openById(ID_HOJA_BIOMETRIA);
    hoja = ss.getSheetByName('pendiente_biometria');
  } catch (e) {
    Logger.log('No se pudo abrir pendiente_biometria: ' + e.message);
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
      biometria: _trim(r[23]),
      observaciones: r[24] || '',
      fecha_asignacion: _limpiarFecha(r[26]),
      correo_analista: _trim(r[27]),
      fecha_fin: _limpiarFecha(r[28]),
      _fecha_fin_raw: r[28] || '',
      nombre_analista: _trim(r[30]),
      motivo_aplazamiento: r[31] || '',
      motivo_negacion: r[32] || '',
      canal: _trim(r[36]),
      minutos_cola: '',
      minutos_gestion: _limpiarNumero(r[34]),
      minutos_general: _limpiarNumero(r[29]),
      reasignacion: r[58] || '',
      tipo_asignado: '',
      codeudor1_nombre: r[37] || '',
      codeudor1_documento: r[38] || '',
      codeudor1_tipo_doc: r[39] || '',
      codeudor1_email: r[40] || '',
      codeudor1_telefono: r[41] || '',
      codeudor1_estado: r[42] || '',
      codeudor1_resultado: r[43] || '',
      codeudor2_nombre: r[44] || '',
      codeudor2_documento: r[45] || '',
      codeudor2_tipo_doc: r[46] || '',
      codeudor2_email: r[47] || '',
      codeudor2_telefono: r[48] || '',
      codeudor2_estado: r[49] || '',
      codeudor2_resultado: r[50] || '',
      codeudor3_nombre: r[51] || '',
      codeudor3_documento: r[52] || '',
      codeudor3_tipo_doc: r[53] || '',
      codeudor3_email: r[54] || '',
      codeudor3_telefono: r[55] || '',
      codeudor3_estado: r[56] || '',
      codeudor3_resultado: r[57] || '',
      origen: 'BIOMETRIA',
      sucursal: obtenerSucursalPorPoliza(r[1]),
      tracking: _trim(r[25]),
      fecha_consulta_sai: _limpiarFecha(r[59]),
      fecha_envio_broadcast: _limpiarFecha(r[60]),
      estado_broadcast: _trim(r[61]),
      nuevo_estado_sai: _trim(r[62]),
      bio_destino_1_rol: r[63] || '',
      bio_destino_1_nombre: r[64] || '',
      bio_destino_1_telefono: r[65] || '',
      bio_destino_2_rol: r[66] || '',
      bio_destino_2_nombre: r[67] || '',
      bio_destino_2_telefono: r[68] || '',
      bio_destino_3_rol: r[69] || '',
      bio_destino_3_nombre: r[70] || '',
      bio_destino_3_telefono: r[71] || '',
      bio_destino_4_rol: r[72] || '',
      bio_destino_4_nombre: r[73] || '',
      bio_destino_4_telefono: r[74] || ''
    });
  }
  return filas;
}

// ── BigQuery: crear dataset y tabla ──

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

function _cargarEnBigQuery(filas) {
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
        writeDisposition: 'WRITE_TRUNCATE',
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
  for (var i = 0; i < 60; i++) {
    var status = BigQuery.Jobs.get(BQ_CONFIG.PROJECT_ID, jobId);
    if (status.status.state === 'DONE') {
      if (status.status.errorResult) {
        Logger.log('Error en carga: ' + status.status.errorResult.message);
      } else {
        Logger.log('Datos cargados: ' + filas.length + ' filas.');
      }
      return;
    }
    Utilities.sleep(2000);
  }
}

// ── Trigger ──

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
