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

**No hay escritura** desde este sistema: es un dashboard de solo lectura.

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
    │       └── Semáforo: 🟢 <45min | 🟡 45-90min | 🔴 >90min
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

---

## 5. ⚙️ Automatizaciones y Procesos en Segundo Plano

Este sistema **no cuenta con triggers ni cron jobs**. Es un dashboard bajo demanda que calcula métricas cada vez que el usuario:

- Abre la aplicación (carga automática: últimos 7 días)
- Hace click en "Sincronizar Datos"
- Cambia el rango de fechas
- Navega a la pestaña de Rendimiento por día

La actualización de las hojas de cálculo fuente (Historico_Gestiones, ORIGEN, solicitud) es responsabilidad de **otros sistemas** que alimentan estos datos.

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

El sistema **no envía correos ni notificaciones push**. Toda la información es visual dentro del dashboard.

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
| **Semáforo Backlog** | 🟢 <45min · 🟡 45-90min · 🔴 >90min | Tiempo desde asignación |
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
   - Verificar que carga datos de los últimos 7 días sin error.

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
