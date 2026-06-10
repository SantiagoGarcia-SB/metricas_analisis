/**
 * CONSTANTES DE CONEXIÓN DE BASE DE DATOS
 */
const TARGET_SOLICITUDES_SS_ID = "1x9groW5-I7Xg5ULh7DXfa2XGmS_RMdfqfW1iDWB8bJ0";
const SHEET_NAME_SOLICITUDES = "Historico_Gestiones";
const ID_HOJA_REESTUDIOS = "1slgykTgjoAtCd6KmlG7Lqiuw-nM1hSguQbi0XqeLu7U";
const NOMBRE_PESTANA_REESTUDIOS = "ORIGEN";
const TIMEZONE = "America/Bogota";


function doGet(e) {
  return HtmlService.createTemplateFromFile('MetricasPanel')
    .evaluate()
    .setTitle('Métricas Análisis de Riesgo')
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
 * Determina la sucursal/ciudad basándose en el número de póliza.
 * @param {string} polizaStr - Número de póliza
 * @returns {string} Nombre de la ciudad/sucursal
 */
function obtenerSucursalPorPoliza(polizaStr) {
  const num = parseInt(String(polizaStr).trim(), 10);
  if (isNaN(num)) return "Sin clasificar";
  if (num === 0) return "Operador Inmobiliario";
  if (num >= 1 && num <= 9999) return "Bogotá";
  if (num >= 10000 && num <= 10999) return "Cali";
  if (num >= 11000 && num <= 11999) return "Bucaramanga";
  if (num >= 12000 && num <= 12999) return "Eje Cafetero";
  if (num >= 13000 && num <= 13999) return "Medellín";
  if (num >= 14000 && num <= 14999) return "Barranquilla";
  if (num >= 15000 && num <= 15999) return "Cartagena";
  if (num >= 16000 && num <= 16999) return "Eje Cafetero";
  return "Sin clasificar";
}

/**
 * Obtiene todas las métricas agregadas para el rango de fechas dado.
 */
function obtenerDatosMetricas(fechaDesde, fechaHasta) {
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
  let sumaTiemposResolucion = 0;
  let countTiemposResolucion = 0;
  let aprobadas = 0;
  let negadas = 0;
  let aplazadas = 0;
  let fueraDeSLA = 0;
  
  const produccionMap = {};
  const slaMap = {};
  const analistaMap = {};
  const sucursalMap = {};  // { fecha: { sucursal: count } }
  const tipoMap = {};
  const tiemposDetalle = [];

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
    const tiempoResolucionRaw = String(fila[29] || "").trim();

    if (estado.includes("APROB")) aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) negadas++;
    else if (estado.includes("APLAZ")) aplazadas++;

    const clase = String(fila[20] || "").toUpperCase().trim();
    let tipoSol = 'Digital';
    if (estado.includes('BIOMETRIA')) tipoSol = 'Biometría';
    else if (clase === 'INDUCCION') tipoSol = 'Inducción';
    if (!tipoMap[fechaGestionStr]) tipoMap[fechaGestionStr] = { Digital: 0, UAR: 0, Reestudio: 0, 'Biometría': 0, 'Inducción': 0 };
    tipoMap[fechaGestionStr][tipoSol]++;

    const tiempoGestion = parseFloat(tiempoGestionRaw);
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) {
      sumaTiempos += tiempoGestion;
      countTiempos++;
    }

    const tiempoResolucion = parseFloat(tiempoResolucionRaw.replace(',', '.'));
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) {
      sumaTiemposResolucion += tiempoResolucion;
      countTiemposResolucion++;
    }

    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) fueraDeSLA++;

    if (!produccionMap[fechaGestionStr]) produccionMap[fechaGestionStr] = 0;
    produccionMap[fechaGestionStr]++;

    if (!slaMap[fechaGestionStr]) slaMap[fechaGestionStr] = { dentroSLA: 0, fueraSLA: 0 };
    if (!isNaN(tiempoResolucion)) {
      if (tiempoResolucion <= 2) slaMap[fechaGestionStr].dentroSLA++;
      else slaMap[fechaGestionStr].fueraSLA++;
    }

    if (!analistaMap[nombre]) {
      analistaMap[nombre] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, diasInfo: {}, horasSlot: {} };
    }
    const a = analistaMap[nombre];
    a.total++;
    const fechaFinCompleta = String(fila[28] || "").trim();
    const horaFin = fechaFinCompleta.split(' ')[1] || "";
    if (horaFin && fechaGestionStr) {
      if (!a.diasInfo[fechaGestionStr]) a.diasInfo[fechaGestionStr] = { count: 0, primera: horaFin, ultima: horaFin };
      a.diasInfo[fechaGestionStr].count++;
      if (horaFin < a.diasInfo[fechaGestionStr].primera) a.diasInfo[fechaGestionStr].primera = horaFin;
      if (horaFin > a.diasInfo[fechaGestionStr].ultima) a.diasInfo[fechaGestionStr].ultima = horaFin;
      const hSlot = parseInt(horaFin.split(':')[0], 10);
      if (!isNaN(hSlot)) a.horasSlot[hSlot] = (a.horasSlot[hSlot] || 0) + 1;
    }
    if (estado.includes("APROB")) a.aprobadas++;
    else if (estado.includes("NEGAD") || estado.includes("RECHAZ")) a.negadas++;
    else if (estado.includes("APLAZ")) a.aplazadas++;
    
    if (!isNaN(tiempoGestion) && tiempoGestion >= 0) { a.sumaTiempo += tiempoGestion; a.countTiempo++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 0) { a.sumaTiempoResolucion += tiempoResolucion; a.countTiempoResolucion++; }
    if (!isNaN(tiempoResolucion) && tiempoResolucion > 2) a.fueraSLA++;

    const sucursal = obtenerSucursalPorPoliza(fila[1]);
    if (!sucursalMap[fechaGestionStr]) sucursalMap[fechaGestionStr] = {};
    sucursalMap[fechaGestionStr][sucursal] = (sucursalMap[fechaGestionStr][sucursal] || 0) + 1;

    tiemposDetalle.push({ fecha: fechaGestionStr, sucursal: sucursal, tipo: tipoSol, tGestion: !isNaN(tiempoGestion) && tiempoGestion >= 0 ? tiempoGestion : null, tResolucion: !isNaN(tiempoResolucion) && tiempoResolucion > 0 ? tiempoResolucion : null });
  }

  try {
    const ssReest = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReest = ssReest.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReest) {
      const lastRowR = hojaReest.getLastRow();
      if (lastRowR > 1) {
        const dataReest = hojaReest.getRange(2, 1, lastRowR - 1, 17).getDisplayValues();
        for (let i = 0; i < dataReest.length; i++) {
          const fechaFinStr = String(dataReest[i][9]).trim();
          if (!fechaFinStr) continue;
          
          const fechaParte = fechaFinStr.split(' ')[0];
          const fechaGestion = parseFechaDDMMYYYY(fechaParte);
          if (!fechaGestion || fechaGestion < desde || fechaGestion > hasta) continue;
          
          totalGestionadas++;
          const estadoR = String(dataReest[i][10]).toUpperCase().trim();
          const nombreR = String(dataReest[i][7] || "Sin nombre").trim();
          const tiempoResolucionReestRaw = String(dataReest[i][14] || "").trim();
          const tiempoGestionReestRaw = String(dataReest[i][15] || "").trim();
          
          if (estadoR.includes("APROB")) aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) negadas++;
          else if (estadoR.includes("APLAZ")) aplazadas++;

          const origenR = String(dataReest[i][3] || "").toUpperCase().trim();
          const tipoProcesoR = String(dataReest[i][4] || "").toUpperCase().trim();
          const esUarMetrica = origenR === "CORREO" && (tipoProcesoR.includes("ADICIONAL") || tipoProcesoR.includes("NUEVA"));
          const tipoReest = esUarMetrica ? 'UAR' : 'Reestudio';
          if (!tipoMap[fechaParte]) tipoMap[fechaParte] = { Digital: 0, UAR: 0, Reestudio: 0, 'Biometría': 0, 'Inducción': 0 };
          tipoMap[fechaParte][tipoReest]++;

          const tiempoResolucionReest = parseFloat(tiempoResolucionReestRaw.replace(',', '.'));
          const tiempoResolucionReestHoras = !isNaN(tiempoResolucionReest) ? tiempoResolucionReest / 60 : NaN;
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) {
            sumaTiemposResolucion += tiempoResolucionReestHoras;
            countTiemposResolucion++;
          }

          const tiempoGestionReest = parseFloat(tiempoGestionReestRaw.replace(',', '.'));
          if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) {
            sumaTiempos += tiempoGestionReest;
            countTiempos++;
          }

          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) fueraDeSLA++;

          if (!produccionMap[fechaParte]) produccionMap[fechaParte] = 0;
          produccionMap[fechaParte]++;

          if (!slaMap[fechaParte]) slaMap[fechaParte] = { dentroSLA: 0, fueraSLA: 0 };
          if (!isNaN(tiempoResolucionReestHoras)) {
            if (tiempoResolucionReestHoras <= 2) slaMap[fechaParte].dentroSLA++;
            else slaMap[fechaParte].fueraSLA++;
          }

          if (!analistaMap[nombreR]) {
            analistaMap[nombreR] = { total: 0, aprobadas: 0, negadas: 0, aplazadas: 0, sumaTiempo: 0, countTiempo: 0, sumaTiempoResolucion: 0, countTiempoResolucion: 0, fueraSLA: 0, diasInfo: {}, horasSlot: {} };
          }
          const aR = analistaMap[nombreR];
          aR.total++;
          const horaFinR = fechaFinStr.split(' ')[1] || "";
          if (horaFinR && fechaParte) {
            if (!aR.diasInfo[fechaParte]) aR.diasInfo[fechaParte] = { count: 0, primera: horaFinR, ultima: horaFinR };
            aR.diasInfo[fechaParte].count++;
            if (horaFinR < aR.diasInfo[fechaParte].primera) aR.diasInfo[fechaParte].primera = horaFinR;
            if (horaFinR > aR.diasInfo[fechaParte].ultima) aR.diasInfo[fechaParte].ultima = horaFinR;
            const hSlotR = parseInt(horaFinR.split(':')[0], 10);
            if (!isNaN(hSlotR)) aR.horasSlot[hSlotR] = (aR.horasSlot[hSlotR] || 0) + 1;
          }
          if (estadoR.includes("APROB")) aR.aprobadas++;
          else if (estadoR.includes("NEGAD") || estadoR.includes("RECHAZ")) aR.negadas++;
          else if (estadoR.includes("APLAZ")) aR.aplazadas++;
          if (!isNaN(tiempoGestionReest) && tiempoGestionReest >= 0) { aR.sumaTiempo += tiempoGestionReest; aR.countTiempo++; }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0) { aR.sumaTiempoResolucion += tiempoResolucionReestHoras; aR.countTiempoResolucion++; }
          if (!isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 2) aR.fueraSLA++;

          const sucursalR = obtenerSucursalPorPoliza(dataReest[i][16]);
          if (!sucursalMap[fechaParte]) sucursalMap[fechaParte] = {};
          sucursalMap[fechaParte][sucursalR] = (sucursalMap[fechaParte][sucursalR] || 0) + 1;

          tiemposDetalle.push({ fecha: fechaParte, sucursal: sucursalR, tipo: tipoReest, tGestion: !isNaN(tiempoGestionReest) && tiempoGestionReest >= 0 ? tiempoGestionReest : null, tResolucion: !isNaN(tiempoResolucionReestHoras) && tiempoResolucionReestHoras > 0 ? tiempoResolucionReestHoras : null });
        }
      }
    }
  } catch (e) {
    Logger.log("Aviso: No se incluyeron reestudios en métricas: " + e.message);
  }

  const tiempoPromedioMinutos = countTiempos > 0 ? Math.round((sumaTiempos / countTiempos) * 10) / 10 : 0;
  const tiempoPromedioResolucionHoras = countTiemposResolucion > 0 ? Number((sumaTiemposResolucion / countTiemposResolucion).toFixed(2)) : 0;
  const tasaAprobacion = totalGestionadas > 0 ? Math.round((aprobadas / totalGestionadas) * 1000) / 10 : 0;

  // Backlog: solicitudes asignadas sin fecha fin
  let backlog = 0;
  for (let i = 1; i < data.length; i++) {
    const fechaAsig = String(data[i][26] || "").trim();
    const fechaFin = String(data[i][28] || "").trim();
    if (fechaAsig !== "" && fechaFin === "") backlog++;
  }
  // Backlog reestudios
  try {
    const ssReestB = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReestB = ssReestB.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReestB) {
      const lastRowB = hojaReestB.getLastRow();
      if (lastRowB > 1) {
        const dataB = hojaReestB.getRange(2, 9, lastRowB - 1, 2).getDisplayValues();
        for (let i = 0; i < dataB.length; i++) {
          const fAsig = String(dataB[i][0]).trim();
          const fFin = String(dataB[i][1]).trim();
          if (fAsig !== "" && fFin === "") backlog++;
        }
      }
    }
  } catch(e) {}

  // Negación por sucursal (para gráfica macro) - incluye ambas hojas
  const negacionSucursal = {};
  for (let i = 1; i < data.length; i++) {
    const fechaGStr = String(data[i][33] || "").trim();
    if (!fechaGStr) continue;
    const fG = parseFechaDDMMYYYY(fechaGStr);
    if (!fG || fG < desde || fG > hasta) continue;
    const est = String(data[i][16] || "").toUpperCase().trim();
    const suc = obtenerSucursalPorPoliza(data[i][1]);
    if (!negacionSucursal[suc]) negacionSucursal[suc] = { total: 0, negadas: 0 };
    negacionSucursal[suc].total++;
    if (est.includes("NEGAD") || est.includes("RECHAZ")) negacionSucursal[suc].negadas++;
  }
  // Agregar reestudios a negación por sucursal
  try {
    const ssReestN = SpreadsheetApp.openById(ID_HOJA_REESTUDIOS);
    const hojaReestN = ssReestN.getSheetByName(NOMBRE_PESTANA_REESTUDIOS);
    if (hojaReestN) {
      const lastRowN = hojaReestN.getLastRow();
      if (lastRowN > 1) {
        const dataN = hojaReestN.getRange(2, 1, lastRowN - 1, 17).getDisplayValues();
        for (let i = 0; i < dataN.length; i++) {
          const fechaFinN = String(dataN[i][9]).trim();
          if (!fechaFinN) continue;
          const fechaParteN = fechaFinN.split(' ')[0];
          const fN = parseFechaDDMMYYYY(fechaParteN);
          if (!fN || fN < desde || fN > hasta) continue;
          const estN = String(dataN[i][10]).toUpperCase().trim();
          const sucN = obtenerSucursalPorPoliza(dataN[i][16]);
          if (!negacionSucursal[sucN]) negacionSucursal[sucN] = { total: 0, negadas: 0 };
          negacionSucursal[sucN].total++;
          if (estN.includes("NEGAD") || estN.includes("RECHAZ")) negacionSucursal[sucN].negadas++;
        }
      }
    }
  } catch(e) {}

  const tasaNegacionSucursal = Object.keys(negacionSucursal).map(s => ({
    sucursal: s,
    total: negacionSucursal[s].total,
    negadas: negacionSucursal[s].negadas,
    tasa: negacionSucursal[s].total > 0 ? Math.round((negacionSucursal[s].negadas / negacionSucursal[s].total) * 1000) / 10 : 0
  })).sort((a, b) => b.tasa - a.tasa);

  // SLA semanal (% cumplimiento)
  const slaSemanal = {};
  const fechasSLA = Object.keys(slaMap).sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b));
  fechasSLA.forEach(fecha => {
    const f = parseFechaDDMMYYYY(fecha);
    if (!f) return;
    // Agrupar por semana (lunes de la semana)
    const dia = f.getDay();
    const lunes = new Date(f);
    lunes.setDate(f.getDate() - (dia === 0 ? 6 : dia - 1));
    const semKey = (lunes.getDate() < 10 ? '0' : '') + lunes.getDate() + '/' + (lunes.getMonth() < 9 ? '0' : '') + (lunes.getMonth()+1) + '/' + lunes.getFullYear();
    if (!slaSemanal[semKey]) slaSemanal[semKey] = { dentro: 0, fuera: 0 };
    slaSemanal[semKey].dentro += slaMap[fecha].dentroSLA;
    slaSemanal[semKey].fuera += slaMap[fecha].fueraSLA;
  });
  const tendenciaSLA = Object.keys(slaSemanal)
    .sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b))
    .map(sem => {
      const t = slaSemanal[sem].dentro + slaSemanal[sem].fuera;
      return { semana: sem, pctCumplimiento: t > 0 ? Math.round((slaSemanal[sem].dentro / t) * 1000) / 10 : 100 };
    });

  // Heatmap hora (consolidado equipo)
  const heatmapHora = {};
  for (let h = 7; h <= 18; h++) heatmapHora[h] = 0;
  Object.keys(analistaMap).forEach(nombre => {
    const slots = analistaMap[nombre].horasSlot;
    Object.keys(slots).forEach(h => { heatmapHora[h] = (heatmapHora[h] || 0) + slots[h]; });
  });

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
            var pMin = parseInt(pParts[0]) * 60 + parseInt(pParts[1]);
            var uMin = parseInt(uParts[0]) * 60 + parseInt(uParts[1]);
            var diffHoras = (uMin - pMin) / 60;
            if (diffHoras > 0) { sumaRates += info.count / diffHoras; diasConRango++; }
            else { sumaRates += info.count; diasConRango++; }
          }
          return diasConRango > 0 ? Math.round(sumaRates / diasConRango) : 0;
        })(),
        detalleHoras: (function() {
          var numDias = Object.keys(a.diasInfo).length || 1;
          var detalle = {};
          for (var h = 7; h <= 18; h++) {
            detalle[h] = a.horasSlot[h] ? Math.round(a.horasSlot[h] / numDias) : 0;
          }
          return detalle;
        })(),
        fueraSLA: a.fueraSLA
      };
    })
    .sort((a, b) => b.total - a.total);

  // Obtener lista de sucursales únicas
  const sucursalesUnicas = {};
  Object.keys(sucursalMap).forEach(fecha => {
    Object.keys(sucursalMap[fecha]).forEach(s => { sucursalesUnicas[s] = true; });
  });
  const listaSucursales = Object.keys(sucursalesUnicas).sort();

  const porSucursal = {
    fechas: Object.keys(sucursalMap).sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b)),
    sucursales: listaSucursales,
    datos: {}
  };
  listaSucursales.forEach(s => {
    porSucursal.datos[s] = porSucursal.fechas.map(f => sucursalMap[f][s] || 0);
  });

  return {
    totalGestionadas: totalGestionadas,
    tiempoPromedioMinutos: tiempoPromedioMinutos,
    tiempoPromedioGeneralHoras: tiempoPromedioResolucionHoras,
    tasaAprobacion: tasaAprobacion,
    fueraDeSLA: fueraDeSLA,
    backlog: backlog,
    produccionDiaria: produccionDiaria,
    distribucionEstados: { aprobadas: aprobadas, negadas: negadas, aplazadas: aplazadas },
    porAnalista: porAnalista,
    slaDiario: slaDiario,
    porSucursal: porSucursal,
    porTipo: Object.keys(tipoMap)
      .sort((a, b) => parseFechaDDMMYYYY(a) - parseFechaDDMMYYYY(b))
      .map(fecha => ({ fecha: fecha, Digital: tipoMap[fecha].Digital, UAR: tipoMap[fecha].UAR, Reestudio: tipoMap[fecha].Reestudio, Biometria: tipoMap[fecha]['Biometría'], Induccion: tipoMap[fecha]['Inducción'] })),
    tiemposDetalle: tiemposDetalle,
    tasaNegacionSucursal: tasaNegacionSucursal,
    tendenciaSLA: tendenciaSLA,
    heatmapHora: heatmapHora
  };
}

/**
 * Obtiene la lista de analistas activos con la hora de su primer resultado del día.
 */
function admin_obtenerAsesoresActivosPrimerResultado(fechaFiltro) {
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
