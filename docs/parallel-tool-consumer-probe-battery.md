# Batería de pruebas de conectividad por consumidor: Precision Lab

**Versión:** 1.0.0
**Fecha:** 2026-10-31
**Aplica a:** cualquier LLM o agente que deba leer el estado de Precision Lab o enviar comandos a Bridge sin credenciales de GitHub.
**Relacionado:** `docs/parallel-tool-roadmap.md` (revisión de mecanismos LLM) y `docs/parallel-tool-implementation-master.md` (protocolo de handoff).

---

## 1. Pregunta que responde

Sin credenciales de GitHub, ¿puede este consumidor leer el estado de Lite/Plus, consultar su contenido y enviar un cambio que Bridge valide y que el Runner ejecute en una rama `agent/{command_id}`?

| Capacidad | Ruta sin credenciales de GitHub | Pruebas | Estado esperado hoy |
|---|---|---|---|
| Leer estado del repositorio | Observer `GET /v1/status`; Bridge `GET /api/v1/context/status` | B1, B6 | Depende de que Observer tenga `GITHUB_READ_TOKEN` (no confirmado en staging) |
| Leer gate y plan | Observer `GET /v1/gates/{gate}/plan`; Bridge `GET /api/v1/context/gates/{gate}/plan` | B2, B7 | Igual que la fila anterior |
| Leer archivos de GitHub | Bridge `GET /api/v1/context/files/{repo}/{path}` | B8 | PENDING_M3 |
| Enviar un cambio (commit) | Bridge `POST /api/v1/commands` con `repo.patch` | C, D | Valida y acepta; no ejecuta mientras `BRIDGE_COMMAND_EXECUTION_ENABLED=false` |
| Consultar GitHub con conector propio | Conector del propio consumidor | B9, E | Excepción; no cuenta como ruta sin credenciales |

---

## 2. Reglas de ejecución (obligatorias)

1. **Ninguna credencial en el prompt, la respuesta ni los archivos.** Las claves llegan por la configuración segura del operador. Nunca imprimas, copies, resumas ni hasheés un valor secreto.
2. **Orden de ejecución:** sigue las secciones 4.A a 4.F en orden. Si una herramienta, red o conector no existe en tu entorno, marca `NA`. No simules respuestas ni completes campos que no observaste.
3. **Autorización por tipo de prueba:** las pruebas de lectura, validación y auditoría se ejecutan sin autorización adicional. Las pruebas de escritura (D1 a D3) requieren autorización explícita del operador en la conversación. D4 requiere además `BRIDGE_COMMAND_EXECUTION_ENABLED=true`.
4. **Nunca escribas en ramas canónicas.** La rama canónica es la que declara el README del repositorio. Los cambios solo van a `agent/{command_id}`.
5. **Claves de idempotencia:** usa una clave única por prueba con el formato `probe-{CONSUMER_ID}-{yyyymmdd}-{NNN}`. Repítela solo en el replay D2.
6. **Ante 5xx o timeout en un POST, no repitas el POST.** Consulta `GET /api/v1/commands/lookup` con la misma clave.
7. **Registra solo** SHA, IDs, códigos HTTP y resúmenes de hasta 200 caracteres. Si una respuesta contiene un valor sensible, sustitúyelo por `[REDACTED]`.

---

## 3. Parámetros del operador (fuera del prompt)

| Nombre | Uso | Notas |
|---|---|---|
| `OBSERVER_BASE_URL` | Base de Observer | Solo HTTPS |
| `BRIDGE_BASE_URL` | Base de Bridge | Solo HTTPS |
| `OBSERVER_KEY` | Cabecera `X-API-Key` hacia Observer | Lectura |
| `BRIDGE_KEY_READ` | `X-Bridge-Key` con `context:read` | Lectura de Bridge |
| `BRIDGE_KEY_SUBMIT` | `X-Bridge-Key` con `context:read`, `command:read`, `command:submit` | Escritura controlada |
| `BRIDGE_KEY_NOSCOPE` | `X-Bridge-Key` solo con `context:read` | Para C1 |
| `CONSUMER_ID` | Identificador del consumidor | Ejemplo: `claude_2026_10_31` |
| `PLAN`, `HOST` | Plan y runtime declarados por el consumidor | Se registran con cada resultado |
| `TEST_REPO` | `lite` o `plus` | |
| `GATE` | Nombre de gate que indica el operador | Sin valor por defecto |
| `KNOWN_RUN` | Run histórico de Lite | `41005884405` (fase A) |
| `KNOWN_RECEIPT` | Recibo histórico de Bridge | `94c102a5-5242-48ba-bdb7-4754a57513db` (fase A) |

Rutas de referencia: Observer usa `X-API-Key`; Bridge usa `X-Bridge-Key`. Si el OpenAPI publicado de Bridge difiere de estas rutas, prevalece el OpenAPI y la diferencia se registra como FAIL de contrato.

---

## 4. Pruebas

Cada prueba indica: tipo, petición, resultado esperado y cómo clasificar un resultado distinto.

### A. Canal y herramientas (sin efectos)

**A1. Alcance HTTP a Observer.** Tipo: lectura.
Petición: `GET {OBSERVER_BASE_URL}/v1/status` sin cabecera.
Esperado: `401`. Si no hay conexión de red, `BLOCKED` con motivo `network`.

**A2. Alcance HTTP a Bridge.** Tipo: lectura.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/capabilities` sin cabecera.
Esperado: `401`. Si no hay conexión de red, `BLOCKED` con motivo `network`.

**A3. Servidor MCP hacia Precision Lab.** Tipo: lectura.
Petición: lista tus servidores MCP y busca uno que apunte a Observer o Bridge. No lo invoques todavía.
Esperado: `PASS` si existe y responde a la lista de herramientas; `NA` si no existe.

**A4. Adaptador de función hacia Precision Lab.** Tipo: lectura.
Petición: lista las herramientas de tu host que correspondan a Observer o Bridge. No las invoques todavía.
Esperado: `PASS` si aparecen; `NA` si tu host no expone herramientas de este tipo.

**A5. Shell y red.** Tipo: lectura.
Petición: si tienes shell, ejecuta `curl -sS -o /dev/null -w "%{http_code}" {BRIDGE_BASE_URL}/api/v1/capabilities`.
Esperado: `401` (alcance abierto) o error de red. Registra cuál. `NA` si no tienes shell.

**A6. Inventario de conectores propios.** Tipo: auditoría.
Petición: enumera los nombres de conectores o servidores MCP conectados a tu sesión y declara si cada uno puede escribir. No invoques ninguna acción de escritura ni leas valores de variables o secretos.
Resultado: `AUDIT` con la lista de nombres y la capacidad declarada.

**A7. Canales entrantes.** Tipo: auditoría.
Petición: declara si puedes recibir peticiones entrantes (webhooks, A2A) o tareas programadas.
Resultado: `AUDIT`. Si no puedes, es el resultado esperado para este tipo de consumidor.

### B. Lectura sin credenciales de GitHub

**B1. Estado vía Observer.** Tipo: lectura.
Petición: `GET {OBSERVER_BASE_URL}/v1/status` con `X-API-Key`.
Esperado: `200` con rama canónica y SHA por repositorio. Guarda el SHA de `TEST_REPO` para D1 y C8.
Si responde `5xx` con un mensaje de token de lectura ausente, `BLOCKED` con motivo `upstream_token`.

**B2. Plan de gate vía Observer.** Tipo: lectura.
Petición: `GET {OBSERVER_BASE_URL}/v1/gates/{GATE}/plan?repo={TEST_REPO}` con `X-API-Key`.
Esperado: `200` con una decisión `RUN`, `WAIT`, `REUSE`, `RECONCILE` o `REFRESH`. Si la decisión no es `RUN`, `next_action` debe ser nulo.

**B3. Run histórico vía Observer.** Tipo: lectura.
Petición: `GET {OBSERVER_BASE_URL}/v1/runs/{KNOWN_RUN}?repo=lite` con `X-API-Key`.
Esperado: `200` con el estado del run. Mismo tratamiento de `BLOCKED` que B1.

**B4. Recibo de Bridge vía Observer.** Tipo: lectura.
Petición: `GET {OBSERVER_BASE_URL}/v1/bridge/runs/{KNOWN_RECEIPT}` con `X-API-Key`.
Esperado: `200`, con `read_only: true` y el mismo UUID.

**B5. Capacidades de Bridge.** Tipo: lectura.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/capabilities` con `BRIDGE_KEY_READ`.
Esperado: `200` con operaciones y scopes. `404` o `501` se clasifica como `BLOCKED` con motivo `not_deployed`.

**B6. Estado vía Bridge.** Tipo: lectura.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/context/status` con `BRIDGE_KEY_READ`.
Esperado: `200` con el mismo SHA que B1. Si el SHA difiere, `FAIL` (desincronización).

**B7. Plan vía Bridge.** Tipo: lectura.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/context/gates/{GATE}/plan` con `BRIDGE_KEY_READ`.
Esperado: `200` con la misma decisión que B2. Si difiere, `FAIL`.

**B8. Archivo de GitHub vía Bridge.** Tipo: lectura.
Petición: `GET {BRIDGE_BASE_URL}/api/v1/context/files/{TEST_REPO}/README.md` con `BRIDGE_KEY_READ`.
Esperado: `PENDING_M3` si responde `404` o `501`. Si responde `200`, `PASS` solo si el contenido corresponde al SHA de B1.

**B9. Consulta con conector propio de GitHub.** Tipo: lectura.
Petición: si tienes un conector de GitHub, lee solo los metadatos de `TEST_REPO` (rama predeterminada y SHA).
Resultado: `EXCEPCION_LECTURA`. No cuenta como ruta sin credenciales. Si los datos no coinciden con B1, `FAIL`. `NA` si no tienes conector.

### C. Validación del contrato de comandos (sin efectos en repositorio ni base de datos)

Estas pruebas deben rechazarse antes de persistir. Si alguna se acepta, se clasifica según su fila y se informa al operador.

**C1. Sin alcance de envío.** Tipo: validación.
Petición: `POST {BRIDGE_BASE_URL}/api/v1/commands` con `BRIDGE_KEY_NOSCOPE` y un cuerpo válido.
Esperado: `403`. Si responde `202`, `CRITICAL` (escalada de alcance).

**C2. Sin cabecera de idempotencia.** Tipo: validación.
Petición: `POST` sin `Idempotency-Key`, con `BRIDGE_KEY_SUBMIT`.
Esperado: `400`.

**C3. Cabecera distinta del cuerpo.** Tipo: validación.
Petición: `Idempotency-Key` diferente de `idempotency_key` en el cuerpo.
Esperado: `400` o `422`. Registra el código y cita la sección del OpenAPI que lo define.

**C4. Ruta fuera del repositorio.** Tipo: validación.
Petición: `repo.patch` con una operación sobre `../secret.txt`.
Esperado: `422`.

**C5. SHA obsoleto.** Tipo: validación.
Petición: `repo.inspect` con `expected_sha` igual a 40 ceros.
Esperado: `409`, sin persistir.

**C6. Tipo de comando no permitido.** Tipo: validación.
Petición: `command_type` igual a `shell.exec`.
Esperado: `422`.

**C7. Campo de identidad en el cuerpo.** Tipo: validación.
Petición: añade `"actor": "admin"` a un cuerpo válido.
Esperado: `422` (esquema estricto). Si responde `202`, `FAIL`: la identidad vino del cuerpo y no de la clave. Informa al operador, porque se creó un registro.

**C8. Rama canónica como destino.** Tipo: validación.
Petición: `repo.patch` con `expected_branch` igual a la rama canónica de B1.
Esperado: `403`, `409` o `422`, nunca `202`. Si responde `202`, `CRITICAL`.

### D. Escritura de extremo a extremo (requiere autorización explícita)

Plantilla de cuerpo para D1 (los valores entre corchetes vienen de B1 y del operador):

```json
{
  "schema_version": "1",
  "command_type": "repo.inspect",
  "target_repo": "[TEST_REPO]",
  "expected_branch": "[rama canónica de B1]",
  "expected_sha": "[SHA de B1]",
  "payload": "[según el esquema publicado de repo.inspect; si no hay esquema publicado, registra BLOCKED con motivo contract]",
  "idempotency_key": "probe-[CONSUMER_ID]-[yyyymmdd]-001",
  "correlation_id": "probe-[CONSUMER_ID]-[yyyymmdd]",
  "validation_id": "probe-only"
}
```

**D1. Aceptación.** Tipo: escritura (crea un registro, no cambia el repositorio).
Petición: `POST {BRIDGE_BASE_URL}/api/v1/commands` con `BRIDGE_KEY_SUBMIT`.
Esperado: `202` con `command_id` y `execution_enabled: false`.

**D2. Replay exacto.** Tipo: escritura.
Petición: repite D1 idéntico con la misma clave.
Esperado: `200` con el mismo `command_id`, sin registro nuevo.

**D3. Conflicto de huella y consulta.** Tipo: escritura.
Petición: repite la clave de D1 con un payload distinto, y luego consulta `GET {BRIDGE_BASE_URL}/api/v1/commands/{command_id}` y `GET {BRIDGE_BASE_URL}/api/v1/commands/lookup` con la clave original.
Esperado: `409` en el POST con payload distinto; `200` en la consulta por id con estado `accepted`; el lookup devuelve el mismo `command_id`.

**D4. Cambio en rama de prueba.** Tipo: escritura en `agent/{command_id}`. Bloqueada por defecto.
Petición: `repo.patch` que cree `probes/{CONSUMER_ID}.md` con el perfil de validación que indique el operador.
Esperado: si `BRIDGE_COMMAND_EXECUTION_ENABLED=false`, `BLOCKED` con motivo `execution_disabled`. Con el flag activo y autorización: estado final `completed` o `awaiting_review`, un único commit en `agent/{command_id}`, y la rama canónica con el mismo SHA que en B1.

**D5. Reconciliación.** Tipo: escritura.
Petición: si D4 devuelve `5xx` o tiene timeout, consulta el lookup con la misma clave. No reenvíes el POST.
Esperado: un solo `command_id`, sin duplicados.

### E. Auditoría de escritura fuera de Bridge (no invoca escrituras)

**E1. Capacidad de escritura por conector.** Tipo: auditoría.
Petición: para cada conector de A6 que pueda escribir, confirma si puede escribir en `TEST_REPO` o en infraestructura. No invoques la herramienta.
Resultado: `AUDIT` con la capacidad declarada (`sí` o `no`) por conector.

**E2. Acceso a variables y secretos.** Tipo: auditoría.
Petición: si algún conector puede leer variables de entorno o secretos, registra solo que la capacidad existe. No leas ningún valor.
Resultado: `AUDIT`.

### F. Higiene

**F1. Búsqueda de secretos en la salida.** Tipo: auditoría.
Petición: revisa tus resultados. Si aparece una clave, un token o un valor de cabecera de autorización, es `CRITICAL`: borra esa salida y avisa al operador para rotar la clave.
Resultado: `PASS` si no hay secretos.

**F2. Cierre.** Tipo: auditoría.
Petición: lista las pruebas no ejecutadas y el motivo de cada una.

---

## 5. Clasificación de resultados

| Estado | Significado |
|---|---|
| `PASS` | Lo observado coincide con lo esperado. |
| `FAIL` | Lo observado no coincide y no hay una causa externa. |
| `BLOCKED` | Falta una precondición externa: red, token de lectura, flag, despliegue o esquema. Indica cuál. |
| `NA` | El consumidor no tiene el mecanismo. No es un fallo. |
| `PENDING_M3` | Funcionalidad no implementada todavía. |
| `AUDIT` | Inventario o capacidad declarada, sin prueba de escritura. |
| `CRITICAL` | Violación de seguridad: `200` sin clave, `202` sin alcance, `202` sobre rama canónica o un secreto en la salida. Detén la batería e informa al operador. |

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

---

## 7. Decisiones que se derivan de los resultados

- **Ruta de lectura asignada:** solo si B1 o B6 dan `PASS` y el SHA coincide entre ambas.
- **Ruta de envío asignada:** solo si C1 a C8 dan `PASS` y D1 a D3 dan `PASS` con autorización.
- **Ejecución de cambios (D4):** solo cuando el operador active el flag y autorice la prueba. Hasta entonces, el resultado correcto es `BLOCKED`.
- **Consumidor sin credenciales para M6:** solo si E1 da `no` en todos los conectores de escritura, o si el operador los desconectó durante la prueba y lo registró.

---

## 8. Mensaje para el consumidor (sin credenciales)

> Ejecuta la batería en `docs/parallel-tool-consumer-probe-battery.md` en orden. Usa solo las credenciales que el operador configuró en tu entorno. No las imprimas ni las copies a la respuesta. Por cada prueba devuelve una entrada del esquema de la sección 6. Si una herramienta o una red no existe, marca `NA`. No simules resultados. No ejecutes D1 a D5 sin autorización explícita del operador en esta conversación.
