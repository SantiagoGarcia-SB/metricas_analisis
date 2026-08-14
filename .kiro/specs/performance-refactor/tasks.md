# Implementation Plan: Performance Refactor

## Overview

Refactorización del monolítico Código.js (~5500 líneas) en 7 archivos modulares con capa de datos memoizada, CacheService con particionamiento, pipeline unificado de métricas, endpoint batch, y sincronización incremental de BigQuery. El orden de implementación respeta las dependencias del namespace global de Apps Script (carga alfabética por prefijo numérico).

## Tasks

- [x] 1. Crear 00_Config.js — Constantes y mapeo de columnas
  - [x] 1.1 Crear archivo 00_Config.js con todas las constantes globales y objetos de mapeo de columnas
    - Extraer de Código.js todas las constantes globales: TARGET_SOLICITUDES_SS_ID, SHEET_NAME_SOLICITUDES, ID_HOJA_REESTUDIOS, NOMBRE_PESTANA_REESTUDIOS, ID_HOJA_BIOMETRIA, TIMEZONE, HORA_INICIO_OPERACION, HORA_FIN_TURNO, BCC_REPORTES_AGENTE, NOMBRE_REMITENTE_AGENTE
    - Definir constantes de CacheService: CACHE_TTL_SEGUNDOS (300), CACHE_MAX_FRAGMENTO_KB (95), CACHE_MAX_FRAGMENTOS (20)
    - Definir los objetos de mapeo de columnas: COL_HISTORICO (completo con los ~30 campos), COL_SOLICITUD, COL_REESTUDIOS, COL_BIOMETRIA
    - Incluir cualquier otra constante o variable global de Código.js (mapas de score, URL configuración, etc.)
    - _Requirements: 11.2, 11.3, 13.1, 13.2, 13.3, 13.4_

- [x] 2. Crear 02_Utilidades.js — Parseo de fechas y helpers compartidos
  - [x] 2.1 Implementar la función unificada parsearFecha con soporte multi-formato
    - Soportar formatos: dd/MM/yyyy, dd-MM-yyyy, yyyy-MM-dd, YYYYMMDD (8 dígitos), dd/MM/yyyy HH:mm:ss
    - Retornar Date válido o null para entradas nulas/vacías/no reconocidas
    - Cuando separador es "-" y primer segmento tiene 4 dígitos → yyyy-MM-dd; sino → dd-MM-yyyy
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 2.2 Implementar normalizarFechaISO y helpers auxiliares
    - Convertir dd/MM/yyyy a yyyy-MM-dd para ordenamiento y comparación
    - Implementar clasificarEstado (APROBADO, RECHAZADO, APLAZADO, OTRO)
    - Implementar parsearTiempoMinutos (manejar coma y punto decimal)
    - Implementar fechaEnRango (evaluación inclusiva desde/hasta)
    - Implementar normalizarTipoAsignado
    - _Requirements: 7.3, 7.4, 4.4_

  - [ ]* 2.3 Escribir property test — Propiedad 2: Round trip de parseo de fechas
    - **Property 2: Parseo de fechas — Round trip por formato**
    - Generar fechas aleatorias (1900-2099) en cada uno de los 5 formatos soportados
    - Verificar que el Date resultante coincide en día, mes, año, hora, minuto, segundo
    - **Validates: Requirements 7.1, 7.2, 7.5**

  - [ ]* 2.4 Escribir property test — Propiedad 3: Normalización preserva identidad
    - **Property 3: Normalización de fecha — Conversión preserva identidad**
    - Generar fechas dd/MM/yyyy aleatorias
    - Verificar parsearFecha(normalizarFechaISO(x)) == parsearFecha(x) en día/mes/año
    - **Validates: Requirements 7.3**

- [x] 3. Crear 01_Datos.js — Capa de datos con memoización y CacheService
  - [x] 3.1 Implementar funciones de lectura memoizadas para cada hoja
    - Implementar obtenerHistoricoGestiones() con variable de módulo _historicoGestiones (lanza error si hoja no accesible)
    - Implementar obtenerHojaReestudios() con _hojaReestudios y _ssReestudios compartido (retorna [] en error, Logger.log)
    - Implementar obtenerHojaOrigen() reutilizando _ssReestudios ya abierto
    - Implementar obtenerHojaBiometria() con _hojaBiometria (retorna [] si <2 filas)
    - Implementar obtenerHojaSolicitud() con _hojaSolicitud
    - Manejar caso de hoja con solo encabezados (lastRow ≤ 1) retornando []
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Implementar sistema de CacheService con particionamiento
    - Implementar _cachePut(claveBase, datos) con fragmentación automática a ≤95KB por fragmento
    - Implementar _cacheGet(claveBase) con lectura y reconstrucción de fragmentos
    - Implementar invalidarCache(claveBase) para eliminación de clave índice + fragmentos
    - Límite de 20 fragmentos máximo por dataset; si excede, no cachear y loguear
    - Fallback transparente: si CacheService falla, retornar null (no lanzar)
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 3.3 Escribir property test — Propiedad 1: Memoización una sola lectura
    - **Property 1: Memoización — Una sola lectura por ciclo de ejecución**
    - Generar secuencias de 1-10 llamadas a funciones de datos
    - Verificar que SpreadsheetApp.openById se llama exactamente 1 vez y se retorna la misma referencia
    - **Validates: Requirements 1.2, 2.2, 3.2, 6.3**

  - [ ]* 3.4 Escribir property test — Propiedad 4: Cache round trip
    - **Property 4: Particionamiento de caché — Round trip de serialización**
    - Generar objetos JSON de tamaño variable (1B - 500KB)
    - Verificar _cacheGet(_cachePut(x)) produce deep equality con x
    - **Validates: Requirements 8.3, 8.4**

- [x] 4. Checkpoint — Verificar capa de datos y utilidades
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Crear 03_Metricas.js — Pipeline compartido de procesamiento
  - [x] 5.1 Implementar _procesarFilasMetricas como pipeline compartido
    - Iterar Historico_Gestiones + Reestudios desde Capa_de_Datos
    - Aplicar parsearFecha y clasificarEstado desde 02_Utilidades.js
    - Agregar por analista: gestionadas, aprobadas, negadas, aplazadas, tiempos
    - Aceptar opciones: desde, hasta, incluirReestudios, incluirBacklog, procesarFila (callback)
    - Construir produccionMap, slaMap, analistaMap, segmentoInmobMap, tipoMap
    - Omitir filas con fechas no parseables sin interrumpir procesamiento
    - _Requirements: 4.1, 4.2, 4.4, 10.4_

  - [x] 5.2 Implementar _filtrarFilasPorRango y _resolverAnalista
    - _filtrarFilasPorRango: filtrar datos por rango de fechas usando parsearFecha y fechaEnRango
    - _resolverAnalista: buscar correo en hoja Usuarios desde Capa_de_Datos, retornar nombre+especialidad o defaults
    - Implementar función auxiliar de filtrado por fecha exacta o rango (usada por métricas y administración)
    - _Requirements: 5.2, 5.3_

  - [x] 5.3 Refactorizar obtenerDatosMetricas, obtenerRendimientoPorDia y _agente_leerDatosRango
    - Cada función delega al pipeline _procesarFilasMetricas con sus opciones específicas
    - Integrar CacheService: verificar cache hit antes de procesar, almacenar resultado después
    - Mantener exactamente la misma estructura de retorno para cada función
    - _Requirements: 4.2, 4.3, 8.1, 8.2_

  - [ ]* 5.4 Escribir property test — Propiedad 5: Equivalencia del pipeline
    - **Property 5: Equivalencia del pipeline — Misma salida que funciones originales**
    - Generar datos simulados de hoja (5-500 filas) con fechas y estados aleatorios
    - Verificar que el pipeline produce valores numéricos idénticos al original
    - **Validates: Requirements 4.3, 11.4**

  - [ ]* 5.5 Escribir property test — Propiedad 6: Filtro de fechas inclusión correcta
    - **Property 6: Filtro de fechas — Inclusión correcta**
    - Generar arreglos de filas con fechas aleatorias y rangos [desde, hasta] aleatorios
    - Verificar que retorna exactamente las filas dentro del rango, sin omisiones ni extras
    - **Validates: Requirements 5.2**

  - [ ]* 5.6 Escribir property test — Propiedad 7: Resolución de analista
    - **Property 7: Resolución de analista — Lookup correcto**
    - Generar listas de usuarios y correos de búsqueda aleatorios
    - Verificar lookup correcto si existe, valores por defecto si no existe, sin excepción
    - **Validates: Requirements 5.3**

- [x] 6. Crear 04_Biometria.js — Módulo de biometría
  - [x] 6.1 Implementar funciones de biometría usando Capa_de_Datos
    - Migrar obtenerDatosBiometria: usar obtenerHojaBiometria() y obtenerHojaSolicitud() en vez de lecturas directas
    - Eliminar invocación directa de obtenerColaAsignacion dentro de obtenerDatosBiometria; obtener campo desplazamiento desde datos de hoja solicitud de la Capa_de_Datos
    - Migrar obtenerColaAsignacion: usar obtenerHojaSolicitud() y obtenerHojaOrigen()
    - Migrar buscarBiometriaSolicitud, obtenerTopPolizasPendientesBiometria, obtenerDetallePendientesPorPoliza
    - Si Capa_de_Datos no puede proveer datos de solicitud, retornar colaActual=0 y loguear error
    - Usar constantes COL_BIOMETRIA en vez de índices numéricos hardcodeados
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4_

- [x] 7. Crear 05_Administracion.js — Control de acceso y funciones de agente
  - [x] 7.1 Implementar funciones de administración usando Capa_de_Datos y helpers compartidos
    - Migrar admin_obtenerAsesoresActivosPrimerResultado: usar Capa_de_Datos para Historico_Gestiones, Reestudios y Usuarios
    - Usar _filtrarFilasPorRango y _resolverAnalista desde 03_Metricas.js
    - Obtener conteo de solicitudes pendientes por analista desde Capa_de_Datos (hoja solicitud)
    - Mantener estructura de retorno idéntica: {esHoy, fecha, datos: [{gestionadas, pendientes, primerResultado, ultimoResultado, promedioGestion, promedioGeneral}]}
    - Migrar obtenerPermisoUsuario, admin_obtenerDetallePorAnalista, y funciones agente_*
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 8. Crear 06_WebApp.js — doGet y endpoint batch
  - [x] 8.1 Implementar doGet y funciones del cliente
    - Migrar doGet con evaluación de templates HTML (MetricasPanel.html, Estilos.html, JSClient.html)
    - Migrar getEmailUsuario y cualquier otra función invocada por google.script.run
    - Mantener nombres de funciones globales intactos (el cliente las referencia directamente)
    - _Requirements: 11.4, 11.5_

  - [x] 8.2 Implementar obtenerDatosBatch — endpoint batch para carga inicial
    - Retornar en una sola invocación: permisos, email, metas, metricas (día actual), cola, salud
    - Si usuario es "sin_acceso", retornar solo permisos sin cargar datos
    - Verificar CacheService antes de procesar; cachear resultado exitoso
    - Envolver cada sección en try/catch independiente; retornar secciones exitosas + errores parciales
    - Tiempo objetivo de respuesta: ≤5000ms
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]* 8.3 Escribir property test — Propiedad 9: Resiliencia parcial del batch
    - **Property 9: Endpoint batch — Resiliencia parcial**
    - Generar combinaciones de secciones que fallan (subconjuntos aleatorios)
    - Verificar que secciones exitosas están intactas y errores contienen mensajes descriptivos
    - **Validates: Requirements 9.5**

  - [ ]* 8.4 Escribir property test — Propiedad 10: Cache hit evita lectura
    - **Property 10: Cache hit evita lectura de spreadsheet**
    - Pre-cargar datos en CacheService mock, luego invocar endpoint
    - Verificar que SpreadsheetApp no se invoca y datos retornados son idénticos
    - **Validates: Requirements 8.2**

- [x] 9. Checkpoint — Verificar todos los módulos nuevos
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Refactorizar BigQuerySync.js — Sincronización incremental
  - [x] 10.1 Refactorizar BigQuerySync para usar Capa_de_Datos y modo incremental
    - Integrar con obtenerHistoricoGestiones() y demás funciones de 01_Datos.js
    - Implementar _determinarModoSync: verificar PropertiesService para última sync; si >50% filas nuevas → sync completa
    - Implementar _syncIncremental: filtrar filas con fecha_fin > última sync, usar WRITE_APPEND + deduplicación por solicitud+origen
    - Implementar _syncCompleta como fallback: WRITE_TRUNCATE
    - Almacenar marca de tiempo ISO 8601 en PropertiesService al finalizar exitosamente
    - Si sync incremental falla o no hay marca previa → ejecutar sync completa
    - Usar CacheService si TTL vigente para obtener datos sin releer hojas
    - Usar getRange limitado a columnas de BQ_SCHEMA en modo completo (fallback)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 10.1, 10.3_

  - [ ]* 10.2 Escribir property test — Propiedad 8: Sync incremental solo filas modificadas
    - **Property 8: Sincronización incremental — Solo filas modificadas**
    - Generar filas con fecha_fin variadas y marca de tiempo de última sync
    - Verificar que solo se incluyen filas posteriores a la marca o con fecha_fin vacía
    - **Validates: Requirements 12.2**

- [x] 11. Actualizar JSClient.html — Usar endpoint batch
  - [x] 11.1 Refactorizar JSClient.html para usar obtenerDatosBatch en carga inicial
    - Reemplazar las 6 llamadas separadas a google.script.run (getEmailUsuario, agente_obtenerMetasDecision, obtenerPermisoUsuario, obtenerDatosMetricas, obtenerColaAsignacion, agente_obtenerDatosDashboard) por una sola llamada a obtenerDatosBatch
    - Distribuir los datos de la respuesta batch a las secciones del dashboard correspondientes
    - Manejar respuesta parcial: si resultado.errores contiene secciones fallidas, mostrar indicador de error en la sección correspondiente
    - Manejar caso sin_acceso: redirigir o mostrar mensaje como antes
    - Mantener las llamadas individuales para acciones interactivas posteriores (refresh, filtros de fecha)
    - _Requirements: 9.1, 9.2, 9.5_

- [x] 12. Eliminar Código.js y limpieza final
  - [x] 12.1 Eliminar Código.js y verificar integridad del proyecto
    - Verificar que todas las funciones de Código.js han sido migradas a los archivos 00_-06_
    - Eliminar el archivo Código.js del proyecto
    - Verificar que no quedan ReferenceError: recorrer cada función expuesta a google.script.run y confirmar que existe en el scope global
    - Verificar que BigQuerySync.js y ConsultaSAIRechazados.js pueden acceder a las funciones que referencian
    - Eliminar funciones duplicadas de parseo: parseFechaDDMMYYYY, _parsearFechaFlexible, parseDatetimeStr, closures inline (_fechaParte, _fechaISO, _fechaNorm, _fechaParteD, _fechaISOD, _fechaNormD)
    - _Requirements: 7.4, 11.1, 11.4, 11.5_

- [x] 13. Checkpoint final — Verificar integración completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requerimientos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los property tests validan propiedades universales de correctitud
- Los unit tests validan ejemplos concretos y edge cases
- Google Apps Script comparte namespace global — no hay imports, los archivos se cargan alfabéticamente por nombre
- Los tests se ejecutan localmente con Jest y mocks de servicios Google (SpreadsheetApp, CacheService, etc.)
- El runtime V8 destruye variables de módulo entre invocaciones, garantizando datos frescos por ciclo

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3"] },
    { "id": 5, "tasks": ["3.4", "5.1"] },
    { "id": 6, "tasks": ["5.2"] },
    { "id": 7, "tasks": ["5.3", "5.4", "5.5", "5.6"] },
    { "id": 8, "tasks": ["6.1", "7.1"] },
    { "id": 9, "tasks": ["8.1"] },
    { "id": 10, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2", "11.1"] },
    { "id": 13, "tasks": ["12.1"] }
  ]
}
```
