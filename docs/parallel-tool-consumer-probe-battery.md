# Batería de pruebas de conectividad por consumidor: Precision Lab

**Versión:** 1.1.0 (autónoma)
**Fecha:** 2026-10-31
**Aplica a:** cualquier LLM o agente que deba leer el estado de Precision Lab o enviar comandos a Bridge sin credenciales de GitHub.
**Relacionado:** `docs/parallel-tool-roadmap.md` (revisión de mecanismos LLM) y `docs/parallel-tool-implementation-master.md` (protocolo de handoff).

---

## 0. Cómo ejecutar esta batería (léelo primero)

- Ejecuta la batería completa de inmediato, con lo que tengas disponible. No pidas parámetros, claves ni confirmaciones antes de empezar.
- Si falta una precondición, marca la prueba `BLOCKED` con el motivo (`missing:NOMBRE`, `network`, `not_deployed`, etc.) y continúa con la siguiente.
- Detente solo ante un `CRITICAL` (sección 5).
- No rechaces el inicio por falta de datos. Falta de datos es un resultado `BLOCKED`, no un motivo para no ejecutar.
- Entrega al final un único bloque JSON con una entrada por prueba (sección 6) y el conteo por estado.

---

## 1. Pregunta que responde

Sin credenciales de GitHub, ¿puede este consumidor leer el estado de Lite/Plus, consultar su contenido y enviar un cambio que Bridge valide y que el Runner ejecute en una rama `agent/{command_id}`?

| Capacidad | Ruta sin credenciales de GitHub | Pruebas |
|---|---|---|
| Leer estado del repositorio | Observer `GET /v1/status`; Bridge `GET /api/v1/context/status` | B1, B6 |
| Leer gate y plan | Observer `GET /v1/gates/{gate}/plan`; Bridge `GET /api/v1/context/gates/{gate}/plan` | B2, B7 |
| Leer archivos de GitHub | Bridge `GET /api/v1/context/files/{repo}/{path}` | B8 (PENDING_M3) |
| Enviar un cambio | Bridge `POST /api/v1/commands` con `repo.patch` | C, D |
| Consultar GitHub con conector propio | Conector del propio consumidor | B9, E (excepción; no cuenta como ruta sin credenciales) |

---

## 2. Reglas de ejecución (obligatorias)

1. **Credenciales.** Nunca imprimas, copies, resumas ni hasheés una clave. Usa solo las que estén en tu entorno o configuración.
2. **No simules.** Si no observaste un resultado, no lo registres como `PASS`. Si no puedes ejecutar una prueba, usa `BLOCKED` o `NA` con su motivo.
3. **Ramas canónicas.** Nunca escribas en la rama canónica (la que declara el README del repositorio). Los cambios solo van a `agent/{command_id}`.
4. **Idempotencia.** Usa una clave por prueba con formato `probe-{CONSUMER_ID}-{yyyymmdd}-{NNN}`. La única repetición permitida es el replay de D2.
5. **5xx o timeout en un POST.** No repitas el POST. Consulta `GET /api/v1/commands/lookup` con la misma clave.
6. **Registro.** Guarda solo SHA, IDs, códigos HTTP y resúmenes de hasta 200 caracteres. Sustituye cualquier valor sensible por `[REDACTED]`.
7. **Escrituras.** D1 a D3 crean registros que no ejecutan cambios; se ejecutan automáticamente cuando hay clave de envío. D4 solo se ejecuta si el servidor confirma `execution_enabled: true`; si no, queda `BLOCKED`.

---

## 3. Resolución de parámetros (automática)

Para cada parámetro, usa el primer valor disponible en este orden: (1) variable de entorno con el mismo nombre; (2) configuración del servidor MCP o conector de Precision Lab en tu sesión, sin imprimir su valor; (3) descubrimiento por API, donde se indica; (4) valor por defecto. Si ninguno existe, la prueba que lo necesita queda `BLOCKED` con `missing:NOMBRE`.

| Parámetro | Fuente | Por defecto |
|---|---|---|
| `OBSERVER_BASE_URL` | entorno o configuración | ninguno |
| `BRIDGE_BASE_URL` | entorno o configuración | ninguno |
| `OBSERVER_KEY` | entorno; se envía como `X-API-Key` | ninguno |
| `BRIDGE_KEY_READ` | entorno; `X-Bridge-Key` con `context:read` | ninguno |
| `BRIDGE_KEY_SUBMIT` | entorno; `X-Bridge-Key` con `context:read`, `command:read`, `command:submit` | ninguno |
| `BRIDGE_KEY_NOSCOPE` | entorno; `X-Bridge-Key` solo con `context:read` | ninguno |
| `CONSUMER_ID` | id asignado en el registro del roadmap | `unregistered-{yyyymmdd}` |
| `PLAN`, `HOST` | autodeclarados por el consumidor | `declared_by_consumer` |
| `TEST_REPO` | fijo | `lite` |
| `GATE` | primer gate de la lista `gates` que devuelva B1 o B5 (descubrimiento) | ninguno: B2 y B7 quedan `BLOCKED` |
| `KNOWN_RUN` | historial de Lite | `41005884405` |
| `KNOWN_RECEIPT` | historial de Bridge | `94c102a5-5242-48ba-bdb7-4754a57513db` |

Observer usa `X-API-Key`; Bridge usa `X-Bridge-Key`. Si el OpenAPI publicado de Bridge difiere de estas rutas, prevalece el OpenAPI y la diferencia se registra como `FAIL` de contrato.

---

## 4. Pruebas

Cada prueba indica tipo, petición, resultado esperado y precondiciones.

### A. Canal y herramientas (sin efectos)

**A1. Alcance HTTP a Observer.** Tipo: lectura. Precondición: `OBSERVER_BASE_URL`.
Petición: `GET {OBSERVER_BASE_URL}/v1/status` sin cabecera.
Esperado: `401`. Sin conexión de red, `BLOCKED` con motivo `network`.

**A2. Alcance HTTP a Bridge.** Tipo: lectura. Precondición: `BRIDGE_BASE_URL`.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/capabilities` sin cabecera.
Esperado: `401`. Sin conexión de red, `BLOCKED` con motivo `network`.

**A3. Servidor MCP hacia Precision Lab.** Tipo: lectura.
Petición: lista tus servidores MCP y busca uno que apunte a Observer o Bridge. No lo invoques.
Esperado: `PASS` si existe y lista sus herramientas; `NA` si no existe.

**A4. Adaptador de función hacia Precision Lab.** Tipo: lectura.
Petición: lista las herramientas de tu host que correspondan a Observer o Bridge. No las invoques.
Esperado: `PASS` si aparecen; `NA` si tu host no expone este tipo de herramientas.

**A5. Shell y red.** Tipo: lectura. Precondición: shell y `BRIDGE_BASE_URL`.
Petición: `curl -sS -o /dev/null -w "%{http_code}" {BRIDGE_BASE_URL}/api/v1/capabilities`.
Esperado: `401` o error de red; registra cuál. `NA` si no tienes shell.

**A6. Inventario de conectores propios.** Tipo: auditoría.
Petición: enumera los conectores o servidores MCP conectados a tu sesión y declara si cada uno puede escribir. No invoques escrituras ni leas valores de variables o secretos.
Resultado: `AUDIT` con nombres y capacidad declarada.

**A7. Canales entrantes.** Tipo: auditoría.
Petición: declara si puedes recibir peticiones entrantes (webhooks, A2A) o tareas programadas.
Resultado: `AUDIT`.

### B. Lectura sin credenciales de GitHub

**B1. Estado vía Observer.** Tipo: lectura. Precondición: `OBSERVER_BASE_URL`, `OBSERVER_KEY`.
Petición: `GET {OBSERVER_BASE_URL}/v1/status` con `X-API-Key`.
Esperado: `200` con rama canónica y SHA por repositorio, y la lista `gates` si la respuesta la incluye. Guarda el SHA de `TEST_REPO` para D1 y C8.
Si responde `5xx` con mensaje de token de lectura ausente: `BLOCKED` con motivo `upstream_token`.

**B2. Plan de gate vía Observer.** Tipo: lectura. Precondición: `GATE`.
Petición: `GET {OBSERVER_BASE_URL}/v1/gates/{GATE}/plan?repo={TEST_REPO}` con `X-API-Key`.
Esperado: `200` con decisión `RUN`, `WAIT`, `REUSE`, `RECONCILE` o `REFRESH`. Si la decisión no es `RUN`, `next_action` debe ser nulo.

**B3. Run histórico vía Observer.** Tipo: lectura.
Petición: `GET {OBSERVER_BASE_URL}/v1/runs/{KNOWN_RUN}?repo=lite` con `X-API-Key`.
Esperado: `200` con el estado del run. Mismo tratamiento de `BLOCKED` que B1.

**B4. Recibo de Bridge vía Observer.** Tipo: lectura.
Petición: `GET {OBSERVER_BASE_URL}/v1/bridge/runs/{KNOWN_RECEIPT}` con `X-API-Key`.
Esperado: `200` con `read_only: true` y el mismo UUID.

**B5. Capacidades de Bridge.** Tipo: lectura. Precondición: `BRIDGE_BASE_URL`, `BRIDGE_KEY_READ`.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/capabilities` con `X-Bridge-Key`.
Esperado: `200` con operaciones, scopes y, si se publica, `execution_enabled`. `404` o `501` es `BLOCKED` con motivo `not_deployed`.

**B6. Estado vía Bridge.** Tipo: lectura. Precondición: `BRIDGE_KEY_READ`.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/context/status` con `X-Bridge-Key`.
Esperado: `200` con el mismo SHA que B1. Si el SHA difiere: `FAIL` (desincronización).

**B7. Plan vía Bridge.** Tipo: lectura. Precondición: `GATE`, `BRIDGE_KEY_READ`.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/context/gates/{GATE}/plan` con `X-Bridge-Key`.
Esperado: `200` con la misma decisión que B2. Si difiere: `FAIL`.

**B8. Archivo de GitHub vía Bridge.** Tipo: lectura. Precondición: `BRIDGE_KEY_READ`.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/context/files/{TEST_REPO}/README.md` con `X-Bridge-Key`.
Esperado: `PENDING_M3` si responde `404` o `501`. Si responde `200`: `PASS` solo si el contenido corresponde al SHA de B1.

**B9. Consulta con conector propio de GitHub.** Tipo: lectura.
Petición: si tienes un conector de GitHub, lee solo los metadatos de `TEST_REPO` (rama predeterminada y SHA).
Resultado: `EXCEPCION_LECTURA`. No cuenta como ruta sin credenciales. Si no coincide con B1: `FAIL`. `NA` si no tienes conector.

### C. Validación del contrato de comandos (se rechaza antes de persistir)

Precondición general: `BRIDGE_KEY_SUBMIT` (C1 usa `BRIDGE_KEY_NOSCOPE`). Si aceptan una petición inválida, se clasifica como indica cada fila.

**C1. Sin alcance de envío.** Tipo: validación. Petición: `POST {BRIDGE_BASE_URL}/api/v1/commands` con `BRIDGE_KEY_NOSCOPE` y un cuerpo válido.
Esperado: `403`. Si responde `202`: `CRITICAL` (escalada de alcance).

**C2. Sin cabecera de idempotencia.** Tipo: validación. Petición: `POST` sin `Idempotency-Key`, con `BRIDGE_KEY_SUBMIT`.
Esperado: `400`.

**C3. Cabecera distinta del cuerpo.** Tipo: validación. Petición: `Idempotency-Key` diferente de `idempotency_key` en el cuerpo.
Esperado: `400` o `422`. Registra el código y la sección del OpenAPI que lo define.

**C4. Ruta fuera del repositorio.** Tipo: validación. Petición: `repo.patch` con una operación sobre `../secret.txt`.
Esperado: `422`.

**C5. SHA obsoleto.** Tipo: validación. Petición: `repo.inspect` con `expected_sha` de 40 ceros.
Esperado: `409`, sin persistir.

**C6. Tipo de comando no permitido.** Tipo: validación. Petición: `command_type` igual a `shell.exec`.
Esperado: `422`.

**C7. Campo de identidad en el cuerpo.** Tipo: validación. Petición: añade `"actor": "admin"` a un cuerpo válido.
Esperado: `422` (esquema estricto). Si responde `202`: `FAIL`, porque la identidad vino del cuerpo y no de la clave. Informa en el reporte, porque se creó un registro.

**C8. Rama canónica como destino.** Tipo: validación. Precondición: rama canónica y SHA de B1.
Petición: `repo.patch` con `expected_branch` igual a la rama canónica.
Esperado: `403`, `409` o `422`, nunca `202`. Si responde `202`: `CRITICAL`.

### D. Escritura de extremo a extremo

Precondición general: `BRIDGE_KEY_SUBMIT`, SHA de B1 y el esquema de payload. El payload de `repo.inspect` debe venir del esquema publicado en `GET /api/v1/capabilities` o en el OpenAPI. Si no hay esquema publicado, D1 a D5 quedan `BLOCKED` con motivo `contract`.

Plantilla de cuerpo para D1 (valores entre corchetes de B1 y de la sección 3):

```json
{
  "schema_version": "1",
  "command_type": "repo.inspect",
  "target_repo": "[TEST_REPO]",
  "expected_branch": "[rama canónica de B1]",
  "expected_sha": "[SHA de B1]",
  "payload": "[según el esquema publicado]",
  "idempotency_key": "probe-[CONSUMER_ID]-[yyyymmdd]-001",
  "correlation_id": "probe-[CONSUMER_ID]-[yyyymmdd]",
  "validation_id": "probe-only"
}
```

**D1. Aceptación.** Tipo: escritura de registro (no cambia el repositorio).
Petición: `POST {BRIDGE_BASE_URL}/api/v1/commands` con `BRIDGE_KEY_SUBMIT`.
Esperado: `202` con `command_id` y `execution_enabled: false`. Guarda el `command_id`.

**D2. Replay exacto.** Tipo: escritura de registro.
Petición: repite D1 idéntico, con la misma clave.
Esperado: `200` con el mismo `command_id`, sin registro nuevo.

**D3. Conflicto de huella y consulta.** Tipo: escritura de registro.
Petición: repite la clave de D1 con un payload distinto. Luego consulta `GET {BRIDGE_BASE_URL}/api/v1/commands/{command_id}` y `GET {BRIDGE_BASE_URL}/api/v1/commands/lookup` con la clave original.
Esperado: `409` en el POST con payload distinto; `200` en la consulta por id con estado `accepted`; el lookup devuelve el mismo `command_id`.

**D4. Cambio en rama de prueba.** Tipo: escritura en `agent/{command_id}`.
Precondición: `execution_enabled: true` en la respuesta de D1 o de B5. Si es `false` o no aparece, `BLOCKED` con motivo `execution_disabled`.
Petición: `repo.patch` que cree `probes/{CONSUMER_ID}.md` con contenido de validación.
Esperado: estado final `completed` o `awaiting_review`, un único commit en `agent/{command_id}`, y la rama canónica con el mismo SHA que en B1.

**D5. Reconciliación.** Tipo: escritura.
Petición: si D4 devuelve `5xx` o timeout, consulta el lookup con la misma clave. No reenvíes el POST.
Esperado: un solo `command_id`, sin duplicados.

### E. Auditoría de escritura fuera de Bridge (no invoca escrituras)

**E1. Capacidad de escritura por conector.** Tipo: auditoría.
Petición: para cada conector de A6 que pueda escribir, declara si puede escribir en `TEST_REPO` o en infraestructura. No invoques la herramienta.
Resultado: `AUDIT` con `sí` o `no` por conector.

**E2. Acceso a variables y secretos.** Tipo: auditoría.
Petición: si algún conector puede leer variables de entorno o secretos, registra solo que la capacidad existe. No leas ningún valor.
Resultado: `AUDIT`.

### F. Higiene

**F1. Búsqueda de secretos en la salida.** Tipo: auditoría.
Petición: revisa tus resultados. Si aparece una clave, un token o un valor de cabecera de autorización, es `CRITICAL`: borra esa salida y repórtalo para rotar la clave.
Resultado: `PASS` si no hay secretos.

**F2. Cierre.** Tipo: auditoría.
Petición: lista las pruebas no ejecutadas y el motivo de cada una.

---

## 5. Clasificación de resultados

| Estado | Significado |
|---|---|
| `PASS` | Lo observado coincide con lo esperado. |
| `FAIL` | Lo observado no coincide y no hay causa externa. |
| `BLOCKED` | Falta una precondición: parámetro (`missing:NOMBRE`), red, token de lectura, flag, despliegue o esquema. Indica cuál. |
| `NA` | El consumidor no tiene el mecanismo. No es un fallo. |
| `PENDING_M3` | Funcionalidad no implementada todavía. |
| `AUDIT` | Inventario o capacidad declarada, sin prueba de escritura. |
| `CRITICAL` | Violación de seguridad: `200` sin clave, `202` sin alcance, `202` sobre rama canónica o un secreto en la salida. Detén la batería y repórtalo en el bloque final. |

---

## 6. Esquema de resultado (una entrada por prueba)

```json
{
  "consumer_id": "claude_2026_10_31",
  "plan": "gratuito",
  "host": "[declarado por el consumidor]",
  "test_id": "B1",
  "mechanism": "Observer HTTP con X-API-Key",
  "route": "consumer -> Observer",
  "type": "lectura",
  "expected": "200 con rama canónica y SHA",
  "http_status": 200,
  "status": "PASS",
  "observed_summary": "Máximo 200 caracteres, sin secretos",
  "timestamp_utc": "2026-10-31T00:00:00Z"
}
```

Al final, incluye un resumen con el conteo por estado y la lista de parámetros que faltaron.

---

## 7. Decisiones que se derivan de los resultados

- **Ruta de lectura asignada:** si B1 o B6 dan `PASS` y el SHA coincide entre ambas.
- **Ruta de envío asignada:** si C1 a C8 dan `PASS` y D1 a D3 dan `PASS`.
- **Ejecución de cambios (D4):** solo cuando el servidor confirma `execution_enabled: true`. Con el flag apagado, el resultado correcto es `BLOCKED`.
- **Consumidor sin credenciales para M6:** si E1 da `no` en todos los conectores de escritura, o si esos conectores se desconectaron durante la prueba y se registró.

---

## 8. Instrucción para el consumidor (pegar esta sección junto al documento)

> Ejecuta esta batería completa de inmediato. No pidas parámetros ni confirmaciones: usa lo que esté en tu entorno o configuración y marca `BLOCKED` lo que falte. No rechaces el inicio por falta de datos. No simules resultados ni los completes sin observarlos. No imprimas claves. Nunca escribas en la rama canónica. Detente solo ante un `CRITICAL`. Al terminar, entrega un único bloque JSON con una entrada por prueba (sección 6) y el resumen de conteos.
