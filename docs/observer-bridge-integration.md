# Observador ↔ Bridge: autenticación y frontera de base de datos

Estado: revisión de código; no se leyeron, modificaron ni divulgaron valores de variables secretas de Render.

## Qué representa la clave llm

La clave mostrada en la administración de Compass con etiqueta llm es una credencial de la API de Bridge. No es una contraseña PostgreSQL ni una clave service-role de Supabase.

En el código Bridge:
- newKey() genera un secreto con prefijo plb_.
- checkKey() calcula SHA-256 del valor recibido y lo compara con bridge_keys.key_hash. La base de datos almacena el hash y el prefijo, no el secreto en claro.
- GET /api/runs/:id lee la credencial del encabezado HTTP X-Bridge-Key.
- El resultado se limita a ejecuciones pertenecientes a la clave autenticada.
- La persistencia interna de Bridge usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, de servidor.

Por tanto, la variable Render llm debe contener el secreto emitido por Bridge y utilizarse como X-Bridge-Key al llamar la API Bridge. No debe confundirse con una conexión SQL, una clave Supabase o un token GitHub.

## Qué contiene el Observador actualmente desplegado

Servicio Render revisado: precision-lab-readonly-api (srv-dbfiidec6qcc739rpafg).
Último deploy observado: dep-dbhrtb9srkjs7389d9l0, estado live, commit f3cdb0cc1746c8503eb1187e1a806ae8b463ee00.

En ese commit:
- app/config.py lee GITHUB_READ_TOKEN, SERVICE_API_KEY y GITHUB_TIMEOUT_SECONDS; no lee llm.
- app/github_api.py fija el host https://api.github.com y su cliente implementa exclusivamente GET.
- app/main.py expone endpoints GET de estado, planificación y evidencia GitHub, protegidos por X-API-Key.
- requirements.txt incluye FastAPI, Uvicorn, HTTPX y PyYAML; no incluye un driver PostgreSQL ni cliente Supabase.
- El código inspeccionado no contiene URL base, cliente HTTP de Bridge, cliente Supabase ni conexión PostgreSQL.

El código actualmente desplegado no demuestra una conexión Observador → Bridge. La clave llm pudo usarse en un deploy anterior, otra integración o por otro consumidor; esta revisión no identifica quién hizo el último uso ni a qué ruta llamó.

## Separación de credenciales

| Variable | Consumidor esperado | Uso |
|---|---|---|
| llm | Cliente autorizado de Bridge | Clave API Bridge en X-Bridge-Key |
| SERVICE_API_KEY | GPT Action que llama al Observador | Autenticación entrante X-API-Key |
| GITHUB_READ_TOKEN | Cliente GitHub del Observador | Lecturas a GitHub REST |
| GH_TOKEN | Servidor Bridge | Dispatch y consulta de GitHub Actions |
| SUPABASE_SERVICE_ROLE_KEY | Servidor Bridge solamente | Acceso privilegiado a PostgreSQL vía Supabase Data API |

No son intercambiables. El Observador no debe recibir GH_TOKEN ni SUPABASE_SERVICE_ROLE_KEY.

## Continuidad de claves — estado actualizado 2026-10-30

La base Supabase independiente ya no está vacía: tiene una clave de staging read-only, un recibo histórico y la migración de scopes aplicada. La clave existente se verificó solo por metadatos de scope y continúa en `['read']`; no se leyó ni rotó su secreto/hash.

La continuidad de credenciales queda separada:
1. `llm` se conserva como credencial Bridge read-only para GET de recibos y reconciliación.
2. Observer obtiene una credencial distinta `BRIDGE_DISPATCH_KEY` con scope `dispatch`, nunca reutiliza `llm`.
3. La clave dispatch se emite solo para staging, con expiración corta y se configura directamente como secreto Render.
4. No revocar la clave read existente ni tocar credenciales de producción como efecto colateral.

## Permisos de GitHub del Observador

El cliente GitHub del código actual solo realiza GET. El permiso de escritura de GITHUB_READ_TOKEN no es necesario para esta versión. El mínimo recomendado es un fine-grained token limitado a c2melendez/precision-lab-lite y c2melendez/precision-lab-plus con Contents: Read, Actions: Read y Metadata: Read. No reutilizar GH_TOKEN de Bridge.

## Trabajo de integración — conciliado

- Observer PR #4 conserva las lecturas de estado Bridge y añade `GET /v1/bridge/requests/{idempotency_key}` para reconciliar recibos.
- Observer PR #4 añade `POST /v1/bridge/dispatch`; valida plan live, estado CURRENT, rama/SHA y decisión RUN antes de llamar a Bridge.
- `SERVICE_API_KEY`, `llm` (scope read) y `BRIDGE_DISPATCH_KEY` (scope dispatch) son credenciales distintas.
- Bridge mantiene validación final, allowlist, idempotencia durable, recibos y dispatch GitHub; no se crea proxy SQL ni llamada directa LLM→Bridge.
- El código y tests están en ramas PR; los despliegues staging actuales aún apuntan a commits anteriores. Falta deploy de HEADs, configuración de la clave dispatch de staging y validación E2E.


## 2026-10-30 — Observador read-only integration proposal

The Observador repository now has draft PR #4:
https://github.com/c2melendez/precision-lab-readonly-api/pull/4

Branch: feature/bridge-readonly-run-status.

PR #4 is Ready for review and open (not merged). It now includes protected GET status, GET idempotency reconciliation and POST dispatch through Bridge. The Observer CI passed on the implementation HEAD; a later metadata-only commit is under CI validation. The historical staging GET test returned 200 with a read-only receipt and 401 without Observer auth; it did not dispatch a workflow. This does not prove dispatch E2E or production connectivity.

The PR keeps the original llm key and original Compass host in place. Before moving to the independent Bridge host, it is still necessary to create a replacement key in the new database (or migrate the original key hash with authorized source access), configure the independent Bridge service, and pass a read-only test. No old key should be revoked before that verification.


## Independent Bridge service — created 2026-10-30

Render service:
- Name: precision-lab-bridge
- Service ID: srv-dbi5b8ss728c73ccvjbg
- Workspace: My Workspace (tea-da4esd7qj5pc73d1fss0)
- Region: Virginia
- Plan: Free (staging/validation only)
- URL: https://precision-lab-bridge.onrender.com
- Git branch: hardening/secure-status-independent-runtime
- Auto-deploy: off
- Initial deploy: dep-dbi5b9cs728c73ccvl20, LIVE on 2026-10-30 from commit fec4dd1448b0385f98565725276b235ddc0821a2.

Render logs from the initial deploy confirm Bun installation, Vite/Nitro build and server startup. A later historical read-only Observer→Bridge staging request returned 200 for an owned receipt and 401 without Observer auth. Neither result validates the current HEAD or a POST dispatch; those require the pending staging deploy and E2E run.

Non-secret Supabase settings were added at service creation:
- SUPABASE_URL and VITE_SUPABASE_URL point to the isolated new project.
- SUPABASE_PUBLISHABLE_KEY and VITE_SUPABASE_PUBLISHABLE_KEY contain its publishable key.
- GH_OWNER=c2melendez and GH_REF=main.
- NODE_ENV=production, NITRO_PRESET=render-com, HOST=0.0.0.0.

Privileged variables still require direct secret entry in Render Dashboard:
- SUPABASE_SECRET_KEY: copy/create an sb_secret_ key in the new project's Settings → API Keys. Never use the publishable key for server administration.
- GH_TOKEN: a dedicated GitHub fine-grained PAT with Actions read/write on only precision-lab-lite and precision-lab-plus (Metadata read is automatic). This is Bridge's dispatch credential; it is not Observador's GITHUB_READ_TOKEN.
- BRIDGE_ADMIN_PASSWORD: a strong unique password stored in a password manager.

Dashboard entry point:
https://dashboard.render.com/web/srv-dbi5b8ss728c73ccvjbg/env

The environment-variable mutation API requires the raw secret value. It is not appropriate to request those values in chat or manufacture placeholders. Set them directly in Render's Dashboard, then save/deploy the configuration. Do not set llm on Observador to this service yet.

Free plan is for staging/validation, not production: it spins down after 15 minutes without inbound traffic and may take about a minute to wake. It may also be subject to free-tier outbound traffic/build limits. Upgrade to a suitable paid plan before production cutover.

Remaining:
1. Wait for CI SUCCESS on the current Bridge HEAD and Observer HEAD.
2. Deploy Bridge staging HEAD first; verify health and that the existing read-scoped key still works.
3. Create a short-lived dispatch-only key in the staging Bridge database and set only `BRIDGE_DISPATCH_KEY` plus `BRIDGE_BASE_URL` on Observer staging; preserve `llm` and all production credentials.
4. Deploy Observer staging HEAD and verify the new API routes.
5. Execute a single policy-approved staging dispatch only if Observer's live plan returns RUN; reconcile the same idempotency key and prove no duplicate workflow.
6. After this E2E evidence, freeze auxiliary infrastructure and resume Lite/Plus mathematical certification.


## Decisión arquitectónica vigente — 2026-10-30 (supersede las secciones anteriores)

La dirección anterior de mantener Observer exclusivamente GET-only y solicitar despachos directamente a Bridge queda supersedida por el roadmap canónico en docs/parallel-tool-roadmap.md y docs/parallel-tool-roadmap.json.

La arquitectura aprobada es:

LLM / Action → Observer → Bridge → GitHub Actions Runner → Lite/Plus
Lite/Plus → Runner → Bridge → Observer → LLM / Action

Observer es la única interfaz del LLM y el plano central de lectura, interpretación, autorización y coordinación. La Action solo conoce el contrato, host y credencial de Observer. Observer integra las consultas Bridge y, cuando la solicitud esté autorizada, invoca Bridge internamente de servidor a servidor.

Bridge permanece como componente interno de despacho, validación final, recibos e idempotencia. No se crea una Action de Bridge, no se entrega al LLM su URL ni su credencial y no se crea otra capa de servicios.

La operación protegida de despacho está implementada en la rama de trabajo de Observer como `POST /v1/bridge/dispatch`. Antes de invocar Bridge, Observer recalcula el plan live y exige continuidad CURRENT, rama canónica y SHA exactos, y decisión RUN. Las solicitudes WAIT/REUSE/REFRESH/RECONCILE/DIAGNOSE/REVIEW no generan dispatch. Observer usa `BRIDGE_DISPATCH_KEY` solo server-to-server; el LLM no conoce el host ni la credencial Bridge. La idempotencia y los identificadores de correlación/validación se conservan desde la solicitud hasta el recibo. Los resultados ambiguos requieren reconciliación, nunca reintento ciego.

La autorización general del usuario cubre operaciones rutinarias dentro del alcance y de las políticas ya establecidas: no se requiere aprobación humana por evento. `dry_run=true` también inicia un workflow y se trata como dispatch real; puede ejecutarse automáticamente cuando el plan, scopes y pruebas lo permitan. No se hace producción cutover, rotación/revocación de secretos ni cambio material de alcance como efecto colateral.

No añadir un nuevo servicio, segundo Runner ni duplicar la lógica de planificación o persistencia. Al completar los criterios O1–O6 del roadmap, cerrar la infraestructura auxiliar y regresar a la certificación matemática de Lite y Plus.


## Política de autonomía operativa — 2026-10-30

El usuario concede autonomía general para completar el trabajo rutinario de infraestructura auxiliar y certificación dentro del alcance, repositorios, gates, workflows, ramas, contratos y límites ya establecidos. Esta autorización no debe transformarse en aprobaciones humanas repetitivas por cada despacho, prueba o reconciliación.

Observer/LLM debe ejecutar automáticamente consultas, planificación, correcciones, pruebas, despachos rutinarios y reconciliaciones cuando las políticas, allowlists, scopes y pruebas automatizadas permitan determinar que la operación está dentro del alcance. No se crea un mecanismo externo de aprobación por evento.

La intervención humana se reserva a decisiones materiales no resueltas por la especificación o las pruebas: cambios de alcance, ambigüedad de aceptación, licencia, publicación/exposición de datos, aceptación de riesgo nuevo o desactivación de protecciones. Un fallo técnico ordinario se investiga, corrige y vuelve a probar autónomamente; si no existe un camino seguro definido, se detiene solo esa operación y se informa el bloqueo concreto.

Las pruebas son la fuente de verdad operativa. Deben cubrir autorización/scopes, allowlist, idempotencia, concurrencia, reconciliación, trazabilidad, regresión y errores. dry_run=true crea un workflow y cuenta como despacho real, pero no exige aprobación por evento si está dentro de la política general delegada y los tests lo habilitan. No confundir éxito del workflow con PASS de certificación matemática.



## Separación de scopes Bridge — 2026-10-30

Se implementó y aplicó la migración `bridge_key_scopes` en el proyecto Supabase de staging (`umxtvefdcjwkiqsubfpb`):
- `bridge_keys.scopes text[]` acepta únicamente `read` y/o `dispatch`.
- El valor por defecto es `['read']`; las claves preexistentes no heredan permiso de despacho.
- `trigger()` exige `dispatch`; `runStatus()` y `lookupRequest()` exigen `read`.
- La UI administrativa permite emitir claves `read`, `dispatch` o `read,dispatch`; el secreto se muestra una sola vez.
- Observer usa `llm` únicamente para GET y `BRIDGE_DISPATCH_KEY` únicamente para POST. No hay fallback de la clave de lectura a despacho.
- La clave existente de staging fue consultada solo por sus scopes: continúa con `['read']`. No se leyó ni rotó su valor/hash.

Pruebas añadidas:
- una clave `read` no puede crear claims ni invocar GitHub dispatch;
- una clave `dispatch` no puede consultar recibos;
- el fixture de integración de idempotencia declara explícitamente ambos scopes;
- las pruebas existentes de replay, conflicto, concurrencia, lease, error definitivo y resultado incierto permanecen activas.

La migración está registrada en Supabase como `20261030133052_bridge_key_scopes` y en Drizzle como `0003_bridge_key_scopes`. La CI Bridge en SHA `74a592253b293a1919dc7387bfbc74f239524044` completó unit/regression tests, ESLint y build con SUCCESS. La actualización posterior de la UI administrativa se valida en una ejecución separada.
