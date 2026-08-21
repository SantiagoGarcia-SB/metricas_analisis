/**
 * 07_Emails.js — Construcción de HTML para emails
 *
 * Funciones puras de presentación que generan el cuerpo HTML de los emails
 * enviados por el Agente Coordinador (alertas críticas, resumen diario,
 * foto del momento, reporte biometría, inicio de operación, chequeo de
 * conexión, e informe individual semanal).
 *
 * NO interactúan con la capa de datos ni envían correos — solo construyen HTML.
 * Las funciones de envío están en 05_Administracion.js.
 *
 * Dependencias (scope global):
 *   agente_obtenerConfig (05_Administracion.js) — solo para _construirEmailResumenDiario
 */

// ============================================================================
// HELPERS DE FORMATO PARA EMAILS
// ============================================================================

function _escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _gradeColor(grade) {
  return grade === "A" ? "#166534" : grade === "B" ? "#253150" : grade === "C" ? "#a16207" : grade === "D" ? "#c2410c" : "#BD0F14";
}

function _gradeBg(grade) {
  return grade === "A" ? "#d1fae5" : grade === "B" ? "#e8edf6" : grade === "C" ? "#fef9c3" : grade === "D" ? "#fed7aa" : "#fde8e8";
}

function _fmtMinEmail(min) {
  if (!min || min === 0) return "0m";
  var h = Math.floor(min / 60);
  var m = Math.round(min % 60);
  if (m === 60) { h++; m = 0; }
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  return m + "m";
}

function _fmtHorasEmail(horas) {
  if (!horas || horas === 0) return "0m";
  var totalMin = Math.round(horas * 60);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  return m + "m";
}

// ============================================================================
// SPARKLINE Y SECCIÓN CORTE DE GESTIÓN (usados dentro de emails)
// ============================================================================

/**
 * Tira de 16 casillas (6:00 a 21:00) con la cantidad de solicitudes cerradas en cada hora.
 */
function _renderSparklineHoras(detalleHoras) {
  var html = '<table role="presentation" cellpadding="0" cellspacing="2"><tr>';
  for (var h = 6; h <= 21; h++) {
    var c = (detalleHoras && detalleHoras[h]) || 0;
    var bg = c === 0 ? "#f4f5f8" : c <= 2 ? "#e8edf6" : c <= 5 ? "#253150" : "#BD0F14";
    var tc = c <= 2 ? "#253150" : "#fff";
    html += '<td style="background:' + bg + ';color:' + tc + ';border-radius:4px;padding:4px 2px;text-align:center;width:30px;">';
    html += '<div style="font-size:8px;opacity:0.75;">' + h + '</div><div style="font-size:11px;font-weight:800;">' + c + '</div>';
    html += '</td>';
  }
  html += '</tr></table>';
  return html;
}

/**
 * Sección "Corte de Gestión" (detalle por analista) embebida dentro del email de Foto del
 * Momento — devuelve solo las filas de tabla (sin doctype/header/footer propios), para
 * insertarse en el mismo documento que _construirEmailResumenDiario.
 */
function _htmlSeccionCorteGestion(datos) {
  var analistas = datos.analistas || [];
  var rojos = analistas.filter(function(a) { return a.semaforo === "rojo"; });
  var amarillos = analistas.filter(function(a) { return a.semaforo === "amarillo"; });
  var verdes = analistas.filter(function(a) { return a.semaforo === "verde"; });
  var grises = analistas.filter(function(a) { return a.semaforo === "gris"; });
  var atencion = rojos.concat(amarillos).sort(function(a, b) {
    if (a.semaforo !== b.semaforo) return a.semaforo === "rojo" ? -1 : 1;
    return a.gestionadas - b.gestionadas;
  });
  var totalGestionado = analistas.reduce(function(s, a) { return s + a.gestionadas; }, 0);

  var html = '';

  // Resumen
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128101; Corte de Gestión — Detalle por Analista</h2>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [
    { l: "Requieren Atención", v: atencion.length, c: "#BD0F14", bg: "#fde8e8" },
    { l: "En Buen Ritmo", v: verdes.length, c: "#166534", bg: "#d1fae5" },
    { l: "Sin Histórico Suf.", v: grises.length, c: "#706F6F", bg: "#f8fafc" },
    { l: "Total Gestionado", v: totalGestionado, c: "#253150", bg: "#e8edf6" }
  ].forEach(function(ri) {
    html += '<td width="25%" style="text-align:center;padding:14px 6px;background:' + ri.bg + ';border-radius:10px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ri.l + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  // Media de producción por equipo
  var equipos = datos.equipos || [];
  if (equipos.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128202; Media de Producción por Equipo</h2>';
    var anchoEquipo = Math.floor(100 / equipos.length) + '%';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    equipos.forEach(function(e) {
      html += '<td width="' + anchoEquipo + '" style="text-align:center;padding:12px 8px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + _escHtml(e.equipo) + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:#253150;">' + e.media + '</div>';
      html += '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + e.totalGestionado + ' entre ' + e.analistas + ' analista(s)</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    html += '</td></tr>';
  }

  // Requieren atención — detalle completo por analista
  if (atencion.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px 8px;">';
    html += '<h2 style="margin:0 0 6px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128308; Requieren Atención (' + atencion.length + ')</h2>';
    html += '<p style="margin:8px 0 12px;font-size:12px;color:#706F6F;">Gestionadas hoy por debajo de lo esperado, ajustado por su tiempo realmente activo (no por horas de turno).</p>';
    html += '</td></tr>';
    atencion.forEach(function(a) {
      var esRojo = a.semaforo === "rojo";
      var col = esRojo ? "#BD0F14" : "#a16207";
      var bg = esRojo ? "#fde8e8" : "#fffbeb";
      html += '<tr><td style="background:#fff;padding:0 32px 16px;">';
      html += '<div style="border-left:5px solid ' + col + ';border-radius:0 10px 10px 0;background:' + bg + ';padding:16px 20px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="font-weight:800;font-size:15px;color:#253150;">' + _escHtml(a.nombre) + '</td>';
      html += '<td align="right"><span style="font-size:12px;font-weight:800;color:' + col + ';background:#fff;padding:4px 10px;border-radius:8px;">' + (esRojo ? "Atrás del ritmo" : "Por debajo del ritmo") + '</span></td>';
      html += '</tr></table>';

      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin-top:12px;"><tr>';
      [
        { l: "Gestionadas", v: a.gestionadas },
        { l: "Esperadas", v: a.esperado || "—", sub: a.pctCumplimiento !== null ? a.pctCumplimiento + "% cumpl." : null },
        { l: "Aprob/Neg/Aplaz", v: a.aprobadas + "/" + a.negadas + "/" + a.aplazadas },
        { l: "T. Gestión", v: _fmtMinEmail(a.tiempoGestionProm) }
      ].forEach(function(m) {
        html += '<td width="25%" style="text-align:center;padding:8px 4px;background:#fff;border-radius:8px;">';
        html += '<div style="font-size:10px;font-weight:700;color:#706F6F;">' + m.l + '</div>';
        html += '<div style="font-size:15px;font-weight:800;color:#253150;">' + m.v + '</div>';
        if (m.sub) html += '<div style="font-size:10px;font-weight:700;color:' + col + ';margin-top:2px;">' + m.sub + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';

      if (a.conectadoAntesDeHorario) {
        html += '<div style="margin-top:10px;font-size:12px;font-weight:700;color:#166534;background:#d1fae5;display:inline-block;padding:4px 10px;border-radius:8px;">&#127749; Conectó antes de horario (' + _escHtml(a.horaPrimeraConexion) + ')</div>';
      }

      html += '<div style="margin-top:10px;font-size:12px;color:#4a4a4a;">';
      html += '<strong style="color:#253150;">Estado actual:</strong> ' + _escHtml(a.estadoActual) + ' &nbsp;·&nbsp; ';
      html += '<strong style="color:#253150;">Tiempo activo:</strong> ' + _fmtMinEmail(a.minutosProductivos) + ' &nbsp;·&nbsp; ';
      html += '<strong style="color:' + (a.pausaExcedida ? "#BD0F14" : "#253150") + ';">Tiempo en pausas:</strong> <span style="color:' + (a.pausaExcedida ? "#BD0F14" : "#4a4a4a") + ';font-weight:' + (a.pausaExcedida ? "800" : "400") + ';">' + _fmtMinEmail(a.minutosNoProductivos) + (a.pausaExcedida ? " ⚠" : "") + '</span>';
      var pausaKeys = Object.keys(a.desglosePausas || {});
      if (pausaKeys.length > 0) {
        html += '<div style="margin-top:4px;color:#706F6F;">' + pausaKeys.map(function(k) { return _escHtml(k) + ": " + _fmtMinEmail(a.desglosePausas[k]); }).join(" · ") + '</div>';
      }
      html += '</div>';

      html += '<div style="margin-top:12px;">' + _renderSparklineHoras(a.detalleHoras) + '</div>';
      html += '</div></td></tr>';
    });
  }

  // En buen ritmo — tabla compacta
  if (verdes.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px 8px;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#166534;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#9989; En Buen Ritmo (' + verdes.length + ')</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    verdes.sort(function(a, b) { return b.gestionadas - a.gestionadas; }).forEach(function(a, idx) {
      html += '<tr><td style="padding:8px 12px;background:' + (idx % 2 === 0 ? "#f0fdf4" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="font-size:13px;font-weight:700;color:#253150;">' + (a.conectadoAntesDeHorario ? "&#127749; " : "") + _escHtml(a.nombre) + '</td>';
      html += '<td width="110" align="center" style="font-size:12px;color:#166534;font-weight:700;">' + a.gestionadas + '/' + a.esperado + ' (' + a.pctCumplimiento + '%)</td>';
      html += '<td width="130" align="right" style="font-size:12px;color:#706F6F;">' + _escHtml(a.estadoActual) + '</td>';
      html += '</tr></table></td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // Sin histórico suficiente — tabla compacta
  if (grises.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px 24px;">';
    html += '<h2 style="margin:0 0 6px;font-size:16px;font-weight:800;color:#706F6F;border-bottom:2px solid #f0f2f5;padding-bottom:10px;">&#8505; Sin Histórico Suficiente (' + grises.length + ')</h2>';
    html += '<p style="margin:8px 0 12px;font-size:12px;color:#706F6F;">Menos de 30 días de historial para calcular un ritmo esperado — se muestran solo sus gestionadas de hoy.</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    grises.sort(function(a, b) { return b.gestionadas - a.gestionadas; }).forEach(function(a, idx) {
      html += '<tr><td style="padding:8px 12px;background:' + (idx % 2 === 0 ? "#f8fafc" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="font-size:13px;font-weight:700;color:#253150;">' + (a.conectadoAntesDeHorario ? "&#127749; " : "") + _escHtml(a.nombre) + '</td>';
      html += '<td width="90" align="center" style="font-size:12px;color:#706F6F;">' + a.gestionadas + ' hoy</td>';
      html += '<td width="130" align="right" style="font-size:12px;color:#706F6F;">' + _escHtml(a.estadoActual) + '</td>';
      html += '</tr></table></td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  return html;
}

// ============================================================================
// EMAIL: ALERTAS CRÍTICAS
// ============================================================================

function _construirEmailAlertas(diagnostico) {
  var d = diagnostico;
  var hs = d.healthScore;
  var gradeColor = _gradeColor(hs.grade);
  var gradeBg = _gradeBg(hs.grade);

  var criticas = d.alerts.filter(function(a) { return a.severity === "critico"; });
  var advertencias = d.alerts.filter(function(a) { return a.severity === "advertencia"; });

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  // Header con banner rojo de urgencia
  html += '<tr><td style="background:#BD0F14;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<div style="font-size:28px;margin-bottom:8px;">&#9888;&#65039;</div>';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">ALERTA CRÍTICA</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">' + criticas.length + ' situación(es) que requiere(n) atención inmediata</p>';
  html += '</td></tr>';

  // Barra de salud operativa
  html += '<tr><td style="background:#fff;padding:20px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  html += '<td style="text-align:center;padding:12px;background:' + gradeBg + ';border-radius:10px;">';
  html += '<div style="font-size:12px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Salud Operativa</div>';
  html += '<span style="font-size:40px;font-weight:800;color:' + gradeColor + ';">' + hs.score + '</span>';
  html += '<span style="font-size:14px;color:#706F6F;">/100</span>';
  html += '<span style="font-size:16px;font-weight:700;color:' + gradeColor + ';background:#fff;padding:4px 14px;border-radius:8px;margin-left:10px;">' + hs.grade + '</span>';
  html += '</td></tr></table>';
  html += '</td></tr>';

  // Sección: Alertas Críticas — qué está pasando
  html += '<tr><td style="background:#fff;padding:24px 32px;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128308; Qué está pasando</h2>';
  criticas.forEach(function(al, idx) {
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>';
    html += '<td style="background:#fde8e8;border-left:5px solid #BD0F14;border-radius:0 10px 10px 0;padding:16px 20px;">';
    html += '<div style="font-weight:800;font-size:15px;color:#BD0F14;margin-bottom:6px;">' + (idx + 1) + '. ' + _escHtml(al.title) + '</div>';
    html += '<div style="font-size:14px;color:#4a4a4a;line-height:1.5;">' + _escHtml(al.description) + '</div>';
    if (al.affectedEntities && al.affectedEntities.length > 0) {
      html += '<div style="font-size:13px;color:#706F6F;margin-top:8px;"><strong>Personas afectadas:</strong> ' + _escHtml(al.affectedEntities.join(", ")) + '</div>';
    }
    html += '</td></tr></table>';
  });
  html += '</td></tr>';

  // Sección: Pasos a seguir
  var sugerencias = criticas.filter(function(a) { return a.suggestion; });
  if (sugerencias.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#166534;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#9989; Pasos a seguir</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    sugerencias.forEach(function(al, idx) {
      html += '<tr><td style="padding:12px 16px;background:' + (idx % 2 === 0 ? "#f0fdf4" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td width="32" valign="top" style="padding-right:12px;"><div style="width:28px;height:28px;background:#166534;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:800;">' + (idx + 1) + '</div></td>';
      html += '<td style="font-size:14px;color:#253150;line-height:1.5;">' + _escHtml(al.suggestion) + '</td>';
      html += '</tr></table>';
      html += '</td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // Sección: Advertencias (si las hay)
  if (advertencias.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#a16207;border-bottom:2px solid #fef9c3;padding-bottom:10px;">&#128992; Advertencias (' + advertencias.length + ')</h2>';
    advertencias.forEach(function(al) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
      html += '<td style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:14px 18px;">';
      html += '<div style="font-weight:700;font-size:14px;color:#92400e;margin-bottom:4px;">' + _escHtml(al.title) + '</div>';
      if (al.description) html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.4;">' + _escHtml(al.description) + '</div>';
      if (al.suggestion) html += '<div style="font-size:13px;color:#a16207;margin-top:8px;font-style:italic;">&#128161; ' + _escHtml(al.suggestion) + '</div>';
      html += '</td></tr></table>';
    });
    html += '</td></tr>';
  }

  // Sección: Hablar con estas personas
  var personas = d.seguimientoPersonas || [];
  if (personas.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128101; Seguimiento Individual (' + personas.length + ')</h2>';
    personas.forEach(function(p) {
      var bCol = p.severidad === "critico" ? "#BD0F14" : p.severidad === "advertencia" ? "#f59e0b" : "#253150";
      var bgCard = p.severidad === "critico" ? "#fef2f2" : p.severidad === "advertencia" ? "#fffbeb" : "#f8fafc";
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>';
      html += '<td style="border-left:5px solid ' + bCol + ';border-radius:0 10px 10px 0;padding:18px 20px;background:' + bgCard + ';">';
      html += '<div style="font-weight:800;font-size:16px;color:#253150;margin-bottom:10px;">' + _escHtml(p.nombre) + '</div>';
      // Métricas en tabla
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;"><tr>';
      p.datos.slice(0, 4).forEach(function(dat) {
        html += '<td width="25%" style="padding:8px 6px;text-align:center;background:#fff;border:2px solid ' + bgCard + ';border-radius:8px;">';
        html += '<div style="font-size:11px;color:#706F6F;font-weight:700;text-transform:uppercase;margin-bottom:4px;">' + _escHtml(dat.label) + '</div>';
        html += '<div style="font-size:16px;font-weight:800;color:#253150;">' + _escHtml(dat.valor) + '</div>';
        if (dat.meta) html += '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">Meta: ' + _escHtml(dat.meta) + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';
      // Puntos de conversación
      html += '<div style="background:#fff;border-radius:8px;padding:12px 14px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;margin-bottom:6px;">Punto de conversación</div>';
      var lineas = p.puntoConversacion.split("\n");
      lineas.forEach(function(l) {
        if (l.trim()) html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.6;margin-bottom:4px;">&#8226; ' + _escHtml(l) + '</div>';
      });
      html += '</div>';
      html += '</td></tr></table>';
    });
    html += '</td></tr>';
  }

  // Footer
  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + d.timestamp + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================================
// EMAIL: RESUMEN DIARIO / FOTO DEL MOMENTO
// ============================================================================

function _construirEmailResumenDiario(diagnostico, datosBio, datosCola, titulo, datosRadicado, datosCorteGestion, datosCierre) {
  var d = diagnostico;
  titulo = titulo || "Cierre del Día";
  var hs = d.healthScore;
  var k = d.kpis;
  var config = agente_obtenerConfig();
  var gradeColor = _gradeColor(hs.grade);
  var gradeBg = _gradeBg(hs.grade);

  var criticas = d.alerts.filter(function(a) { return a.severity === "critico"; });
  var advertencias = d.alerts.filter(function(a) { return a.severity === "advertencia"; });
  var infos = d.alerts.filter(function(a) { return a.severity === "info"; });

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  // Header
  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">' + _escHtml(titulo) + '</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">' + d.timestamp + '</p>';
  html += '</td></tr>';

  // SECCIÓN 1: Salud Operativa
  html += '<tr><td style="background:#fff;padding:28px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  html += '<td style="text-align:center;padding:20px;background:' + gradeBg + ';border-radius:12px;">';
  html += '<div style="font-size:12px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Salud Operativa</div>';
  html += '<span style="font-size:48px;font-weight:800;color:' + gradeColor + ';">' + hs.score + '</span>';
  html += '<span style="font-size:16px;color:#706F6F;">/100</span>';
  html += '<span style="font-size:18px;font-weight:700;color:' + gradeColor + ';background:#fff;padding:4px 16px;border-radius:8px;margin-left:12px;">' + hs.grade + '</span>';
  html += '</td></tr></table>';

  if (hs.components) {
    var compNames = { slaCumplimiento: "SLA", productividad: "Productividad", tiempoGestion: "T. Gestión", backlogSalud: "Backlog", inactividad: "Actividad Equipo" };
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>';
    Object.keys(hs.components).forEach(function(ck) {
      var c = hs.components[ck];
      var col = c.value >= 80 ? "#166534" : c.value >= 60 ? "#a16207" : "#BD0F14";
      var bg = c.value >= 80 ? "#d1fae5" : c.value >= 60 ? "#fef9c3" : "#fde8e8";
      html += '<td style="text-align:center;padding:8px 4px;">';
      html += '<div style="font-size:11px;color:#706F6F;font-weight:700;margin-bottom:4px;">' + (compNames[ck] || ck) + '</div>';
      html += '<div style="font-size:16px;font-weight:800;color:' + col + ';background:' + bg + ';padding:6px 4px;border-radius:8px;">' + c.value + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
  }
  html += '</td></tr>';

  // SECCIÓN 1.5: Radicado del Día
  if (datosRadicado) {
    var pctAGN = datosRadicado.totalRadicadas > 0 ? Math.round((datosRadicado.aGestionNormal || 0) / datosRadicado.totalRadicadas * 1000) / 10 : 0;
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128229; Radicado del Día</h2>';
    html += '<p style="margin:0 0 16px;font-size:12px;color:#706F6F;border-bottom:2px solid #e8edf6;padding-bottom:10px;">Lo que ingresó hoy al sistema — cohorte distinto de "Gestionado" de abajo, no tienen por qué coincidir.</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
    html += '<td style="text-align:center;padding:18px;background:#e8edf6;border-radius:12px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Radicadas</div>';
    html += '<span style="font-size:36px;font-weight:800;color:#253150;">' + (datosRadicado.totalRadicadas || 0) + '</span>';
    html += '<div style="font-size:11px;color:#706F6F;margin-top:4px;">Ingresaron al sistema hoy</div>';
    html += '</td></tr></table>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#3a4d7a;margin-bottom:4px;">A Gestión Normal</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#3a4d7a;">' + (datosRadicado.aGestionNormal || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + pctAGN + '% del total radicado</div>';
    html += '</td>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#fde8e8;border-radius:10px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#BD0F14;margin-bottom:4px;">Negación Directa</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + (datosRadicado.negacionDirecta || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + (datosRadicado.pctNegacionDirecta || 0) + '% del total radicado</div>';
    html += '</td>';
    html += '</tr></table>';
    html += '</td></tr>';
  }

  // SECCIÓN 2: Métricas Principales
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128202; Métricas del Día</h2>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:4px;">';

  var kpiItems = [
    { label: "Solicitudes Gestionadas", value: k.totalGestionadas, meta: k.esperadoHoyEquipo, metaLabel: "Esperadas a esta hora", icon: "&#128196;" },
    { label: "Tiempo de Gestión", value: _fmtMinEmail(k.tiempoGestionProm), meta: _fmtMinEmail(config.metas.maxTiempoGestionMin), icon: "&#9201;" },
    { label: "Tiempo General", value: _fmtHorasEmail(k.tiempoGeneralProm), meta: _fmtHorasEmail(config.metas.maxTiempoGeneralHoras), icon: "&#128337;" },
    { label: "Tasa de Aprobación", value: k.tasaAprobacion + "%", meta: null, icon: "&#9989;" },
    { label: "Backlog Pendiente", value: k.backlog, meta: config.metas.maxBacklog, icon: "&#128203;" }
  ];

  html += '<tr>';
  kpiItems.slice(0, 3).forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:14px 8px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:12px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ki.icon + ' ' + ki.label + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:#253150;">' + ki.value + '</div>';
    if (ki.meta !== null) html += '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">' + (ki.metaLabel || "Meta") + ': ' + ki.meta + '</div>';
    html += '</td>';
  });
  html += '</tr>';
  html += '<tr>';
  html += '<td width="33%"></td>';
  kpiItems.slice(3, 5).forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:14px 8px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:12px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ki.icon + ' ' + ki.label + '</div>';
    html += '<div style="font-size:24px;font-weight:800;color:#253150;">' + ki.value + '</div>';
    if (ki.meta !== null) html += '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">' + (ki.metaLabel || "Meta") + ': ' + ki.meta + '</div>';
    html += '</td>';
  });
  html += '</tr>';
  html += '</table>';
  html += '</td></tr>';

  // SECCIÓN 2.5: Cola de Asignación + Producción + SLA
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';

  if (datosCola && datosCola.total > 0) {
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128229; Cola de Asignación — ' + datosCola.total + ' sin asignar</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>';
    [{ l: "Desplazamiento", v: datosCola.desplazamiento }, { l: "Inducción", v: datosCola.induccion }, { l: "Digital", v: datosCola.digital }].forEach(function(ci) {
      html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#fde8e8;border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '</tr><tr>';
    [{ l: "Bio. Fallida", v: datosCola.biometriaFallida }, { l: "Nueva UAR", v: datosCola.nuevaUar }, { l: "Deudor UAR", v: datosCola.deudorUar }].forEach(function(ci) {
      html += '<td width="33%" style="text-align:center;padding:8px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    if (datosCola.reestudio > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr>';
      html += '<td style="text-align:center;padding:10px;background:#ecfdf5;border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#059669;">Reestudios</div>';
      html += '<div style="font-size:22px;font-weight:800;color:#059669;">' + datosCola.reestudio + '</div>';
      html += '</td></tr></table>';
    }
    html += '<div style="height:20px;"></div>';
  }

  if (k.backlog > 0) {
    html += '<h2 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#253150;">&#8987; Asignado en Proceso — ' + k.backlog + ' sin cerrar</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    [{ l: "Dentro de SLA", v: k.backlogVerde || 0, c: "#059669", b: "#ecfdf5" }, { l: "Por vencer", v: k.backlogAmarillo || 0, c: "#d97706", b: "#fffbeb" }, { l: "Fuera de SLA", v: k.backlogRojo || 0, c: "#BD0F14", b: "#fde8e8" }].forEach(function(bi) {
      html += '<td width="33%" style="text-align:center;padding:10px 6px;background:' + bi.b + ';border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:' + bi.c + ';">' + bi.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + bi.c + ';">' + bi.v + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    html += '<div style="height:20px;"></div>';
  }

  if (k.prodPorTipo && Object.keys(k.prodPorTipo).length > 0) {
    html += '<h2 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#253150;">&#128200; Producción por Tipo</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>';
    var tipoKeys = Object.keys(k.prodPorTipo).sort(function(a, b) { return k.prodPorTipo[b] - k.prodPorTipo[a]; });
    var tipoColores = { Digital: "#253150", UAR: "#BD0F14", Reestudio: "#706F6F", "Biometría": "#3a4d7a", "Inducción": "#8b0a0e" };
    tipoKeys.forEach(function(t) {
      html += '<td style="text-align:center;padding:10px 4px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + _escHtml(t) + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + (tipoColores[t] || "#253150") + ';">' + k.prodPorTipo[t] + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    html += '<div style="height:16px;"></div>';
  }

  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:#ecfdf5;border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#059669;">Aprobados</div>';
  html += '<div style="font-size:22px;font-weight:800;color:#059669;">' + (k.aprobadas || 0) + '</div></td>';
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:#fde8e8;border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#BD0F14;">Rechazados</div>';
  html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + (k.negadas || 0) + '</div></td>';
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:#fffbeb;border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#d97706;">Aplazados</div>';
  html += '<div style="font-size:22px;font-weight:800;color:#d97706;">' + (k.aplazadas || 0) + '</div></td>';
  var slaColor = k.slaPct >= 90 ? "#059669" : k.slaPct >= 70 ? "#d97706" : "#BD0F14";
  var slaBg = k.slaPct >= 90 ? "#ecfdf5" : k.slaPct >= 70 ? "#fffbeb" : "#fde8e8";
  html += '<td width="25%" style="text-align:center;padding:12px 6px;background:' + slaBg + ';border-radius:10px;">';
  html += '<div style="font-size:11px;font-weight:700;color:' + slaColor + ';">SLA</div>';
  html += '<div style="font-size:22px;font-weight:800;color:' + slaColor + ';">' + k.slaPct + '%</div></td>';
  html += '</tr></table>';

  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>';
  html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">T. Cola</div>';
  html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + _fmtMinEmail(k.tiempoColaProm || 0) + '</div></td>';
  html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">T. Gestión</div>';
  html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + _fmtMinEmail(k.tiempoGestionProm) + '</div></td>';
  html += '<td width="33%" style="text-align:center;padding:10px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">T. General</div>';
  html += '<div style="font-size:18px;font-weight:800;color:#253150;">' + _fmtHorasEmail(k.tiempoGeneralProm) + '</div></td>';
  html += '</tr></table>';

  html += '</td></tr>';

  // SECCIÓN 3: Estado de Alertas
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#128276; Estado de Alertas</h2>';

  if (d.alerts.length === 0) {
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
    html += '<td style="background:#d1fae5;border-radius:10px;padding:16px 20px;text-align:center;">';
    html += '<div style="font-size:15px;font-weight:700;color:#166534;">&#9989; Sin alertas — Operación saludable</div>';
    html += '</td></tr></table>';
  } else {
    if (criticas.length > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
      html += '<td style="background:#fde8e8;border-left:5px solid #BD0F14;border-radius:0 10px 10px 0;padding:14px 18px;">';
      html += '<div style="font-weight:800;font-size:14px;color:#BD0F14;margin-bottom:6px;">&#128308; ' + criticas.length + ' Alerta(s) Crítica(s)</div>';
      criticas.forEach(function(a) { html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.5;margin-bottom:4px;">&#8226; <strong>' + _escHtml(a.title) + '</strong></div>'; });
      html += '</td></tr></table>';
    }
    if (advertencias.length > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
      html += '<td style="background:#fffbeb;border-left:5px solid #f59e0b;border-radius:0 10px 10px 0;padding:14px 18px;">';
      html += '<div style="font-weight:800;font-size:14px;color:#a16207;margin-bottom:6px;">&#128992; ' + advertencias.length + ' Advertencia(s)</div>';
      advertencias.forEach(function(a) { html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.5;margin-bottom:4px;">&#8226; ' + _escHtml(a.title) + '</div>'; });
      html += '</td></tr></table>';
    }
    if (infos.length > 0) {
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td style="background:#e8edf6;border-left:5px solid #253150;border-radius:0 10px 10px 0;padding:14px 18px;">';
      html += '<div style="font-weight:800;font-size:14px;color:#253150;margin-bottom:6px;">&#128309; ' + infos.length + ' Informativa(s)</div>';
      infos.forEach(function(a) { html += '<div style="font-size:13px;color:#4a4a4a;line-height:1.5;margin-bottom:4px;">&#8226; ' + _escHtml(a.title) + '</div>'; });
      html += '</td></tr></table>';
    }
  }
  html += '</td></tr>';

  // SECCIÓN 3.5: Corte de Gestión
  if (datosCorteGestion && datosCorteGestion.analistas && datosCorteGestion.analistas.length > 0) {
    html += _htmlSeccionCorteGestion(datosCorteGestion);
  }

  // SECCIÓN 4: Top Analistas
  if (d.rankAnalistas && d.rankAnalistas.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#127942; Desempeño del Equipo (' + d.rankAnalistas.length + ' analistas)</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    html += '<tr style="background:#253150;"><th style="padding:8px 10px;text-align:left;font-size:11px;color:#fff;font-weight:700;border-radius:8px 0 0 0;">Analista</th><th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Total</th><th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Aprob.</th><th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Neg.</th><th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">Aplaz.</th><th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;">T.Gestión</th><th style="padding:8px 6px;text-align:center;font-size:11px;color:#fff;font-weight:700;border-radius:0 8px 0 0;">F.SLA</th></tr>';
    d.rankAnalistas.forEach(function(a, idx) {
      var rowBg = idx % 2 === 0 ? "#f8fafc" : "#fff";
      var medal = idx === 0 ? "&#129351; " : idx === 1 ? "&#129352; " : idx === 2 ? "&#129353; " : "";
      html += '<tr>';
      html += '<td style="padding:7px 10px;font-weight:600;font-size:12px;color:#253150;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + medal + _escHtml(a.nombre) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:13px;font-weight:800;color:#253150;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + a.total + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;color:#059669;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.aprobadas || 0) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;color:#BD0F14;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.negadas || 0) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;color:#d97706;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.aplazadas || 0) + '</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;font-weight:600;color:#706F6F;background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.tGestionProm || 0) + 'm</td>';
      html += '<td style="text-align:center;padding:7px 4px;font-size:12px;font-weight:700;color:' + ((a.fueraSLA || 0) > 0 ? '#BD0F14' : '#059669') + ';background:' + rowBg + ';border-bottom:1px solid #e5e7eb;">' + (a.fueraSLA || 0) + '</td>';
      html += '</tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // SECCIÓN 5: Pasos a Seguir
  var sugerencias = d.alerts.filter(function(a) { return a.suggestion; }).map(function(a) { return a.suggestion; });
  if (sugerencias.length > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#166534;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#127919; Pasos a Seguir</h2>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    sugerencias.slice(0, 5).forEach(function(s, i) {
      html += '<tr><td style="padding:12px 14px;background:' + (i % 2 === 0 ? "#f0fdf4" : "#fff") + ';border-radius:8px;">';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
      html += '<td width="36" valign="top" style="padding-right:12px;"><div style="width:30px;height:30px;background:#166534;color:#fff;border-radius:50%;text-align:center;line-height:30px;font-size:14px;font-weight:800;">' + (i + 1) + '</div></td>';
      html += '<td style="font-size:14px;color:#253150;line-height:1.5;">' + _escHtml(s) + '</td>';
      html += '</tr></table></td></tr>';
    });
    html += '</table>';
    html += '</td></tr>';
  }

  // SECCIÓN 6: Reporte de Biometría
  if (datosBio && datosBio.totalConsultadas > 0) {
    var bio = datosBio;
    var ges = bio.gestion || {};
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #d1fae5;padding-bottom:10px;">&#129302; Reporte Biometría del Día</h2>';
    html += '<div style="font-size:13px;font-weight:700;color:#059669;margin-bottom:2px;">Ciclo de Broadcast (WhatsApp)</div>';
    html += '<div style="font-size:11px;color:#706F6F;margin-bottom:10px;">Cola y Esperando Próximo Corte son en vivo (no dependen del día). El resto es actividad real de hoy — Tasa Conversión = Resueltas por WA ÷ WA Enviados, sin pasar por analista.</div>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    var bioKpis = [
      { label: "Cola de Asignación (en vivo)", value: bio.colaActual, color: "#d97706", bg: "#fffbeb" },
      { label: "Esperando Próximo Corte (en vivo)", value: bio.esperandoCorte, color: "#253150", bg: "#f8fafc" },
      { label: "WA Enviados Hoy", value: bio.totalEnviados, color: "#25D366", bg: "#ecfdf5" },
      { label: "Resueltas por WA Hoy", value: bio.enviadasYResueltas, color: "#059669", bg: "#ecfdf5" },
      { label: "Resueltas sin WA Hoy", value: bio.resueltasSinWA, color: "#253150", bg: "#f8fafc" },
      { label: "Tasa Conversión", value: bio.tasaConversion + "%", color: "#059669", bg: "#ecfdf5" }
    ];
    bioKpis.slice(0, 3).forEach(function(ki) {
      html += '<td width="33%" style="text-align:center;padding:12px 6px;background:' + ki.bg + ';border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.label + '</div>';
      html += '<div style="font-size:22px;font-weight:800;color:' + ki.color + ';">' + ki.value + '</div>';
      html += '</td>';
    });
    html += '</tr><tr>';
    bioKpis.slice(3, 6).forEach(function(ki) {
      html += '<td width="33%" style="text-align:center;padding:12px 6px;background:' + ki.bg + ';border-radius:10px;border:1px solid #e5e7eb;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.label + '</div>';
      html += '<div style="font-size:22px;font-weight:800;color:' + ki.color + ';">' + ki.value + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    html += _construirBarraDesgloseCola(bio);

    if (ges.total > 0) {
      html += '<div style="font-size:13px;font-weight:700;color:#253150;margin:18px 0 10px;border-top:1px solid #e5e7eb;padding-top:14px;">Gestión de Analistas (llamadas)</div>';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
      [{ l: "Gestionadas", v: ges.total, c: "#253150" }, { l: "OK Llamada", v: ges.okLlamada, c: "#059669" }, { l: "No Contestó", v: ges.noContesto, c: "#d97706" }, { l: "Tasa Contacto", v: ges.tasaContacto + "%", c: "#253150" }, { l: "¿Sirve la llamada?", v: (ges.tasaConversionLlamada || 0) + "%", c: "#059669" }].forEach(function(ki) {
        html += '<td width="20%" style="text-align:center;padding:10px 4px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
        html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
        html += '<div style="font-size:20px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:6px;"><tr>';
      [{ l: "Aprobados", v: ges.aprobadas, c: "#059669", b: "#ecfdf5" }, { l: "Rechazados", v: ges.negadas, c: "#BD0F14", b: "#fde8e8" }, { l: "Aplazados", v: ges.aplazadas, c: "#d97706", b: "#fffbeb" }].forEach(function(ri) {
        html += '<td width="33%" style="text-align:center;padding:10px 6px;background:' + ri.b + ';border-radius:10px;">';
        html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ri.l + '</div>';
        html += '<div style="font-size:20px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
        html += '</td>';
      });
      html += '</tr></table>';
      var motivoKeys = Object.keys(ges.motivos || {});
      if (motivoKeys.length > 0) {
        html += '<div style="font-size:12px;font-weight:700;color:#d97706;margin:12px 0 6px;">Motivos de aplazamiento:</div>';
        motivoKeys.forEach(function(m) { html += '<div style="font-size:12px;color:#4a4a4a;line-height:1.6;">&#8226; ' + _escHtml(m) + ': <strong>' + ges.motivos[m] + '</strong></div>'; });
      }
    }
    html += '</td></tr>';
  }

  // SECCIÓN 7: Estado en SAI al Cierre
  html += _construirSeccionEstadoCierreEmail(datosCierre);

  // Footer
  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + d.timestamp + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================================
// EMAIL: INICIO DE OPERACIÓN
// ============================================================================

function _construirEmailInicioOperacion(datosCola, datosRadicado, fecha) {
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">&#9728;&#65039; Inicio de Operación</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">¡Buenos días! Así arranca la operación hoy — ' + _escHtml(fecha) + '</p>';
  html += '</td></tr>';

  if (datosRadicado) {
    var pctAGN = datosRadicado.totalRadicadas > 0 ? Math.round((datosRadicado.aGestionNormal || 0) / datosRadicado.totalRadicadas * 1000) / 10 : 0;
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128229; Total Estudios Radicados</h2>';
    html += '<p style="margin:0 0 16px;font-size:12px;color:#706F6F;border-bottom:2px solid #e8edf6;padding-bottom:10px;">Lo que ha ingresado al sistema hoy hasta este momento.</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>';
    html += '<td style="text-align:center;padding:18px;background:#e8edf6;border-radius:12px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Total Radicadas</div>';
    html += '<span style="font-size:36px;font-weight:800;color:#253150;">' + (datosRadicado.totalRadicadas || 0) + '</span>';
    html += '</td></tr></table>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#3a4d7a;margin-bottom:4px;">A Gestión Normal</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#3a4d7a;">' + (datosRadicado.aGestionNormal || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + pctAGN + '% del total radicado</div>';
    html += '</td>';
    html += '<td width="50%" style="text-align:center;padding:12px 6px;background:#fde8e8;border-radius:10px;">';
    html += '<div style="font-size:11px;font-weight:700;color:#BD0F14;margin-bottom:4px;">Negación Directa</div>';
    html += '<div style="font-size:22px;font-weight:800;color:#BD0F14;">' + (datosRadicado.negacionDirecta || 0) + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + (datosRadicado.pctNegacionDirecta || 0) + '% del total radicado</div>';
    html += '</td>';
    html += '</tr></table>';
    html += '</td></tr>';
  }

  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  if (datosCola && datosCola.total > 0) {
    html += '<h2 style="margin:0 0 16px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128229; Cola Pendiente al Iniciar — ' + datosCola.total + ' sin asignar</h2>';
    var colaTipos = [
      { l: "Digital", v: datosCola.digital },
      { l: "Desplazamiento", v: datosCola.desplazamiento },
      { l: "Inducción", v: datosCola.induccion },
      { l: "Reestudio", v: datosCola.reestudio },
      { l: "UAR Nueva", v: datosCola.nuevaUar },
      { l: "UAR Deudor", v: datosCola.deudorUar },
      { l: "Biometría Fallida", v: datosCola.biometriaFallida }
    ];
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>';
    colaTipos.slice(0, 4).forEach(function(ci) {
      html += '<td width="25%" style="text-align:center;padding:10px 4px;background:#fde8e8;border-radius:10px;">';
      html += '<div style="font-size:10px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:#BD0F14;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '</tr><tr>';
    colaTipos.slice(4, 7).forEach(function(ci) {
      html += '<td width="25%" style="text-align:center;padding:10px 4px 0;background:#fde8e8;border-radius:10px;">';
      html += '<div style="font-size:10px;font-weight:700;color:#706F6F;">' + ci.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:#BD0F14;">' + ci.v + '</div>';
      html += '</td>';
    });
    html += '<td width="25%"></td>';
    html += '</tr></table>';
  } else {
    html += '<h2 style="margin:0 0 8px;font-size:16px;font-weight:800;color:#166534;">&#9989; Sin Cola Pendiente</h2>';
    html += '<p style="margin:0;font-size:13px;color:#706F6F;">No hay solicitudes heredadas sin asignar al iniciar la operación.</p>';
  }
  html += '</td></tr>';

  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + _escHtml(fecha) + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================================
// EMAIL: CHEQUEO DE CONEXIÓN
// ============================================================================

function _construirEmailChequeoConexion(listaActivos, porEstado, fecha, horaChequeo, offsetMin) {
  var totalNoActivos = Object.keys(porEstado).reduce(function(acc, k) { return acc + porEstado[k].length; }, 0);
  var sinAsignacion = listaActivos.filter(function(a) { return !a.primeraAsignacion; }).length;

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  var offsetLabel = _fmtMinEmail(offsetMin || 30) + ' después del inicio';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;letter-spacing:0.5px;">&#128075; Chequeo de Conexión</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">Un vistazo rápido a quién ya está conectado — ' + _escHtml(offsetLabel) + ' · ' + _escHtml(fecha) + ' ' + _escHtml(horaChequeo) + '</p>';
  html += '</td></tr>';

  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [{ l: "Analistas Activos", v: listaActivos.length, c: "#166534", bg: "#d1fae5" }, { l: "Analistas No Activos", v: totalNoActivos, c: "#BD0F14", bg: "#fde8e8" }, { l: "Activos Sin Asignación", v: sinAsignacion, c: "#a16207", bg: "#fef9c3" }].forEach(function(ri) {
    html += '<td width="33%" style="text-align:center;padding:14px 8px;background:' + ri.bg + ';border-radius:10px;">';
    html += '<div style="font-size:12px;font-weight:700;color:#706F6F;margin-bottom:6px;">' + ri.l + '</div>';
    html += '<div style="font-size:26px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  html += '<tr><td style="background:#fff;padding:24px 32px 24px;">';
  html += '<h2 style="margin:0 0 6px;font-size:16px;font-weight:800;color:#253150;border-bottom:2px solid #e8edf6;padding-bottom:10px;">&#9989; Analistas Activos (' + listaActivos.length + ')</h2>';
  html += '<p style="margin:8px 0 12px;font-size:12px;color:#706F6F;">Hora de la primera solicitud asignada, de su primer resultado cerrado hoy, y cuántas lleva gestionadas hasta este momento (Historico_Gestiones + Reestudios).</p>';
  if (listaActivos.length > 0) {
    var ordenados = listaActivos.slice().sort(function(a, b) {
      if (!a.primeraAsignacion && b.primeraAsignacion) return -1;
      if (a.primeraAsignacion && !b.primeraAsignacion) return 1;
      if (!a.primerResultado && b.primerResultado) return -1;
      if (a.primerResultado && !b.primerResultado) return 1;
      return String(a.primeraAsignacion || "").localeCompare(String(b.primeraAsignacion || ""));
    });
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
    html += '<tr><td style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">Analista</td><td width="110" style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">1ª Asignación</td><td width="110" style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">1er Resultado</td><td width="90" align="center" style="padding:6px 12px;font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;">Gestionadas</td></tr>';
    ordenados.forEach(function(a, idx) {
      var sinConexion = !a.primeraAsignacion && !a.primerResultado;
      var inconsistente = !a.primeraAsignacion && !!a.primerResultado;
      var sinResultadoAun = !!a.primeraAsignacion && !a.primerResultado;
      var bg = sinConexion ? "#fde8e8" : sinResultadoAun ? "#fffbeb" : inconsistente ? "#f8fafc" : (idx % 2 === 0 ? "#f0fdf4" : "#fff");
      var colAsig = sinConexion ? "#BD0F14" : inconsistente ? "#94a3b8" : "#253150";
      var txtAsig = a.primeraAsignacion ? _escHtml(a.primeraAsignacion) : (sinConexion ? "Sin conexión" : "N/D");
      var colRes = a.primerResultado ? "#166534" : (sinConexion ? "#BD0F14" : "#a16207");
      var txtRes = a.primerResultado ? _escHtml(a.primerResultado) : (sinConexion ? "—" : "Sin resultado");
      html += '<tr><td style="padding:8px 12px;background:' + bg + ';border-radius:8px 0 0 8px;font-size:13px;font-weight:700;color:#253150;">' + _escHtml(a.nombre) + '</td>';
      html += '<td style="padding:8px 12px;background:' + bg + ';font-size:13px;font-weight:800;color:' + colAsig + ';">' + txtAsig + '</td>';
      html += '<td style="padding:8px 12px;background:' + bg + ';font-size:13px;font-weight:800;color:' + colRes + ';">' + txtRes + '</td>';
      html += '<td style="padding:8px 12px;background:' + bg + ';border-radius:0 8px 8px 0;font-size:13px;font-weight:800;color:#253150;text-align:center;">' + a.gestionadas + '</td></tr>';
    });
    html += '</table>';
  } else {
    html += '<p style="margin:0;font-size:13px;color:#706F6F;">No hay analistas con Estado ACTIVO en la hoja Usuarios.</p>';
  }
  html += '</td></tr>';

  var estadosKeys = Object.keys(porEstado).sort(function(a, b) { return porEstado[b].length - porEstado[a].length; });
  if (estadosKeys.length > 0) {
    html += '<tr><td style="background:#fff;padding:0 32px 24px;">';
    html += '<h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#BD0F14;border-bottom:2px solid #fde8e8;padding-bottom:10px;">&#128308; Analistas No Activos (' + totalNoActivos + ')</h2>';
    estadosKeys.forEach(function(estado) {
      var nombres = porEstado[estado].slice().sort(function(a, b) { return a.localeCompare(b); });
      html += '<div style="margin-bottom:16px;">';
      html += '<div style="font-weight:800;font-size:13px;color:#BD0F14;margin-bottom:8px;">&#9679; ' + _escHtml(estado) + ' (' + nombres.length + ')</div>';
      html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">';
      for (var i = 0; i < nombres.length; i += 2) {
        html += '<tr>';
        for (var j = i; j < i + 2; j++) {
          html += '<td width="50%" style="padding:3px 4px 3px 0;">';
          if (j < nombres.length) {
            html += '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:12px;color:#253150;font-weight:600;">' + _escHtml(nombres[j]) + '</div>';
          }
          html += '</td>';
        }
        html += '</tr>';
      }
      html += '</table>';
      html += '</div>';
    });
    html += '</td></tr>';
  }

  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + _escHtml(fecha) + ' ' + _escHtml(horaChequeo) + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================================
// EMAIL: REPORTE BIOMETRÍA
// ============================================================================

/**
 * Sección "En Vivo" del email de biometría — mismos 2 indicadores que el tablero
 * (Cola de Asignación / Esperando Próximo Corte), que no dependen del día del reporte.
 * @private
 */
function _construirSeccionEnVivoEmail(bio) {
  var html = '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128225; En Vivo</h2>';
  html += '<p style="margin:0 0 14px;font-size:12px;color:#706F6F;">El estado del proceso ahora mismo, al momento de enviar este correo</p>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [
    { l: "Cola de Asignación", v: bio.colaActual || 0, s: "Esperando que un analista las tome", bg: "#BD0F14" },
    { l: "Esperando Próximo Corte", v: bio.esperandoCorte || 0, s: "Ya tienen WhatsApp enviado, esperan el corte de 8am/12pm", bg: "#253150" }
  ].forEach(function(k) {
    html += '<td width="50%" style="padding:18px 16px;background:' + k.bg + ';border-radius:12px;color:#fff;">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;opacity:0.9;">' + k.l + '</div>';
    html += '<div style="font-size:34px;font-weight:800;line-height:1.1;margin-top:4px;">' + k.v + '</div>';
    html += '<div style="font-size:10px;opacity:0.75;margin-top:4px;">' + k.s + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';
  return html;
}

/**
 * Sección "Top Inmobiliarias con Más Pendientes" del email — mismo ranking que el
 * tablero (en vivo, no depende del día del reporte).
 * @param {Array<{poliza:string,inmobiliaria:string,count:number}>} ranking
 * @private
 */
function _construirSeccionTopPolizasEmail(ranking) {
  if (!ranking || ranking.length === 0) return '';
  var html = '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#127970; Top Inmobiliarias con Más Pendientes</h2>';
  html += '<p style="margin:0 0 14px;font-size:12px;color:#706F6F;">Pólizas con mayor volumen de biometrías sin resolver, ahora mismo</p>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="4">';
  ranking.slice(0, 10).forEach(function(item, idx) {
    html += '<tr><td style="padding:8px 12px;background:#f8fafc;border-radius:8px;border-left:4px solid #d97706;">';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
    html += '<td width="22" style="font-size:12px;font-weight:800;color:#d97706;">' + (idx + 1) + '</td>';
    html += '<td style="font-size:12px;color:#253150;"><strong>' + _escHtml(item.inmobiliaria) + '</strong> <span style="color:#706F6F;">&middot; p&oacute;liza ' + _escHtml(item.poliza) + '</span></td>';
    html += '<td width="46" align="right" style="font-size:15px;font-weight:800;color:#d97706;">' + item.count + '</td>';
    html += '</tr></table></td></tr>';
  });
  html += '</table>';
  html += '</td></tr>';
  return html;
}

/**
 * Sección "Pendientes por Rango de Canon" del email — mismo desglose que el tablero,
 * cohorte de casos consultados a SAI el día del reporte (fecha_consulta_sai).
 * @param {{rangos:Array,sinDato:number,total:number}|null} datosCanon
 * @private
 */
function _construirSeccionCanonEmail(datosCanon) {
  if (!datosCanon || !datosCanon.rangos || datosCanon.total === 0) return '';
  var colores = { bajo: '#059669', medio: '#d97706', alto: '#BD0F14' };
  var html = '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128181; Pendientes por Rango de Canon</h2>';
  html += '<p style="margin:0 0 14px;font-size:12px;color:#706F6F;">De las biometrías de hoy, cu&aacute;ntas caen en cada rango de canon</p>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6">';
  datosCanon.rangos.forEach(function(r) {
    var color = colores[r.key] || '#253150';
    html += '<tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;border-left:4px solid ' + color + ';">';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
    html += '<td style="font-size:13px;font-weight:700;color:#253150;">' + _escHtml(r.label) + '</td>';
    html += '<td width="60" align="center" style="font-size:18px;font-weight:800;color:' + color + ';">' + r.count + '</td>';
    html += '<td width="50" align="right" style="font-size:12px;font-weight:700;color:#706F6F;">' + r.pct + '%</td>';
    html += '</tr></table></td></tr>';
  });
  html += '</table>';
  if (datosCanon.sinDato > 0) {
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:8px;">' + datosCanon.sinDato + ' caso(s) sin canon registrado, no incluido(s) arriba.</div>';
  }
  html += '</td></tr>';
  return html;
}

function _construirEmailReporteBiometria(bio, fecha, datosCierre, topPolizas, datosCanon) {
  var ges = bio.gestion || {};
  var convColor = bio.tasaConversion >= 60 ? "#166534" : bio.tasaConversion >= 40 ? "#a16207" : "#BD0F14";
  var convBg = bio.tasaConversion >= 60 ? "#d1fae5" : bio.tasaConversion >= 40 ? "#fef9c3" : "#fde8e8";

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<h1 style="margin:0;font-size:22px;font-weight:800;">&#129302; Reporte Biometría del Día</h1>';
  html += '<p style="margin:8px 0 0;font-size:14px;opacity:0.9;">' + fecha + '</p>';
  html += '</td></tr>';

  // Hero: 3 Tasas
  html += '<tr><td style="background:#fff;padding:28px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  var tasaResSinWA = bio.totalConsultadas > 0 ? Math.round((bio.resueltasSinWA / bio.totalConsultadas) * 1000) / 10 : 0;
  [
    { l: "Tasa Conversión WA", v: bio.tasaConversion + "%", c: convColor, b: convBg, s: "De los WA enviados, % que se resolvió solo con el mensaje" },
    { l: "Tasa Resolución sin WA", v: tasaResSinWA + "%", c: "#059669", b: "#ecfdf5", s: "De las capturadas, % que se resolvió sin necesitar mensaje" },
    { l: "Conversión Llamada", v: (ges.tasaConversionLlamada || 0) + "%", c: "#253150", b: "#f0f4ff", s: "De las llamadas exitosas, % que terminó aprobada" }
  ].forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:16px 8px;background:' + ki.b + ';border-radius:10px;">';
    html += '<div style="font-size:10px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">' + ki.l + '</div>';
    html += '<div style="font-size:32px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
    html += '<div style="font-size:10px;color:#706F6F;margin-top:4px;">' + ki.s + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '</td></tr>';

  // En Vivo: mismos 2 indicadores del tablero, ahora mismo (no dependen del día del reporte)
  html += _construirSeccionEnVivoEmail(bio);

  // Top Pólizas con más pendientes — mismo ranking que el tablero (en vivo)
  html += _construirSeccionTopPolizasEmail(topPolizas);

  // Pendientes por Rango de Canon — mismo desglose que el tablero, cohorte del día del reporte
  html += _construirSeccionCanonEmail(datosCanon);

  // Narrativa
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 12px;font-size:16px;font-weight:800;color:#253150;">&#128202; Así se movió la biometría hoy</h2>';
  html += '<p style="margin:0 0 20px;font-size:13px;color:#334155;line-height:1.7;">';
  html += 'Hoy el sistema consultó <strong>' + bio.totalConsultadas + ' solicitudes</strong> en SAI. ';
  html += 'De esas, <strong>' + bio.totalSinIniciar + ' están esperando</strong> que se cumplan las 4 horas para enviarles el WhatsApp. ';
  html += 'Ya <strong>enviamos ' + bio.totalEnviados + ' mensajes</strong> de WhatsApp a clientes pidiéndoles que completen la biometría.</p>';
  html += '<p style="margin:0 0 20px;font-size:13px;color:#334155;line-height:1.7;">';
  html += 'De las capturadas, <strong>' + bio.resueltasSinWA + ' se resolvieron solas</strong> sin necesitar el mensaje de WhatsApp. ';
  html += 'De las que sí recibieron WA, <strong>' + bio.enviadasYResueltas + ' se resolvieron tras el mensaje</strong> sin necesidad de escalar a un analista (tasa de conversión: ' + bio.tasaConversion + '%).</p>';
  html += '<p style="margin:0 0 20px;font-size:13px;color:#334155;line-height:1.7;">';
  html += 'De esos WhatsApp enviados, <strong>' + bio.esperandoCorte + ' están esperando</strong> el próximo corte (8am/12pm) para revisar si el cliente ya hizo la biometría o si toca escalarlo.</p>';
  html += '<p style="margin:0 0 20px;font-size:13px;color:#334155;line-height:1.7;">';
  html += 'De las que ya pasaron por el corte: <strong>' + bio.totalEscaladas + ' se enviaron a la cola</strong> de análisis. ';
  html += 'De esas, <strong>' + bio.totalAsignadas + ' las tomó un analista</strong>';
  if (bio.totalArchivadas > 0) html += ' y <strong>' + bio.totalArchivadas + ' se archivaron</strong> (más de 12h en cola sin ser asignadas)';
  if (bio.totalResueltasEnCola > 0) html += '. <strong>' + bio.totalResueltasEnCola + ' se resolvieron en cola</strong> sin necesitar analista';
  html += '.</p>';
  html += '<p style="margin:0;font-size:13px;color:#334155;line-height:1.7;">';
  html += 'Ahora mismo quedan <strong>' + bio.colaActual + ' en cola</strong> esperando analista.</p>';
  html += '</td></tr>';

  // Tarjetas resumen
  html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<div style="font-size:14px;font-weight:800;color:#253150;margin-bottom:12px;">Resumen en números</div>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
  [{ l: "Consultadas", v: bio.totalConsultadas, c: "#253150" }, { l: "Esperando 4h", v: bio.totalSinIniciar, c: "#706F6F" }, { l: "WA Enviados", v: bio.totalEnviados, c: "#25D366" }].forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:12px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
    html += '<div style="font-size:22px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>';
  [{ l: "Resueltas sin WA", v: bio.resueltasSinWA, c: "#059669" }, { l: "Resueltas por WA", v: bio.enviadasYResueltas, c: "#059669" }, { l: "Enviadas a Cola", v: bio.totalEscaladas, c: "#BD0F14" }].forEach(function(ki) {
    html += '<td width="33%" style="text-align:center;padding:12px 6px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">';
    html += '<div style="font-size:11px;font-weight:700;color:#706F6F;margin-bottom:4px;">' + ki.l + '</div>';
    html += '<div style="font-size:22px;font-weight:800;color:' + ki.c + ';">' + ki.v + '</div>';
    html += '</td>';
  });
  html += '</tr></table>';
  html += _construirBarraDesgloseCola(bio);
  html += '</td></tr>';

  // Gestión de Analistas
  if (ges.total > 0) {
    html += '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
    html += '<h2 style="margin:0 0 12px;font-size:16px;font-weight:800;color:#253150;">&#128222; Resultados de Gestión</h2>';
    html += '<p style="margin:0 0 16px;font-size:13px;color:#334155;line-height:1.7;">';
    html += 'Los analistas gestionaron <strong>' + ges.total + ' casos</strong>. ';
    html += 'Contactaron a <strong>' + ges.okLlamada + '</strong> (' + ges.tasaContacto + '% tasa de contacto). ';
    if (ges.noContesto > 0) html += '<strong>' + ges.noContesto + '</strong> no contestaron. ';
    if (ges.tasaConversionLlamada > 0) html += 'De las llamadas exitosas, <strong>' + ges.tasaConversionLlamada + '%</strong> terminaron aprobadas.';
    html += '</p>';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';
    [{ l: "Aprobados", v: ges.aprobadas, c: "#059669", b: "#ecfdf5" }, { l: "Rechazados", v: ges.negadas, c: "#BD0F14", b: "#fde8e8" }, { l: "Aplazados", v: ges.aplazadas, c: "#d97706", b: "#fffbeb" }].forEach(function(ri) {
      html += '<td width="33%" style="text-align:center;padding:10px 6px;background:' + ri.b + ';border-radius:10px;">';
      html += '<div style="font-size:11px;font-weight:700;color:#706F6F;">' + ri.l + '</div>';
      html += '<div style="font-size:20px;font-weight:800;color:' + ri.c + ';">' + ri.v + '</div>';
      html += '</td>';
    });
    html += '</tr></table>';
    var motivoKeys = Object.keys(ges.motivos || {});
    if (motivoKeys.length > 0) {
      html += '<div style="font-size:12px;font-weight:700;color:#d97706;margin:14px 0 6px;">Motivos de aplazamiento:</div>';
      motivoKeys.forEach(function(m) { html += '<div style="font-size:12px;color:#4a4a4a;line-height:1.6;">&#8226; ' + _escHtml(m) + ': <strong>' + ges.motivos[m] + '</strong></div>'; });
    }
    html += '</td></tr>';
  }

  // Estado en SAI al Cierre
  html += _construirSeccionEstadoCierreEmail(datosCierre);

  html += '<tr><td style="background:#253150;color:#fff;padding:20px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Agente Coordinador — Métricas Análisis</div>';
  html += '<div style="font-size:11px;opacity:0.6;margin-top:4px;">' + fecha + '</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================================
// SECCIÓN EMAIL: ESTADO EN SAI AL CIERRE
// ============================================================================

/**
 * Construye la sección HTML de "¿En qué estado quedaron en SAI?" para emails.
 * @param {Object|null} datosCierre - Resultado de obtenerResumenEstadoSAICierre()
 * @returns {string} HTML de la sección (filas de tabla)
 * @private
 */
function _construirSeccionEstadoCierreEmail(datosCierre) {
  if (!datosCierre || datosCierre.total === 0) return '';

  var total = datosCierre.total;
  var sinReconsulta = datosCierre.sinReconsulta || 0;
  var reconsultadas = total - sinReconsulta;
  var desglose = datosCierre.desglose || [];

  if (reconsultadas === 0) return '';

  var colores = {
    'APROBADO': '#059669',
    'APROBADO_PENDIENTE_BIOMETRIA': '#d97706',
    'PENDIENTE_BIOMETRIA': '#d97706',
    'EN_ESTUDIO': '#3b82f6',
    'RECHAZADO': '#BD0F14',
    'NEGADO': '#BD0F14',
    'NO_ENCONTRADA': '#9ca3af',
    'SIN_DATO': '#6b7280'
  };
  var defaultColor = '#8b5cf6';

  // Calcular cifras clave para la narrativa
  var aprobadas = 0, pendientes = 0, rechazadas = 0, enEstudio = 0;
  desglose.forEach(function(item) {
    if (item.estado === 'APROBADO') aprobadas = item.cantidad;
    else if (item.estado === 'APROBADO_PENDIENTE_BIOMETRIA' || item.estado === 'PENDIENTE_BIOMETRIA') pendientes += item.cantidad;
    else if (item.estado === 'RECHAZADO' || item.estado === 'NEGADO') rechazadas += item.cantidad;
    else if (item.estado === 'EN_ESTUDIO') enEstudio = item.cantidad;
  });
  var pctAprobadas = reconsultadas > 0 ? Math.round((aprobadas / reconsultadas) * 100) : 0;
  var pctPendientes = reconsultadas > 0 ? Math.round((pendientes / reconsultadas) * 100) : 0;

  var html = '<tr><td style="background:#fff;padding:24px 32px;border-bottom:2px solid #f0f2f5;">';
  html += '<h2 style="margin:0 0 4px;font-size:16px;font-weight:800;color:#253150;">&#128269; ¿En qué estado quedaron en SAI?</h2>';

  // Narrativa accionable
  html += '<p style="margin:8px 0 16px;font-size:13px;color:#334155;line-height:1.7;">';
  html += 'De las <strong>' + total + '</strong> consultadas, ';
  if (aprobadas > 0) html += '<strong style="color:#059669;">' + aprobadas + ' ya están aprobadas</strong> (' + pctAprobadas + '%)';
  if (aprobadas > 0 && pendientes > 0) html += ' y ';
  if (pendientes > 0) html += '<strong style="color:#d97706;">' + pendientes + ' siguen pendientes de biometría</strong> (' + pctPendientes + '%)';
  html += '.';
  if (rechazadas > 0) html += ' <strong style="color:#BD0F14;">' + rechazadas + '</strong> fueron rechazadas.';
  if (enEstudio > 0) html += ' <strong>' + enEstudio + '</strong> aún están en estudio.';
  if (sinReconsulta > 0) html += ' <span style="color:#706F6F;">' + sinReconsulta + ' no se han verificado aún (se verifican al cierre).</span>';
  html += '</p>';

  // Indicador de acción
  if (pendientes > 0 && pctPendientes >= 40) {
    html += '<div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;">';
    html += '<div style="font-size:12px;font-weight:800;color:#92400e;">&#128161; ' + pctPendientes + '% sigue pendiente de biometría — considerar reforzar el broadcast o seguimiento telefónico mañana.</div>';
    html += '</div>';
  } else if (pctAprobadas >= 70) {
    html += '<div style="background:#ecfdf5;border-left:4px solid #059669;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:16px;">';
    html += '<div style="font-size:12px;font-weight:800;color:#166534;">&#9989; Buen resultado — ' + pctAprobadas + '% de las consultadas ya se aprobaron.</div>';
    html += '</div>';
  }

  // Barra proporcional
  var totalBarra = desglose.reduce(function(s, d) { return s + d.cantidad; }, 0);
  if (totalBarra > 0) {
    html += '<div style="display:flex;height:24px;border-radius:8px;overflow:hidden;margin-bottom:12px;">';
    desglose.forEach(function(item) {
      var color = colores[item.estado] || defaultColor;
      var pct = Math.round((item.cantidad / totalBarra) * 100);
      if (pct > 0) {
        html += '<div style="flex:' + item.cantidad + ';background:' + color + ';display:flex;align-items:center;justify-content:center;">';
        if (pct >= 8) html += '<span style="font-size:10px;font-weight:800;color:#fff;">' + item.cantidad + '</span>';
        html += '</div>';
      }
    });
    html += '</div>';
  }

  // Tabla de desglose
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="4">';
  desglose.forEach(function(item) {
    var color = colores[item.estado] || defaultColor;
    var labelEstado = item.estado.replace(/_/g, ' ');
    html += '<tr>';
    html += '<td style="padding:8px 12px;background:#f8fafc;border-radius:8px;border-left:4px solid ' + color + ';">';
    html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
    html += '<td style="font-size:13px;font-weight:700;color:#253150;">' + _escHtml(labelEstado) + '</td>';
    html += '<td width="80" align="center" style="font-size:16px;font-weight:800;color:' + color + ';">' + item.cantidad + '</td>';
    html += '<td width="60" align="right" style="font-size:12px;font-weight:700;color:#706F6F;">' + item.pct + '%</td>';
    html += '</tr></table></td>';
    html += '</tr>';
  });
  html += '</table>';
  html += '</td></tr>';

  return html;
}

// ============================================================================
// BARRA DE DESGLOSE DE COLA (sub-componente usado en emails de biometría)
// ============================================================================

function _construirBarraDesgloseCola(bio) {
  var partes = [
    { label: "En Cola (Pendiente)", valor: bio.totalEnColaPendiente || 0, color: "#d97706" },
    { label: "Asignadas", valor: bio.totalAsignadas || 0, color: "#059669" },
    { label: "Resueltas en Cola", valor: bio.totalResueltasEnCola || 0, color: "#2563eb" },
    { label: "Archivadas", valor: bio.totalArchivadas || 0, color: "#BD0F14" }
  ];
  var total = partes.reduce(function(s, p) { return s + p.valor; }, 0);

  var html = '<div style="font-size:13px;font-weight:800;color:#253150;margin:20px 0 10px;">';
  html += '&#8618; &iquest;En qu&eacute; van las <span style="color:#BD0F14;">' + total + '</span> enviadas a cola?</div>';

  if (total === 0) {
    html += '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:10px 0;">Sin solicitudes enviadas a cola en este per&iacute;odo</div>';
    return html;
  }

  var visibles = partes.filter(function(p) { return p.valor > 0; });
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;"><tr>';
  visibles.forEach(function(p, i) {
    var pct = Math.round(p.valor / total * 1000) / 10;
    var conValor = pct >= 8;
    html += '<td width="' + pct + '%" style="background:' + p.color + ';height:26px;font-size:11px;font-weight:800;color:#fff;text-align:center;vertical-align:middle;">' + (conValor ? p.valor : '&nbsp;') + '</td>';
    if (i < visibles.length - 1) html += '<td width="2" style="background:#f0f2f5;">&nbsp;</td>';
  });
  html += '</tr></table>';

  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin-top:10px;"><tr>';
  partes.forEach(function(p) {
    html += '<td style="text-align:left;font-size:11px;color:#4a4a4a;white-space:nowrap;">';
    html += '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + p.color + ';margin-right:5px;"></span>';
    html += p.label + ' <strong style="color:#253150;">' + p.valor + '</strong>';
    html += '</td>';
  });
  html += '</tr></table>';

  return html;
}

// ============================================================================
// EMAIL: INFORME INDIVIDUAL SEMANAL
// ============================================================================

function _construirEmailInformeIndividual(m, rango) {
  var primerNombre = String(m.nombre || "").trim().split(/\s+/)[0] || "";
  primerNombre = primerNombre.charAt(0) + primerNombre.slice(1).toLowerCase();

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f0f2f5;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:24px 0;"><tr><td align="center">';
  html += '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif;">';

  html += '<tr><td style="background:#253150;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">';
  html += '<div style="font-size:13px;opacity:0.85;letter-spacing:0.5px;text-transform:uppercase;">Tu semana en números</div>';
  html += '<h1 style="margin:6px 0 0;font-size:22px;font-weight:800;">&#128075; Hola, ' + _escHtml(primerNombre) + '</h1>';
  html += '<p style="margin:8px 0 0;font-size:13px;opacity:0.9;">' + _escHtml(rango.fechaDesdeActual) + ' al ' + _escHtml(rango.fechaHastaActual) + '</p>';
  html += '</td></tr>';

  html += '<tr><td style="background:#fff;padding:28px 32px;">';
  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>';

  var mejoraVolumen = m.gestionadasPrev != null && m.gestionadasPrev > 0 && m.gestionadas >= m.gestionadasPrev;
  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:#f8fafc;border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#128193; Casos gestionados</div>';
  html += '<div style="font-size:30px;font-weight:800;color:#253150;">' + m.gestionadas + '</div>';
  if (mejoraVolumen) {
    var pctVol = Math.round((m.gestionadas - m.gestionadasPrev) / m.gestionadasPrev * 100);
    html += '<div style="font-size:11px;font-weight:700;color:#166534;margin-top:4px;">&#9650; ' + (pctVol > 0 ? pctVol + "% más" : "Igual") + ' que la semana pasada</div>';
  }
  html += '</td>';

  var mejoraTiempo = m.tiempoProm != null && m.tiempoPromPrev != null && m.tiempoProm <= m.tiempoPromPrev;
  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:#f8fafc;border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#9201; Tiempo promedio</div>';
  html += '<div style="font-size:30px;font-weight:800;color:#253150;">' + (m.tiempoProm != null ? _fmtMinEmail(m.tiempoProm) : "—") + '</div>';
  if (mejoraTiempo && m.tiempoProm < m.tiempoPromPrev) {
    html += '<div style="font-size:11px;font-weight:700;color:#166534;margin-top:4px;">&#9650; Más ágil que la semana pasada</div>';
  }
  html += '</td>';
  html += '</tr></table>';

  html += '<table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>';

  var mejoraSla = m.slaPct != null && m.slaPctPrev != null && m.slaPct >= m.slaPctPrev;
  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:#f0fdf4;border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#9989; Dentro de tiempo objetivo</div>';
  html += '<div style="font-size:30px;font-weight:800;color:#166534;">' + (m.slaPct != null ? m.slaPct + "%" : "—") + '</div>';
  if (mejoraSla && m.slaPct > m.slaPctPrev) {
    html += '<div style="font-size:11px;font-weight:700;color:#166534;margin-top:4px;">&#9650; Mejor que la semana pasada</div>';
  }
  html += '</td>';

  html += '<td width="50%" style="text-align:center;padding:16px 10px;background:' + (m.racha >= 2 ? '#fff7ed' : '#f8fafc') + ';border-radius:12px;">';
  html += '<div style="font-size:11px;font-weight:700;color:#706F6F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#128293; Constancia</div>';
  if (m.racha >= 2) {
    html += '<div style="font-size:30px;font-weight:800;color:#c2410c;">' + m.racha + '</div>';
    html += '<div style="font-size:11px;font-weight:700;color:#c2410c;margin-top:4px;">días seguidos gestionando</div>';
  } else {
    html += '<div style="font-size:16px;font-weight:700;color:#94a3b8;padding-top:6px;">Vas arrancando esta semana</div>';
  }
  html += '</td>';
  html += '</tr></table>';

  html += '<p style="font-size:13px;color:#4a4a4a;line-height:1.6;margin:24px 0 0;">Gracias por tu trabajo esta semana. Este es solo un vistazo rápido de tu propio avance — ¡sigue así! &#128170;</p>';
  html += '</td></tr>';

  html += '<tr><td style="background:#253150;color:#fff;padding:18px 32px;border-radius:0 0 12px 12px;text-align:center;">';
  html += '<div style="font-size:12px;opacity:0.9;">Equipo de Analítica — El Libertador</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}
