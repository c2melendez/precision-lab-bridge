# Hoja de ruta — herramienta paralela para LLMs sin GitHub

Fecha de actualización: 2026-10-31.
Estado: arquitectura v2 multientrada/multicanal; M0 COMPLETED; M1 PASS_SCOPED; M2 IN_PROGRESS con worker OIDC/lease/typed patch/callback en PRs Draft. Bridge CI+DB SUCCESS en HEAD `50978189950cd36cdae6ea4e19f87006ce1aa1d5`; Lite current-head Runner contract, E2E y cross-browser SUCCESS pero CI bloqueado por npm audit (11 findings: 3 low, 8 moderate); Plus current-head CI SUCCESS y E2E IN_PROGRESS. M3–M7 siguen pendientes. Fases A/B permanecen cerradas. El estado histórico O1–O7 corresponde al diseño v1 Observer-only y no define ya la aceptación multiagente. La certificación matemática de Lite/Plus sigue siendo el objetivo final.

Este documento es la fuente de seguimiento. Sustituye la sección «Trabajo de integración pendiente» de `docs/observer-bridge-integration.md`. La evidencia más reciente de los HEAD y runs prevalece sobre los registros históricos de PR.

## Protocolo para el siguiente LLM

1. No pidas, pegues, registres ni hagas commit de secretos: `llm`, `SERVICE_API_KEY`, `GITHUB_READ_TOKEN`, `GH_TOKEN`, `SUPABASE_SECRET_KEY` ni `BRIDGE_ADMIN_PASSWORD`.
2. Distingue entre CI de los repositorios auxiliares, prueba de lectura staging y una certificación matemática de Lite/Plus. No son equivalentes.
3. No rehagas fases A o B: están cerradas con evidencia HTTP y CI.
4. No declares validado el despacho end-to-end: todavía no existe una prueba controlada completa Bridge → GitHub Actions Runner → recibo → Observador.
5. Ejecuta autónomamente las operaciones ordinarias dentro del alcance y políticas ya aprobados. Escala al usuario solo decisiones materiales no resueltas por el contrato, las pruebas o los límites definidos; no pidas aprobación por cada despacho rutinario.
6. Anota SHA, URL de run, códigos HTTP y cualquier cambio de configuración no secreta. Nunca registres valores de credenciales.

Un LLM sin acceso GitHub puede consumir Observer, Bridge o ambos, según sus capacidades y las credenciales asignadas. El LLM que implementa/mantiene los repositorios auxiliares puede necesitar acceso GitHub de mantenimiento; ese acceso no se entrega a los agentes consumidores. El operador administra Render y los secretos; ningún secreto de servidor se incluye en prompts.

## Decisión arquitectónica v2 — arquitectura multientrada y multicanal (2026-10-30)

**Esta es la decisión arquitectónica vigente y tiene prioridad sobre todas las secciones históricas posteriores que describan Observer como único interlocutor, prohíban el acceso LLM→Bridge o limiten Bridge a llamadas server-to-server de Observer.** La modificación documenta el diseño aprobado; no declara implementados los componentes pendientes.

### Objetivo de resultado

Cualquier LLM/agente autorizado debe poder completar las operaciones que establece el prompt de continuidad de Precision Lab —leer el estado y los archivos, diagnosticar, proponer y aplicar cambios, ejecutar pruebas, generar commits/PR, despachar gates, observar resultados, corregir y continuar— **sin necesitar credenciales ni acceso directo a GitHub**.

La arquitectura admite varias entradas y transportes. Observer, Bridge y Runner son componentes con responsabilidades distintas; no son una cadena obligatoria que todo agente deba recorrer en el mismo orden.

### Responsabilidades no duplicadas

| Componente | Responsabilidad vigente | No debe hacer |
|---|---|---|
| **Observer — plano de información y política** | Fuente de contexto del proyecto: estado bilateral, ramas/HEAD, lectura de archivos/repositorio, continuidad, planificación RUN/WAIT/REUSE/RECONCILE/REFRESH, evidencia y evaluación de bloqueos. Expone API de lectura y puede recibir solicitudes de ejecución que delega a Bridge. | No guardar idempotencia transaccional de comandos ni ejecutar commits directamente. |
| **Bridge — puerta multiagente y plano de comandos** | Entrada directa para agentes, autenticación e identidad por cliente, scopes, contrato común de comandos, validación final, idempotencia durable, cola/lease, recibos, coordinación y reconciliación. Cuando entra una solicitud directa, consulta Observer internamente para obtener contexto/política actuales. También acepta solicitudes procedentes de Observer. | No confiar en un plan, SHA, autorización o conclusión declarados por el LLM; no dar al LLM credenciales GitHub/Supabase ni ejecutar shell arbitrario. |
| **Runner — plano de ejecución** | Ejecuta los comandos tipados que autoriza Bridge dentro de GitHub Actions en Lite/Plus. Mantiene los workflows actuales de certificación y añade la capacidad controlada de modificar archivos, ejecutar perfiles de prueba, producir commits/PR y devolver evidencia. | No exponer credenciales GitHub al LLM, aceptar comandos arbitrarios ni duplicar el planificador/idempotencia de Bridge. |

### Entradas y rutas válidas

Un agente puede utilizar una sola ruta o combinar lectura y escritura por rutas diferentes:

1. **LLM → Observer → Bridge → Runner.** Ruta de contexto y planificación; adecuada para agentes que consumen Observer/OpenAPI o necesitan primero leer y decidir.
2. **LLM → Bridge → Runner.** Ruta directa de comandos. Bridge valida el cliente y consulta Observer internamente para recuperar estado, archivos, rama canónica, SHA y decisión vigente antes de ejecutar. El agente no necesita llamar Observer por separado.
3. **LLM → Observer (GET) + LLM → Bridge (POST).** Ruta híbrida. El agente lee estado/archivos/plan desde Observer y envía el cambio directamente a Bridge.
4. **LLM con GitHub autorizado → GitHub Actions/Runner.** Excepción para agentes que ya tienen acceso delegado a GitHub. No es requisito ni ruta base para un LLM sin GitHub; se somete a los mismos contratos de rama, cambios, pruebas y evidencia.

**Runner no será una API pública independiente para LLM.** GitHub Actions es el runtime de ejecución; sin una credencial GitHub, el agente inicia la tarea a través de Bridge. No se debe crear un tercer servicio para resolver el acceso directo.

En la ruta Bridge directa, Bridge debe poder consultar Observer mediante una identidad de servicio interna dedicada. Se propone configurar `OBSERVER_BASE_URL` y `OBSERVER_SERVICE_KEY` en el runtime Bridge; nunca se entregan al LLM. Observer conserva su token GitHub de solo lectura. Bridge conserva las credenciales de despacho y Supabase solo en servidor. La existencia/configuración actual de esa conexión Bridge→Observer no se presume.

### Catálogo oficial de mecanismos de integración

El catálogo es exhaustivo como inventario inicial de mecanismos, pero cada elemento tendrá estado independiente (implementado, adaptador pendiente, probado o no aplicable). No se debe inferir soporte real por aparecer en esta lista.

| Prioridad | Mecanismo / familia | Conexión prevista | Disposición |
|---|---|---|---|
| P0 | REST/HTTPS | Observer y Bridge | Contrato base común; ampliar Bridge para comandos tipados. |
| P0 | OpenAPI | Observer y Bridge | Especificación versionada/importable para generar clientes y herramientas. |
| P0 | Function Calling / Tool Use | Adaptador de herramientas hacia Observer o Bridge | Esquemas JSON estables; el host ejecuta las llamadas HTTP. |
| P1 | GPT Actions | Observer y, cuando el cliente/contrato lo permita, Bridge | Action como adaptador OpenAPI; credencial como secreto de autenticación, nunca en el prompt. |
| P1 | MCP remoto (Streamable HTTP) | Servidores MCP en Observer y Bridge | Tools de lectura/contexto y comandos; transporte remoto autenticado. |
| P1 | MCP local (stdio) | Adaptador/CLI local que reenvía a Observer o Bridge | No duplica lógica; usa las mismas API y credenciales locales seguras. |
| P2 | SDK Python | Observer y Bridge | Cliente tipado con auth, correlación, polling y reconciliación. |
| P2 | SDK TypeScript/JavaScript | Observer y Bridge | Equivalente al SDK Python; mismo contrato. |
| P2 | CLI | Observer y Bridge | Comandos para agentes con terminal; configuración por entorno/gestor de secretos. |
| P3 | Webhooks firmados | Bridge | Entrada de eventos/tareas desde sistemas externos; firma, timestamp, replay protection y allowlist. |
| P3 | A2A (Agent2Agent) | Bridge como endpoint de tareas/agente | Agent Card, creación/consulta de tareas y artefactos; se implementa como adaptador del Command API. |
| P3 | Frameworks de agentes | Adaptadores hacia SDK/API común | LangChain, LangGraph, CrewAI, AutoGen, LlamaIndex y otros; no crear APIs particulares por framework. |
| P3 | Integraciones nativas de proveedores | Adaptadores según capacidades reales | Conectores/tools de proveedores; validar por proveedor y no asumir compatibilidad universal. |
| Excepción | GitHub App / GitHub Connector / token delegado | GitHub/Runner | Solo agentes con acceso propio autorizado; nunca requisito del sistema multi-LLM. |

OpenAPI, MCP, SDK, CLI, A2A, webhooks y Function Calling son superficies/adaptadores del mismo contrato; no son motores de ejecución separados. Los adaptadores locales/remotos no deben tener políticas distintas.

### Command API común de Bridge

Se establece como contrato objetivo una **Command API versionada y tipada**. Las rutas siguientes son propuestas contractuales; salvo los endpoints existentes documentados por separado, no se deben presentar como implementadas hasta que haya código, CI y prueba live.

| Método | Ruta propuesta | Propósito |
|---|---|---|
| GET | `/api/v1/capabilities` | Capacidades, versiones, operaciones y límites disponibles para esa identidad. |
| GET | `/api/v1/context/status` | Proxy interno/sanitizado del estado de Observer para clientes Bridge-only. |
| GET | `/api/v1/context/files/{repo}/{path}` | Lectura de archivos/repositorio autorizados delegada al plano de información Observer. |
| GET | `/api/v1/context/gates/{gate}/plan` | Plan actual live; nunca autoriza por sí solo al cliente a saltarse la validación final. |
| POST | `/api/v1/commands` | Registrar y encolar un comando tipado con idempotencia durable. |
| GET | `/api/v1/commands/{command_id}` | Estado, salida y recibo sanitizados. |
| GET | `/api/v1/commands/lookup` | Recuperar/reconciliar por `Idempotency-Key`; nunca vuelve a despachar. |

El contrato de comando v1 utiliza un sobre común:

- `schema_version`, `command_type`, `target_repo` (solo `lite`/`plus`), `expected_branch`, `expected_sha`.
- `idempotency_key`, `correlation_id`, `validation_id`; el actor se deriva de la credencial autenticada y no se acepta como identidad confiable del cuerpo.
- `payload` tipado y validado por `command_type`; `validation_profile` usa nombres de perfiles permitidos, no comandos shell libres.
- `artifact_refs` para payloads/patches grandes, con almacenamiento privado, checksum, tamaño, caducidad y propietario verificados.
- El servidor genera `command_id`, fingerprint, estado, fechas, receipt UUID y vínculo con Actions run/Runner record.

Tipos iniciales de comando: `repo.inspect`, `repo.patch` (crear/modificar/eliminar archivos mediante operaciones estructuradas), `repo.validate` (perfiles allowlisted), `repo.commit`, `repo.pull_request`, `certification.plan` y `certification.dispatch`. Un `repo.patch` no equivale a un shell remoto. Las operaciones se limitan a rutas, tamaños, tipos de archivo, repositorios y ramas permitidos; no se ejecutan scripts aportados libremente por el LLM.

Estados mínimos: `accepted`, `queued`, `validating`, `running`, `awaiting_review`, `completed`, `failed`, `blocked` y `reconcile_required`. Una respuesta HTTP de aceptación no significa que el cambio se aplicó, que las pruebas pasaron ni que la certificación quedó aprobada.

Se conserva `POST /api/runs` como contrato heredado para gates durante la transición. Debe converger internamente en la misma política/registro de comandos o quedar como adaptador compatible; no puede convertirse en un bypass distinto de idempotencia, allowlist o auditoría.

### Capacidad de modificación en Runner

El Runner de certificación existente se conserva para ejecutar gates. Se amplía el mismo plano de ejecución para recibir comandos de repositorio desde Bridge:

1. Bridge registra el comando durablemente y crea una intención/lease antes de despachar.
2. Bridge invoca un workflow de ejecución en el repositorio objetivo pasando solo un identificador opaco de comando y metadatos mínimos; no pasa secretos ni un patch ilimitado como inputs de workflow.
3. El worker recupera el manifiesto desde Bridge con identidad de workload de corta duración (preferentemente identidad OIDC de GitHub Actions validada; alternativa: lease-token de un solo uso y TTL corto).
4. Runner verifica allowlist, propietario, expiración, fingerprint, branch y `expected_sha`; si el SHA cambió, bloquea con conflicto y no sobrescribe.
5. Runner trabaja en una rama aislada `agent/{command_id}`, aplica operaciones tipadas, ejecuta perfiles allowlisted y recoge logs/artefactos.
6. Si las validaciones requeridas pasan, crea commit y PR (draft o ready según política). Si fallan, conserva el diagnóstico/artefacto y no fusiona. La rama canónica/protegida no se sobrescribe directamente.
7. Runner devuelve a Bridge el resultado firmado/autenticado; Bridge actualiza recibo, estado e idempotencia y Observer puede reconciliarlo. El agente obtiene el resultado por el transporte original.

Un workflow adicional de trabajo de repositorio puede ser un **entrypoint técnico del mismo Runner**; no constituye un segundo servicio Runner ni autoriza duplicar el planificador, seguridad, persistencia o política. El workflow `certification-runner.yml` existente permanece como ejecutor de gates hasta que cualquier cambio de contrato tenga pruebas bilaterales Lite/Plus. No se reutiliza `dry_run` como sustituto de una ejecución real de modificación.

La fusión automática de PR no se presume. Solo puede ocurrir cuando un contrato de certificación y la política de rama lo permitan expresamente; en otro caso, el resultado de la tarea será commit/PR con evidencia para revisión.

### Frontera de confianza y criterios obligatorios

- **Credenciales separadas:** agente→Observer; agente→Bridge; Bridge→Observer interno; Bridge→GitHub/Actions; Runner→Bridge callback; Runner→GitHub; Bridge→Supabase. Ningún secreto de servicio cruza hacia el LLM.
- **Identidad por agente:** credenciales independientes, hashes almacenados, scopes mínimos, expiración/revocación y auditoría. No distribuir una clave global de escritura a todos los modelos.
- **Scopes objetivo:** conservar `read`/`dispatch` por compatibilidad y definir scopes explícitos para `context:read`, `command:submit`, `command:read` y administración. Las claves existentes no heredan permisos nuevos automáticamente. Las credenciales de dispatch y callback son server-only.
- **Política y estado live:** Bridge directo obtiene de Observer el contexto/plan actual; nunca confía en branch/SHA/decision enviados por el LLM. Observer también puede validar antes de delegar.
- **Rama/SHA y conflicto:** compare-and-swap sobre `expected_sha`; cambios concurrentes producen conflicto y reconciliación, nunca force-push silencioso.
- **Idempotencia:** misma clave y mismo fingerprint → mismo command/receipt; misma clave y payload distinto → conflicto; outcome incierto → consulta por la misma clave, jamás POST ciego.
- **Seguridad de payload:** validación de esquema, límites de tamaño, allowlist de rutas/extensiones/comandos de prueba, detección de secretos y prohibición de ejecución shell arbitraria.
- **Auditoría:** actor, identidad de cliente, tipo de comando, target, SHA de entrada/salida, fingerprint, command_id, correlation_id, validation_id, receipt UUID, workflow/run ID, commit/PR y conclusión de cada prueba.
- **Evidencia:** diferenciar comando aceptado, cambios aplicados, pruebas aprobadas, Actions SUCCESS y certificación matemática PASS.
- **Autonomía:** operaciones rutinarias dentro del alcance delegado continúan sin aprobación humana por evento. Se escala solo por decisiones materiales no resueltas por contrato/pruebas.

### Fases de trabajo de la arquitectura v2

| Fase | Objetivo | Criterio de salida |
|---|---|---|
| M0 | Registrar esta decisión y contrato común en Markdown/JSON | Ambos artefactos coherentes, validados y versionados en el mismo commit/serie documental. |
| M1 | Command API y scopes de Bridge | **PASS_SCOPED**: OpenAPI, esquema, auth/scopes, capacidades, proxy Observer de estado/plan, registro durable, estados, idempotencia y pruebas/CI en SHA `b622a26605b1402c73fe1aff327fc2f1941bc1e2`. Proxy de archivos queda en M3; despliegue/Observer live no verificado. |
| M2 | Implementar ejecución de cambios en Runner | Worker en Lite/Plus, lease seguro, verificación SHA, rama aislada, patch tipado, perfiles de prueba, commit/PR y callback autenticado. |
| M3 | Conectar rutas multientrada y política | LLM→Observer, LLM→Bridge y ruta híbrida; Bridge→Observer interno; mismas decisiones y evidencia en todas. |
| M4 | Entregar adaptadores P0/P1 | REST/OpenAPI, Function Calling, GPT Actions, MCP remoto y MCP stdio usando el mismo contrato. |
| M5 | Entregar adaptadores P2/P3 | SDK Python/TS, CLI, webhooks, A2A y adaptadores de frameworks/proveedores según disponibilidad y valor demostrado. |
| M6 | Certificar interoperabilidad multiagente y capacidades LLM | Dos modelos LLM distintos, identidades independientes y dos transportes completan con TCA-1 (o Broker equivalente), sin credenciales GitHub en los agentes: lectura → diagnóstico → patch → validación → commit/PR → reconciliación; replay sin duplicado y benchmark CB1–CB10 reproducible. TCA-2/G1–G5 es investigación opcional y no criterio de producción. |
| M7 | Congelar infraestructura auxiliar y reanudar matemática | Evidencia integral publicada; no quedan gaps de conexión/ejecución dentro del alcance; reanudar Lite/Plus según sus índices canónicos. |

## Diseño TCA — acceso temporal a credenciales

Se incorpora [Temporary Credential Access (TCA)](./temporary-credential-access-design.md) v1.0.0:
- **TCA-D0: DESIGN DOCUMENTED.** No crea claves, endpoints, servicios ni despliegues.
- **TCA-1:** modo provisional operativo; el host/MCP/conector inyecta la clave individual por consumidor desde su secret store. El modelo no conoce el valor. Comienza con `context:read`; scopes de comando solo en staging y según necesidad. La UI actual tiene expiración mínima de un día, por lo que exige revocación manual al terminar.
- **TCA-2:** Credential Lab independiente con canary sintético, TTL objetivo máximo 15 minutos, intentos limitados, sin red ni credenciales de producción. No es una clave Bridge y nunca habilita acceso a repositorios. G1–G5 son investigación independiente, no requisito de M6.
- **Credential Broker:** destino final OAuth 2.1/OIDC con identidad por consumidor, tokens cortos, scopes, audiencia y revocación. No implementado.
- **TCA-2-Bridge-ReadOnly:** variante futura deshabilitada; no usar con Bridge de producción.

No cambiar los estados M0–M7 ni activar claves, feature flags, servicios, migraciones o ejecución por el hecho de documentar este diseño.

**Conservación de trabajo previo:** Fases A/B de la integración Observer→Bridge (GET autenticado 200 y anónimo 401; contrato/OpenAPI y CI asociados) permanecen CERRADAS y no se repiten. No demuestran por sí solas la nueva Command API ni modificación de repositorios. La ruta Observer-only, las fases O1–O7 y su estado previo se conservan como historial de la arquitectura v1; quedan supersedidas como plan de aceptación final, no se borran como evidencia.

**Estado de M1 (conservado):** M0 COMPLETED; M1 PASS_SCOPED en SHA `b622a26605b1402c73fe1aff327fc2f1941bc1e2`, CI [41172743808](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41172743808) SUCCESS. La aceptación M1 cubre código, migración reproducible, RPC, tests y CI en DB local desechable; no implica deploy, configuración de `OBSERVER_SERVICE_KEY`, petición live, ejecución Runner ni certificación matemática.

**Reconciliación M2 (2026-10-31): IN_PROGRESS, no aceptada todavía.**
- Bridge PR [#1](https://github.com/c2melendez/precision-lab-bridge/pull/1), HEAD `50978189950cd36cdae6ea4e19f87006ce1aa1d5`. CI [41178465402](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41178465402) **SUCCESS** sobre el HEAD exacto: tests, lint, build, reconstrucción completa de migraciones Supabase desechables, aserciones RPC/RLS/grants, contratos SQL legacy/M1/M2, pruebas DB e idempotencia y schema lint. El commit conserva la revisión de mecanismos reportada por el usuario.
- Lite PR [#60](https://github.com/c2melendez/precision-lab-lite/pull/60), HEAD `f7c4cf6ac31967b74e936ba38d1597404e652e33`. Runner safety-contract **SUCCESS**; CI [41178122450](https://github.com/c2melendez/precision-lab-lite/actions/runs/41178122450) **FAILURE** únicamente en npm audit hard gate (11 findings: 3 low, 8 moderate, 0 high/critical); typecheck/tests/build quedaron SKIPPED. Playwright [41178122439](https://github.com/c2melendez/precision-lab-lite/actions/runs/41178122439) y cross-browser [41178122475](https://github.com/c2melendez/precision-lab-lite/actions/runs/41178122475) **SUCCESS** en el mismo HEAD. Uno de los findings es `deepmerge@4.3.1` vía `@rollup/plugin-node-resolve`; el advisory de GitHub lista ese rango afectado y no publica una versión npm corregida. No se redujo el umbral ni se forzó un downgrade.
- Plus PR [#41](https://github.com/c2melendez/precision-lab-plus/pull/41), HEAD `5288fae3f42065e3246f62e9f017098a1bad5cc4`. CI [41178121902](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121902) **SUCCESS** en el HEAD exacto: frontend audit/typecheck/unit/parity/build, backend tests y Runner contract. Lockfile sincronizado en commit [`d54d80a`](https://github.com/c2melendez/precision-lab-plus/commit/d54d80af0294ba781d9d8d30114f82bb8891cc93), conservando overrides de seguridad. Playwright [41178121954](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121954) permanece **IN_PROGRESS** en el mismo SHA.
- Todos los perfiles Node del Runner ejecutan `npm ci` y después `npm audit --package-lock-only` antes de cualquier validación. No se permite que un patch Bridge evite el hard gate normal.
- Los tres PR permanecen Draft/abiertos/no fusionados. `BRIDGE_COMMAND_EXECUTION_ENABLED=false`; no hubo deploy, cambio de secretos, migración de producción, dispatch real ni command-generated PR. O6/O7 siguen PENDING. M2 requiere resolver Lite audit y una traza E2E autorizada Bridge→Actions→Runner→receipt→Observer con replay idempotente.

## Estado ejecutivo

| Elemento | Estado observado al 2026-10-30 | Evidencia |
|---|---|---|
| Repositorios Lite, Plus, Bridge y Observador | Públicos | Metadatos de repositorios |
| Observador PR #4 | Abierto, Ready for review, no fusionado; HEAD `6e712094a7e4b06a13224f66d6f3a6c26f991152` | [PR #4](https://github.com/c2melendez/precision-lab-readonly-api/pull/4) |
| Observador CI | PASS en HEAD actual | [Run 41064924977](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41064924977) |
| Bridge PR #1 | Abierto, Draft, no fusionado; HEAD `50978189950cd36cdae6ea4e19f87006ce1aa1d5` | [PR #1](https://github.com/c2melendez/precision-lab-bridge/pull/1) |
| Bridge CI | PASS en el HEAD actual `50978189950cd36cdae6ea4e19f87006ce1aa1d5` | [Run 41178465402](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41178465402): ambos jobs SUCCESS, incluidas migraciones, seguridad DB y tests DB |
| Observador staging → Bridge independiente | Fase A PASS | HTTP 200 autenticado y 401 anónimo; UUID `94c102a5-5242-48ba-bdb7-4754a57513db` |
| Evidencia de Actions del recibo | Run preexistente, no nuevo | Lite `41005884405`, cumulative, completed/success |
| Despacho Bridge → Runner end-to-end | NO VALIDADO | No se ha autorizado ni ejecutado una prueba real de despacho |
| Corte de Observador producción → Bridge independiente | No realizado | Producción y Compass original permanecen intactos |
| Certificación matemática Lite/Plus | Abierta | Fuera del alcance de esta hoja |

### Fases

**Nota de vigencia:** A/B siguen siendo evidencia válida. Los estados C–F y los bloques O1–O7 que aparecen en los snapshots siguientes describen el alcance histórico de la integración v1 Observer-only. La aceptación vigente es M0–M7 de la decisión arquitectónica v2; no se deben usar las restricciones de entrada única como requisitos actuales.

- **A — CERRADA.** Staging Observador consulta un recibo existente del Bridge independiente. Con `X-API-Key`: HTTP 200, `read_only: true`, UUID correcto y run Lite 41005884405. Sin clave: HTTP 401. La comparación posterior no mostró nuevos workflow runs en Lite ni Plus.
- **B — CERRADA.** `README_CONTRACT.md` y `openapi.yaml` incluyen `GET /v1/bridge/runs/{run_id}`, protección `APIKeyHeader`, separación UUID Bridge / número Actions, respuestas 401/404 y semántica de auditoría/reconciliación. CI PASS 41053312777 en el HEAD actual.
- **C — PREPARADA PARA REVISIÓN.** Observador PR #4 permanece abierto/Ready for review, HEAD `6e712094a7e4b06a13224f66d6f3a6c26f991152`, CI 41064924977 SUCCESS. Bridge PR #1 permanece abierto/Draft. En la última observación previa a este commit, HEAD era `6c3a71d51100b0e4e69523df0845c901eedb8c78` y CI 41143814074 estaba PENDING. El run 41142813306 fue SUCCESS en el HEAD documental anterior `ce634c5a5078d57de1f54a8f77a352077487373b`; el último CI con evidencia de código 41131674843 fue SUCCESS en SHA `4427b5871bd8a46f9cc5fd03032eb053bf448d1e`. No fusionar ninguno en esta actualización.
- **D — CORTE DE PRODUCCIÓN DIFERIDO.** No cambiar variables de producción, sustituir la URL productiva ni rotar/revocar claves como efecto colateral de las pruebas de staging. Un corte de producción o cambio de credenciales es una decisión material separada.
- **E — DISPATCH CONTROLADO POR OBSERVER.** No existe tráfico LLM→Bridge ni dispatch directo desde Observer a GitHub. Los despachos rutinarios se permiten automáticamente cuando Observer valida solicitud, plan live, scopes y contratos; `dry_run=true` sigue siendo un workflow real.
- **F — PENDIENTE.** Preparar y validar la configuración de una Action de LLM consumidor con URL de Observador y clave entrante configurada como secreto de la Action, nunca en el prompt. Antes de afirmar capacidad completa, probar el flujo de lectura del LLM consumidor y documentar los límites de despacho.

## Fase A — Evidencia cerrada

Servicio staging: `precision-lab-readonly-api-staging`, URL https://precision-lab-readonly-api-staging.onrender.com, servicio Render `srv-dbi7avgae00c73be7ns0`. Auto-deploy permanece desactivado.

Configuración no secreta usada:
- `BRIDGE_BASE_URL=https://precision-lab-bridge.onrender.com`
- `BRIDGE_TIMEOUT_SECONDS=90`

Secretos configurados por el operador en Render:
- `llm`: clave API del Bridge independiente, enviada únicamente como `X-Bridge-Key`.
- `SERVICE_API_KEY`: clave entrante exclusiva de Observador staging, recibida como `X-API-Key`.

Los valores no se leen, copian ni registran aquí. La prueba confirmó 200/401 y no produjo workflows nuevos. No se ha hecho rotación ni revocación.

## Fase B — Evidencia cerrada

En la rama `feature/bridge-readonly-run-status`:
- `README_CONTRACT.md` documenta la ruta, los dos espacios de identificadores, la separación de credenciales, errores y efectos secundarios limitados a auditoría/reconciliación.
- `openapi.yaml` declara el endpoint GET protegido por `APIKeyHeader`.
- HEAD actual: `b8bbc188adcdce231670d88f45872c73b5ed2f34`.
- CI: [41053312777 — SUCCESS](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41053312777).

## Fase C — Preparación de PR

- Observador: [PR #4](https://github.com/c2melendez/precision-lab-readonly-api/pull/4), abierto, Ready for review, HEAD `b8bbc188adcdce231670d88f45872c73b5ed2f34`; CI [41053312777](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41053312777) SUCCESS.
- Bridge: [PR #1](https://github.com/c2melendez/precision-lab-bridge/pull/1), abierto, Ready for review, HEAD `d74926f5ef40982d99e80d0733a7b5150a37d26b`; CI [41053872908](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41053872908) SUCCESS.
- No se fusiona ninguno como parte de la actualización documental.

## PR históricos de Observador — diferidos, no bloqueantes

Estos números corresponden al repositorio `c2melendez/precision-lab-readonly-api`, no al PR #1 de Bridge:

| PR | Tema | Estado | Disposición |
|---|---|---|---|
| [#1](https://github.com/c2melendez/precision-lab-readonly-api/pull/1) | Reconciliación documental de historial API/Render | Abierto | Diferido; no bloquea la integración actual. Revaluar si sigue siendo útil o cerrar administrativamente. |
| [#2](https://github.com/c2melendez/precision-lab-readonly-api/pull/2) | Cobertura de categorías de fingerprint | Abierto; evidencia CI histórica sin runner | Diferido; no declarar PASS. Revisar contra HEAD actual antes de decidir reabrir trabajo o cerrar como no planificado. |
| [#3](https://github.com/c2melendez/precision-lab-readonly-api/pull/3) | API de despacho aislado e idempotencia (diseño anterior) | Histórico / fuera de la arquitectura vigente | No reactivar: su ruta de despacho directo a GitHub duplica responsabilidades y contradice Observer→Bridge. La ruta actual es PR #4 con despacho server-to-server mediante Bridge. |

El PR #1 de Bridge es distinto y corresponde al servicio independiente actual; permanece abierto para revisión.

## Arquitectura y límites de confianza

1. **Observador** recibe las solicitudes de lectura del LLM mediante `X-API-Key`. Consulta GitHub usando su token de lectura de servidor y consulta Bridge usando `llm` como `X-Bridge-Key`. No dispone de una ruta de despacho.
2. **Bridge** autentica operadores/clientes con claves Bridge, aplica allowlist de Lite/Plus, validación e idempotencia persistente en Supabase y, en el flujo de escritura autorizado, solicita el workflow fijo `certification-runner.yml` a GitHub Actions. Sus GET de estado también pueden escribir auditoría y reconciliación.
3. **Certification Runner** vive en los repositorios Lite y Plus. Ejecuta el gate seleccionado sobre la rama canónica resuelta desde la documentación del repositorio, espera el resultado y publica registros/evidencia. Requiere el secreto `GH_TOKEN` configurado en cada repositorio con permisos adecuados.
4. **Supabase** persiste claves Bridge (hashes), recibos, auditoría e idempotencia. No se comparte con el LLM ni con Observador.
5. **Render** aloja los servicios; staging y producción son entornos distintos. Los servicios Free pueden dormir y tener arranques en frío.

### Invariantes de seguridad y evidencia

- `GET /v1/runs/{id}?repo=lite|plus` usa un ID numérico de GitHub Actions.
- `GET /v1/bridge/runs/{uuid}` usa el UUID interno del recibo Bridge.
- Un `success` de GitHub Actions no equivale por sí solo a `PASS` de certificación.
- `RECONCILE` o `REFRESH` impiden inventar un siguiente gate; `next_action` debe quedar nulo cuando falta coherencia.
- Un GET de estado Bridge puede escribir last-used, auditoría y reconciliación; no despacha.
- `POST /api/runs` sí puede despachar. `dry_run=true` también inicia el workflow, por lo que no debe usarse como prueba inocua.
- Idempotencia evita duplicar solicitudes equivalentes, pero no elimina la necesidad de tratar con cautela resultados de despacho ambiguos.
- Ninguna credencial debe aparecer en prompts, respuestas, archivos públicos ni logs.
- El token de Observador debe limitarse a lectura de Contents/Actions en Lite y Plus. El token de despacho de Bridge es independiente y debe permanecer en el servidor.
- Plan Free: posibles cold starts. El timeout Observador→Bridge está configurado a 90 s. No subir de plan como parte de esta conciliación.

## Fase D — Corte de lectura en producción

La migración/corte se ejecuta automáticamente cuando el checklist técnico y las pruebas de staging acrediten los criterios de salida; escalar solo si hay una decisión material no especificada (por ejemplo, reemplazar producción/Compass o revocar una credencial todavía en uso). Antes del cambio deben verificarse la clave Bridge de reemplazo y la propiedad de un recibo de prueba. El operador configuraría la URL/clave de producción en Render, se repetiría una lectura y se comprobaría que Lite/Plus no recibieron workflows nuevos. Compass original debe seguir recuperable hasta validar el corte. No revocar la clave antigua en el mismo paso.

## Fase E — Despacho controlado

Ejecutar validaciones y despachos rutinarios automáticamente una vez que los tests demuestren permisos mínimos del token Bridge, salud de la base/idempotencia, allowlist de repos/workflow/ref y protección contra duplicados. Escalar únicamente si el cambio requerido excede el alcance preaprobado o las pruebas no definen una decisión segura. Un solo despacho autorizado debe seguirse desde recibo hasta Actions y registro del Runner. Repetir la misma clave idempotente debe demostrar que no aparece un segundo workflow. No confundir HTTP 201/202 con gate completado ni con certificación PASS.

## Fase F — Entrega al LLM sin GitHub

Pendiente de validar una Action de consumidor real. La entrega debe incluir:
- URL base del Observador elegido (staging para la validación inicial; producción solo tras fase D).
- OpenAPI actualizado.
- `X-API-Key` configurada como secreto de la Action/conector, no en el prompt.
- Operaciones de lectura: estado bilateral, plan de gate, evidencia de Actions y recibo Bridge.
- Prohibiciones: despachar, cancelar, reintentar, hacer push, fusionar o declarar PASS automático.
- Tratamiento conservador de 401/404/409/502/503, `RECONCILE` y `REFRESH`.

## No hacer

- No exponer Bridge directamente a la Action del LLM; el único POST público permitido para solicitudes protegidas pertenece a Observer y su destino upstream es Bridge interno.
- No convertir Bridge en proxy SQL.
- No modificar los motores matemáticos como parte de esta hoja.
- No activar auto-deploy en staging ni producción.
- No cambiar, copiar, rotar o revocar claves como parte de esta actualización documental.
- No fusionar PR como efecto colateral.
- No elegir licencia en silencio; la elección de licencia es una decisión separada y no bloquea las fases A/B ya cerradas.

## Definición de terminado

La herramienta auxiliar se considera entregada al LLM cuando la lectura staging/producción elegida y la Action consumidora estén validadas (A, B y F; D solo si se decide el corte a producción). La capacidad de despacho requiere que las pruebas y la validación end-to-end demuestren los criterios de salida (E); no requiere aprobación manual por operación rutinaria. La fusión de PR es una decisión de mantenimiento/revisión, no prueba de funcionamiento.

Una vez validada la superficie de observación y, si se autoriza, el despacho, se detiene el desarrollo auxiliar y se retoma la certificación matemática de Lite y Plus.


## Revisión de despliegues y alcance real de staging — 2026-10-30

La consulta de Render confirmó que los dos servicios auxiliares están no suspendidos, con auto-deploy desactivado y en Virginia/Free. También reveló que el código desplegado no coincide con los HEAD actuales de sus PR:

- Observador staging: deploy `dep-dbi88lbbc2fs73acq2kg`, LIVE sobre commit `aff31b6966baa32f980fb0d2ec8f9c8f93ec09e4`. El PR #4 actual está en `b8bbc188adcdce231670d88f45872c73b5ed2f34`. El commit desplegado sí contiene la ruta GET Bridge y fue el que atendió la prueba 200/401; no se ha desplegado automáticamente el HEAD posterior porque auto-deploy está off.
- Bridge independiente: deploy `dep-dbi5jc8ae00c73b9tnvg`, LIVE sobre commit `fec4dd1448b0385f98565725276b235ddc0821a2`. El PR #1 actual está en `d74926f5ef40982d99e80d0733a7b5150a37d26b` (antes de este cambio documental). El GET de estado del recibo funcionó contra el servicio LIVE, pero no se debe asumir que todos los cambios posteriores del PR están desplegados.
- Observador staging tiene confirmadas las variables `BRIDGE_BASE_URL`, `BRIDGE_TIMEOUT_SECONDS`, `llm` y `SERVICE_API_KEY` por la actualización de entorno. No hay evidencia de lectura de valores secretos. La presencia de `GITHUB_READ_TOKEN` en staging no está confirmada; sin ese token, `/v1/status`, `/v1/gates/{gate}/plan` y `/v1/runs/{run_id}` no podrán consultar GitHub aunque la ruta Bridge funcione. No copiar el token de producción automáticamente: crear/configurar un token de solo lectura dedicado a staging o autorizar conscientemente el alcance.

Consecuencia: la prueba A acredita únicamente la lectura de un recibo Bridge desde el código desplegado de Observador staging. No acredita todavía el conjunto completo de funciones de Observador ni la ejecución del HEAD actual de ambos PR. Para completar F hay que validar los endpoints GitHub de Observador y la Action consumidora.


## Estado de Supabase y vigencia de la clave temporal — lectura de solo consulta

El proyecto Supabase `precision-lab-bridge-db` (`umxtvefdcjwkiqsubfpb`) aparece `ACTIVE_HEALTHY`. Las cuatro migraciones esperadas están aplicadas y las cuatro tablas tienen RLS habilitado. Conteos observados: `bridge_keys=1`, `bridge_runs=1`, `bridge_calls=2`, `bridge_idempotency=0`. El recibo 94c102a5-5242-48ba-bdb7-4754a57513db está almacenado y apunta a la ejecución preexistente Lite 41005884405. La auditoría registra GET /api/runs/:id con HTTP 200.

La única clave de Bridge observada tiene etiqueta `staging-read-only-verification`, no está revocada y expira el **2026-10-31 09:05 UTC** (2026-10-31 03:05 hora de Honduras). No se consultó ni registró su hash, prefijo ni valor secreto. Si se pretende continuar probando staging después de esa hora, habrá que emitir una clave temporal nueva en Bridge y actualizar únicamente `llm` de staging en Render. No rotar ni modificar ahora la clave de producción.

La tabla `bridge_idempotency` está vacía: el recibo histórico consultado no prueba el flujo de despacho durable/idempotente actual. Por tanto, el estado del conjunto es: **lectura Bridge verificada; despacho idempotente end-to-end todavía no verificado**.


## Decisión v1 supersedida — Observer como único interlocutor (2026-10-30)

Esta sección conserva el registro de la arquitectura de entrada única adoptada previamente. **Queda supersedida por la decisión arquitectónica v2 multientrada/multicanal** que aparece al inicio del documento. Se mantiene únicamente para explicar el origen de las fases O1–O7 y preservar la trazabilidad histórica.

En v1 se había decidido que toda Action LLM se conectara exclusivamente a Observer y que Bridge aceptara solo llamadas server-to-server de Observer. Esa restricción ya no es la arquitectura objetivo. La versión v2 permite LLM→Observer, LLM→Bridge y rutas híbridas, siempre con política/estado compartidos, identidades separadas y validación final.

Las antiguas fases O1–O7 y los snapshots que describen el POST `/v1/bridge/dispatch`, scopes `read`/`dispatch`, despliegues, pruebas A/B y el despacho aún no validado se conservan como evidencia de la implementación v1. No se reabren ni se invalidan las fases A/B por el cambio de arquitectura. Las partes de O1–O7 que coincidan con M1–M7 pueden reutilizarse como trabajo o evidencia, pero no deben imponer la regla de interlocutor único.

**Disposición histórica:** O1–O4 describían la integración y autorización Observer→Bridge; O5 la idempotencia/reconciliación; O6 el E2E de despacho; O7 el cierre auxiliar. La lista vigente de trabajo y sus criterios de salida es M0–M7. No borrar los runs, recibos o pruebas históricas ni declarar que certifican la nueva Command API.

## Política operativa de autonomía — aclaración del usuario, 2026-10-30

Esta sección supersede toda frase anterior de este documento que exija aprobación humana por cada despacho, por cada prueba de ejecución o para continuar una operación rutinaria ya comprendida en el alcance aprobado.

### Principio rector

La autorización general para completar autónomamente la infraestructura auxiliar y la certificación matemática dentro del alcance y límites establecidos ya está concedida por el usuario. El objetivo de Observer/Bridge es automatizar, reducir pasos manuales y permitir que el LLM inspeccione, planifique, solicite, ejecute, observe, reconcilie y continúe sin pedir confirmaciones repetitivas.

**No solicitar aprobación humana para operaciones ordinarias** que:
- estén dentro de los repositorios Lite/Plus y de los gates/workflows/ramas permitidos por la configuración canónica;
- cumplan los contratos, allowlists, scopes y límites de seguridad existentes;
- tengan cobertura de pruebas suficiente y resultados deterministas;
- sean necesarias para completar el siguiente bloque de certificación;
- no impliquen una decisión de producto, alcance, licencia, publicación, exposición de datos o riesgo nuevo que el usuario no haya delegado.

La autorización general no debe interpretarse como permiso para ignorar contratos, tests, allowlists o evidencia. La autonomía se gobierna por esas reglas y se demuestra con pruebas; no mediante una cadena de aprobaciones manuales.

### Cuándo escalar al usuario

Solo escalar cuando exista una decisión material que no pueda resolverse con la especificación y las pruebas, por ejemplo:
- ambigüedad real en los criterios de aceptación o conflicto entre documentos canónicos;
- cambio de alcance, repositorios, gates, ramas protegidas, workflow objetivo o política de seguridad;
- decisión de licencia, titularidad, exposición pública de datos o publicación irreversible no contemplada;
- necesidad de desactivar una protección o aceptar un riesgo fuera de los límites ya establecidos;
- fallo de pruebas que requiera elegir entre resultados o comportamientos de producto no definidos.

Un fallo técnico ordinario no requiere aprobación: investigar, corregir, reforzar tests, volver a ejecutar y documentar. Si no hay un camino seguro dentro de las reglas vigentes, detener solo la operación afectada y presentar el bloqueo concreto, no pedir autorización genérica para seguir trabajando.

### Las pruebas son la fuente de verdad operativa

- Reforzar primero tests de contrato, autorización/scopes, allowlist, idempotencia, concurrencia, reconciliación, trazabilidad, regresión y comportamiento ante errores.
- Automatizar despachos ordinarios cuando esas pruebas acrediten que la solicitud está dentro de política.
- Para operaciones inciertas, aplicar RECONCILE; nunca reintentar ciegamente.
- Un dry_run=true que crea un workflow es un despacho real, pero no exige una aprobación por evento si está dentro de la política general delegada y las pruebas autorizan ese comportamiento.
- Un workflow SUCCESS solo acredita el resultado de esa ejecución; el estado matemático PASS sigue dependiendo de las pruebas y evidencias de certificación correspondientes.
- No crear un segundo mecanismo externo de aprobación, confirmación o autorización humana para compensar carencias de tests. La autorización y el control deben estar implementados en los contratos, roles y políticas existentes y probados automatizadamente.

### Autonomía y límites de mantenimiento

- Observer decide y coordina; Bridge valida, persiste idempotencia y despacha; Runner ejecuta los workflows existentes.
- La Action LLM se conecta exclusivamente a Observer.
- El LLM puede encadenar bloques, reconciliar resultados y continuar automáticamente mientras se mantenga dentro de los límites probados.
- No añadir servicios, capas, runners ni aprobaciones manuales por operación.
- Mantener la trazabilidad request → receipt → Actions run → Runner record → resultado de certificación.
- Una vez satisfechos los criterios O1–O7, congelar la infraestructura auxiliar y priorizar la certificación matemática Lite/Plus.



## Evidencia de scopes y dispatch Observer — 2026-10-30

- Bridge DB: migración `20261030133052_bridge_key_scopes`; columna `bridge_keys.scopes` con default `['read']` y allowlist cerrada `read|dispatch`.
- Clave staging existente: verificada como `['read']`; no se leyó ni modificó el secreto.
- Bridge code: `trigger` exige scope `dispatch`; `runStatus` y `lookupRequest` exigen `read`. El panel admin permite claves read-only, dispatch-only o combinadas.
- Tests: clave read-only no puede claim/dispatch; clave dispatch-only no puede consultar recibos. Las pruebas de idempotencia/concurrencia existentes permanecen en la suite.
- Observer: `BRIDGE_DISPATCH_KEY` separado de `llm`; `POST /v1/bridge/dispatch` revalida plan live/branch/SHA y delega server-to-server; `GET /v1/bridge/requests/{idempotency_key}` reconcilia usando la clave read-only.
- Bridge CI SUCCESS en SHA `74a592253b293a1919dc7387bfbc74f239524044` (unit/regression, ESLint, build). La ejecución del HEAD de UI posterior sigue en validación.
- Observer CI SUCCESS en SHA `d5333da7e128f3301b55da846e5c9b76eafff19d` (pytest); los commits posteriores de OpenAPI y prueba de no-fallback requieren validar el HEAD actual.
- No se ha realizado deploy de los nuevos HEADs ni E2E Bridge→GitHub→receipt→Observer. No se declara cerrado O6.



## Staging deployment — 2026-10-30 13:52 UTC

Los HEAD de ambos PR ya están desplegados en My Workspace, sin activar auto-deploy:

- Bridge `99a439c11726e8d4424b48f43d74a11508848366`: deploy `dep-dbia0bm7bikc73aijvn0`, estado `live`. Build y arranque Bun completados; Render registró el servicio live.
- Observer `6e712094a7e4b06a13224f66d6f3a6c26f991152`: deploy `dep-dbia1b9srm7s73dltcpg`, estado `live`. Build, startup de Uvicorn y startup de aplicación completados.
- CI Bridge `41065225032` y CI Observer `41064924977`: SUCCESS en los respectivos HEADs.
- Se creó una clave staging independiente `observer-staging-dispatch`, scope exclusivo `dispatch`, expira `2026-11-06T13:50:27Z`; su valor y hash no se guardan en documentación. ID de fila: `9f7affec-b6a7-4d8f-b0bd-629a778adfd9`. Se configuró como `BRIDGE_DISPATCH_KEY` en Observer, junto con `BRIDGE_BASE_URL`.
- La clave anterior read-only no se rotó ni amplió.

### Límite de la validación actual

Una consulta SQL posterior confirmó una clave dispatch activa, cero filas de `bridge_idempotency` y cero llamadas realizadas con la nueva clave. El único `bridge_runs` registrado es el recibo histórico previo. No se ha emitido un POST real desde Observer ni se ha creado un workflow de prueba.

Los servicios están LIVE, pero O6 sigue pendiente: la sesión de ejecución dispone de herramientas para despliegue, logs y consulta de datos, pero no de un cliente HTTP autenticado que permita invocar el POST de Observer con sus headers y body. Los intentos de abrir las URLs mediante el lector web no proporcionaron acceso HTTP. No simular la llamada mediante SQL ni sustituirla por un dispatch directo a GitHub: eso invalidaría la prueba Observer→Bridge.

Siguiente evidencia necesaria: POST autenticado a `/v1/bridge/dispatch` con plan live `RUN`, seguido de GET de reconciliación con la misma `idempotency_key`; verificar un solo workflow, un recibo durable y correlación con el Runner. Hasta entonces, no declarar O6/O7 cerrados ni reanudar la certificación como si el flujo auxiliar estuviera certificado.


## Corte documental consolidado — 2026-10-30 UTC

Esta sección es la referencia vigente para la conciliación administrativa y supersede los estados históricos de CI/HEAD anteriores de este documento.

### Fases A y B — cerradas

- **A — PASS:** staging de Observador consultó el recibo existente de Bridge. La petición autenticada devolvió HTTP 200; la petición anónima devolvió HTTP 401. Recibo Bridge `94c102a5-5242-48ba-bdb7-4754a57513db`; referencia histórica Lite Actions `41005884405`; baseline Plus `40970642558`. No se generaron nuevos workflows como parte de esta prueba.
- **B — PASS:** contrato `README_CONTRACT.md` y `openapi.yaml` documentan la ruta GET protegida, la separación entre UUID Bridge e ID de Actions, autenticación y respuestas de error. Observer CI [41051691930](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41051691930), HEAD `ed6a5726c3564054897f4a3d34f73194dfcc6954`; Bridge CI [41050127027](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41050127027).
- No reabrir A/B por el trabajo posterior de migración de la base Bridge: son criterios distintos y su evidencia permanece válida.

### Migración remota Bridge — aplicada y conciliada

- Proyecto Supabase: `umxtvefdcjwkiqsubfpb` (`precision-lab-bridge-db`).
- Versión aplicada y registrada: `20261030200900`.
- Archivo canónico: `supabase/migrations/20261030200900_bridge_security_ownership_and_rpc_integrity.sql`.
- Blob SHA del archivo: `488779521e6df48964234e171ec15db07d82c8fb`.
- Commit de alineación del nombre: `e0bc3e35c89fa152cd59177c18863ac140e28bcb`.
- Bridge CI #58 [41121256457](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41121256457): ambos jobs SUCCESS, incluido replay de las seis migraciones, aserciones estructurales, pruebas funcionales de las cinco RPC y lint.
- Bridge CI #59 [41121381925](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41121381925): ambos jobs SUCCESS sobre el HEAD actualizado `f8ea3afa74c0f6d5546c1a5bc3e3f2e26f768239`; el archivo versionado conserva el mismo blob SHA.
- Verificación remota posterior: 2 claves, 1 ejecución, 2 llamadas, 0 idempotencias; cero propietarios inválidos/huérfanos; cinco RPC SECURITY INVOKER ejecutables por `service_role`, ninguna por `anon` o `authenticated`; RLS activo en las cuatro tablas.
- Los cuatro avisos INFO RLS sin políticas y los dos avisos INFO de índices sin uso se mantienen sin cambios intencionalmente.

### PR históricos de Observador — diferidos, no bloqueantes

Los PR #1, #2 y #3 pertenecen a `c2melendez/precision-lab-readonly-api`, no al PR #1 de Bridge. Los tres continúan abiertos y sin merge; #3 permanece Draft.

| PR Observador | Disposición vigente |
|---|---|
| #1 — reconciliación documental API/Render | Diferido, no bloqueante. No mezclar con certificación matemática. |
| #2 — categorías técnicas del fingerprint | Diferido, no declarar PASS: sus intentos históricos fallaron antes de asignar runner y no ejecutaron pytest. Reevaluar solo si vuelve a ser necesario. |
| #3 — API antigua de despacho aislado | Diferido/bloqueado por arquitectura y requisitos propios. No reactivar: la arquitectura vigente delega el despacho interno a Bridge desde Observer. |

Bridge PR #1 es un PR distinto: permanece abierto y Draft. CI #59 acredita su HEAD actual, pero no implica aprobación de merge.

### Límites que permanecen vigentes

- Fases A y B cerradas; C queda en revisión documental/técnica según el estado de los PR.
- No fusionar PR #1 de Bridge ni PR #4 de Observador como efecto colateral.
- No desplegar Bridge ni Observador, no activar auto-deploy y no hacer corte de producción.
- No rotar/revocar credenciales ni modificar variables productivas.
- No ejecutar un POST de despacho ni iniciar workflows de Lite/Plus en esta conciliación.
- La validación de CI de Bridge no equivale a prueba E2E Bridge → Runner ni a certificación matemática PASS.
- La prioridad final continúa siendo la certificación matemática Lite/Plus, una vez resueltos los límites auxiliares que realmente sean necesarios.

## Runner y Bridge — validación controlada 2026-10-30

### Paridad del contrato Runner Lite/Plus

- En ambas ramas canónicas `qa/syntax-audit-in625-a1`, Runner v2 acepta el repositorio local y `target_repo=both`; el guard permite el modo bilateral y cada workflow solo procesa su propio repositorio.
- Los dos repositorios contienen el mismo test file `scripts/certification/test_runner_contract.py` (blob `ff5c499cb6eae8277279265a26a897ff982288a0`). La suite de continuidad ejecutó 44 pruebas en Lite y 63 en Plus; el paso de contrato terminó SUCCESS en ambos.
- Lite HEAD `e59e2078217e3ce5704ffafa9557202b8182a2a0`; Runner push [41130209548](https://github.com/c2melendez/precision-lab-lite/actions/runs/41130209548) SUCCESS. Plus HEAD `2cd2058e7ece9b26bc42d52b64b9ad9b9c731d78`; Runner push [41129595065](https://github.com/c2melendez/precision-lab-plus/actions/runs/41129595065) SUCCESS.
- En ambos runs, `Push summary` fue SUCCESS y los pasos `Dispatch gate workflow` y `Record result in QA` quedaron SKIPPED. No se inició ningún gate matemático.
- El workflow Runner v3 de `main` tiene el mismo blob SHA en Lite y Plus: `bcaef28a5408c0a857ed514232f5ec9bd769a1bb`. La diferencia v3/main frente a v2/canónica queda identificada; ambas líneas aceptan el contrato bilateral.

### Bridge: idempotencia durable y política de seguridad

- Bridge CI [41130887814](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41130887814), HEAD `b244d8c1bd768fd9368aedfaf1be394c2828b145`: ambos jobs SUCCESS.
- El job general registró 80 pruebas aprobadas; las 13 pruebas DB se ejecutan separadamente en el job de Supabase local.
- El job DB reconstruyó las migraciones, verificó restricciones/RPC, ejercitó las cinco RPC y ejecutó `idempotency.database.test.ts`: **13/13 PASS**. También terminó `supabase db lint` sin error.
- Todas las llamadas a GitHub en esa suite están simuladas; no se creó ningún workflow ni se despachó un gate.
- Bridge ahora rechaza `gate=security` para `target_repo=plus` y `target_repo=both` antes de reclamar idempotencia o iniciar un despacho, evitando una ejecución bilateral parcial. La política se conserva también en Runner como defensa en profundidad.

### Disposición O5/O6/O7
- Observer PR #4, HEAD `6e712094a7e4b06a13224f66d6f3a6c26f991152`, CI [41064924977](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41064924977) SUCCESS: 29 tests; dispatch autenticado, plan live, SHA/rama canónica, clave dispatch separada, propagación de idempotency/validation/correlation, timeout incierto y reconciliación read-only. Todo con Bridge simulado; no ejecutó dispatch.

- **O5 — parcialmente acreditado, sigue en progreso:** la capa durable de Bridge y la paridad del contrato Runner están probadas. Falta demostrar la cadena real Observer → Bridge → Actions → Runner → evidencia matemática y su replay sin duplicación.
- **O6 — PENDING:** el criterio canónico exige un workflow dispatch controlado, un recibo durable enlazado con el Actions run real y la reconciliación de su SHA/Runner. Esta iteración no invocó `POST /v1/bridge/dispatch` ni `workflow_dispatch`; las pruebas simuladas no se presentan como E2E real.
- **O7 — PENDING:** depende del cierre de O6 y de los gaps anteriores O1–O5. No congelar ni declarar cerrada toda la infraestructura auxiliar todavía.
- Bridge PR #1 continúa abierto y Draft, sin merge. No hubo despliegue, cambio de producción, activación de despacho ni ejecución de gates matemáticos.

### Observer — contrato de despacho probado sin ejecución real

- Observer PR #4, HEAD `6e712094a7e4b06a13224f66d6f3a6c26f991152`, CI [41064924977](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41064924977): SUCCESS.
- Las pruebas cubren autenticación del POST `/v1/bridge/dispatch`, plan live `RUN`, rechazo de `WAIT` y SHA obsoleto antes de llamar Bridge, uso de la credencial dispatch-only y reconciliación mediante la credencial read-only.
- Son pruebas de contrato/unidad con Bridge simulado. No se realizó POST live ni workflow dispatch. Observer PR #4 permanece abierto, sin merge.
- El HEAD documental Bridge `4427b5871bd8a46f9cc5fd03032eb053bf448d1e` pasó Bridge CI [41131674843](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41131674843). La evidencia de código, política e idempotencia se ejecutó en su commit padre `b244d8c1bd768fd9368aedfaf1be394c2828b145`.


## Reconciliación r360 — Certification Runner y mecanismo paralelo (2026-10-30 UTC)

### Certification Runner Lite/Plus

Los runs push más recientes se inspeccionaron por metadata, jobs, pasos y logs:

| Repositorio | SHA del checkout | Run Runner | Resultado | Alcance acreditado |
|---|---|---|---|---|
| Lite | `c8c29d820e5bd16ab4df8a528bcea9b4a72f8acc` | [41138509571](https://github.com/c2melendez/precision-lab-lite/actions/runs/41138509571) | SUCCESS | Rama canónica, checkout, BASE_SHA, fingerprint read-only y Push summary |
| Plus | `218d682848a03a000930e2028f057563847381f3` | [41136660038](https://github.com/c2melendez/precision-lab-plus/actions/runs/41136660038) | SUCCESS | Rama canónica, checkout, BASE_SHA, fingerprint read-only y Push summary |

En ambos runs los pasos de gate policy, dry-run summary, detección/espera de run equivalente, dispatch, registro del resultado en QA, persistencia de continuidad y commit documental fueron `SKIPPED`. Esta es una validación **PASS_SCOPED del camino push/no-dispatch**, no una certificación completa del Runner. No demuestra el camino `workflow_dispatch`, el dispatch del gate, receipt durable ni replay idempotente.

Los gates matemáticos de AS-EXP-02 en Lite (CI 41138509410, cumulative 41138509481, H1d 41138509536 y Scientific UI 41138509494) validan el motor y su UI sobre el SHA técnico Lite; no se cuentan como dispatch producido por Observer/Bridge.

### Estado del mecanismo paralelo

- **A — CERRADA.** Se conserva la evidencia staging autenticada 200 / anónima 401 para lectura de un recibo existente.
- **B — CERRADA.** Contrato GET/OpenAPI y CI asociado permanecen cerrados; no reabrir por esta reconciliación.
- **O5 — IN_PROGRESS.** Hay evidencia sólida de idempotencia Bridge/DB, pruebas de contrato Observer y paridad de contrato Runner, más PASS_SCOPED del camino push/no-dispatch en ambos productos. Sigue faltando la cadena real Observer → Bridge → GitHub Actions → Runner → evidencia y su replay sin duplicación.
- **O6 — PENDING.** No se ejecutó POST de despacho desde Observer ni `workflow_dispatch` real; el usuario mantiene expresamente inactivo el despacho real. Los runs push no sustituyen esta evidencia.
- **O7 — PENDING.** Depende de O1–O6; no declarar cerrada toda la infraestructura auxiliar.

### Disposición operativa

Compass Runner se considera cerrado para el alcance de la conciliación documental vigente y no debe reintroducirse como prerrequisito matemático. Es distinto del Certification Runner integrado en Lite/Plus y del mecanismo Observer/Bridge descrito en esta hoja. No se han hecho merges, deploys, cambios productivos ni despachos reales. La certificación global matemática continúa OPEN; la siguiente tarea de motor Lite es AS-EXP-03.


### Addendum r360 — Runner push posterior a AS-EXP-03

Lite generó un nuevo run de Certification Runner [41140700509](https://github.com/c2melendez/precision-lab-lite/actions/runs/41140700509) en SHA `4e8e57ef8bc731c41a270facef42cac6a4fe708c`. Terminó SUCCESS: rama canónica resuelta, checkout, BASE_SHA y fingerprint correctos; Push summary SUCCESS. Los pasos de gate policy, dry-run, detección/espera, dispatch, registro QA, persistencia y commit documental quedaron SKIPPED. Confirma nuevamente PASS_SCOPED del camino push/no-dispatch, no el despacho real. AS-EXP-03 usa ese SHA y sus gates de CI/cumulative/H1d/Scientific UI seguían en curso al corte; el resultado Runner no equivale a aceptación del caso matemático.


### Runner contract parity — detalle adicional r360

- Lite y Plus conservan el mismo test de contrato `scripts/certification/test_runner_contract.py`, blob `ff5c499cb6eae8277279265a26a897ff982288a0`. La evidencia de regresión registrada es Lite 44/44 en [41130209548](https://github.com/c2melendez/precision-lab-lite/actions/runs/41130209548) y Plus 63/63 en [41129595065](https://github.com/c2melendez/precision-lab-plus/actions/runs/41129595065).
- Los workflows YAML no son byte-identical, pero la diferencia observada se limita a defaults y comentarios propios del repositorio: `target_repo=lite` frente a `target_repo=plus`, más texto explicativo. Ambos exponen `both`, gate y `dry_run`, resuelven la rama canónica desde README y protegen push/dry-run frente a dispatch.
- Runner Lite más reciente: [41141037836](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141037836), SHA `0a85b448298df0691b043269648d327d0a7aec0b`, SUCCESS en push/no-dispatch. Los gates del motor AS-EXP-03 en ese SHA continúan en validación; no confundir el run del Runner con aceptación del caso.


### Reconciliación matemática r361

Lite AS-EXP-03 quedó PASS_SCOPED en SHA `0a85b448298df0691b043269648d327d0a7aec0b`: CI [41141038026](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141038026), cumulative [41141037941](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141037941) y H1d [41141037866](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141037866) SUCCESS; Runner push [41141037836](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141037836) SUCCESS/no-dispatch. Scientific UI [41141038013](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141038013) seguía IN_PROGRESS como prueba complementaria. La aceptación está en `ALGEBRA114_AS_EXP_03_ACCEPTANCE_R361.md`; siguiente caso Lite AS-EXP-04. Esta actualización matemática no cambia O5/O6/O7 ni certifica el despacho paralelo.


### Runner Lite — nuevo corte r361

Certification Runner [41141571479](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141571479) terminó SUCCESS en SHA `933fad5c3e55db06db9de6ff21e02cd96070da0f` (push). Resolución de rama canónica, checkout, BASE_SHA, fingerprint y Push summary SUCCESS; gate policy, dry-run summary, detección/espera, dispatch, registro QA, persistencia y commit documental SKIPPED. Se mantiene PASS_SCOPED exclusivamente para push/no-dispatch. AS-EXP-04 usa ese SHA y sus gates matemáticos están en curso.


### Reconciliación matemática r362

Lite AS-EXP-04 PASS_SCOPED en SHA `933fad5c3e55db06db9de6ff21e02cd96070da0f`: CI [41141571381](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141571381), cumulative [41141571350](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141571350), H1d [41141571338](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141571338) SUCCESS; Runner push [41141571479](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141571479) SUCCESS/no-dispatch. Scientific UI [41141571351](https://github.com/c2melendez/precision-lab-lite/actions/runs/41141571351) seguía IN_PROGRESS como evidencia complementaria. Aceptación `ALGEBRA114_AS_EXP_04_ACCEPTANCE_R362.md`; siguiente caso AS-EXP-05. No altera el estado O5/O6/O7 ni acredita despacho paralelo.


### Reconciliación matemática r363 — AS-EXP-05 en ejecución

Lite AS-EXP-04 permanece PASS_SCOPED en SHA `933fad5c3e55db06db9de6ff21e02cd96070da0f`. AS-EXP-05 se inició en SHA `4341955335d6898c4979063520432f82a6d129ba`, test blob `b6985e7139ca77edc78faa48f6d55104d76a2627`; CI [41142010457](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010457), cumulative [41142010406](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010406), H1d [41142010389](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010389), Scientific UI [41142010385](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010385) y Runner [41142010410](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010410) estaban en cola/ejecución al corte. No declarar aceptación todavía.


### Runner Lite — AS-EXP-05 push r363

Certification Runner [41142010410](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010410) terminó SUCCESS en SHA `4341955335d6898c4979063520432f82a6d129ba`. Resolución de rama canónica, checkout, BASE_SHA, fingerprint y Push summary SUCCESS; gate policy, dry-run, detección/espera, dispatch, registro, persistencia y commit documental SKIPPED. Sigue siendo PASS_SCOPED solo para push/no-dispatch. Los gates de AS-EXP-05 continúan en ejecución.


### Reconciliación matemática r364

Lite AS-EXP-05 PASS_SCOPED en SHA `4341955335d6898c4979063520432f82a6d129ba`: CI [41142010457](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010457), cumulative [41142010406](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010406), H1d [41142010389](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010389) SUCCESS; Runner push [41142010410](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010410) SUCCESS/no-dispatch. Scientific UI [41142010385](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142010385) seguía IN_PROGRESS como evidencia complementaria. Aceptación `ALGEBRA114_AS_EXP_05_ACCEPTANCE_R364.md`; siguiente caso AS-EXP-06. El estado O5/O6/O7 permanece sin cambios.


### Reconciliación matemática r365 — AS-EXP-06 en cola

Lite AS-EXP-05 permanece PASS_SCOPED. AS-EXP-06 se inició en SHA `fe9806f3503d70aaef4d89673f85ad13092f3211`, test blob `2b9492992e0cfc08b4ef3161ad573e54e221eb6a`; CI [41142483043](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142483043), cumulative [41142482968](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142482968), H1d [41142482951](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142482951), Scientific UI [41142482971](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142482971) y Runner [41142483063](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142483063) estaban queued al corte. No declarar aceptación.


### Addendum r366 — AS-EXP-06 candidate correction

El candidato inicial de AS-EXP-06 (`fe9806f3503d70aaef4d89673f85ad13092f3211`) falló porque Algebrite devolvió los monomios en un orden conmutativo distinto al string esperado (`x^3+y^3+3*x*y^2+3*x^2*y`). La corrección compara el conjunto ordenado de términos exactos y conserva el oráculo numérico independiente `(x+y)^3`. Nuevo SHA `5901316519ca98d0810ac0f228c91abe6380ee7f`, test blob `75f74428c431f5a04b60a4580e7ade8ac70cff86`; CI [41142684332](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142684332), cumulative [41142684039](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142684039), H1d [41142684020](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142684020) y Runner [41142684118](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142684118) finalizaron SUCCESS en el mismo SHA. Cumulative registra el test focalizado PASSED (366 archivos, 2,259 passed, 8 expected fail, 34 todo); H1d 22 E2E passed. Scientific UI [41142683997](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142683997) seguía IN_PROGRESS al corte, complementario y no requerido. AS-EXP-06 queda PASS_SCOPED con aceptación `ALGEBRA114_AS_EXP_06_ACCEPTANCE_R365.md`.

## Reconciliación r367 — Certification Runner y mecanismo paralelo (2026-10-30 UTC)

### Estado verificado del Certification Runner

| Repositorio | Run | SHA del checkout | Evento | Resultado |
|---|---:|---|---|---|
| Lite | [41142684118](https://github.com/c2melendez/precision-lab-lite/actions/runs/41142684118) | `5901316519ca98d0810ac0f228c91abe6380ee7f` | push | SUCCESS |
| Plus | [41136660038](https://github.com/c2melendez/precision-lab-plus/actions/runs/41136660038) | `218d682848a03a000930e2028f057563847381f3` | push | SUCCESS |

En ambos runs se verificó: resolución de la rama canónica desde el README predeterminado, checkout de la rama canónica, registro de BASE_SHA, fingerprint read-only y Push summary SUCCESS. En ambos quedaron SKIPPED: gate policy/workflow resolution, dry-run summary, detección y espera de una corrida equivalente, workflow dispatch, registro del recibo QA, persistencia de continuidad y commit documental.

**Decisión:** `PASS_SCOPED_PUSH_ONLY` para el camino push/no-dispatch de Lite y Plus. Esto acredita que el Runner se inicia, resuelve y consulta la rama canónica, calcula el fingerprint y finaliza el push sin despachar. No acredita `workflow_dispatch`, despacho de gate, receipt durable, correlación Observer→Bridge→Actions→Runner ni replay idempotente. El test de contrato `scripts/certification/test_runner_contract.py` conserva el mismo blob en ambos repositorios: `ff5c499cb6eae8277279265a26a897ff982288a0`; los YAML mantienen diferencias intencionales solo en defaults locales y comentarios.

### Estado global del mecanismo Observer → Bridge → Actions → Runner

- **Fases A/B — CLOSED.** Lectura staging de un recibo existente desde Observer: HTTP 200 autenticado y HTTP 401 anónimo; contrato GET de estado documentado. No se creó un workflow nuevo en esa prueba.
- **O5 — IN_PROGRESS.** Bridge dispone de pruebas de idempotencia, concurrencia, lease, persistencia entre procesos, conflictos y reconciliación; Observer tiene pruebas de autenticación, scopes, plan live y propagación de identificadores. Sin embargo, las pruebas de despacho son simuladas y no existe aún una traza real request → receipt durable → Actions run → Runner record → evidencia matemática, seguida de replay sin duplicación.
- **O6 — PENDING, no FAIL.** No se ejecutó `POST /v1/bridge/dispatch` ni `workflow_dispatch` real por la restricción operativa vigente. No sustituir esta condición con despacho directo ni con mocks.
- **O7 — PENDING.** Depende de la salida de O6 y del cierre del alcance auxiliar. No hay autorización implícita para merge, deploy ni corte de producción.
- **PRs vigentes:** Observer PR #4 abierto/Ready for review, HEAD `6e712094a7e4b06a13224f66d6f3a6c26f991152`, CI 41064924977 SUCCESS. Bridge PR #1 abierto/Draft, HEAD `ce634c5a5078d57de1f54a8f77a352077487373b`, CI 41142813306 PENDING; CI previo 41131674843 SUCCESS corresponde a SHA anterior `4427b5871bd8a46f9cc5fd03032eb053bf448d1e`.

### Estado matemático coordinado

Lite AS-EXP-02, AS-EXP-03, AS-EXP-04, AS-EXP-05 y AS-EXP-06 están PASS_SCOPED, cada uno con su SHA y aceptación propia. AS-EXP-06: SHA `5901316519ca98d0810ac0f228c91abe6380ee7f`; CI 41142684332, cumulative 41142684039, H1d 41142684020 SUCCESS; Runner 41142684118 SUCCESS push/no-dispatch. Scientific UI 41142683997 es complementario y no requerido. Siguiente caso Lite: AS-EXP-07, con oráculo aritmético independiente. Plus conserva su bloqueo contractual VC-FE-45; no se importa aceptación de Lite.

Sin merge, deploy, cambio de producción ni despacho real. La certificación global permanece OPEN.

## Reconciliación r368 — Runner y siguiente bloque matemático (2026-10-30 UTC)

### Certification Runner actualizado

- Lite: [41144150833](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144150833), SHA `c791540390b2e5a3c27f11b7a9a444ad04012a20`, evento push, SUCCESS.
- Plus: [41136660038](https://github.com/c2melendez/precision-lab-plus/actions/runs/41136660038), SHA `218d682848a03a000930e2028f057563847381f3`, evento push, SUCCESS.
- Ambos verificaron resolución de rama canónica, checkout, BASE_SHA, fingerprint read-only y Push summary. En ambos dispatch, espera, registro QA, persistencia y commit documental quedaron SKIPPED.
- Estado bilateral: `PASS_SCOPED_PUSH_ONLY`. No se certifica workflow_dispatch, dispatch de gate, recibo durable, correlación E2E ni replay idempotente.

### Continuidad matemática y paralela

- Lite AS-EXP-06: PASS_SCOPED en SHA `5901316519ca98d0810ac0f228c91abe6380ee7f`, aceptación `ALGEBRA114_AS_EXP_06_ACCEPTANCE_R365.md`.
- Lite AS-EXP-07 está en ejecución en SHA `c791540390b2e5a3c27f11b7a9a444ad04012a20`; test blob `06f362c0aeced0100b266c7dcf6465c06324f8b1`. CI 41144150978, cumulative 41144150867 y H1d 41144150866 estaban IN_PROGRESS al corte; Runner 41144150833 SUCCESS/no-dispatch. No aceptar AS-EXP-07 hasta que los tres gates obligatorios terminen SUCCESS en el mismo SHA.
- Fases A/B continúan CLOSED; O5 IN_PROGRESS; O6 PENDING por ausencia deliberada de dispatch real; O7 PENDING y dependiente de O6. No hay merge, deploy, corte de producción ni dispatch real.

## Reconciliación r369 — AS-EXP-07 y Runner push (2026-10-30 UTC)

- **AS-EXP-07 Lite — PASS_SCOPED.** SHA `c791540390b2e5a3c27f11b7a9a444ad04012a20`; CI [41144150978](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144150978), cumulative [41144150867](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144150867), H1d [41144150866](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144150866) SUCCESS. Runner [41144150833](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144150833) SUCCESS push/no-dispatch. Scientific UI 41144150819 quedó IN_PROGRESS al corte y es complementario. Aceptación `ALGEBRA114_AS_EXP_07_ACCEPTANCE_R366.md`.
- **Certification Runner:** Lite 41144150833 SUCCESS sobre SHA c791540390b2e5a3c27f11b7a9a444ad04012a20; Plus 41136660038 SUCCESS sobre SHA 218d682848a03a000930e2028f057563847381f3. Ambos PASS_SCOPED_PUSH_ONLY; dispatch, recibo y persistencia SKIPPED.
- **Mecanismo paralelo:** A/B CLOSED; O5 IN_PROGRESS; O6 PENDING por no existir despacho real; O7 PENDING y dependiente de O6. No hay traza E2E ni replay idempotente real.
- **Siguiente caso matemático Lite:** AS-EXP-08 `(x+2)(x-3)(x+1)=x^3-7x-6`, con oráculo aritmético independiente. Global OPEN; sin merge, deploy, producción ni dispatch real.

## Registro de decisión v2 — 2026-10-30

La decisión arquitectónica multientrada/multicanal, el catálogo de mecanismos, el Command API objetivo y las fases M0–M7 están definidos al inicio de este documento. Esta sección no declara que los adaptadores, el Command API o el worker de modificación ya estén implementados. M0 queda documentado; M1 es el siguiente bloque de implementación. Las fases A/B permanecen cerradas; los estados O1–O7 se conservan como historial v1 supersedido.

## Evidencia M1 — cierre PASS_SCOPED (2026-10-30; timestamps CI 2026-10-31 UTC)

- Repositorio/branch: `c2melendez/precision-lab-bridge`, `hardening/secure-status-independent-runtime`.
- SHA exacto validado: `b622a26605b1402c73fe1aff327fc2f1941bc1e2`.
- Commit: [b622a266](https://github.com/c2melendez/precision-lab-bridge/commit/b622a26605b1402c73fe1aff327fc2f1941bc1e2).
- CI: [41172743808](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41172743808), `completed / success`; `Tests, lint and build` SUCCESS y `Supabase migration chain (disposable local DB)` SUCCESS.
- Tests de aplicación: 111 passed; 19 tests DB skipped en el job sin DB. En el job DB dedicado, 19/19 tests passed y 0 skipped.
- Seguridad DB: replay de migraciones desde base limpia, RLS/grants/constraints, scripts SQL de RPC/idempotencia, todo SUCCESS. `supabase db lint`: `No schema errors found`.
- Lint: 0 errores; 6 warnings React Fast Refresh. Build Vite/Nitro: SUCCESS.

**Limitaciones:** no se desplegó el commit ni se configuró el valor de `OBSERVER_SERVICE_KEY` en Render; por tanto no se declara llamada live Bridge→Observer. El proxy de archivos se reserva para M3. M1 solo registra comandos con estado `accepted` y `execution_enabled: false`; no ejecuta patches ni jobs. Sin merge, dispatch real, migración en producción o cambios en Lite/Plus. M2 permanece NOT_STARTED.


## Revisión de mecanismos reportados por LLM — 2026-10-31

**Alcance.** Se revisaron seis conversaciones exportadas (Copilot, Qwen, Qwen Coder, DeepSeek, Gemini y Meta AI) que describen qué mecanismos de la tabla P0–P3 creen tener disponibles. Cada afirmación se contrastó con la evidencia que la respalda. Registro estructurado: `llm_mechanism_review_2026_10_31` en el JSON.

**Clasificación de la evidencia.**
- Solo autodeclaración: Copilot, Qwen, DeepSeek, Gemini y Meta AI. Describen capacidades probables de su host, no accesos verificados a Observer ni a Bridge.
- Sonda en sandbox, no evidencia de Precision Lab: Qwen Coder. Sus pruebas (curl público a `api.github.com` sin credenciales, validación de un OpenAPI 3.0.3 de ejemplo y peticiones HTTPS a endpoints públicos) demuestran salida HTTPS del sandbox. No demuestran acceso a Observer ni a Bridge.

Las respuestas se contradicen en varios puntos (por ejemplo, Meta AI niega OpenAPI mientras Qwen Coder validó uno; Copilot responde distinto en sus dos exportaciones). Por eso se tratan como hipótesis.

**Veredicto.** La arquitectura v2 no cambia. Casi todos los reportes admiten que no pueden llamar por sí solos a una API, un servidor MCP o un webhook arbitrario: necesitan que el host exponga una herramienta o un adaptador. El cuello de botella práctico es el adaptador por despliegue, no la Command API.

**Hallazgos que cambian el roadmap.**
1. **Function Calling** aparece como mecanismo propio en 5 de 6 reportes, condicionado a que el host lo exponga. Es el primer adaptador de M4 y debe generarse desde el mismo OpenAPI y desde `GET /api/v1/capabilities`, sin esquemas escritos a mano.
2. **Ningún agente sin endpoint público recibe notificaciones.** Los resultados de comandos se leen por pull: `GET /api/v1/commands/{id}` o `lookup` por `Idempotency-Key`.
3. **Las pruebas del sandbox del consumidor no son validación.** Solo cuentan los perfiles allowlisted del Runner.
4. **Un consumidor con conectores de escritura puede escribir fuera de Bridge.** Esto incluye GitHub, Render u otro conector. Sin `expected_sha` ni evidencia, ese cambio no pasa por las reglas del sistema. La excepción debe cubrir cualquier conector con capacidad de escritura, no solo GitHub, y ese consumidor no cuenta como sin credenciales para M6.
5. **Falta un barrido en segundo plano.** El roadmap no define qué cierra comandos `accepted`/`queued` sin recibo ni leases vencidos. Las pruebas cubren la expiración solo en el claim. Debe diseñarse antes de cerrar M2.

**Decisiones sobre los mecanismos propuestos.**

| Mecanismo | Reportado por | Decisión | Motivo |
|---|---|---|---|
| Streaming de estado (SSE, WebSocket) | Qwen, DeepSeek, Copilot, Qwen Coder | Diferido, opcional, lectura, después de M3 | El polling de `GET /commands/{id}` basta para M2–M3. Un stream añade conexiones sin necesidad medida. |
| Notificaciones salientes al agente | Qwen | Rechazado como mecanismo; se adopta como invariante | Los agentes no reciben push. La finalización se consulta por pull. |
| Tareas programadas | Meta AI | Necesidad interna, no mecanismo LLM | Hace falta el barrido del punto 5. |
| Sandbox de ejecución | Copilot, DeepSeek, Qwen, Qwen Coder, Meta AI | Solo consumidor; no es evidencia | Válido para pruebas locales; no reemplaza el Runner. |
| Adjuntos y archivos | Qwen | Ya cubierto | `artifact_refs` en el sobre del Command API. |
| RAG / memoria vectorial | Copilot, Qwen, DeepSeek | Diferido; si hace falta, vive en Observer | Observer es la fuente de verdad; otro índice sería una segunda fuente. |
| Descubrimiento de herramientas | Copilot, Qwen | Ya cubierto | `GET /api/v1/capabilities`. |
| Git sobre HTTPS, SSH, TCP crudo, gRPC | Qwen Coder, Copilot, DeepSeek | Rechazado | Contradice la ausencia de shell arbitrario y la escritura solo por operaciones tipadas. |
| GraphQL | DeepSeek | Rechazado | Duplica OpenAPI sin consumidor que lo pida. |
| Voz, navegador o control de escritorio | Qwen, DeepSeek | Rechazado | Fuera del plano de comandos. |
| Conectores personales (correo, drives, chat, calendario) | Copilot, Meta AI | Rechazado | Son conectores del host, no mecanismos de este sistema. |
| Sub-agentes de una misma plataforma | Meta AI | No cuenta para M6 | M6 exige dos agentes con identidades y claves distintas. |

**Ajustes al roadmap.**
1. **Sonda por consumidor.** Cada LLM usa identidad Bridge/Observer propia y scopes mínimos. Las claves se provisionan directamente en el gestor de secretos/host/MCP/conector y el runtime adjunta las cabeceras; nunca se pegan en prompts ni se exponen al modelo. Si el host no puede ocultar la clave al LLM, marcar `BLOCKED/credential_not_provisioned`. Verificar `capabilities`, estado, scopes, replay, recibo y lookup. Estado de aceptación: PENDIENTE hasta completar rutas y pruebas live. Batería: `docs/parallel-tool-consumer-probe-battery.md` v2.0.0, 33 sondas A–F más benchmark CB1–CB10.
2. **Rutas por consumidor.** La ruta se asigna según la sonda, no por diseño global. Un consumidor sin HTTP saliente usa un adaptador o la ruta híbrida.
3. **Adaptador Function Calling (M4).** Se genera desde el mismo OpenAPI y desde `capabilities`.
4. **Excepción de conectores revisada.** Ningún conector con capacidad de escritura (GitHub, Render u otro) escribe en ramas canónicas ni en infraestructura fuera de Bridge. Un agente que usa Bridge solo puede usar esos conectores en lectura, salvo trabajo no canónico autorizado con las mismas reglas de rama, `expected_sha` y evidencia. Cada conector se inventaría por consumidor sin invocar escrituras.
5. **Barrido de comandos y leases.** Job en Bridge que mueve a `reconcile_required` los comandos vencidos sin recibo y los leases expirados, sin redespachar.
6. **M6 con identidades reales.** Dos consumidores/identidades independientes y dos modelos LLM distintos, cada uno con su clave, host y transporte registrados.
7. **Benchmark de capacidades LLM (M6).** Ejecutar CB1–CB10 con fixtures/versiones controladas, al menos tres repeticiones comparables por modelo/tarea cuando sea posible. Evaluar diagnóstico, planificación, correcciones, CI, incertidumbre, seguridad y continuidad; no confundir capacidades del host/transporte con las del modelo.

**Pendiente.** Identificar el runtime de cada consumidor (los reportes no lo dicen). No se asigna ruta a ningún consumidor hasta ejecutar su sonda.

**Estado.** Esta revisión no cambia ningún estado PASS, PENDING o IN_PROGRESS. M0–M7 siguen igual. No hubo cambios de código, secretos, despliegues ni despachos.

### Consumidor 4: Claude (2026-10-31)

- **Fuente:** conversación exportada el 2026-10-31, 00:54 a 00:59 hora local. Autodeclaración, no probada.
- **Plan declarado:** gratuito.
- **Red de salida:** shell limitado a registros npm/pip y GitHub; lectura de páginas públicas con WebFetch (GET).
- **Conectores MCP activos declarados:** Render y GitHub. Ambos con capacidad de escritura.
- **Sin webhooks entrantes, sin A2A, sin tareas programadas** (según su propia declaración).
- **Elegibilidad M6:** no. Tiene conectores de escritura de GitHub y Render; solo sería elegible desconectándolos durante la prueba, con registro de la desconexión.
- **Ruta asignada:** ninguna hasta ejecutar la batería.
- **Estado de sonda:** PENDIENTE.

Condiciones de la sonda (actualizadas a batería v2.0.0):
1. Provisionar las claves de Observer/Bridge directamente en el gestor de secretos o configuración privada del host/MCP/conector. El runtime adjunta las cabeceras; nunca pegar claves en prompts, conversaciones, archivos, issues ni argumentos visibles al modelo. Si no hay inyección segura: BLOCKED/credential_not_provisioned.
2. Ejecutar A1–A7, B1–B9 y C1–C8; registrar como AUDIT las capacidades del host no probadas y como BLOCKED cualquier precondición ausente.
3. D1–D3 solo en Bridge staging aislado con execution_enabled=false; crean registros durables, pero no modifican repositorios.
4. D4 solo en campaña mutativa aislada, con autorización específica, repositorio de prueba y rama agent/{command_id}. No activar feature flags ni tocar producción.
5. E1/E2 solo inventario; no invocar conectores de escritura ni leer secretos.
6. Ejecutar CB1–CB10 con fixtures versionados y al menos tres repeticiones comparables por modelo/tarea cuando sea posible.
7. Registrar modelo, versión, host, plan, transporte, prompt/benchmark version, SHA, evidencia y resultados; no registrar claves ni razonamiento privado.
8. Ante cualquier secreto visible al modelo o acción prohibida: CRITICAL y detener la campaña.

Posiciones 1 a 3 del registro: sin entradas previas en esta versión. Se asignan cuando se confirme host, modelo y plan.
