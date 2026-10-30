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
