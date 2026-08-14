# Requirements Document

## Introduction

Este documento define los requerimientos para la refactorización de rendimiento del proyecto **metricas_analisis**, una aplicación Google Apps Script desplegada como webapp en un dominio Google Workspace. El sistema presenta problemas severos de latencia causados por lecturas redundantes de hojas de cálculo, funciones duplicadas, y la ausencia de patrones de caché y batch. El objetivo es reducir drásticamente los tiempos de respuesta sin alterar la funcionalidad visible del dashboard.

## Glossary

- **Sistema**: La aplicación metricas_analisis desplegada como Google Apps Script webapp
- **Capa_de_Datos**: Módulo centralizado responsable de leer cada hoja de cálculo una sola vez por ciclo de ejecución y proveer los datos a las funciones consumidoras
- **CacheService**: Servicio nativo de Google Apps Script que permite almacenar datos procesados en memoria entre ejecuciones (máximo 6 horas TTL)
- **Endpoint_Batch**: Función del servidor que agrupa múltiples respuestas de datos en una sola invocación desde el cliente
- **Historico_Gestiones**: Hoja principal de gestiones dentro del spreadsheet TARGET_SOLICITUDES_SS_ID
- **Hoja_Reestudios**: Spreadsheet con ID_HOJA_REESTUDIOS, pestaña Historico_Gestiones de reestudios
- **Hoja_Biometria**: Spreadsheet con ID_HOJA_BIOMETRIA, pestaña pendiente_biometria
- **BigQuerySync**: Módulo que sincroniza datos de hojas de cálculo hacia BigQuery cada 15 minutos
- **Cliente**: Código JavaScript ejecutado en el navegador del usuario (JSClient.html)
- **Round_Trip**: Cada invocación individual de google.script.run desde el Cliente hacia el servidor
- **TTL**: Time To Live — duración en segundos durante la cual un dato cacheado es válido
- **Índice_de_Columna**: Posición numérica fija (ej. fila[26]) usada para acceder a una columna específica en los datos de la hoja

## Requirements

### Requirement 1: Capa de datos compartida para Historico_Gestiones

**User Story:** Como desarrollador, quiero que la hoja Historico_Gestiones se lea una sola vez por ciclo de ejecución del servidor, para eliminar las 8 lecturas redundantes actuales y reducir el tiempo de respuesta.

#### Acceptance Criteria

1. THE Capa_de_Datos SHALL proveer una función única que lea la hoja Historico_Gestiones del spreadsheet TARGET_SOLICITUDES_SS_ID mediante getDataRange().getDisplayValues() y retorne los datos como un arreglo bidimensional de strings (string[][]) incluyendo la fila de encabezados, para ser consumidos por todas las funciones que los necesiten.
2. WHEN múltiples funciones del servidor requieran datos de Historico_Gestiones dentro del mismo ciclo de ejecución (una sola invocación server-side de Apps Script), THE Capa_de_Datos SHALL retornar la misma referencia en memoria sin ejecutar llamadas adicionales a SpreadsheetApp.openById ni getDataRange, de modo que el número total de lecturas al spreadsheet por ciclo sea exactamente 1.
3. WHEN una función consumidora solicite datos de Historico_Gestiones, THE Capa_de_Datos SHALL proveer los datos sin que la función consumidora ejecute SpreadsheetApp.openById, getSheetByName ni getDataRange directamente.
4. IF la hoja Historico_Gestiones no existe en el spreadsheet o el spreadsheet no es accesible, THEN THE Capa_de_Datos SHALL lanzar un error descriptivo indicando la causa de la falla, sin retornar un arreglo vacío silenciosamente.
5. WHEN se inicie un nuevo ciclo de ejecución del servidor (nueva invocación independiente de Apps Script), THE Capa_de_Datos SHALL ejecutar una lectura fresca al spreadsheet, sin reutilizar datos de ejecuciones anteriores.

### Requirement 2: Capa de datos compartida para Hoja_Reestudios

**User Story:** Como desarrollador, quiero que la hoja de Reestudios se lea una sola vez por ciclo de ejecución, para eliminar las 8 lecturas redundantes actuales.

#### Acceptance Criteria

1. THE Capa_de_Datos SHALL proveer una función única que abra el spreadsheet ID_HOJA_REESTUDIOS mediante SpreadsheetApp.openById una sola vez por ciclo de ejecución, lea la pestaña Historico_Gestiones usando getDisplayValues, y retorne los datos como un arreglo bidimensional de strings almacenado en una variable de módulo.
2. WHEN múltiples funciones requieran datos de Hoja_Reestudios dentro del mismo ciclo de ejecución, THE Capa_de_Datos SHALL retornar la misma referencia al arreglo almacenado en la variable de módulo sin ejecutar SpreadsheetApp.openById ni getSheetByName adicionales.
3. THE Capa_de_Datos SHALL proveer una función separada que lea la pestaña ORIGEN del spreadsheet ID_HOJA_REESTUDIOS reutilizando la instancia del spreadsheet ya abierta por el criterio 1, y retorne sus datos como un arreglo bidimensional de strings almacenado en su propia variable de módulo.
4. IF SpreadsheetApp.openById(ID_HOJA_REESTUDIOS) lanza una excepción o la pestaña solicitada no existe, THEN THE Capa_de_Datos SHALL registrar el error mediante Logger.log y retornar un arreglo vacío, permitiendo que las funciones consumidoras continúen su ejecución sin datos de reestudios.
5. WHEN la pestaña Historico_Gestiones o ORIGEN contenga solo la fila de encabezados (lastRow menor o igual a 1), THE Capa_de_Datos SHALL retornar un arreglo vacío sin intentar leer un rango de datos.

### Requirement 3: Capa de datos compartida para Hoja_Biometria

**User Story:** Como desarrollador, quiero que la hoja pendiente_biometria se lea una sola vez por ciclo de ejecución, para eliminar las 5 lecturas redundantes actuales.

#### Acceptance Criteria

1. THE Capa_de_Datos SHALL proveer una función única que lea la pestaña pendiente_biometria del spreadsheet ID_HOJA_BIOMETRIA mediante getDataRange().getDisplayValues() y retorne el resultado como un arreglo bidimensional de strings almacenado en memoria durante el ciclo de ejecución actual (una invocación server-side de Apps Script).
2. WHEN una función de biometría (obtenerDatosBiometria, _buscarBioBroadcast, la función de listado detallado de biometrías, obtenerTopPolizasPendientesBiometria u obtenerDetallePendientesPorPoliza) solicite datos de Hoja_Biometria y la pestaña ya haya sido leída en el mismo ciclo de ejecución, THE Capa_de_Datos SHALL retornar la referencia en memoria existente sin ejecutar llamadas adicionales a SpreadsheetApp.openById ni getDataRange.
3. WHEN una función de biometría solicite datos de Hoja_Biometria por primera vez en un ciclo de ejecución, THE Capa_de_Datos SHALL ejecutar exactamente 1 llamada a SpreadsheetApp.openById(ID_HOJA_BIOMETRIA).getSheetByName("pendiente_biometria").getDataRange().getDisplayValues() y almacenar el resultado para el resto del ciclo.
4. IF la pestaña pendiente_biometria no existe o la hoja contiene menos de 2 filas al momento de la lectura, THEN THE Capa_de_Datos SHALL retornar un arreglo vacío [] y las funciones consumidoras SHALL manejar este caso sin generar error no controlado.

### Requirement 4: Consolidación de funciones de métricas

**User Story:** Como desarrollador, quiero consolidar las funciones obtenerDatosMetricas, obtenerRendimientoPorDia, y _agente_leerDatosRango en un pipeline compartido de procesamiento de filas, para eliminar la duplicación de lógica de iteración, parseo de fechas y agregación por analista.

#### Acceptance Criteria

1. THE Sistema SHALL proveer un pipeline único de procesamiento de filas que itere los datos de Historico_Gestiones y de Reestudios, parsee fechas mediante las funciones de parseo existentes, clasifique estados, y agregue resultados por analista, aceptando como parámetros: la configuración de filtrado de fechas (rango desde/hasta o fecha única), y una función o configuración de agregación que determine qué métricas acumular por cada fila procesada.
2. WHEN obtenerDatosMetricas, obtenerRendimientoPorDia, o _agente_leerDatosRango necesiten datos agregados, THE Sistema SHALL delegar la iteración de filas, el parseo de fechas, la clasificación de estados (APROBADO, RECHAZADO, APLAZADO), y el parseo de tiempos (gestión, resolución, cola) al pipeline compartido, sin duplicar dicha lógica en el cuerpo de cada función.
3. THE Sistema SHALL mantener la misma estructura de datos y valores de retorno que las funciones originales producen para entradas idénticas, de modo que las funciones dependientes (Cliente HTML, reportes de agente) no requieran modificación.
4. WHEN el pipeline compartido procese una fila con valores de fecha no parseables o campos de tiempo vacíos, THE Sistema SHALL omitir esa fila del cálculo de promedios de tiempo sin interrumpir el procesamiento de las filas restantes, replicando el comportamiento actual de las tres funciones.

### Requirement 5: Consolidación de funciones de seguimiento de analistas

**User Story:** Como desarrollador, quiero unificar la lógica compartida entre obtenerDatosMetricas y admin_obtenerAsesoresActivosPrimerResultado, para que ambas funciones consuman los mismos datos base sin abrir las hojas de forma independiente.

#### Acceptance Criteria

1. WHEN admin_obtenerAsesoresActivosPrimerResultado necesite datos de Historico_Gestiones, Hoja_Reestudios, o la hoja Usuarios, THE Sistema SHALL obtenerlos de la Capa_de_Datos en lugar de ejecutar SpreadsheetApp.openById o getSheetByName directamente.
2. THE Sistema SHALL proveer una función auxiliar de filtrado por fecha que acepte una fecha exacta (coincidencia de día) o un rango de fechas (desde/hasta), y que sea invocada tanto por obtenerDatosMetricas como por admin_obtenerAsesoresActivosPrimerResultado para seleccionar filas de Historico_Gestiones y Hoja_Reestudios.
3. THE Sistema SHALL proveer una función auxiliar de resolución de analista que, dado un correo electrónico, retorne el nombre y la especialidad del analista a partir de los datos de la hoja Usuarios, y que sea invocada por ambas funciones en lugar de iterar la hoja Usuarios de forma independiente.
4. WHEN se complete la consolidación, THE Sistema SHALL mantener la misma estructura de retorno de admin_obtenerAsesoresActivosPrimerResultado (objeto con propiedades esHoy, fecha, y datos con la lista de analistas incluyendo gestionadas, pendientes, primerResultado, ultimoResultado, promedioGestion, y promedioGeneral) sin alterar los valores producidos para los mismos datos de entrada.
5. WHEN admin_obtenerAsesoresActivosPrimerResultado necesite el conteo de solicitudes pendientes por analista, THE Sistema SHALL obtener los datos de la hoja solicitud desde la Capa_de_Datos en lugar de abrirla directamente.

### Requirement 6: Eliminación de lecturas redundantes en obtenerDatosBiometria

**User Story:** Como desarrollador, quiero que obtenerDatosBiometria no invoque obtenerColaAsignacion internamente causando lecturas adicionales, para reducir el número total de llamadas a SpreadsheetApp.

#### Acceptance Criteria

1. WHEN obtenerDatosBiometria necesite el conteo de solicitudes en cola de asignación (campo desplazamiento), THE Sistema SHALL obtener ese dato desde la Capa_de_Datos (que lee la hoja "solicitud" del spreadsheet TARGET_SOLICITUDES_SS_ID una sola vez por ciclo de ejecución), en lugar de invocar obtenerColaAsignacion como función independiente.
2. THE Sistema SHALL eliminar la invocación directa de obtenerColaAsignacion() dentro del cuerpo de obtenerDatosBiometria, de modo que obtenerDatosBiometria no ejecute SpreadsheetApp.openById ni getDataRange sobre la hoja "solicitud" por cuenta propia.
3. WHEN obtenerColaAsignacion sea invocada desde el Endpoint_Batch o desde el Cliente de forma independiente, THE Sistema SHALL reutilizar los datos de la hoja "solicitud" ya cargados en la Capa_de_Datos sin ejecutar una lectura adicional al spreadsheet.
4. IF la Capa_de_Datos no puede proveer los datos de la hoja "solicitud" (error de lectura o spreadsheet no disponible), THEN THE Sistema SHALL retornar el valor 0 para el campo colaActual de obtenerDatosBiometria y registrar el error en Logger sin interrumpir el resto del cálculo de biometría.

### Requirement 7: Unificación de helpers de parseo de fechas

**User Story:** Como desarrollador, quiero una sola función de parseo de fechas flexible, para eliminar la duplicación entre parseFechaDDMMYYYY, _parsearFechaFlexible, y las closures inline que repiten la misma lógica.

#### Acceptance Criteria

1. THE Sistema SHALL proveer una función unificada de parseo de fechas que acepte los formatos dd/MM/yyyy, dd-MM-yyyy, yyyy-MM-dd, YYYYMMDD (8 dígitos compactos), y dd/MM/yyyy HH:mm:ss, y retorne un objeto Date válido o null cuando la entrada sea nula, vacía, o no coincida con ningún formato soportado.
2. WHEN la función unificada reciba una cadena con componente de hora (formato dd/MM/yyyy HH:mm:ss), THE Sistema SHALL preservar horas, minutos y segundos en el objeto Date retornado.
3. THE Sistema SHALL proveer una función auxiliar de normalización que convierta una fecha en formato dd/MM/yyyy a representación yyyy-MM-dd (cadena ISO) para uso en ordenamiento y comparación de rangos, reemplazando las closures inline _fechaParte/_fechaISO/_fechaNorm y sus duplicados _fechaParteD/_fechaISOD/_fechaNormD.
4. THE Sistema SHALL eliminar las funciones parseFechaDDMMYYYY, _parsearFechaFlexible, parseDatetimeStr, y las closures inline de parseo (_fechaParte, _fechaISO, _fechaNorm, _fechaParteD, _fechaISOD, _fechaNormD), reemplazando cada invocación por la función unificada o la función auxiliar de normalización según corresponda.
5. WHEN la función unificada reciba una cadena con separador "-" donde el primer segmento tenga 4 dígitos, THE Sistema SHALL interpretar el formato como yyyy-MM-dd; en caso contrario, SHALL interpretarlo como dd-MM-yyyy.

### Requirement 8: Implementación de CacheService para datos procesados

**User Story:** Como desarrollador, quiero utilizar CacheService para almacenar datos procesados frecuentemente consultados, para que invocaciones subsecuentes dentro de la ventana de TTL no requieran releer las hojas de cálculo.

#### Acceptance Criteria

1. THE Capa_de_Datos SHALL almacenar en CacheService el resultado agregado retornado por el pipeline de procesamiento de Historico_Gestiones (métricas, mapas por analista, producción por día, y segmentación por inmobiliaria) utilizando CacheService.getScriptCache() con un TTL de 300 segundos (5 minutos).
2. WHEN una solicitud del Cliente llegue al servidor y exista una entrada válida en CacheService para la misma combinación de fechaDesde y fechaHasta solicitada, THE Capa_de_Datos SHALL retornar los datos deserializados desde caché sin leer el spreadsheet.
3. IF los datos serializados en JSON para una clave de CacheService exceden 100 KB, THEN THE Capa_de_Datos SHALL particionar los datos en fragmentos de máximo 95 KB cada uno, almacenarlos en claves secuenciales con un sufijo numérico (ej. _part0, _part1), y almacenar el conteo total de fragmentos en una clave índice, sin exceder 20 fragmentos por dataset.
4. WHEN la Capa_de_Datos necesite leer datos particionados desde CacheService, THE Capa_de_Datos SHALL leer la clave índice, recuperar todos los fragmentos referenciados, concatenarlos en orden, y deserializar el JSON resultante.
5. IF CacheService lanza una excepción o retorna null para una clave esperada (fragmento faltante o servicio no disponible), THEN THE Capa_de_Datos SHALL ejecutar la lectura directa del spreadsheet como fallback y continuar la operación sin error visible para el Cliente.
6. WHEN un administrador invoque la función de invalidación manual del Sistema, THE Sistema SHALL eliminar la clave índice y todas las claves de fragmentos asociados al dataset invalidado, de modo que la siguiente solicitud ejecute una lectura fresca del spreadsheet.

### Requirement 9: Endpoint batch para carga inicial del Cliente

**User Story:** Como usuario del dashboard, quiero que la carga inicial de la página sea rápida, para no esperar más de 5 segundos para ver los datos principales.

#### Acceptance Criteria

1. THE Sistema SHALL proveer un Endpoint_Batch que retorne en una sola invocación un objeto JSON con las siguientes secciones: permisos del usuario, email del usuario, metas de decisión del equipo, datos de métricas para el rango de fechas por defecto (día actual), cola de asignación, y resumen de salud operativa.
2. WHEN el Cliente cargue la página por primera vez, THE Cliente SHALL ejecutar un solo Round_Trip al Endpoint_Batch en lugar de los Round_Trips separados a getEmailUsuario, agente_obtenerMetasDecision, obtenerPermisoUsuario, obtenerDatosMetricas, obtenerColaAsignacion, y agente_obtenerDatosDashboard.
3. WHEN el Endpoint_Batch sea invocado, THE Sistema SHALL retornar la respuesta completa en un tiempo máximo de 5000 milisegundos medido desde la recepción de la solicitud hasta el envío de la respuesta al Cliente.
4. WHEN el Endpoint_Batch sea invocado, THE Sistema SHALL utilizar la Capa_de_Datos para obtener los datos de cada sección compartiendo las lecturas de hojas de cálculo ya realizadas dentro de la misma ejecución, de modo que el tiempo total de respuesta sea menor o igual al tiempo de la llamada individual más lenta (no la suma de todas).
5. IF el Endpoint_Batch no puede obtener los datos de una o más secciones, THEN THE Sistema SHALL retornar las secciones que sí se obtuvieron exitosamente junto con una indicación de error por cada sección fallida, permitiendo al Cliente renderizar un estado parcial del dashboard.
6. IF el usuario no tiene permisos de acceso (rol "sin_acceso"), THEN THE Endpoint_Batch SHALL retornar únicamente la sección de permisos con el rol correspondiente, omitiendo la carga de las demás secciones de datos.

### Requirement 10: Lectura selectiva de columnas

**User Story:** Como desarrollador, quiero leer solo las columnas necesarias de cada hoja en lugar de todas las 60+ columnas, para reducir el volumen de datos transferidos y el tiempo de lectura.

#### Acceptance Criteria

1. WHEN la Capa_de_Datos lea la hoja "solicitud" para funciones que solo necesiten las columnas estado_general (16) y clase (20), THE Capa_de_Datos SHALL utilizar getRange con rangos específicos limitados a las columnas necesarias en lugar de getDataRange sobre las 60+ columnas.
2. THE Capa_de_Datos SHALL definir constantes nombradas para los índices de columnas críticos de cada hoja (Historico_Gestiones, solicitud, Reestudios, Biometria) asociando nombres descriptivos a los índices numéricos correspondientes.
3. WHEN BigQuerySync lea los datos para sincronización en modo completo (fallback), THE BigQuerySync SHALL utilizar getRange limitado a las columnas definidas en BQ_SCHEMA en lugar de leer columnas adicionales no requeridas por el esquema.
4. WHEN la Capa_de_Datos lea Historico_Gestiones para el pipeline compartido de métricas, THE Capa_de_Datos SHALL leer todas las columnas en una sola lectura (ya que múltiples funciones consumen diferentes subconjuntos), priorizando una lectura amplia sobre múltiples lecturas parciales.

### Requirement 11: Modularización de Código.js

**User Story:** Como desarrollador, quiero separar Código.js (5500+ líneas) en archivos organizados por dominio, para facilitar el mantenimiento y la comprensión del código.

#### Acceptance Criteria

1. THE Sistema SHALL organizar el código en archivos separados por dominio con los siguientes nombres: 00_Config.js (constantes y configuración), 01_Datos.js (Capa_de_Datos), 02_Utilidades.js (helpers de parseo, normalización y formateo), 03_Metricas.js (obtenerDatosMetricas, obtenerRendimientoPorDia, pipeline de agregación), 04_Biometria.js (obtenerDatosBiometria, buscarBiometriaSolicitud, obtenerColaAsignacion y funciones asociadas), 05_Administracion.js (admin_obtenerAsesoresActivosPrimerResultado, admin_obtenerDetallePorAnalista, control de acceso, agente_*), y 06_WebApp.js (doGet y funciones invocadas por el Cliente vía google.script.run).
2. THE Sistema SHALL nombrar los archivos con prefijo numérico de dos dígitos (00_ a 06_) para garantizar que Google Apps Script los cargue en orden alfabético, asegurando que las constantes y la Capa_de_Datos se inicialicen antes de las funciones que las consumen.
3. THE Sistema SHALL colocar en 00_Config.js todas las constantes globales del proyecto: TARGET_SOLICITUDES_SS_ID, SHEET_NAME_SOLICITUDES, ID_HOJA_REESTUDIOS, NOMBRE_PESTANA_REESTUDIOS, ID_HOJA_BIOMETRIA, TIMEZONE, HORA_INICIO_OPERACION, HORA_FIN_TURNO, BCC_REPORTES_AGENTE, NOMBRE_REMITENTE_AGENTE, y cualquier otra variable declarada con const o var en el scope global de Código.js.
4. WHEN se complete la modularización, THE Sistema SHALL pasar las mismas pruebas funcionales que el archivo Código.js original: doGet retorna la webapp, cada función invocada por el Cliente vía google.script.run retorna la misma estructura de datos, y ninguna función lanza ReferenceError por variables o funciones no definidas.
5. IF una función es referenciada desde otro archivo del proyecto (BigQuerySync.js, ConsultaSAIRechazados.js) o desde el Cliente (google.script.run), THEN THE Sistema SHALL mantener el mismo nombre de función en el scope global sin renombrarla ni encapsularla.

### Requirement 12: Optimización de BigQuerySync

**User Story:** Como desarrollador, quiero que BigQuerySync no relea las 4 hojas completas desde cero cada 15 minutos, para reducir la carga en los spreadsheets y el tiempo de ejecución del trigger.

#### Acceptance Criteria

1. WHEN BigQuerySync ejecute la sincronización periódica y existan datos en CacheService con un TTL no expirado (máximo 300 segundos según configuración de Capa_de_Datos), THE BigQuerySync SHALL obtener los datos desde CacheService en lugar de abrir los spreadsheets y llamar a getDataRange() en cada una de las 4 hojas.
2. WHEN BigQuerySync ejecute la sincronización periódica, THE BigQuerySync SHALL comparar el valor de la columna fecha_fin de cada fila contra la marca de tiempo de la última sincronización exitosa almacenada en PropertiesService, y enviar a BigQuery únicamente las filas cuya fecha_fin sea posterior a dicha marca o que no tengan fecha_fin registrada previamente.
3. WHEN BigQuerySync ejecute una sincronización incremental, THE BigQuerySync SHALL utilizar writeDisposition WRITE_APPEND junto con una consulta de deduplicación por el campo solicitud+origen, para evitar la pérdida de datos previamente cargados en la tabla.
4. IF la sincronización incremental falla, o la marca de tiempo de referencia no existe en PropertiesService, o el número de filas incrementales supera el 50% del total de filas en las hojas, THEN THE BigQuerySync SHALL ejecutar una sincronización completa con writeDisposition WRITE_TRUNCATE como fallback y registrar la nueva marca de tiempo en PropertiesService.
5. WHEN la sincronización (incremental o completa) finalice exitosamente, THE BigQuerySync SHALL almacenar en PropertiesService la marca de tiempo en formato ISO 8601 (yyyy-MM-dd'T'HH:mm:ss) correspondiente al momento de inicio de la ejecución actual.

### Requirement 13: Eliminación de índices de columna hardcodeados

**User Story:** Como desarrollador, quiero reemplazar los índices numéricos dispersos (fila[26], fila[35], fila[60]) por constantes con nombres descriptivos, para mejorar la legibilidad y reducir errores cuando las columnas cambien de posición.

#### Acceptance Criteria

1. THE Sistema SHALL definir un objeto de mapeo de columnas por cada hoja (COL_HISTORICO, COL_SOLICITUD, COL_REESTUDIOS, COL_BIOMETRIA) que asocie nombres descriptivos a los índices numéricos correspondientes (ej. COL_HISTORICO.FECHA_FIN = 26, COL_HISTORICO.TIEMPO_GESTION = 32, COL_HISTORICO.TIPO_ASIGNADO = 60).
2. WHEN cualquier función del Sistema acceda a una columna por índice numérico, THE Sistema SHALL utilizar la constante nombrada del objeto de mapeo correspondiente en lugar del número literal.
3. THE Sistema SHALL centralizar todos los objetos de mapeo de columnas en el archivo 00_Config.js para que un cambio de posición de columna requiera modificar un solo lugar.
4. WHEN se agregue o modifique una columna en una hoja de cálculo, THE Sistema SHALL requerir actualizar únicamente el valor numérico en el objeto de mapeo correspondiente, sin necesidad de buscar y reemplazar índices en múltiples funciones.
