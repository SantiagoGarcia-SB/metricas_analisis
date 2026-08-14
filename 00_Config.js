/**
 * 00_Config.js — Constantes globales y mapeo de columnas
 *
 * Este archivo se carga PRIMERO por el runtime de Apps Script (orden alfabético por prefijo).
 * Centraliza toda la configuración estática del proyecto para que un cambio de ID, nombre de
 * pestaña o posición de columna solo requiera modificar este archivo.
 */

// ============================================================================
// CONSTANTES DE CONEXIÓN — Spreadsheets
// ============================================================================

const TARGET_SOLICITUDES_SS_ID = "1x9groW5-I7Xg5ULh7DXfa2XGmS_RMdfqfW1iDWB8bJ0";
const SHEET_NAME_SOLICITUDES = "Historico_Gestiones";
const ID_HOJA_REESTUDIOS = "1slgykTgjoAtCd6KmlG7Lqiuw-nM1hSguQbi0XqeLu7U";
const NOMBRE_PESTANA_REESTUDIOS = "Historico_Gestiones";
const ID_HOJA_BIOMETRIA = "1gHW1RFMVd0h4HZr2xTrFnx-A5Pk_npJs-bAk8GOx2h0";

// ============================================================================
// CONFIGURACIÓN DE TIEMPO Y ZONA HORARIA
// ============================================================================

const TIMEZONE = "America/Bogota";
const HORA_INICIO_OPERACION = "08:00";
const HORA_FIN_TURNO = "17:00";

// ============================================================================
// CONFIGURACIÓN DE CORREOS — Agente
// ============================================================================

const BCC_REPORTES_AGENTE = "santiago.garcia@segurosbolivar.com";
const NOMBRE_REMITENTE_AGENTE = "Análisis · El Libertador";

// ============================================================================
// CACHESERVICE — Constantes de particionamiento
// ============================================================================

const CACHE_TTL_SEGUNDOS = 300;
const CACHE_MAX_FRAGMENTO_KB = 95;
const CACHE_MAX_FRAGMENTOS = 20;

// ============================================================================
// CONTROL DE ACCESO — Claves de PropertiesService
// ============================================================================

var ACCESS_COORD_KEY = "ACCESS_COORDINADORES";
var ACCESS_BIO_KEY = "ACCESS_BIOMETRIA";
var COORD_FIJO = "desarrollocrmlibertador@ellibertador.co";

// ============================================================================
// AGENTE — Claves y configuración por defecto
// ============================================================================

var AGENT_CONFIG_KEY = "AGENT_CONFIG";
var AGENT_HISTORY_KEY = "AGENT_ALERT_HISTORY";
var AGENT_HIST_CACHE_KEY = "AGENT_HIST_30D";
var AGENT_DIAG_CACHE_KEY = "AGENT_LAST_DIAGNOSTICO";
var MAX_ALERT_HISTORY = 50;
var AGENT_TRIGGER_FNS = ["agente_triggerOperacion"];
var AGENT_RAZONES_NO_ALERTAR = [
  "sin alertas criticas",
  "desactivado",
  "sin datos de biometría hoy",
  "sin analistas con gestiones esta semana"
];

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
    maxTasaAplazamientoPct: 30,
    umbralMinutosPausa: 90
  },
  umbrales: {
    desviacionHistoricaPct: 20,
    inactividadMinutos: 90,
    outlierStdDev: 3
  },
  notificaciones: {
    enviarInicioOperacion: true,
    enviarChequeoConexion: true,
    chequeoConexionOffsetMin: 30,
    enviarAlertasCriticas: true,
    alertasCriticasFrecuenciaHoras: 1,
    enviarFotoMomento: true,
    fotoMomentoFrecuenciaHoras: 2,
    enviarResumenDiario: true,
    enviarResumenBiometria: true,
    enviarInformeIndividual: false,
    informeIndividualDiaISO: 5
  },
  horarioReporte: {
    activo: true,
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

// ============================================================================
// BIGQUERY — Configuración de sincronización
// ============================================================================

var BQ_CONFIG = {
  PROJECT_ID: 'proyecto-ia-servicios-bolivar',
  DATASET_ID: 'analisis_arrendamiento',
  TABLE_ID: 'gestiones_unificadas'
};

var BQ_SCHEMA = [
  'solicitud', 'poliza', 'identificacion', 'tipo_identificacion',
  'nombre_inquilino', 'correo_inquilino', 'telefono_inquilino',
  'ingresos', 'fecha_expedicion', 'canon', 'cuota', 'direccion',
  'destino_inmueble', 'ciudad', 'nombre_asesor', 'correo_asesor',
  'estado', 'fecha_radicacion', 'fecha_resultado', 'descripcion_resultado',
  'clase', 'digital_uar', 'biometria', 'observaciones',
  'fecha_asignacion', 'correo_analista', 'fecha_fin', 'nombre_analista',
  'motivo_aplazamiento', 'motivo_negacion', 'canal',
  'minutos_cola', 'minutos_gestion', 'minutos_general',
  'reasignacion', 'tipo_asignado',
  'codeudor1_nombre', 'codeudor1_documento', 'codeudor1_tipo_doc',
  'codeudor1_email', 'codeudor1_telefono', 'codeudor1_estado', 'codeudor1_resultado',
  'codeudor2_nombre', 'codeudor2_documento', 'codeudor2_tipo_doc',
  'codeudor2_email', 'codeudor2_telefono', 'codeudor2_estado', 'codeudor2_resultado',
  'codeudor3_nombre', 'codeudor3_documento', 'codeudor3_tipo_doc',
  'codeudor3_email', 'codeudor3_telefono', 'codeudor3_estado', 'codeudor3_resultado',
  'origen', 'sucursal',
  'tracking', 'fecha_consulta_sai', 'fecha_envio_broadcast', 'estado_broadcast', 'nuevo_estado_sai',
  'bio_destino_1_rol', 'bio_destino_1_nombre', 'bio_destino_1_telefono',
  'bio_destino_2_rol', 'bio_destino_2_nombre', 'bio_destino_2_telefono',
  'bio_destino_3_rol', 'bio_destino_3_nombre', 'bio_destino_3_telefono',
  'bio_destino_4_rol', 'bio_destino_4_nombre', 'bio_destino_4_telefono',
  'es_gestionada', 'estado_label', 'fecha_cierre', 'fuera_sla', 'es_backlog',
  'tipo_solicitud', 'horas_general', 'dentro_sla', 'es_aprobado_num', 'es_rechazado_num', 'es_aplazado_num',
  'es_estado_definitivo', 'es_rechazado_sai',
  'inmobiliaria', 'segmento', 'hora_cierre', 'fecha_fin_completa',
  't_general_fmt', 't_cola_fmt', 't_gestion_fmt'
];

// ============================================================================
// SAI — Configuración de consulta de rechazados
// ============================================================================

var SAI_CONFIG = {
  SHEET_ID: '1VCcd2_QglH-71-WnyPoBfDAyf05HAd51mbjVJtBXyyM',
  DIAS_ATRAS: 3,
  PAGE_SIZE: 200,
  SLEEP_MS: 2000,
  TOTAL_COLUMNAS: 45,
  REQUEST_TYPE_MAP: {
    'TS': 'NUEVA',
    'RSD': 'REESTUDIO',
    'RE': 'REESTUDIO',
    'RC': 'REESTUDIO',
    'IND': 'INDUCCION'
  },
  ENCABEZADOS: [
    'solicitud', 'poliza', 'identificacion', 'tipo_identificacion',
    'nombre_inquilino', 'correo_inquilino', 'telefono_inquilino',
    'ingresos', 'fecha_expedicion', 'canon', 'cuota', 'direccion',
    'destino_inmueble', 'ciudad', 'nombre_asesor', 'correo_asesor',
    'estado_general', 'fecha_radicacion', 'fecha_resultado',
    'descripcion_resultado', 'clase', 'uar',
    'codeudor1_nombre', 'codeudor1_documento', 'codeudor1_tipo_doc',
    'codeudor1_email', 'codeudor1_telefono', 'codeudor1_estado', 'codeudor1_resultado',
    'codeudor2_nombre', 'codeudor2_documento', 'codeudor2_tipo_doc',
    'codeudor2_email', 'codeudor2_telefono', 'codeudor2_estado', 'codeudor2_resultado',
    'codeudor3_nombre', 'codeudor3_documento', 'codeudor3_tipo_doc',
    'codeudor3_email', 'codeudor3_telefono', 'codeudor3_estado', 'codeudor3_resultado',
    'canal', 'fecha_consulta'
  ]
};

// ============================================================================
// MAPEO DE COLUMNAS — Historico_Gestiones (TARGET_SOLICITUDES_SS_ID)
// ============================================================================
// Cada propiedad es el índice 0-based de la columna en la hoja.
// Cuando una columna cambie de posición, solo hay que actualizar el valor aquí.

var COL_HISTORICO = {
  SOLICITUD: 0,
  POLIZA: 1,
  IDENTIFICACION: 2,
  TIPO_IDENTIFICACION: 3,
  NOMBRE_INQUILINO: 4,
  CORREO_INQUILINO: 5,
  TELEFONO_INQUILINO: 6,
  INGRESOS: 7,
  FECHA_EXPEDICION: 8,
  CANON: 9,
  CUOTA: 10,
  DIRECCION: 11,
  DESTINO_INMUEBLE: 12,
  CIUDAD: 13,
  NOMBRE_ASESOR: 14,
  CORREO_ASESOR: 15,
  ESTADO_GENERAL: 16,
  FECHA_RADICACION: 17,
  FECHA_RESULTADO: 18,
  DESCRIPCION_RESULTADO: 19,
  CLASE: 20,
  DIGITAL_UAR: 21,
  BIOMETRIA: 22,
  OBSERVACIONES: 23,
  FECHA_ASIGNACION: 24,
  CORREO_ANALISTA: 25,
  FECHA_FIN: 26,
  NOMBRE_ANALISTA: 27,
  MOTIVO_APLAZAMIENTO: 28,
  MOTIVO_NEGACION: 29,
  CANAL: 32,
  MINUTOS_COLA: 34,
  MINUTOS_GESTION: 35,
  MINUTOS_GENERAL: 36,
  REASIGNACION: 37,
  CODEUDOR1_NOMBRE: 39,
  CODEUDOR1_DOCUMENTO: 40,
  CODEUDOR1_TIPO_DOC: 41,
  CODEUDOR1_EMAIL: 42,
  CODEUDOR1_TELEFONO: 43,
  CODEUDOR1_ESTADO: 44,
  CODEUDOR1_RESULTADO: 45,
  CODEUDOR2_NOMBRE: 46,
  CODEUDOR2_DOCUMENTO: 47,
  CODEUDOR2_TIPO_DOC: 48,
  CODEUDOR2_EMAIL: 49,
  CODEUDOR2_TELEFONO: 50,
  CODEUDOR2_ESTADO: 51,
  CODEUDOR2_RESULTADO: 52,
  CODEUDOR3_NOMBRE: 53,
  CODEUDOR3_DOCUMENTO: 54,
  CODEUDOR3_TIPO_DOC: 55,
  CODEUDOR3_EMAIL: 56,
  CODEUDOR3_TELEFONO: 57,
  CODEUDOR3_ESTADO: 58,
  CODEUDOR3_RESULTADO: 59,
  TIPO_ASIGNADO: 60
};

// ============================================================================
// MAPEO DE COLUMNAS — Hoja "solicitud" (TARGET_SOLICITUDES_SS_ID)
// ============================================================================
// La hoja "solicitud" tiene la misma estructura de columnas que Historico_Gestiones
// para los campos principales (las filas se mueven directamente de una a otra).

var COL_SOLICITUD = {
  SOLICITUD: 0,
  POLIZA: 1,
  IDENTIFICACION: 2,
  TIPO_IDENTIFICACION: 3,
  NOMBRE_INQUILINO: 4,
  CORREO_INQUILINO: 5,
  TELEFONO_INQUILINO: 6,
  INGRESOS: 7,
  FECHA_EXPEDICION: 8,
  CANON: 9,
  CUOTA: 10,
  DIRECCION: 11,
  DESTINO_INMUEBLE: 12,
  CIUDAD: 13,
  NOMBRE_ASESOR: 14,
  CORREO_ASESOR: 15,
  ESTADO_GENERAL: 16,
  FECHA_RADICACION: 17,
  FECHA_RESULTADO: 18,
  DESCRIPCION_RESULTADO: 19,
  CLASE: 20,
  DIGITAL_UAR: 21,
  BIOMETRIA: 22,
  OBSERVACIONES: 23,
  FECHA_ASIGNACION: 24,
  CORREO_ANALISTA: 25,
  FECHA_FIN: 26,
  NOMBRE_ANALISTA: 27,
  FECHA_FIN_SOLICITUD: 28,
  TIPO_ASIGNADO: 60
};

// ============================================================================
// MAPEO DE COLUMNAS — Historico_Gestiones de Reestudios (ID_HOJA_REESTUDIOS)
// ============================================================================

var COL_REESTUDIOS = {
  FECHA_RADICACION: 0,
  SOLICITUD: 1,
  POLIZA_ALT: 2,
  ORIGEN: 3,
  TIPO_PROCESO: 4,
  CLASE: 5,
  CORREO_ANALISTA: 6,
  NOMBRE_ANALISTA: 7,
  FECHA_ASIGNACION: 8,
  FECHA_FIN: 9,
  ESTADO_GENERAL: 10,
  MOTIVO_APLAZAMIENTO: 11,
  MOTIVO_NEGACION: 12,
  OBSERVACIONES: 13,
  MINUTOS_COLA: 14,
  MINUTOS_GESTION: 15,
  MINUTOS_GENERAL: 16,
  POLIZA: 17,
  TIPO_ASIGNADO: 18,
  REASIGNACION: 19
};

// ============================================================================
// MAPEO DE COLUMNAS — Hoja ORIGEN (ID_HOJA_REESTUDIOS, pestaña "ORIGEN")
// ============================================================================

var COL_ORIGEN = {
  ORIGEN: 3,
  TIPO_PROCESO: 4,
  CORREO_ANALISTA: 6,
  FECHA_FIN: 9
};

// ============================================================================
// MAPEO DE COLUMNAS — pendiente_biometria (ID_HOJA_BIOMETRIA)
// ============================================================================
// La hoja de biometría usa un colMap dinámico basado en headers, ya que los
// encabezados pueden cambiar. Las columnas fijas conocidas son las primeras 60+
// que coinciden con el layout de Historico_Gestiones, más campos específicos de
// biometría que se resuelven por nombre de header en runtime.
// Los campos resueltos dinámicamente por nombre de header son:
//   fecha_consulta_sai, fecha_envio_brodcast, fecha_actualizacion_fase,
//   estado_brodcast, nuevo_estado_sai, fase_seguimiento_biometria

var COL_BIOMETRIA = {
  SOLICITUD: 0,
  POLIZA: 1,
  IDENTIFICACION: 2,
  TIPO_IDENTIFICACION: 3,
  NOMBRE_INQUILINO: 4,
  CORREO_INQUILINO: 5,
  TELEFONO_INQUILINO: 6,
  INGRESOS: 7,
  FECHA_EXPEDICION: 8,
  CANON: 9,
  CUOTA: 10,
  DIRECCION: 11,
  DESTINO_INMUEBLE: 12,
  CIUDAD: 13,
  NOMBRE_ASESOR: 14,
  CORREO_ASESOR: 15,
  ESTADO_GENERAL: 16,
  FECHA_RADICACION: 17,
  FECHA_RESULTADO: 18,
  DESCRIPCION_RESULTADO: 19,
  CLASE: 20,
  DIGITAL_UAR: 21,
  BIOMETRIA: 23,
  OBSERVACIONES: 24,
  TRACKING: 25,
  FECHA_ASIGNACION: 26,
  CORREO_ANALISTA: 27,
  FECHA_FIN: 28,
  MINUTOS_GENERAL: 29,
  NOMBRE_ANALISTA: 30,
  MOTIVO_APLAZAMIENTO: 31,
  MOTIVO_NEGACION: 32,
  MINUTOS_GESTION: 34,
  CANAL: 36,
  CODEUDOR1_NOMBRE: 37,
  CODEUDOR1_DOCUMENTO: 38,
  CODEUDOR1_TIPO_DOC: 39,
  CODEUDOR1_EMAIL: 40,
  CODEUDOR1_TELEFONO: 41,
  CODEUDOR1_ESTADO: 42,
  CODEUDOR1_RESULTADO: 43,
  CODEUDOR2_NOMBRE: 44,
  CODEUDOR2_DOCUMENTO: 45,
  CODEUDOR2_TIPO_DOC: 46,
  CODEUDOR2_EMAIL: 47,
  CODEUDOR2_TELEFONO: 48,
  CODEUDOR2_ESTADO: 49,
  CODEUDOR2_RESULTADO: 50,
  CODEUDOR3_NOMBRE: 51,
  CODEUDOR3_DOCUMENTO: 52,
  CODEUDOR3_TIPO_DOC: 53,
  CODEUDOR3_EMAIL: 54,
  CODEUDOR3_TELEFONO: 55,
  CODEUDOR3_ESTADO: 56,
  CODEUDOR3_RESULTADO: 57,
  REASIGNACION: 58,
  // Campos de fecha/estado de biometría (resueltos por header — estos son los
  // índices típicos pero pueden variar por hoja; el código los busca por nombre)
  FECHA_CONSULTA_SAI: 59,
  FECHA_ENVIO_BROADCAST: 60,
  ESTADO_BROADCAST: 61,
  NUEVO_ESTADO_SAI: 62,
  BIO_DESTINO_1_ROL: 63,
  BIO_DESTINO_1_NOMBRE: 64,
  BIO_DESTINO_1_TELEFONO: 65,
  BIO_DESTINO_2_ROL: 66,
  BIO_DESTINO_2_NOMBRE: 67,
  BIO_DESTINO_2_TELEFONO: 68,
  BIO_DESTINO_3_ROL: 69,
  BIO_DESTINO_3_NOMBRE: 70,
  BIO_DESTINO_3_TELEFONO: 71,
  BIO_DESTINO_4_ROL: 72,
  BIO_DESTINO_4_NOMBRE: 73,
  BIO_DESTINO_4_TELEFONO: 74,
  // Headers dinámicos (nombres de columna para colMap lookup en runtime)
  HEADER_FECHA_CONSULTA_SAI: "fecha_consulta_sai",
  HEADER_FECHA_ENVIO_BROADCAST: "fecha_envio_brodcast",
  HEADER_FECHA_ACTUALIZACION_FASE: "fecha_actualizacion_fase",
  HEADER_ESTADO_BROADCAST: "estado_brodcast",
  HEADER_NUEVO_ESTADO_SAI: "nuevo_estado_sai",
  HEADER_FASE_SEGUIMIENTO: "fase_seguimiento_biometria"
};

// ============================================================================
// MAPEO DE COLUMNAS — Hoja "Usuarios" (TARGET_SOLICITUDES_SS_ID)
// ============================================================================

var COL_USUARIOS = {
  ID: 0,
  NOMBRE: 1,
  CORREO: 2,
  TELEFONO: 3,
  ESPECIALIDAD: 4,
  ESTADO: 5
};
