/**
 * CONSTANTES DE CONEXIÓN DE BASE DE DATOS
 */
const TARGET_SOLICITUDES_SS_ID = "1x9groW5-I7Xg5ULh7DXfa2XGmS_RMdfqfW1iDWB8bJ0";
const SHEET_NAME_SOLICITUDES = "Historico_Gestiones";
const ID_HOJA_REESTUDIOS = "1slgykTgjoAtCd6KmlG7Lqiuw-nM1hSguQbi0XqeLu7U";
const NOMBRE_PESTANA_REESTUDIOS = "ORIGEN";
const TIMEZONE = "America/Bogota";

/**
 * Control de Acceso Web App de Métricas.
 */
function verificarPermisoAdmin() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
  const ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  const hojaUser = ss.getSheetByName("Usuarios");
  const dataUser = hojaUser.getDataRange().getValues();
  const usuario = dataUser.find(f => String(f[2]).toLowerCase().trim() === userEmail);
  
  if (!usuario || String(usuario[23]).toUpperCase().trim() !== "ADMIN") {
    throw new Error("Acceso Denegado: Se requieren permisos de Administrador.");
  }
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('MetricasPanel')
    .evaluate()
    .setTitle('Métricas del Equipo - Producción')
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
 * Obtiene todas las métricas agregadas para el rango de fechas dado.
 */
function obtenerDatosMetricas(fechaDesde, fechaHasta) {
  verificarPermisoAdmin();
  const ss = SpreadsheetApp.openById(TARGET_SOLICITUDES_SS_ID);
  const hoja = ss.getSheetByName(SHEET_NAME_SOLICITUDES);
  if (!hoja) throw new Error("No se pudo acceder a la hoja de solicitudes.");
  
  const data = hoja.getDataRange().getDisplayValues();
  const desde = parseFechaDDMMYYYY(fechaDesde);
  const hasta = parseFechaDDMMYYYY(fechaHasta);
  if (!desde || !hasta) throw new Error("Formato de fecha inválido. Use dd/MM/yyyy.");
  
  hasta.setHours(23, 59, 59, 999);
  
  let totalGestionadas = 0;
  let sumaTiempos = 0;
  let countTiempos = 0;
  let sumaTiemposGeneral = 0;
  let countTiemposGeneral = 0;
  let aprobadas = 0;
  let negadas = 0;
  let aplazadas = 0;
  let fueraDeSLA = 0;
  
  const produccionMap = {};
  const slaMap = {};
  const analistaMap = {};

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
    const tiempoGeneralRaw = String(fila[36] || "").trim();
    const slaHorasRaw = String(fila[29] || "").trim();

    if (estado.includes("APROB")) aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) negadas++;
    else if (estado.includes("APLAZ")) aplazadas++;

    const tiempoGestion = parseFloat(tiempoGestionRaw);
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) {
      sumaTiempos += tiempoGestion;
      countTiempos++;
    }

    const tiempoGeneral = parseFloat(tiempoGeneralRaw);
    if (!isNaN(tiempoGeneral) && tiempoGeneral > 0) {
      sumaTiemposGeneral += tiempoGeneral;
      countTiemposGeneral++;
    }

    const slaHoras = parseFloat(slaHorasRaw.replace(',', '.'));
    if (!isNaN(slaHoras) && slaHoras > 4) fueraDeSLA++;

    if (!produccionMap[fechaGestionStr]) produccionMap[fechaGestionStr] = 0;
    produccionMap[fechaGestionStr]++;

    if (!slaMap[fechaGestionStr]) slaMap[fechaGestionStr] = { dentroSLA: 0, fueraSLA: 0 };
    if (!isNaN(slaHoras)) {
      if (slaHoras <= 4) slaMap[fechaGestionStr].dentroSLA++;
      else slaMap[fechaGestionStr].fueraSLA++;
    }

    if (!analistaMap[nombre]) {
      analistaMap[nombre] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoGeneral: 0, countTiempoGeneral: 0, fueraSLA: 0 };
    }
    const a = analistaMap[nombre];
    a.total++;
    if (estado.includes("APROB")) a.aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) a.negadas++;
    else if (estado.includes("APLAZ")) a.aplazadas++;
    
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) { a.sumaTiempo += tiempoGestion; a.countTiempo++; }
    if (!isNaN(tiempoGeneral) && tiempoGeneral > 0) { a.sumaTiempoGeneral += tiempoGeneral; a.countTiempoGeneral++; }
    if (!isNaN(slaHoras) && slaHoras > 4) a.fueraSLA++;
  }

  try {
    const ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 14).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const fechaFinStr = String(dataReest[i][9]).trim();
          if (!fechaFinStr) continue;
          
          const fechaParte = fechaFinStr.split(' ')[0];
          const fechaGestion = parseFechaDDMMYYYY(fechaParte);
          if (!fechaGestion || fechaGestion < desde || fechaGestion > hasta) continue;
          
          totalGestionadas++;
          const estadoR = String(dataReest[i][10]).toUpperCase().trim();
          const nombreR = String(dataReest[i][7] || "Sin nombre").trim();
          
          if (estadoR.includes("APROB")) aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) negadas++;
          else if (estadoR.includes("APLAZ")) aplazadas++;

          if (!produccionMap[fechaParte]) produccionMap[fechaParte] = 0;
          produccionMap[fechaParte]++;

          if (!analistaMap[nombreR]) {
            analistaMap[nombreR] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, fueraSLA: 0 };
          }
          const aR = analistaMap[nombreR];
          aR.total++;
          if (estadoR.includes("APROB")) aR.aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) aR.negadas++;
          else if (estadoR.includes("APLAZ")) aR.aplazadas++;
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se incluyeron reestudios en métricas: " + e.message);
  }

  const tiempoPromedioMinutos = countTiempos > 0 ? Math.round((sumaTiempos / countTiempos) * 10) / 10 : 0;
  const tiempoPromedioGeneralHoras = countTiemposGeneral > 0 ? Number((sumaTiemposGeneral / countTiemposGeneral).toFixed(2)) : 0;
  const tasaAprobacion = totalGestionadas > 0 ? Math.round((aprobadas / totalGestionadas) * 1000) / 10 : 0;

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
        tiempoPromedioGeneral: a.countTiempoGeneral > 0 ? Number((a.sumaTiempoGeneral / a.countTiempoGeneral).toFixed(2)) : 0,
        fueraSLA: a.fueraSLA
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    totalGestionadas: totalGestionadas,
    tiempoPromedioMinutos: tiempoPromedioMinutos,
    tiempoPromedioGeneralHoras: tiempoPromedioGeneralHoras,
    tasaAprobacion: tasaAprobacion,
    fueraDeSLA: fueraDeSLA,
    produccionDiaria: produccionDiaria,
    distribucionEstados: { aprobadas: aprobadas, negadas: negadas, aplazadas: aplazadas },
    porAnalista: porAnalista,
    slaDiario: slaDiario
  };
}

/**
 * Obtiene la lista de analistas activos con la hora de su primer resultado del día.
 */
function admin_obtenerAsesoresActivosPrimerResultado(fechaFiltro) {
  verificarPermisoAdmin();
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

  const primerResultadoMap = {};
  const ultimoResultadoMap = {};
  const gestionadasMap = {};
  const pendientesMap = {};
  const asignadasFechaMap = {};
  const tiemposGestionMap = {};
  const tiemposGeneralMap = {};

  for (let i = 1; i < dataSol.length; i++) {
    const asignado = String(dataSol[i][27] || "").toLowerCase().trim();
    const fechaFinRaw = String(dataSol[i][28] || "").trim();
    const fechaAsignacion = String(dataSol[i][26] || "").trim();
    const tiempoGestionVal = String(dataSol[i][34] || "").trim();
    const tiempoGeneralVal = String(dataSol[i][36] || "").trim();
    if (!asignado) continue;

    if (esHoy) {
      if (fechaAsignacion !== "" && fechaFinRaw === "") {
        pendientesMap[asignado] = (pendientesMap[asignado] || 0) + 1;
      }
    } else {
      if (fechaAsignacion && fechaAsignacion.includes(fechaStr)) {
        asignadasFechaMap[asignado] = (asignadasFechaMap[asignado] || 0) + 1;
      }
    }

    if (fechaFinRaw && fechaFinRaw.includes(fechaStr)) {
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
      const hora = partes.length > 1 ? partes[1] : "";
      if (hora) {
        if (!primerResultadoMap[asignado] || hora < primerResultadoMap[asignado]) primerResultadoMap[asignado] = hora;
        if (!ultimoResultadoMap[asignado] || hora > ultimoResultadoMap[asignado]) ultimoResultadoMap[asignado] = hora;
      }
    }
  }

  try {
    const ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 7, lastRowR - 1, 10).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const asignado = String(dataReest[i][0]).trim().toLowerCase();
          const fechaAsig = String(dataReest[i][2]).trim();
          const fechaFinRaw = String(dataReest[i][3]).trim();
          const tiempoTotalReest = String(dataReest[i][8] || "").trim();
          const tiempoGestionReest = String(dataReest[i][9] || "").trim();
          
          if (!asignado) continue;
          if (esHoy) {
            if (fechaAsig !== "" && fechaFinRaw === "") {
              pendientesMap[asignado] = (pendientesMap[asignado] || 0) + 1;
            }
          } else {
            if (fechaAsig && fechaAsig.includes(fechaStr)) {
              asignadasFechaMap[asignado] = (asignadasFechaMap[asignado] || 0) + 1;
            }
          }

          if (fechaFinRaw && fechaFinRaw.includes(fechaStr)) {
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
            const hora = partes.length > 1 ? partes[1] : "";
            if (hora) {
              if (!primerResultadoMap[asignado] || hora < primerResultadoMap[asignado]) primerResultadoMap[asignado] = hora;
              if (!ultimoResultadoMap[asignado] || hora > ultimoResultadoMap[asignado]) ultimoResultadoMap[asignado] = hora;
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se incluyeron reestudios en seguimiento: " + e.message);
  }

  const resultado = [];
  for (let j = 1; j < dataUser.length; j++) {
    const estadoUser = String(dataUser[j][5] || "").toUpperCase().trim();
    if (estadoUser === "INACTIVO" || estadoUser === "") continue;
    
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
      pendientes: esHoy ? (pendientesMap[correo] || 0) : (asignadasFechaMap[correo] || 0),
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
  verificarPermisoAdmin();
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
    const fechaAsignacion = String(dataSol[i][26] || "").trim();
    const fechaFin = String(dataSol[i][28] || "").trim();
    const tiempoGestion = String(dataSol[i][34] || "").trim();
    const tiempoSLA = String(dataSol[i][29] || "").trim();
    const tiempoGeneral = String(dataSol[i][36] || "").trim();

    if (!solicitudId) continue;

    let tipo = 'Digital';
    if (estado.includes('BIOMETRIA')) tipo = 'Biometría';
    else if (clase === 'INDUCCION') tipo = 'Inducción';

    if (fechaFin !== "" && fechaFin.includes(fechaStr)) {
      gestionadas.push({
        id: solicitudId,
        poliza: poliza,
        tipo: tipo,
        estado: estado,
        fechaFin: fechaFin,
        duracion: tiempoGestion,
        tiempoSLA: tiempoSLA,
        tiempoGeneral: tiempoGeneral
      });
    }

    if (esHoy) {
      if (fechaAsignacion !== "" && fechaFin === "") {
        pendientes.push({ id: solicitudId, poliza: poliza, tipo: tipo, estado: estado, fechaAsignacion: fechaAsignacion });
      }
    } else {
      if (fechaAsignacion && fechaAsignacion.includes(fechaStr)) {
        pendientes.push({ id: solicitudId, poliza: poliza, tipo: tipo, estado: estado, fechaAsignacion: fechaAsignacion });
      }
    }
  }

  try {
    const ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 16).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const asignado = String(dataReest[i][6]).toLowerCase().trim();
          if (asignado !== correoAnalista) continue;
          
          const solicitud = String(dataReest[i][1]).trim();
          const origen = String(dataReest[i][3]).trim();
          const tipoProceso = String(dataReest[i][4]).trim();
          const fechaAsig = String(dataReest[i][8]).trim();
          const fechaFin = String(dataReest[i][9]).trim();
          const estadoG = String(dataReest[i][10]).trim();
          const tiempoG = String(dataReest[i][15]).trim();

          if (!solicitud) continue;
          const origenUp = origen.toUpperCase();
          const tipoUp = tipoProceso.toUpperCase();
          const esUar = origenUp === "CORREO" && (tipoUp.includes("ADICIONAL") || tipoUp.includes("NUEVA"));
          const tipoLabel = esUar ? 'UAR' : 'Reestudio';

          if (fechaFin !== "" && fechaFin.includes(fechaStr)) {
            gestionadas.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: estadoG, fechaFin: fechaFin, duracion: tiempoG });
          }
          if (esHoy) {
            if (fechaAsig !== "" && fechaFin === "") {
              pendientes.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: "En gestión", fechaAsignacion: fechaAsig });
            }
          } else {
            if (fechaAsig && fechaAsig.includes(fechaStr)) {
              pendientes.push({ id: solicitud, poliza: origen, tipo: tipoLabel, estado: estadoG || "En gestión", fechaAsignacion: fechaAsig });
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
