# Flujo completo de biometrías — Documentación para el equipo

---

## ¿Qué es una biometría pendiente?

Una solicitud de arrendamiento que fue aprobada por SAI pero requiere que el inquilino (o un codeudor) complete una validación biométrica antes de continuar. SAI la reporta con `studyStatus = "APROBADO_PENDIENTE_BIOMETRIA"` y `resultCode = 500 o 503`.

---

## Hojas involucradas

| Hoja | Spreadsheet | Función |
|------|-------------|---------|
| `pendiente_biometria` | `ID_SHEET_BIOMETRIA_PENDIENTE` | Registro maestro de todo el ciclo de vida. Cada biometría tiene una fila aquí desde que se detecta hasta que se cierra. |
| `solicitud` | `TARGET_SOLICITUDES_SS_ID` | Cola de asignación. Las biometrías entran aquí temporalmente cuando se escalan para que un analista las tome. |
| `Historico_Gestiones` | `TARGET_SOLICITUDES_SS_ID` | Destino final operativo. Cuando un analista toma el caso, se mueve aquí para gestión. |

---

## El flujo paso a paso

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. CAPTURA (cada 10 min)                                           │
│  consultarBiometriasPeriodicaAPI()                                  │
│                                                                     │
│  SAI API → detecta APROBADO_PENDIENTE_BIOMETRIA con rc 500/503     │
│  → Inserta en pendiente_biometria con fase = "" (vacía)            │
│  → fecha_consulta_sai = ahora                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. PRIMER CONTACTO (cada hora)                                     │
│  cicloPrimerContactoBiometria()                                     │
│                                                                     │
│  Para cada fila con fase vacía:                                     │
│  - Si pasaron ≥4h desde fechaResultado                             │
│  - Reconsulta SAI → ¿sigue pendiente?                              │
│    → NO: marca fase = "RESUELTA" (se resolvió sola, sin WA)       │
│    → SÍ: envía WhatsApp al cliente                                 │
│           marca fase = "WA_ENVIADO"                                 │
│           fecha_envio_brodcast = ahora                              │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. ESCALACIÓN (8am y 12pm)                                         │
│  cicloBiometriaPendiente()                                          │
│                                                                     │
│  Hace 3 cosas en orden:                                             │
│                                                                     │
│  3a. limpiarBiometriasResueltas()                                   │
│      Revisa las que YA están en cola "solicitud".                   │
│      Si SAI ya no dice pendiente → elimina de cola                 │
│      → marca fase = "RESUELTA_EN_COLA" en pendiente_biometria      │
│      Si lastMovementDate cambió → actualiza fechaResultado          │
│                                                                     │
│  3b. _archivarColaBiometriaVencida()                                │
│      Solicitudes en cola >12h sin ser asignadas → elimina de cola  │
│      → marca fase = "ARCHIVADA" en pendiente_biometria             │
│                                                                     │
│  3c. _procesarCortePendientes()                                     │
│      Toma filas de pendiente_biometria con fase WA_ENVIADO          │
│      Reconsulta SAI individualmente:                                │
│      → Si ya no está pendiente: fase = "RESUELTA" (no se escala)   │
│      → Si sigue pendiente: inserta en cola "solicitud"             │
│        marca fase = "ESCALADA"                                      │
│        estadoGeneral = "APROBADO_PENDIENTE_BIOMETRIA"              │
│        fechaResultado = lastMovementDate de SAI                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. LIMPIEZA CONTINUA (cada hora)                                   │
│  cicloLimpiezaBiometriaEscalada()                                   │
│                                                                     │
│  Revisa las biometrías en cola "solicitud" contra SAI.              │
│  Si ya no está pendiente → elimina de cola                         │
│  → marca fase = "RESUELTA_EN_COLA" en pendiente_biometria          │
│  Si lastMovementDate cambió → actualiza fechaResultado              │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. ASIGNACIÓN                                                      │
│  (dos vías: asignarBiometriaDesdeBoton o RequestLeadUnificado)     │
│                                                                     │
│  Analista pide caso → toma de cola "solicitud"                     │
│  → Mueve a Historico_Gestiones                                      │
│  → Elimina de cola "solicitud"                                      │
│  → marca fase = "ASIGNADA" en pendiente_biometria                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Fases posibles en `fase_seguimiento_biometria` (col 76)

| Fase | Significado | Es terminal |
|------|-------------|:-----------:|
| `""` (vacía) | Recién capturada, esperando ventana de 4h | No |
| `WA_ENVIADO` | Ya recibió WhatsApp, esperando corte 8am/12pm | No |
| `ESCALADA` | En cola "solicitud", esperando analista | No |
| `RESUELTA` | SAI dejó de reportar pendiente ANTES de escalar | ✅ |
| `ASIGNADA` | Un analista la tomó de la cola | ✅ |
| `RESUELTA_EN_COLA` | SAI la resolvió mientras estaba en cola (sin analista) | ✅ |
| `ARCHIVADA` | Se venció >12h en cola sin ser asignada | ✅ |

---

## Columnas clave de `pendiente_biometria` para métricas

| Col | Índice | Nombre | Cuándo se llena |
|-----|--------|--------|-----------------|
| 1 | 0 | solicitud (consecutivo) | Al capturar |
| 17 | 16 | estadoGeneral | Al capturar (`APROBADO_PENDIENTE_BIOMETRIA`) |
| 18 | 17 | fechaRadicacion | Al capturar |
| 19 | 18 | fechaResultado | Al capturar + se actualiza cada hora para escaladas |
| 60 | 59 | fecha_consulta_sai | Al capturar |
| 61 | 60 | fecha_envio_brodcast | Al enviar WhatsApp |
| 62 | 61 | estado_brodcast | `"ENVIADO"` al enviar WhatsApp |
| 63 | 62 | nuevo_estado_sai | Al reconsultar SAI en escalación |
| 76 | 75 | fase_seguimiento_biometria | En cada transición de fase |
| 77 | 76 | fecha_actualizacion_fase | En cada transición de fase |

---

## Fecha de anclaje por métrica

| Métrica | Filtrar por |
|---------|-------------|
| Consultadas SAI | `fecha_consulta_sai` |
| WA Enviados | `fecha_envio_brodcast` |
| Resueltas (todas) | `fecha_actualizacion_fase` |
| Escaladas | `fecha_actualizacion_fase` |
| Asignadas | `fecha_actualizacion_fase` |
| Archivadas | `fecha_actualizacion_fase` |
| Resueltas en cola | `fecha_actualizacion_fase` |
| En vivo (cola, esperando corte, sin iniciar) | Sin filtro de fecha |

---

## Cascadas que siempre cierran

### Cascada de Consultadas (anclada a `fecha_consulta_sai`)
```
Consultadas = Sin Iniciar + Resueltas sin WA (cohorte) + Ya Enviadas (cohorte)
```
> Pregunta: "De lo que ENTRÓ en este período, ¿en qué estado está ahora?"

### Desglose de Escaladas (anclado a `fecha_actualizacion_fase`)
```
Escaladas = Aún en Cola + Asignadas + Resueltas en Cola + Archivadas
```
> Pregunta: "De lo que PASÓ POR LA COLA en este período, ¿qué pasó con cada una?"

### ¿Por qué las filas de "Actividad del Período" no suman entre sí?
Cada tarjeta usa su propia fecha real. Una solicitud detectada ayer que se escaló hoy
aparece en "Escaladas" de hoy pero NO en "Consultadas" de hoy.
Esto es intencional: cada evento queda en el día real en que ocurrió.

---

## Reglas de negocio importantes

1. **Solo entran** a `pendiente_biometria` solicitudes con `resultCode` 500 o 503 y `mainResultCode` 2. Cualquier otro resultCode con estado APROBADO_PENDIENTE_BIOMETRIA se descarta.

2. **No hay duplicados**: antes de insertar se verifica que no exista ni en `pendiente_biometria` ni en la cola `"solicitud"`.

3. **La cola "solicitud" es temporal**. Las biometrías entran y salen. El registro permanente es `pendiente_biometria`.

4. **fechaResultado** en la cola se alimenta de `lastMovementDate` de SAI (no `lastResultDate`). Se actualiza cada hora por `limpiarBiometriasResueltas` y `cicloLimpiezaBiometriaEscalada`.

5. **Orden de asignación** en la cola: configurable por admin (`RECIENTE_PRIMERO` o `ANTIGUO_PRIMERO`), basado en fechaResultado.

6. **Ventana de archivado**: ~12h. Si una biometría está en cola más de 12h sin ser asignada, se archiva en el siguiente corte de 8am o 12pm.

---

> 📅 Documento creado: Julio 2026
> 🔧 Referencia: `Biometria.js` (proyecto Apps Script) + `Código.js` (métricas de solo lectura)
