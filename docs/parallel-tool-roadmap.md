# Hoja de ruta — herramienta paralela para LLMs sin GitHub

Fecha de actualización: 2026-10-30.
Estado: A y B cerradas con evidencia; C preparada para revisión; D y E no autorizadas; F pendiente de la validación y entrega al LLM consumidor. La certificación matemática de Lite y Plus es una línea de trabajo separada.

Este documento es la fuente de seguimiento. Sustituye la sección «Trabajo de integración pendiente» de `docs/observer-bridge-integration.md`. La evidencia más reciente de los HEAD y runs prevalece sobre los registros históricos de PR.

## Protocolo para el siguiente LLM

1. No pidas, pegues, registres ni hagas commit de secretos: `llm`, `SERVICE_API_KEY`, `GITHUB_READ_TOKEN`, `GH_TOKEN`, `SUPABASE_SECRET_KEY` ni `BRIDGE_ADMIN_PASSWORD`.
2. Distingue entre CI de los repositorios auxiliares, prueba de lectura staging y una certificación matemática de Lite/Plus. No son equivalentes.
3. No rehagas fases A o B: están cerradas con evidencia HTTP y CI.
4. No declares validado el despacho end-to-end: todavía no existe una prueba controlada completa Bridge → GitHub Actions Runner → recibo → Observador.
5. No fusiones PR, no cambies producción, no rotes/revoques claves ni despaches Lite/Plus sin autorización expresa del usuario en esa conversación.
6. Anota SHA, URL de run, códigos HTTP y cualquier cambio de configuración no secreta. Nunca registres valores de credenciales.

Un LLM sin GitHub es el consumidor previsto de Observador. El LLM que construye/mantiene la herramienta necesita acceso a GitHub; el humano administra Render y los secretos.

## Decisión de diseño vigente

La interfaz que recibe el LLM/alumno es Observador y es GET-only. No se añade una ruta POST de despacho ni se entrega al modelo un token de GitHub.

El despacho, cuando se autorice, se solicita al Bridge mediante `POST /api/runs`, con `X-Bridge-Key` e `Idempotency-Key`, por un operador o cliente autorizado con capacidad de escritura. Observador permite después consultar el recibo Bridge y la evidencia de Actions. Añadir despacho mediado por Observador sería un cambio arquitectónico nuevo.

## Estado ejecutivo

| Elemento | Estado observado al 2026-10-30 | Evidencia |
|---|---|---|
| Repositorios Lite, Plus, Bridge y Observador | Públicos | Metadatos de repositorios |
| Observador PR #4 | Abierto, Ready for review, no fusionado; HEAD `b8bbc188adcdce231670d88f45872c73b5ed2f34` | [PR #4](https://github.com/c2melendez/precision-lab-readonly-api/pull/4) |
| Observador CI | PASS en HEAD actual | [Run 41053312777](https://github.com/c2melendez/precision-lab-readonly-api/actions/runs/41053312777) |
| Bridge PR #1 | Abierto, Ready for review, no fusionado; HEAD `d74926f5ef40982d99e80d0733a7b5150a37d26b` | [PR #1](https://github.com/c2melendez/precision-lab-bridge/pull/1) |
| Bridge CI | PASS en HEAD actual | [Run 41053872908](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41053872908) |
| Observador staging → Bridge independiente | Fase A PASS | HTTP 200 autenticado y 401 anónimo; UUID `94c102a5-5242-48ba-bdb7-4754a57513db` |
| Evidencia de Actions del recibo | Run preexistente, no nuevo | Lite `41005884405`, cumulative, completed/success |
| Despacho Bridge → Runner end-to-end | NO VALIDADO | No se ha autorizado ni ejecutado una prueba real de despacho |
| Corte de Observador producción → Bridge independiente | No realizado | Producción y Compass original permanecen intactos |
| Certificación matemática Lite/Plus | Abierta | Fuera del alcance de esta hoja |

### Fases

- **A — CERRADA.** Staging Observador consulta un recibo existente del Bridge independiente. Con `X-API-Key`: HTTP 200, `read_only: true`, UUID correcto y run Lite 41005884405. Sin clave: HTTP 401. La comparación posterior no mostró nuevos workflow runs en Lite ni Plus.
- **B — CERRADA.** `README_CONTRACT.md` y `openapi.yaml` incluyen `GET /v1/bridge/runs/{run_id}`, protección `APIKeyHeader`, separación UUID Bridge / número Actions, respuestas 401/404 y semántica de auditoría/reconciliación. CI PASS 41053312777 en el HEAD actual.
- **C — PREPARADA PARA REVISIÓN.** Observador PR #4 y Bridge PR #1 siguen abiertos y sin fusionar; ambos HEAD actuales tienen CI PASS. Observador está sincronizado con `main` (19 commits ahead, 0 behind, según la actualización del PR); la divergencia `tests/image.png` fue eliminada y ya no bloquea. La fusión sigue fuera de alcance de esta hoja hasta decisión expresa.
- **D — BLOQUEADA POR AUTORIZACIÓN.** No cambiar las variables de producción, no sustituir la URL de Compass, no rotar ni revocar la clave de producción. Requiere plan de migración y autorización expresa.
- **E — NO AUTORIZADA / FUERA DE LA RUTA DE LECTURA.** No despachar workflows reales ni ampliar permisos `GH_TOKEN` sin autorización expresa. `dry_run=true` en Bridge sigue iniciando un workflow; no equivale a simulación sin efectos.
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
| [#3](https://github.com/c2melendez/precision-lab-readonly-api/pull/3) | API de despacho aislado e idempotencia | Abierto, Draft; bloqueado | Mantener deshabilitado. Requiere PostgreSQL dedicado activo, migración, CI verificable, permisos mínimos, pruebas de concurrencia/idempotencia y autorización expresa. No desplegar ni fusionar. |

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

No iniciar sin autorización expresa. Antes del cambio deben verificarse la clave Bridge de reemplazo y la propiedad de un recibo de prueba. El operador configuraría la URL/clave de producción en Render, se repetiría una lectura y se comprobaría que Lite/Plus no recibieron workflows nuevos. Compass original debe seguir recuperable hasta validar el corte. No revocar la clave antigua en el mismo paso.

## Fase E — Despacho controlado

No iniciar sin autorización expresa. Requiere confirmar permisos de escritura mínimos del token Bridge, salud de la base/idempotencia, allowlist de repos/workflow/ref, protección contra dispatch duplicado y plan de reversión. Un solo despacho autorizado debe seguirse desde recibo hasta Actions y registro del Runner. Repetir la misma clave idempotente debe demostrar que no aparece un segundo workflow. No confundir HTTP 201/202 con gate completado ni con certificación PASS.

## Fase F — Entrega al LLM sin GitHub

Pendiente de validar una Action de consumidor real. La entrega debe incluir:
- URL base del Observador elegido (staging para la validación inicial; producción solo tras fase D).
- OpenAPI actualizado.
- `X-API-Key` configurada como secreto de la Action/conector, no en el prompt.
- Operaciones de lectura: estado bilateral, plan de gate, evidencia de Actions y recibo Bridge.
- Prohibiciones: despachar, cancelar, reintentar, hacer push, fusionar o declarar PASS automático.
- Tratamiento conservador de 401/404/409/502/503, `RECONCILE` y `REFRESH`.

## No hacer

- No añadir POST a Observador.
- No convertir Bridge en proxy SQL.
- No modificar los motores matemáticos como parte de esta hoja.
- No activar auto-deploy en staging ni producción.
- No cambiar, copiar, rotar o revocar claves como parte de esta actualización documental.
- No fusionar PR como efecto colateral.
- No elegir licencia en silencio; la elección de licencia es una decisión separada y no bloquea las fases A/B ya cerradas.

## Definición de terminado

La herramienta auxiliar se considera entregada al LLM cuando la lectura staging/producción elegida y la Action consumidora estén validadas (A, B y F; D solo si se decide el corte a producción). La capacidad de despacho requiere una validación separada y autorización (E). La fusión de PR es una decisión de mantenimiento/revisión, no prueba de funcionamiento.

Una vez validada la superficie de observación y, si se autoriza, el despacho, se detiene el desarrollo auxiliar y se retoma la certificación matemática de Lite y Plus.


## Revisión de despliegues y alcance real de staging — 2026-10-30

La consulta de Render confirmó que los dos servicios auxiliares están no suspendidos, con auto-deploy desactivado y en Virginia/Free. También reveló que el código desplegado no coincide con los HEAD actuales de sus PR:

- Observador staging: deploy `dep-dbi88lbbc2fs73acq2kg`, LIVE sobre commit `aff31b6966baa32f980fb0d2ec8f9c8f93ec09e4`. El PR #4 actual está en `b8bbc188adcdce231670d88f45872c73b5ed2f34`. El commit desplegado sí contiene la ruta GET Bridge y fue el que atendió la prueba 200/401; no se ha desplegado automáticamente el HEAD posterior porque auto-deploy está off.
- Bridge independiente: deploy `dep-dbi5jc8ae00c73b9tnvg`, LIVE sobre commit `fec4dd1448b0385f98565725276b235ddc0821a2`. El PR #1 actual está en `d74926f5ef40982d99e80d0733a7b5150a37d26b` (antes de este cambio documental). El GET de estado del recibo funcionó contra el servicio LIVE, pero no se debe asumir que todos los cambios posteriores del PR están desplegados.
- Observador staging tiene confirmadas las variables `BRIDGE_BASE_URL`, `BRIDGE_TIMEOUT_SECONDS`, `llm` y `SERVICE_API_KEY` por la actualización de entorno. No hay evidencia de lectura de valores secretos. La presencia de `GITHUB_READ_TOKEN` en staging no está confirmada; sin ese token, `/v1/status`, `/v1/gates/{gate}/plan` y `/v1/runs/{run_id}` no podrán consultar GitHub aunque la ruta Bridge funcione. No copiar el token de producción automáticamente: crear/configurar un token de solo lectura dedicado a staging o autorizar conscientemente el alcance.

Consecuencia: la prueba A acredita únicamente la lectura de un recibo Bridge desde el código desplegado de Observador staging. No acredita todavía el conjunto completo de funciones de Observador ni la ejecución del HEAD actual de ambos PR. Para completar F hay que validar los endpoints GitHub de Observador y la Action consumidora.
