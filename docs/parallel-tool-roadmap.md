# Hoja de ruta — herramienta paralela para LLMs sin GitHub

Fecha de este corte: 2026-10-30.
Estado: la herramienta de observación y despacho no está terminada. La certificación matemática de Lite y Plus queda fuera de este archivo.

Este documento es la fuente de seguimiento. Sustituye la sección «Trabajo de integración pendiente» de `docs/observer-bridge-integration.md`, que describe el diseño pero quedó detrás de los PR. Si un comentario de PR cita un SHA o una prueba más nueva, esa evidencia manda y este archivo debe actualizarse en el mismo cambio.

## Protocolo para el siguiente LLM

1. No pidas, pegues, registres ni commits secretos. Ni `llm`, ni `SERVICE_API_KEY`, ni `GH_TOKEN`, ni `SUPABASE_SECRET_KEY`, ni `BRIDGE_ADMIN_PASSWORD`.
2. Lee este archivo, el cuerpo de los dos PR y el check más reciente de cada cabeza. No rehagas fases ya cerradas.
3. Ejecuta solo la primera fase cuyo criterio de salida no esté cumplido.
4. Anota la evidencia (SHA, URL de run, código HTTP, conteo de workflows) y detente.
5. No fusiones, no despliegues producción, no cambies variables de producción y no despaches Lite ni Plus salvo que la fase activa lo diga y el usuario lo haya aprobado en esa misma conversación.

Un LLM sin acceso a GitHub no ejecuta esta hoja. Es el usuario final de Observador. El LLM que construye la herramienta necesita GitHub, y el humano opera Render y las claves.

## Decisión de diseño que no se reabre sin pedido explícito

La superficie del alumno o del modelo es solo lectura, contra Observador. Observador no gana una ruta POST, ni un proxy de despacho, ni un token de GitHub entregable al modelo.

Pedir una certificación sigue siendo `POST /api/runs` en Bridge, con `X-Bridge-Key` e `Idempotency-Key`, hecho por un operador. El modelo después observa el recibo y la evidencia. Añadir un POST mediado en Observador es una fase nueva, no un cabo suelto de esta hoja.

## Hecho — no rehacer

| Hecho | Evidencia |
|---|---|
| Los cuatro repositorios son públicos | `precision-lab-lite`, `precision-lab-plus`, `precision-lab-bridge`, `precision-lab-readonly-api` |
| Observador propone `GET /v1/bridge/runs/{uuid}` | [PR #4](https://github.com/c2melendez/precision-lab-readonly-api/pull/4), borrador, cabeza `aff31b6966baa32f980fb0d2ec8f9c8f93ec09e4` antes de cualquier commit posterior de documentación |
| CI de Observador | [run #6](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41042163883): 19 passed, 0 failed |
| CI de Bridge | [run #4](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41042873423): Vitest 71 passed / 13 skipped; ESLint 0 errores y 6 avisos; build correcto. Cabeza previa `598412af66c04177b1ff3891a007e09745d77d93` |
| Bridge independiente arranca | https://precision-lab-bridge.onrender.com, servicio `srv-dbi5b8ss728c73ccvjbg`, Virginia, Free, auto-deploy off |
| Base nueva, vacía al crearla | Supabase `precision-lab-bridge-db`, ref `umxtvefdcjwkiqsubfpb` |
| Lectura real de un recibo, sin despacho | UUID `94c102a5-5242-48ba-bdb7-4754a57513db`, Actions Lite `41005884405`, HTTP 200 |
| Staging de Observador existe y no está probado contra Bridge | https://precision-lab-readonly-api-staging.onrender.com, `srv-dbi7avgae00c73be7ns0`, auto-deploy off, sin `SERVICE_API_KEY` ni `llm` |
| Producción de Observador no tiene cliente Bridge | commit `f3cdb0cc1746c8503eb1187e1a806ae8b463ee00`, servicio `srv-dbfiidec6qcc739rpafg` |
| Compass original | Sigue en pie. Su clave `llm` no se revoca en esta hoja |

## Invariantes

- `GET /v1/runs/{id}` usa el número de GitHub Actions y exige `repo=lite|plus`.
- `GET /v1/bridge/runs/{id}` usa el UUID interno de Bridge. No son intercambiables.
- `success` de Actions no es `PASS`. Si la continuidad no cuadra, la respuesta es `RECONCILE` o `REFRESH`, con `next_action=null`.
- Un GET de estado en Bridge puede escribir último uso, auditoría y reconciliación. No es un despacho.
- `dry_run=true` en `POST /api/runs` igual inicia el workflow. No usarlo como sustituto de una lectura.
- La misma `Idempotency-Key` y los mismos parámetros no deben volver a despachar.
- Credenciales solo de servidor: el modelo solo conoce el nombre del encabezado `X-API-Key`.
- `GH_TOKEN` de Bridge permanece en Actions: Read hasta la fase E, y solo si el usuario la aprueba.
- Plan Free: el servicio puede dormir. El timeout de Observador ya es 90 s. No subir de plan como parte de una prueba.

## Fase A — Probar la lectura staging → Bridge independiente

Estado: pendiente. Es la única fase activa.

Objetivo: demostrar que Observador, sin token de GitHub hacia el cliente, lee un recibo del Bridge nuevo.

Quién: el humano escribe secretos en el Dashboard de Render. El LLM solo observa HTTP y Actions después de que el humano confirme que guardó, sin revelar valores.

Precondición: el recibo `94c102a5-5242-48ba-bdb7-4754a57513db` pertenece a la clave temporal ya creada en el admin del Bridge nuevo. Otra clave recibirá 404 aunque el UUID exista. No crear otra clave si la temporal sigue disponible.

Pasos del humano, en el servicio staging `srv-dbi7avgae00c73be7ns0`:

1. `BRIDGE_BASE_URL` = `https://precision-lab-bridge.onrender.com`
2. `BRIDGE_TIMEOUT_SECONDS` = `90`
3. `llm` = la clave temporal que ya posee ese recibo. No usar la clave de producción de Compass.
4. `SERVICE_API_KEY` = una clave nueva, solo de este staging.
5. Guardar y esperar el deploy en LIVE. No activar auto-deploy.

Pasos del LLM, después:

1. Anotar el último run de Actions de Lite y de Plus.
2. `GET /healthz` en el staging. Esperado: 200 y `read_only: true`. Puede tardar por el plan Free.
3. `GET /v1/bridge/runs/94c102a5-5242-48ba-bdb7-4754a57513db` con `X-API-Key`. Esperado: 200, `read_only: true`, y el UUID dentro de `bridge_run`. El cuerpo no contiene la clave.
4. Repetir sin encabezado. Esperado: 401.
5. Volver a mirar Actions. Esperado: ningún workflow nuevo en Lite ni Plus.

Si la clave temporal se perdió: detenerse. No insertar filas a mano ni hacer `POST /api/runs` para fabricar un recibo.

Prohibido: cambiar producción, fusionar, revocar la clave de Compass, ampliar `GH_TOKEN`.

Salida: un 200 del proxy staging y cero despachos nuevos, anotados en este archivo.

## Fase B — Contrato que el LLM importa

Estado: pendiente. Empieza solo con la fase A cerrada o, si el usuario lo pide, en paralelo sin desplegar.

Hoy `README_CONTRACT.md` en la rama de Observador no lista `GET /v1/bridge/runs/{run_id}`. El OpenAPI vivo lo genera FastAPI; no asumir que el `openapi.yaml` versionado está al día.

Hacer:

1. Incluir la ruta Bridge en `README_CONTRACT.md` y en el esquema que la Action importa.
2. Documentar los dos espacios de ID, el 404 de dueño y que un GET puede reconciliar sin despachar.
3. Dejar explícito que no hay métodos de escritura.
4. Correr pytest de Observador. No debilitar tests para ponerse en verde.

Salida: el esquema importable contiene solo GET para `/v1/bridge/runs/{run_id}`, protegido por `APIKeyHeader`, y la CI de esa cabeza pasa.

## Fase C — Dejar los PR listos para revisar, sin fusionar

Estado: pendiente.

1. Observador está 1 commit detrás de `main` por `tests/image.png`. Integrar `main` en la rama. No force-push.
2. Esperar CI verde en la cabeza nueva de cada PR.
3. Seguir en borrador hasta que A y B tengan salida.
4. No fusionar para «activar» `workflow_dispatch`. Ese disparador solo aparece cuando el workflow ya está en la rama por defecto, y no hace falta para la prueba.

Salida: ambos PR en borrador, mergeable, CI verde, y la descripción cita la evidencia de la fase A.

## Fase D — Corte de lectura en producción

Estado: bloqueada por A, B y aprobación explícita del usuario.

1. Crear en el Bridge nuevo una clave de reemplazo, o importar con autorización el hash de la clave vieja. La base nueva no autentica sola la clave de Compass.
2. El humano pone esa clave en `llm` de producción y cambia `BRIDGE_BASE_URL` al host independiente. El LLM no ve el valor.
3. Repetir la lectura de un recibo propiedad de esa clave.
4. Confirmar que Lite y Plus no recibieron un workflow nuevo.
5. Solo entonces, y con un sí del usuario, revocar la clave vieja. Compass no se apaga en el mismo paso.

Salida: producción de Observador lee al Bridge independiente y el Compass anterior sigue recuperable.

## Fase E — Un solo despacho de prueba, si el usuario lo aprueba

Estado: fuera de la ruta de lectura. No empezarla para «completar» A–D.

1. El usuario autoriza por escrito, en la conversación, subir `GH_TOKEN` a Actions: Write solo sobre Lite y Plus.
2. Un único `POST /api/runs` con clave nueva de idempotencia. Preferir `dry_run` sabiendo que el workflow sí arranca.
3. Leer el UUID por Observador y la evidencia por `GET /v1/runs/{numero}?repo=lite|plus`.
4. Repetir el mismo POST. Esperado: no aparece un segundo workflow.
5. Devolver `GH_TOKEN` a Actions: Read si no va a haber más despachos.

Salida: un recibo observable de punta a punta y la idempotencia demostrada. Ahí termina la herramienta paralela.

## Fase F — Entrega al LLM que no tiene GitHub

Estado: pendiente del corte que el usuario elija (staging estable o producción).

Publicar, sin secretos:

- URL base del Observador que debe usar.
- Esquema OpenAPI.
- Encabezado `X-API-Key` y el hecho de que la clave se configura en la Action, no en el prompt.
- Tabla de operaciones permitidas: estado, plan de compuerta, evidencia de Actions, recibo Bridge.
- Tabla de prohibiciones: despachar, cancelar, reintentar, pushear, fusionar, declarar `PASS` automático.
- Qué hacer ante `409`, `RECONCILE` y `REFRESH`: informar, no inventar un siguiente gate.

Salida: un modelo con solo esa Action contesta el estado de Lite o Plus y no tiene manera de lanzar un runner.

## No hacer en esta hoja

- No añadir POST a Observador.
- No convertir Bridge en proxy SQL.
- No migrar ni reescribir los motores de Lite y Plus.
- No seguir puliendo UI, Lovable o el plan Free después de la fase E.
- No elegir licencia en silencio. Los repos ya son públicos y la rama de Observador no tiene archivo `LICENSE`. Preguntar una vez al usuario y añadir la que elija; no bloquea la fase A.

## Definición de terminado

La herramienta paralela está terminada cuando A, B, D y F están cerradas y, si el usuario abrió E, E también. C es el requisito para fusionar, no un sustituto de D.

En ese momento se deja de construir Bridge y Observador. El trabajo que sigue es la certificación matemática, usando esta superficie para observar y, solo con aprobación, para encargar corridas.
