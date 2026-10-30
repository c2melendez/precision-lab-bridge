# Hoja de ruta — herramienta paralela para LLMs sin GitHub

Fecha de actualización: 2026-10-30.
Estado: roadmap reorientado al plano de control Observer → Bridge. La lectura Observer→Bridge está probada en staging; la coordinación integral y el despacho mediado por Observer siguen pendientes de implementación y validación. No se añade ningún servicio. La certificación matemática de Lite y Plus continúa siendo el objetivo final.

Este documento es la fuente de seguimiento. Sustituye la sección «Trabajo de integración pendiente» de `docs/observer-bridge-integration.md`. La evidencia más reciente de los HEAD y runs prevalece sobre los registros históricos de PR.

## Protocolo para el siguiente LLM

1. No pidas, pegues, registres ni hagas commit de secretos: `llm`, `SERVICE_API_KEY`, `GITHUB_READ_TOKEN`, `GH_TOKEN`, `SUPABASE_SECRET_KEY` ni `BRIDGE_ADMIN_PASSWORD`.
2. Distingue entre CI de los repositorios auxiliares, prueba de lectura staging y una certificación matemática de Lite/Plus. No son equivalentes.
3. No rehagas fases A o B: están cerradas con evidencia HTTP y CI.
4. No declares validado el despacho end-to-end: todavía no existe una prueba controlada completa Bridge → GitHub Actions Runner → recibo → Observador.
5. Ejecuta autónomamente las operaciones ordinarias dentro del alcance y políticas ya aprobados. Escala al usuario solo decisiones materiales no resueltas por el contrato, las pruebas o los límites definidos; no pidas aprobación por cada despacho rutinario.
6. Anota SHA, URL de run, códigos HTTP y cualquier cambio de configuración no secreta. Nunca registres valores de credenciales.

Un LLM sin GitHub es el consumidor previsto de Observador. El LLM que construye/mantiene la herramienta necesita acceso a GitHub; el humano administra Render y los secretos.

## Decisión de diseño vigente — Observer como único interlocutor del LLM

La arquitectura canónica es **LLM → Observer → Bridge → GitHub Actions Runner → Lite/Plus**, con retorno de recibos, estados y evidencias **Lite/Plus → Runner → Bridge → Observer → LLM**.

- **LLM / Action:** una sola conexión hacia Observer. Puede consultar y solicitar una operación; no conoce URL, claves ni endpoints de Bridge/GitHub.
- **Observer:** interfaz central, plano de control y orquestador. Integra las consultas de estado de Bridge con las lecturas GitHub existentes, evalúa plan/estado, valida autorización y scopes, decide RUN/WAIT/REUSE/RECONCILE y, cuando la solicitud está autorizada, invoca Bridge de servidor a servidor.
- **Bridge:** componente interno de despacho, recibos e idempotencia. Solo acepta solicitudes autenticadas desde Observer; aplica allowlist y validación final, registra la operación y despacha el workflow fijo. No es una Action ni una API consumida directamente por el LLM.
- **Runner:** ejecuta los workflows ya existentes en Lite/Plus y publica evidencia. No se crea un segundo Runner ni se duplica la lógica de planificación.

No se añade una nueva capa o servicio. Se reutilizan Observer, Bridge, los runners actuales, Render y Supabase ya desplegados. GET /v1/bridge/runs/{run_id} queda integrado como lectura de Observer; el siguiente cambio funcional es una operación protegida de solicitud de despacho en Observer, que internamente llama POST /api/runs de Bridge.

La autorización debe validarse en Observer antes de llamar Bridge y volver a validarse en Bridge con una credencial de servicio y permisos/scopes limitados. La Action solo recibe la credencial de Observer. La clave Bridge nunca se devuelve ni se documenta en el contrato público de la Action. Idempotency-Key debe conservarse extremo a extremo; los timeouts o resultados ambiguos pasan a reconciliación, nunca a reintento ciego.

La autorización operativa general del usuario permite automatizar el flujo ordinario dentro de los repositorios, gates, ramas, workflows y límites ya definidos. No se exige aprobación humana por cada despacho. dry_run=true en Bridge también inicia un workflow y debe tratarse como ejecución real: puede utilizarse automáticamente solo cuando la operación esté dentro de la política preaprobada y sus pruebas la permitan.

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


## Reorientación canónica del roadmap — 2026-10-30

Esta sección supersede cualquier instrucción anterior de este documento que indique que Observer debe permanecer GET-only, que el despacho debe solicitarse directamente a Bridge por un operador/LLM, o que un POST mediado por Observer esté fuera de alcance.

### Secuencia obligatoria

1. **Consolidar Observer como interfaz central de lectura y coordinación.** Mantener en Observer el estado bilateral, planificación de gates, evidencia GitHub, consulta de recibos Bridge, interpretación de bloqueos y decisiones RUN/WAIT/REUSE/RECONCILE.
2. **Integrar las consultas de Bridge dentro de Observer.** El LLM consulta recibos/estado únicamente por endpoints Observer; las llamadas upstream y credenciales quedan en servidor.
3. **Incorporar en Observer una operación protegida para solicitar despachos a Bridge.** El contrato público acepta una solicitud estricta; Observer recalcula el plan live, comprueba rama/SHA canónicos y delegación general dentro de política, y hace el POST interno a Bridge sin aprobación humana por evento.
4. **Mantener Bridge inaccesible directamente desde la Action del LLM.** Una única Action/OpenAPI apunta a Observer. No se publica una segunda Action, URL ni credencial Bridge.
5. **Validar autorización, scopes, idempotencia y trazabilidad de extremo a extremo.** Observer valida identidad/permiso/alcance; Bridge acepta únicamente la identidad de servicio Observer y limita targets/gates/workflow/ref; la misma clave idempotente y correlation/validation IDs se trazan desde la solicitud hasta el receipt y el run de Actions. Timeouts ambiguos → RECONCILE.
6. **Cerrar la infraestructura auxiliar y regresar a la certificación matemática.** No ampliar servicios, no crear runners paralelos y no seguir añadiendo funciones una vez validados los criterios de salida.

### Plan de ejecución y criterios de salida

| Bloque | Trabajo | Criterio de salida |
|---|---|---|
| O1 | Revisar y consolidar los endpoints de lectura de Observer, incluidos status, plan, evidencia y recibo Bridge | Un solo contrato LLM→Observer; datos de Bridge consultables sin exponer Bridge |
| O2 | Implementar operación protegida de solicitud de ejecución en Observer | Validación de esquema, plan live, rama/SHA, scopes y límites; ninguna llamada Bridge si falla la política |
| O3 | Endurecer autenticación interna Observer→Bridge | Credencial de servicio separada de la Action; Bridge rechaza llamadas no autorizadas y no confía en credenciales del LLM |
| O4 | Idempotencia y reconciliación | Reutilización segura de solicitudes equivalentes; conflictos de fingerprint rechazados; outcome incierto no se reintenta ciegamente |
| O5 | Pruebas de seguridad y trazabilidad | Tests para auth, scopes, allowlist, no exposición de secretos, audit trail y relación request→receipt→Actions run→Runner record |
| O6 | Validación end-to-end controlada | Tras CI y pruebas de seguridad/idempotencia verdes, ejecutar automáticamente un dispatch de staging dentro del alcance delegado; comparar run IDs y demostrar repetición idempotente sin segundo workflow |
| O7 | Cierre auxiliar | Evidencias y límites documentados; detener cambios en Observer/Bridge y retomar Lite/Plus |

### Límites operativos

- No se crea otra capa de servicios ni otro Runner.
- No se duplica en Observer la persistencia transaccional/idempotencia que corresponde a Bridge; Observer coordina y Bridge registra/ejecuta.
- Observer es el único interlocutor del LLM y el único servidor que puede invocar Bridge en este diseño.
- Bridge no recibe tráfico desde la Action del LLM. La restricción debe verificarse en el contrato OpenAPI y en pruebas, no solo en documentación.
- Observer no despacha por inferencia aislada: exige una solicitud explícita con parámetros exactos, plan live RUN, rama/SHA canónicos y scopes válidos. Dentro de ese contrato, la autorización general del usuario elimina aprobaciones humanas por evento.
- Un `dry_run=true` que crea un workflow se considera ejecución real y puede ejecutarse autónomamente dentro de la política delegada y probada.
- No hacer merge, corte de producción ni rotación de secretos como consecuencia automática de este cambio; son decisiones materiales separadas.
- La fase O6 no requiere aprobación humana adicional por dispatch rutinario; requiere que las pruebas de seguridad, allowlist, idempotencia y trazabilidad hayan habilitado la operación.

### Estado inicial de los bloques

- O1: parcialmente implementado; GET de recibo Bridge está en Observer PR #4 y fue probado en staging sobre el commit desplegado histórico. Verificar la rama/HEAD actual y ampliar consultas necesarias.
- O2: las rutas Observer GET de recibo UUID y consulta por idempotency key están implementadas; CI debe validar el HEAD actual y el despliegue staging aún no está actualizado.
- O3: `POST /v1/bridge/dispatch` está implementado en la rama del PR #4. Revalida el plan live, rama y SHA; solo llama Bridge cuando la decisión es RUN. Observer usa `BRIDGE_DISPATCH_KEY`, separado de la clave read-only `llm`.
- O4: migración `bridge_key_scopes` aplicada en Supabase; claves existentes quedan `read`; Bridge exige `dispatch` para POST y `read` para GET. Falta validar el rechazo de claves y el flujo desde el runtime staging actualizado.
- O5: Bridge ya tiene pruebas de replay, fingerprint conflict, concurrencia, lease, outcome unknown y reconciliación; se añadieron regresiones para scopes. La trazabilidad completa request→receipt→Actions→Runner todavía requiere E2E.
- O6: no ejecutado; pendiente CI del HEAD actual, despliegue staging y validación end-to-end.
- O7: pendiente de O1–O6.

### Actualización de la prioridad

La fase F anterior (entrega de una Action LLM GET-only) deja de ser el criterio final. La Action debe ser única y apuntar a Observer, pero su contrato final incluirá consultas y una solicitud protegida de despacho. No se habilita una Action directa a Bridge. La certificación matemática de Lite/Plus no debe quedar subordinada a mejoras cosméticas o nuevas capacidades auxiliares.


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
