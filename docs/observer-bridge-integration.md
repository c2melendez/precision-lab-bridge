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

## Continuidad de la clave al migrar la base

La nueva instancia Supabase está vacía y bridge_keys no contiene registros. La clave llm existente en Compass no se autenticará automáticamente contra el nuevo Bridge.

Una clave antigua solo puede conservarse si se importa de forma deliberada su fila bridge_keys (hash SHA-256, etiqueta, prefijo, expiración, revocación y último uso). La base original no es accesible mediante la cuenta Supabase conectada, por lo que esa fila no se ha migrado.

Alternativa segura:
1. Desplegar y verificar Bridge independiente conectado a la nueva base.
2. Crear en la administración del nuevo Bridge una clave de reemplazo con etiqueta llm.
3. Sustituir el secreto Render llm por el nuevo valor mediante el almacén de secretos. No pegarlo en chat, Git, logs ni documentación.
4. Verificar una solicitud GET /api/runs/:id con una ejecución perteneciente a esa clave antes de mover tráfico de escritura/dispatch.

No revocar la clave vieja ni desconectar el Compass original hasta que el nuevo Bridge y su nueva clave hayan superado esa comprobación.

## Permisos de GitHub del Observador

El cliente GitHub del código actual solo realiza GET. El permiso de escritura de GITHUB_READ_TOKEN no es necesario para esta versión. El mínimo recomendado es un fine-grained token limitado a c2melendez/precision-lab-lite y c2melendez/precision-lab-plus con Contents: Read, Actions: Read y Metadata: Read. No reutilizar GH_TOKEN de Bridge.

## Trabajo de integración pendiente

- Identificar qué componente desplegado utilizaba históricamente llm y a qué ruta Bridge llamaba. La captura de Compass demuestra una clave con esa etiqueta y un uso reciente, pero no identifica al consumidor ni la ruta.
- Definir si Observador necesita solo el endpoint Bridge de estado de ejecuciones o un contrato de datos de solo lectura más amplio. No convertir Bridge en un proxy SQL arbitrario.
- Si hace falta, incorporar a Observador un cliente Bridge de solo lectura con URL base explícita, secreto de servidor, timeout, control de errores y pruebas. No añadir funciones de escritura/dispatch al Observador.
- Mantener SERVICE_API_KEY separado de llm.
- No activar la nueva base en el Bridge actual hasta completar la configuración del host independiente y la prueba de lectura.


## 2026-10-30 — Observador read-only integration proposal

The Observador repository now has draft PR #4:
https://github.com/c2melendez/precision-lab-readonly-api/pull/4

Branch: feature/bridge-readonly-run-status.

The PR adds a server-side GET-only proxy route: GET /v1/bridge/runs/{run_id}. The route:
- Keeps Observador inbound API authentication on X-API-Key using SERVICE_API_KEY.
- Sends the lowercase Render environment variable llm only as the upstream X-Bridge-Key header.
- Uses BRIDGE_BASE_URL (defaulting to the known Compass Lovable origin) and BRIDGE_TIMEOUT_SECONDS.
- Requires HTTPS and refuses redirects.
- Does not expose the Bridge key in its response or error details.
- Does not create runs or dispatch GitHub Actions workflows. A Bridge status GET may still update Bridge last-used/audit metadata and reconcile status in the Bridge database.

PR #4 is a draft only. The tests have been authored but have not been executed; no Render environment variables have been changed and no deployment or live Bridge call has been made. This addition is not a proof of production connectivity.

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

Render logs confirm Bun 1.4.4, package installation, Vite client/SSR build, Nitro render-com build, and server startup. This verifies build and runtime startup only. No external HTTP request or admin/API integration test was completed in this session.

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
1. Enter the three server-only secrets in Render Dashboard.
2. Deploy those environment changes and confirm new deploy LIVE.
3. Open the admin page and sign in using BRIDGE_ADMIN_PASSWORD.
4. Create a temporary test key (not llm) and validate it only against a synthetic/test-owned run; do not call POST dispatch.
5. Validate GET status against that owned run, ensuring no new GitHub run was created. Only after this will Observador's BRIDGE_BASE_URL and replacement llm key be considered for controlled cutover.
