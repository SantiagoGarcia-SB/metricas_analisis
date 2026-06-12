# Changelog — main

## [No publicado]

### Corregido
- Se corrigió filtrado de fechas en tabla "Monitoreo y Log de Actividad" para usar comparación exacta (normalizada) en vez de `includes`, evitando falsos positivos por formatos de fecha inconsistentes (ej: "1/6/2026" vs "11/06/2026")
- Se corrigió el mismo problema en la función `admin_obtenerDetallePorAnalista` para el modal de detalle por analista
- Se corrigió comparación de horas (primer/último resultado) para normalizar a formato `HH:MM:SS` antes de comparar, evitando que horas sin cero inicial (ej: "9:06:20") se ordenen incorrectamente frente a horas de dos dígitos (ej: "14:18:40")
- Se aplicó normalización de horas en todas las funciones: `admin_obtenerAsesoresActivosPrimerResultado`, `obtenerRendimientoPorDia` y `obtenerDatosMetricas`
- Se agregaron funciones auxiliares `normalizarFechaDDMMYYYY`, `coincideFecha` y `normalizarHora` para garantizar comparaciones correctas

### Cambiado
- Se cambió la fuente de datos de "Pendientes" en tabla "Monitoreo y Log de Actividad": ahora se lee de hoja `solicitud` + hoja `ORIGEN` (reestudios) en vez de `Historico_Gestiones`, mostrando siempre el backlog real (solicitudes asignadas sin fecha de fin) independientemente de la fecha seleccionada
- Se cambió la visualización de Radicación y Asignación en el modal de historial del analista: ahora muestra fecha y hora completa (ej: "11/06/2026 08:30:45") en vez de solo la hora
- Se cambió la tabla "Monitoreo y Log de Actividad" para mostrar analistas en todos los estados (no solo ACTIVO), permitiendo ver también los que están en almuerzo, break, etc.
- Se corrigió error de DataTables "Incorrect column count" en tabla de Rendimiento Individual que ocurría cuando no había registros para la fecha (se intentaba inicializar DataTable sobre una fila con colspan)

### Agregado
- Se agregó sección "Tiempos por Solicitud" en la pestaña Tiempos con gráfica de barras agrupadas (T. Gestión y T. General) y tabla detalle
- Se agregó campo de búsqueda por número de solicitud y fecha para localizar solicitudes específicas en distintas fechas
- Se incluyó el ID de solicitud y analista en el payload `tiemposDetalle` del backend para habilitar la búsqueda
- Se agregó nueva columna "Prod. Real/Hora" en tabla Rendimiento Individual
- Se agregaron constantes globales `HORA_INICIO_OPERACION` ("08:00") y `HORA_FIN_TURNO` ("17:00")

### Cambiado
- Se renombró columna "Prom/Hora" a "Ritmo Efec./Hora" en tabla Rendimiento Individual (lógica sin cambios)
- Se ajustó lógica de "Prod. Real/Hora" para calcular con tiempo real transcurrido: si el día es hoy usa hora actual como corte, si es un día pasado usa HORA_FIN_TURNO (17:00). Fórmula: `solicitudes_dia / horasTranscurridas` promediado entre días con registros
- Se amplió el detalle de solicitudes por analista (modal) para mostrar columnas: Radicación, Asignación, Resultado, T. Gestión y T. General por cada solicitud gestionada
- Se amplió la tabla de pendientes por analista para incluir hora de radicación y asignación
- Se amplió el modal a 900px para acomodar las nuevas columnas
