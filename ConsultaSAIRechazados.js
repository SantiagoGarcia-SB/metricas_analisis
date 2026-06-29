/**
 * Consulta periódica de solicitudes RECHAZADAS desde la API SAI
 * y almacenamiento en Google Sheet con deduplicación por consecutivo.
 */

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

function consultarSAIRechazados() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('API_KEY');
  var endpointBase = props.getProperty('ENDPOINT_BASE');

  var hoy = new Date();
  var inicio = new Date(hoy);
  inicio.setDate(inicio.getDate() - SAI_CONFIG.DIAS_ATRAS);

  var startDate = Utilities.formatDate(inicio, 'America/Bogota', 'yyyyMMdd');
  var endDate = Utilities.formatDate(hoy, 'America/Bogota', 'yyyyMMdd');

  var rechazados = fetchRechazadosSAI_(endpointBase, apiKey, startDate, endDate);
  if (rechazados.length === 0) {
    Logger.log('Sin solicitudes rechazadas nuevas.');
    return;
  }

  escribirEnSheet_(rechazados);
}

function fetchRechazadosSAI_(endpointBase, apiKey, startDate, endDate) {
  var resultado = [];
  var page = 0;
  var totalPages = 1;

  while (page < totalPages) {
    var url = endpointBase
      + '?startDate=' + startDate
      + '&endDate=' + endDate
      + '&page=' + page
      + '&size=' + SAI_CONFIG.PAGE_SIZE;

    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('Error API SAI página ' + page + ': HTTP ' + code);
      break;
    }

    var data = JSON.parse(response.getContentText());
    totalPages = data.totalPages || 1;
    var content = data.content || [];

    for (var i = 0; i < content.length; i++) {
      var s = content[i];
      if (String(s.firstResult) === '34' && s.requestType !== 'AC' && s.uar !== true) {
        resultado.push(s);
      }
    }

    page++;
    if (page < totalPages) {
      Utilities.sleep(SAI_CONFIG.SLEEP_MS);
    }
  }

  Logger.log('Total rechazados encontrados: ' + resultado.length);
  return resultado;
}

function escribirEnSheet_(rechazados) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    Logger.log('No se pudo obtener lock: ' + e.message);
    return;
  }

  try {
    var ss = SpreadsheetApp.openById(SAI_CONFIG.SHEET_ID);
    var sheet = ss.getSheetByName('rechazado_gestion_directa');

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, SAI_CONFIG.TOTAL_COLUMNAS)
        .setNumberFormat('@')
        .setValues([SAI_CONFIG.ENCABEZADOS])
        .setFontWeight('bold');
      SpreadsheetApp.flush();
    }

    var lastRow = sheet.getLastRow();

    var existentes = {};
    if (lastRow > 1) {
      var colA = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < colA.length; i++) {
        var val = String(colA[i][0]).trim();
        if (val !== '') existentes[val] = true;
      }
    }

    var timestamp = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd HH:mm:ss');
    var filas = [];

    for (var j = 0; j < rechazados.length; j++) {
      var s = rechazados[j];
      var consecutivo = String(s.consecutive || '');
      if (existentes[consecutivo]) continue;
      existentes[consecutivo] = true;

      filas.push(construirFila_(s, timestamp));
    }

    if (filas.length === 0) {
      Logger.log('Todas las solicitudes ya existían en la hoja.');
      return;
    }

    var startRow = Math.max(lastRow + 1, 2);
    var range = sheet.getRange(startRow, 1, filas.length, SAI_CONFIG.TOTAL_COLUMNAS);
    range.setNumberFormat('@');
    range.setValues(filas);
    SpreadsheetApp.flush();

    Logger.log(filas.length + ' filas nuevas escritas desde fila ' + startRow);
  } finally {
    lock.releaseLock();
  }
}

function construirFila_(s, timestamp) {
  var cod = s.codebtors || s.coDebtors || [];
  var c1 = cod[0] || {};
  var c2 = cod[1] || {};
  var c3 = cod[2] || {};

  var clase = SAI_CONFIG.REQUEST_TYPE_MAP[s.requestType] || String(s.requestType || '');

  return [
    String(s.consecutive || ''),                                    // A  solicitud
    String(s.policyNumber || ''),                                   // B  poliza
    String(s.evaluatedDocument || s.holderDocument || ''),           // C  identificacion
    String(s.evaluatedDocumentType || s.holderDocumentType || ''),   // D  tipo_identificacion
    String(s.tenantName || ''),                                     // E  nombre_inquilino
    String(s.tenantEmail || ''),                                    // F  correo_inquilino
    String(s.tenantPhone || ''),                                    // G  telefono_inquilino
    String(s.income || ''),                                         // H  ingresos
    String(s.expeditionDate || ''),                                 // I  fecha_expedicion
    String(s.monthlyRent || ''),                                    // J  canon
    String(s.managementFee || ''),                                  // K  cuota
    String(s.address || ''),                                        // L  direccion
    String(s.propertyUse || ''),                                    // M  destino_inmueble
    String(s.cityName || ''),                                       // N  ciudad
    String(s.executiveName || ''),                                  // O  nombre_asesor
    String(s.advisorEmail || ''),                                   // P  correo_asesor
    String(s.studyStatus || ''),                                    // Q  estado_general
    String(s.registrationDate || ''),                               // R  fecha_radicacion
    String(s.lastResultDate || s.lastMovementDate || ''),           // S  fecha_resultado
    '',                                                             // T  descripcion_resultado
    clase,                                                          // U  clase
    'No',                                                           // V  uar
    // Codeudor 1 (W-AC)
    String(c1.name || c1.fullName || ''),
    String(c1.document || c1.documentNumber || ''),
    String(c1.documentType || ''),
    String(c1.email || ''),
    String(c1.phone || ''),
    String(c1.status || c1.studyStatus || ''),
    String(c1.result || c1.resultDescription || ''),
    // Codeudor 2 (AD-AJ)
    String(c2.name || c2.fullName || ''),
    String(c2.document || c2.documentNumber || ''),
    String(c2.documentType || ''),
    String(c2.email || ''),
    String(c2.phone || ''),
    String(c2.status || c2.studyStatus || ''),
    String(c2.result || c2.resultDescription || ''),
    // Codeudor 3 (AK-AQ)
    String(c3.name || c3.fullName || ''),
    String(c3.document || c3.documentNumber || ''),
    String(c3.documentType || ''),
    String(c3.email || ''),
    String(c3.phone || ''),
    String(c3.status || c3.studyStatus || ''),
    String(c3.result || c3.resultDescription || ''),
    // Canal y timestamp
    String(s.channel || ''),                                        // AR canal
    timestamp                                                       // AS fecha_consulta
  ];
}

/**
 * Explorar API SAI sin filtros: muestra TODOS los campos y valores de las primeras solicitudes.
 * Ejecutar manualmente y revisar en Registros (Logger).
 */
function explorarAPISAI() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('API_KEY');
  var endpointBase = props.getProperty('ENDPOINT_BASE');

  var hoy = new Date();
  var inicio = new Date(hoy);
  inicio.setDate(inicio.getDate() - 1);

  var startDate = Utilities.formatDate(inicio, 'America/Bogota', 'yyyyMMdd');
  var endDate = Utilities.formatDate(hoy, 'America/Bogota', 'yyyyMMdd');

  var url = endpointBase + '?startDate=' + startDate + '&endDate=' + endDate + '&page=0&size=10';

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
    muteHttpExceptions: true
  });

  var data = JSON.parse(response.getContentText());
  Logger.log('=== META ===');
  Logger.log('totalPages: ' + data.totalPages + ' | totalElements: ' + data.totalElements);

  var content = data.content || [];
  Logger.log('=== Registros en esta página: ' + content.length + ' ===');

  for (var i = 0; i < Math.min(content.length, 5); i++) {
    Logger.log('--- Solicitud #' + (i+1) + ' ---');
    var keys = Object.keys(content[i]).sort();
    for (var k = 0; k < keys.length; k++) {
      var val = content[i][keys[k]];
      if (typeof val === 'object' && val !== null) {
        Logger.log('  ' + keys[k] + ': ' + JSON.stringify(val));
      } else {
        Logger.log('  ' + keys[k] + ': ' + val);
      }
    }
  }

  var estados = {};
  var firstResults = {};
  var requestTypes = {};
  for (var j = 0; j < content.length; j++) {
    var s = content[j];
    var est = String(s.studyStatus || 'null');
    var fr = String(s.firstResult || 'null');
    var rt = String(s.requestType || 'null');
    estados[est] = (estados[est] || 0) + 1;
    firstResults[fr] = (firstResults[fr] || 0) + 1;
    requestTypes[rt] = (requestTypes[rt] || 0) + 1;
  }
  Logger.log('=== RESUMEN estados ===');
  Logger.log(JSON.stringify(estados));
  Logger.log('=== RESUMEN firstResult ===');
  Logger.log(JSON.stringify(firstResults));
  Logger.log('=== RESUMEN requestType ===');
  Logger.log(JSON.stringify(requestTypes));
}

// ── Trigger ──

function crearTriggerSAIRechazados() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'consultarSAIRechazados') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('consultarSAIRechazados')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Trigger creado: consultarSAIRechazados cada 10 minutos.');
}

function eliminarTriggerSAIRechazados() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'consultarSAIRechazados') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('Trigger eliminado.');
}

// ── Setup inicial de Script Properties ──

function setupPropiedadesSAI() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'API_KEY': 'K40xpXTgvd61f0355OLXV3jtz5FWbCjTXn1SfhD1',
    'ENDPOINT_BASE': 'https://2n7hb4m6v7.execute-api.us-east-1.amazonaws.com/prod/flujo/flujo/v1/study/rental/date'
  });
  Logger.log('Script Properties configuradas.');
}
