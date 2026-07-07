# 📊 Documentación Técnica — Métricas Análisis

---

## 1. 📋 Ficha Técnica del Proyecto

| Campo | Detalle |
|-------|---------|
| **Nombre** | Métricas Análisis |
| **Propósito General** | Dashboard analítico en tiempo real para el equipo de Análisis de Arrendamiento de Seguros Bolívar. Consolida, procesa y visualiza indicadores clave de rendimiento (KPIs) sobre la gestión de solicitudes de estudio (aprobaciones, negaciones, aplazamientos), tiempos de respuesta (cola, gestión, general), cumplimiento de SLA, productividad por analista y segmentación por inmobiliaria/sucursal. Permite a coordinadores y líderes operativos tomar decisiones basadas en datos para optimizar la eficiencia del equipo. |
| **Beneficiarios** | Coordinadores y líderes del área de Análisis de Arrendamiento |
| **Stack Tecnológico** | Google Apps Script (runtime V8), Google Sheets (base de datos), HtmlService (frontend), Chart.js 4, Bootstrap 5.3, DataTables 1.13.5, SweetAlert2 11, Particles.js 2.0, jQuery 3.7 |
| **Modelo de Despliegue** | Google Apps Script Web App (acceso por dominio corporativo) |
| **Zona Horaria** | `America/Bogota` |

---

## 2. 🏗️ Arquitectura de Software

### 2.1 Modelo de Diseño

El proyecto implementa un patrón **MVC simplificado** adaptado a la plataforma Google Apps Script:

```
┌─────────────────────────────────────────────────────────┐
│                    PRESENTACIÓN (View)                   │
│  MetricasPanel.html + Estilos.html + JSClient.html      │
│  Bootstrap 5 · Chart.js · DataTables · SweetAlert2      │
└─────────────────────┬───────────────────────────────────┘
                      │ google.script.run.*
                      ▼
┌─────────────────────────────────────────────────────────┐
│              LÓGICA DE NEGOCIO (Controller)              │
│                     Código.js                            │
│  Funciones expuestas: obtenerDatosMetricas(),           │
│  obtenerRendimientoPorDia(),                            │
│  admin_obtenerAsesoresActivosPrimerResultado(),         │
│  admin_obtenerDetallePorAnalista()                      │
└─────────────────────┬───────────────────────────────────┘
                      │ SpreadsheetApp.openById()
                      ▼
┌─────────────────────────────────────────────────────────┐
│              PERSISTENCIA (Model / Data)                 │
│  Google Sheets:                                         │
│  • Historico_Gestiones (solicitudes principales)        │
│  • solicitud (backlog activo)                           │
│  • score (diccionario póliza→inmobiliaria/segmento)     │
│  • Usuarios (asesores y estados)                        │
│  • Hoja ORIGEN en Spreadsheet de Reestudios             │
└─────────────────────────────────────────────────────────┘
```

La comunicación entre capas se realiza exclusivamente a través de `google.script.run` (RPC asíncrono nativo de Apps Script), con callbacks `withSuccessHandler` y `withFailureHandler`.

### 2.2 Estructura de Archivos

| Archivo | Responsabilidad |
|---------|-----------------|
| `Código.js` | **Backend/Controller.** Contiene toda la lógica de negocio: parsing de fechas, clasificación de sucursales por póliza, carga del diccionario de score, cálculo de métricas agregadas (tiempos, SLA, producción, backlog), y funciones expuestas al frontend. |
| `MetricasPanel.html` | **Vista principal.** Layout HTML completo con sidebar de navegación, filtros de fecha/segmento, tarjetas KPI, contenedores de gráficos (canvas), tablas de backlog y pestañas (Resumen, Producción, Tiempos, Analistas). |
| `JSClient.html` | **JavaScript del cliente.** Toda la lógica frontend: inicialización, navegación entre tabs, carga y transformación de datos, renderizado de ~20 gráficos Chart.js, filtros dinámicos, drill-downs modales, DataTables, y recálculo en memoria. |
| `Estilos.html` | **CSS.** Sistema de diseño propio con variables CSS, componentes reutilizables (cards, badges, sidebar colapsable), responsive grid, animaciones y tema visual corporativo (rojo Bolívar + azul oscuro). |
| `appsscript.json` | **Manifiesto.** Configuración del proyecto: timezone, runtime V8, despliegue como web app ejecutada por el usuario desplegador con acceso de dominio. |
| `.clasp.json` | **Configuración CLASP.** Vinculación con el script ID de Google para push/pull desde CLI. |
| `Biometria.js` | **Ciclo de biometrías (captura → WA → escalación → asignación → gestión → verificación final).** Ver [4.7](#47-flujo-de-biometrías-biometriajs). ⚠️ Vive en el proyecto Apps Script desplegado; aún no sincronizado a este repo local vía `clasp pull`. |

### 2.3 Gestión de Datos

El sistema utiliza **Google Sheets como base de datos operativa**. No hay base de datos relacional ni NoSQL; toda la persistencia reside en dos hojas de cálculo:

| Fuente de Datos | Spreadsheet ID | Pestañas Utilizadas |
|-----------------|----------------|---------------------|
| **Solicitudes Principal** | `1x9groW5-I7Xg5ULh7DXfa2XGmS_RMdfqfW1iDWB8bJ0` | `Historico_Gestiones`, `solicitud`, `score`, `Usuarios` |
| **Reestudios** | `1slgykTgjoAtCd6KmlG7Lqiuw-nM1hSguQbi0XqeLu7U` | `ORIGEN` |

**Estrategia de lectura:**
- Se usa `getDataRange().getDisplayValues()` para obtener todos los datos como strings formateados.
- Se construyen mapas/diccionarios en memoria para procesamiento eficiente (O(n) lineal).
- El diccionario `scoreMap` (póliza → inmobiliaria/segmento) se carga una sola vez por solicitud de métricas.

**El dashboard de métricas en sí** (`Código.js`) es de solo lectura. La excepción es el ciclo de `Biometria.js` ([4.7](#47-flujo-de-biometrías-biometriajs)), que sí escribe activamente en `pendiente_biometria`, `solicitud` y `Historico_Gestiones` como parte de su operación normal (captura, escalación, asignación y gestión de biometrías).

---

## 3. 🔐 Roles y Seguridad

| Mecanismo | Implementación |
|-----------|----------------|
| **Autenticación** | OAuth implícito de Google Workspace. El `appsscript.json` define `"access": "DOMAIN"`, restringiendo el acceso únicamente a usuarios del dominio corporativo. |
| **Identificación** | `Session.getActiveUser().getEmail()` obtiene el correo del usuario autenticado para mostrar en la UI. |
| **Ejecución** | `"executeAs": "USER_DEPLOYING"` — el script se ejecuta con los permisos del desplegador, garantizando acceso a las hojas sin depender de permisos individuales de cada usuario. |
| **Nivel de acceso** | No hay sistema de roles diferenciado en el código. Todos los usuarios con acceso al dominio ven las mismas métricas (vista administrativa completa). |

---

## 4. 🔄 Flujos Clave del Sistema (Core Workflows)

### 4.1 Flujo de Carga Inicial

```
[Usuario abre la URL]
    │
    ▼
doGet() → HtmlService.createTemplateFromFile('MetricasPanel')
    │        ├── Incluye Estilos.html (CSS inline)
    │        └── Incluye JSClient.html (JS inline)
    │
    ▼
window.onload()
    ├── getEmailUsuario() → muestra correo en sidebar
    ├── Inicializa controles de fecha (hoy)
    └── setRangoRapido('semana') → cargarMetricas()
```

### 4.2 Flujo Principal: Carga de Métricas

```
[Frontend] cargarMetricas()
    │  Muestra spinner, oculta contenido
    │  Formatea fechas (dd/MM/yyyy)
    │
    ▼
[Backend] obtenerDatosMetricas(fechaDesde, fechaHasta)
    │
    ├── 1. Valida fechas de entrada
    ├── 2. Carga diccionario score (póliza → inmobiliaria/segmento)
    ├── 3. Abre hoja de reestudios
    │
    ├── 4. LOOP: Historico_Gestiones (col 33 = fecha gestión)
    │       ├── Filtra por rango de fechas
    │       ├── Clasifica estado (APROB/NEGAD/APLAZ)
    │       ├── Calcula tipo (Digital/Biometría/Inducción)
    │       ├── Extrae tiempo gestión (col 34) y resolución (col 29)
    │       ├── Calcula tiempo de cola (col 37 radicación → col 26 asignación)
    │       ├── Mapea segmento/inmobiliaria via scoreMap
    │       └── Acumula en: produccionMap, slaMap, analistaMap, sucursalMap, tipoMap
    │
    ├── 5. LOOP: Reestudios/ORIGEN
    │       ├── Misma lógica, columnas diferentes
    │       ├── Clasifica tipo: UAR (correo+adicional/nueva) vs Reestudio
    │       └── Tiempo resolución: minutos → horas (÷60)
    │
    ├── 6. Calcula Backlog (hoja "solicitud" + reestudios)
    │       ├── Solicitudes con fecha_asignación ≠ "" AND fecha_fin = ""
    │       └── Semáforo: 🟢 <15min | 🟡 15-30min | 🔴 >30min
    │
    ├── 7. Agrega y formatea resultados
    │       ├── KPIs: totales, promedios, tasas
    │       ├── Segmentación inmobiliaria por segmento
    │       ├── Producción diaria, SLA diario, tendencia
    │       ├── Heatmap horario, dispersión, negación por sucursal
    │       └── Detalle por solicitud (tiemposDetalle[])
    │
    └── return { totalGestionadas, tiempoPromedioMinutos, ... }
         │
         ▼
[Frontend] onDatosCargados(datos)
    ├── Almacena _datosCompletos, _segmentacionData
    ├── Pobla filtros dinámicos (segmento, sucursal, analista)
    └── aplicarFiltroSegmentoGlobal() → renderizarConDatos()
         ├── KPIs en DOM
         ├── ~20 gráficos Chart.js (destroy + new)
         ├── Tabla backlog semáforo
         └── Pestaña analistas (carga separada por día)
```

### 4.3 Flujo de Filtros Dinámicos (Recálculo en Frontend)

Cuando el usuario cambia un filtro (segmento, sucursal, tipo, estado, analista, póliza), el sistema **NO llama al backend de nuevo**. En su lugar:

1. Filtra `_datosCompletos.tiemposDetalle[]` en memoria con `aplicarFiltrosGeneralesADatos()`.
2. Recalcula TODOS los KPIs y agregaciones desde los registros filtrados (`recalcularYRenderizar()`).
3. Re-renderiza todos los gráficos con los datos recalculados.

Esto permite interactividad instantánea sin latencia de red.

### 4.4 Flujo de Rendimiento por Día

```
[Frontend] cargarRendimientoPorDia()
    │
    ▼
[Backend] obtenerRendimientoPorDia(fechaFiltro)
    │  Filtra solo la fecha específica
    │  Calcula por analista:
    │    • Solicitudes por franja horaria
    │    • Ritmo efectivo (solicitudes/hora activa)
    │    • Producción real (total/horas_transcurridas)
    │
    └── return [{nombre, total, ..., detalleHoras}]
         │
         ▼
[Frontend] renderTablaAnalistasDia(pa)
    └── DataTable con detalle horario modal
```

### 4.5 Flujo de Seguimiento de Analistas

```
[Frontend] cargarAsesoresActivosPrimerResultado()
    │
    ▼
[Backend] admin_obtenerAsesoresActivosPrimerResultado(fechaFiltro)
    │  Lee hoja "Usuarios" para lista de asesores
    │  Cruza con Historico_Gestiones y Reestudios
    │  Calcula por analista:
    │    • Primer y último resultado del día
    │    • Solicitudes gestionadas y pendientes
    │    • Promedios de tiempo
    │
    └── return { esHoy, fecha, datos: [...] }
```

### 4.6 Flujo de Drill-Down KPI

Al hacer click en cualquier tarjeta KPI o card de tipo:

```
[Frontend] drilldownKPI(tipo)
    │  Filtra _ultimosTiemposFiltrados por criterio
    │  (top 100 más lentas, por estado, por tipo, etc.)
    │
    └── SweetAlert2 modal con tabla de detalle
```

### 4.7 Flujo de Biometrías (Biometria.js)

El ciclo completo de gestión de biometrías vive en `Biometria.js` y corre en 6 etapas encadenadas por triggers (ver [5.1](#51-triggers-de-biometría)):

**1. Captura — cada 10 min**
`consultarBiometriasPeriodicaAPI()` → `_capturarNuevasBiometrias()` (Biometria.js:521)
Consulta SAI (últimos 3 días), filtra candidatos con `studyStatus = APROBADO_PENDIENTE_BIOMETRIA`, `resultCode` 500/503, `mainResultCode = 2`, excluyendo UAR y tipo "AC". Guarda en la hoja `pendiente_biometria` evitando duplicados. Cada fila arranca con `fase_seguimiento_biometria` (columna 76) vacía.

**2. Primer contacto (WhatsApp) — cada hora**
`cicloPrimerContactoBiometria()` → `_enviarPrimerContactoBiometria()` (Biometria.js:537 / 704)
Revisa solo los pendientes con fase `""`. Para cada uno:
- Reconsulta SAI individualmente.
- Si ya no está pendiente → fase `RESUELTA` (se cierra sin llamar).
- Si sigue pendiente y ya pasaron ≥4h desde `fecha_resultado` (para no duplicar el WA que radicación ya envió al aplazar por biometría) → envía WhatsApp vía Infobip y marca fase `WA_ENVIADO`.
- Si aún no cumple las 4h → no hace nada, espera la próxima corrida horaria.

Esto desacopla el envío del WA de los cortes fijos de las 8am/12pm: el mensaje sale la misma noche en cuanto se cumple la ventana de 4h, sin depender de caer justo en un corte.

**3. Escalación a la cola — 8am y 12pm**
`cicloBiometriaPendiente()` → `_procesarCortePendientes()` (Biometria.js:546 / 793)
Revisa solo los pendientes en fase `WA_ENVIADO` (segundo contacto). Para cada uno:
- Reconsulta SAI.
- Si ya no está pendiente → `RESUELTA`.
- Si sigue pendiente → `procesarYGuardarLote()` lo escribe en la cola principal de solicitudes (hoja `solicitud`) y marca `ESCALADA`.

Como el WA ya salió la noche/tarde anterior gracias al paso 2, la mayoría de los casos llegan a este corte ya en `WA_ENVIADO` y se escalan de inmediato a las 8am.

**4. Asignación al analista**
`autoAsignarBiometria()` (Biometria.js:225) — el analista con cupo disponible toma casos de la cola (`APROBADO_PENDIENTE_BIOMETRIA`, sin asignar); se mueven a `Historico_Gestiones` (tipo `desaplazamiento`) y se borran de la cola.

**5. Gestión y cierre**
`guardarGestionBiometria()` (Biometria.js:449) — el analista registra `APROBADO`/`APLAZADO`/`RECHAZADO`; se calculan tiempos SLA (cola = 0, porque desaplazamiento no tiene fase de cola).

**6. Verificación diaria de resultado final — 16:00-17:00**
`verificarAprobacionDesaplazamientos()` — revisa contra SAI los casos de los últimos 3 días sin estado final y los actualiza si SAI ya resolvió.

> ⚠️ `Biometria.js` es la fuente de verdad operativa de este flujo. Las funciones de solo-lectura descritas en la sección [7.4](#74-clasificación-de-tipos-de-solicitud) (`obtenerDatosBiometria()`, `obtenerColaAsignacion()`, `buscarBiometriaSolicitud()` en `Código.js`) leen los resultados que este ciclo escribe, pero no lo reemplazan.

---

## 5. ⚙️ Automatizaciones y Procesos en Segundo Plano

El **dashboard de métricas** (`Código.js` / `MetricasPanel.html`) no dispara triggers propios: calcula todo bajo demanda cada vez que el usuario:

- Abre la aplicación (carga automática: hoy)
- Hace click en "Sincronizar Datos"
- Cambia el rango de fechas
- Navega a la pestaña de Rendimiento por día

Pero las hojas de cálculo que ese dashboard lee sí se alimentan mediante triggers de tiempo, definidos en otros archivos del proyecto (`BigQuerySync.js`, `ConsultaSAIRechazados.js`, `Biometria.js`).

### 5.1 Triggers de Biometría

| Trigger | Función | Frecuencia | Rol en el flujo ([4.7](#47-flujo-de-biometrías-biometriajs)) |
|---------|---------|------------|------|
| Captura SAI | `consultarBiometriasPeriodicaAPI()` | Cada 10 min | Paso 1 — detecta nuevas biometrías pendientes |
| Primer contacto WA | `cicloPrimerContactoBiometria()` | Cada hora *(⚠️ pendiente de crear en la UI de Triggers de Apps Script tras el próximo `clasp push`)* | Paso 2 — envía WhatsApp a las ≥4h del resultado |
| Corte de escalación | `cicloBiometriaPendiente()` | 8:00am y 12:00m | Paso 3 — escala a la cola de analista si sigue sin resolver |
| Verificación final | `verificarAprobacionDesaplazamientos()` | 16:00-17:00 | Paso 6 — cierra casos que SAI ya resolvió |

---

## 6. 🔔 Sistema de Alertas y Notificaciones

### Notificaciones en Pantalla (UI)

| Tipo | Mecanismo | Cuándo |
|------|-----------|--------|
| **Semáforo de Backlog** | Tabla con colores 🟢🟡🔴 + ordenamiento por urgencia | Siempre visible en tab Resumen |
| **Errores de carga** | SweetAlert2 modal con `icon:'error'` | Fallo en `google.script.run` |
| **Validación de fechas** | SweetAlert2 modal con `icon:'warning'` | Fechas incompletas o inválidas |
| **Sin resultado (analista)** | Badge rojo inline | Analista activo sin gestionar en el día actual |
| **Fuera de SLA** | Fila con clase `table-danger` | Analista con solicitudes >2h |
| **Puntos rojos en tendencia SLA** | Chart.js pointBackgroundColor condicional | Día con cumplimiento <80% |

### Correos Automáticos (Agente)

El motor `agente_triggerOperacion()` (dispara cada 30 min vía trigger instalable) envía los
siguientes correos según `DEFAULT_AGENT_CONFIG.notificaciones`, cada uno con su propio interruptor:

| Correo | Destinatario | Cuándo | Función |
|--------|-------------|--------|---------|
| Inicio de Operación | Coordinadores (`_obtenerDestinatarios`) | Una vez, a `horaInicio` | `agente_enviarInicioOperacion` |
| Chequeo de Conexión | Coordinadores | `horaInicio` + offset configurable | `agente_enviarChequeoConexion` |
| Alertas Críticas | Coordinadores | Dentro de ventana, frecuencia propia | `agente_enviarAlertasCriticas` |
| Foto del Momento | Coordinadores | Dentro de ventana, frecuencia propia (incluye detalle por analista / Corte de Gestión) | `agente_enviarSnapshotActual` |
| Resumen Diario + Biometría | Coordinadores | Una vez, a `horaFin` | `agente_enviarResumenDiario`, `agente_enviarReporteBiometria` |
| **Informe Individual Semanal** | **Cada analista, uno por uno** (solo quien tuvo gestiones en la semana) | Una vez por semana, el día ISO de `informeIndividualDiaISO` (viernes por defecto) a `horaFin` | `agente_enviarInformeIndividualAnalistas` |

El Informe Individual Semanal es distinto en tono al resto: no usa semáforo rojo/amarillo/verde ni
compara contra otros analistas, solo contra la propia semana anterior del mismo analista (ver
`_agente_calcularRendimientoSemanal`). Arranca desactivado (`enviarInformeIndividual: false`); se
prueba con `agente_enviarInformeIndividualManual(correo)` antes de activarlo para todos.

---

## 7. 🛠️ Guía de Mantenimiento y Configuración

### 7.1 Variables de Configuración

Las siguientes constantes en `Código.js` deben ajustarse según el entorno:

```javascript
// IDs de hojas de cálculo (Google Sheets)
const TARGET_SOLICITUDES_SS_ID = "1x9groW5-I7Xg5ULh7DXfa2XGmS_RMdfqfW1iDWB8bJ0";
const ID_HOJA_REESTUDIOS = "1slgykTgjoAtCd6KmlG7Lqiuw-nM1hSguQbi0XqeLu7U";

// Nombres de pestañas
const SHEET_NAME_SOLICITUDES = "Historico_Gestiones";
const NOMBRE_PESTANA_REESTUDIOS = "ORIGEN";

// Parámetros operativos
const TIMEZONE = "America/Bogota";
const HORA_INICIO_OPERACION = "08:00";
const HORA_FIN_TURNO = "17:00";
```

**Pestañas requeridas en la hoja principal:**

| Pestaña | Propósito | Columnas Clave |
|---------|-----------|----------------|
| `Historico_Gestiones` | Registro histórico de solicitudes gestionadas | Col 0: ID, Col 1: Póliza, Col 16: Estado, Col 26: Fecha Asignación, Col 28: Fecha Fin, Col 29: Tiempo Resolución, Col 30: Nombre Analista, Col 33: Fecha Gestión, Col 34: Tiempo Gestión, Col 37: Fecha Radicación |
| `solicitud` | Solicitudes activas (backlog) | Col 0: ID, Col 1: Póliza, Col 26: Fecha Asignación, Col 27: Correo Analista, Col 28: Fecha Fin, Col 30: Nombre Analista |
| `score` | Diccionario póliza→inmobiliaria/segmento | Cols: poliza, inmobiliaria, segmentación final |
| `Usuarios` | Asesores registrados | Col 1: Nombre, Col 2: Correo, Col 4: Especialidad, Col 5: Estado |

**Pestañas en hoja de Reestudios:**

| Pestaña | Propósito | Columnas Clave |
|---------|-----------|----------------|
| `ORIGEN` | Solicitudes de reestudio y UAR | Col 0: Fecha Radicación, Col 1: ID, Col 3: Origen, Col 4: Tipo Proceso, Col 6: Correo Asignado, Col 7: Nombre Analista, Col 8: Fecha Asignación, Col 9: Fecha Fin, Col 10: Estado, Col 14: Tiempo Total, Col 15: Tiempo Gestión, Col 16: Póliza |

### 7.2 Lógica de Clasificación de Sucursales

```javascript
// Rango de pólizas → Sucursal
0            → "Operador Inmobiliario"
1-9999       → "Bogotá"
10000-10999  → "Cali"
11000-11999  → "Bucaramanga"
12000-12999  → "Eje Cafetero"
13000-13999  → "Medellín"
14000-14999  → "Barranquilla"
15000-15999  → "Cartagena"
16000-16999  → "Eje Cafetero"
```

### 7.3 Umbrales de SLA

| Indicador | Meta | Criterio |
|-----------|------|----------|
| **Tiempo General (Resolución)** | ≤ 2 horas | Radicación → Cierre |
| **Semáforo Backlog** | 🟢 <15min · 🟡 15-30min · 🔴 >30min | Tiempo desde asignación |
| **Tendencia SLA alerta** | <80% cumplimiento diario | Punto rojo en gráfico |
| **Tasa negación alta** | >20% por sucursal | Color rojo en gráfico |

### 7.4 Clasificación de Tipos de Solicitud

| Tipo | Lógica de Identificación |
|------|--------------------------|
| **Digital** | Tipo por defecto (ni biometría ni inducción) |
| **Biometría** | Estado contiene "BIOMETRIA" |
| **Inducción** | Clase = "INDUCCION" |
| **UAR** | Reestudio con origen="CORREO" y tipo proceso="ADICIONAL" o "NUEVA" |
| **Reestudio** | Solicitudes de la hoja ORIGEN que no son UAR |

### 7.5 Instrucciones de Despliegue

**Prerrequisitos:**
- Node.js (para CLASP CLI)
- `@google/clasp` instalado globalmente: `npm install -g @google/clasp`
- Autenticación CLASP: `clasp login`

**Paso a paso:**

1. **Clonar el repositorio** en la máquina local.

2. **Verificar `.clasp.json`** — debe apuntar al Script ID correcto del proyecto GAS destino.

3. **Push del código:**
   ```bash
   clasp push
   ```

4. **Crear despliegue web:**
   - Abrir el editor de Apps Script en el navegador.
   - Ir a *Implementar > Nueva implementación*.
   - Seleccionar tipo: "Aplicación web".
   - Ejecutar como: "Usuario que implementa la app".
   - Acceso: "Cualquiera dentro de [dominio]".
   - Hacer click en "Implementar".

5. **Permisos de hojas:**
   - El usuario desplegador debe tener acceso de lectura a ambas hojas de cálculo (Solicitudes y Reestudios).

6. **Validar:**
   - Abrir la URL generada.
   - Verificar que carga datos de hoy sin error.

### 7.6 Dependencias Externas (CDN)

| Librería | Versión | Propósito |
|----------|---------|-----------|
| Bootstrap CSS | 5.3.0 | Grid, utilidades, componentes |
| Bootstrap Icons | 1.10.5 | Iconografía |
| Manrope (Google Fonts) | Weights 300-800 | Tipografía del sistema |
| DataTables | 1.13.5 | Tablas con paginación/búsqueda |
| jQuery | 3.7.0 | Requerido por DataTables |
| Chart.js | 4.x | Gráficos (línea, barra, doughnut, scatter) |
| chartjs-plugin-datalabels | 2.x | Etiquetas sobre gráficos |
| SweetAlert2 | 11.x | Modales informativos y de error |
| Particles.js | 2.0.0 | Efecto visual de fondo |

### 7.7 Consideraciones de Rendimiento

- **Límite de tiempo GAS:** Las funciones backend tienen un máximo de 6 minutos de ejecución. Para rangos de fecha extensos con grandes volúmenes de datos, esto puede ser un cuello de botella.
- **Lectura masiva:** Se lee toda la hoja con `getDataRange()` en cada consulta. No hay caché persistente entre llamadas.
- **Recálculo frontend:** Los filtros operan sobre el array `tiemposDetalle[]` que ya reside en memoria del navegador, por lo que la experiencia de filtrado es instantánea.
- **Destrucción de charts:** Cada re-renderizado destruye (`chart.destroy()`) y recrea los gráficos para evitar memory leaks de Chart.js.

---

## 8. 📐 Diagrama de Componentes Frontend

```
MetricasPanel.html
├── Sidebar (navegación lateral colapsable)
│   └── Tabs: Resumen | Producción | Tiempos | Analistas
│
├── Filtros Globales
│   ├── Rango de fechas (desde/hasta + atajos rápidos)
│   ├── Segmento (select dinámico)
│   ├── Póliza, Sucursal, Tipo, Estado, Analista
│   └── Botón "Limpiar Filtros"
│
├── Tab Resumen
│   ├── KPI Cards (5): Total, T.Cola, T.Gestión, T.General, Tasa Aprobación
│   ├── Tipo Cards (6): General, Digital, UAR, Reestudio, Biometría, Inducción
│   ├── Gráficos: Producción Diaria, Estados, Analistas, SLA
│   ├── Segmentación: Volumen Inmobiliaria, Comparativa Tiempos
│   ├── Sucursales: Volumen, Comparativa Tiempos
│   ├── Indicadores: Negación, Tendencia SLA, Backlog
│   └── Tabla Semáforo Backlog
│
├── Tab Producción
│   ├── Por Sucursal (stacked), Por Tipo (stacked)
│   ├── Mensual por Tipo, Mensual por Sucursal
│   ├── Heatmap Hora, Tiempos por Tipo
│   └── (Gráficos de evolución temporal)
│
├── Tab Tiempos
│   ├── Tiempos de Respuesta (T.Gestión + T.General diarios, con filtros)
│   ├── Búsqueda por Solicitud (ID o fecha)
│   └── Gráfico de Dispersión (Rapidez vs Productividad)
│
└── Tab Analistas
    ├── Rendimiento Individual (DataTable con métricas por analista)
    │   ├── Modo Día (con navegación de fecha)
    │   └── Modo Rango (datos del período completo)
    ├── Seguimiento (primer/último resultado, pendientes, estado)
    └── Detalle modal por analista (SweetAlert2)
```

---

> 📅 Documento generado: Junio 2026  
> 🔧 Versión del proyecto: Activa en producción (Google Apps Script Web App)
