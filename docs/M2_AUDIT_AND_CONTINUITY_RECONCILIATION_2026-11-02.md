# Auditoría M2 y reconciliación de continuidad — 2026-11-02

**Tipo:** informe diagnóstico documental, no normativo  
**Estado:** borrador para revisión  
**Rama de este informe:** `audit/m2-failure-reconciliation-2026-11-02`  
**Base Bridge:** `main` en `f8cef11fc48e56459ffad7764c2cf10c0a0a3321`

## 1. Alcance y límites

Se inspeccionaron, sin modificar código ni ejecutar nuevos workflows:

- Lite PR [#60](https://github.com/c2melendez/precision-lab-lite/pull/60), head `c6813092c12b84212b64a14db540d67eb95b4915`, base `main` en `4507082a101fbc5a196cfbfe335db6e83c2cb6d0`.
- Plus PR [#41](https://github.com/c2melendez/precision-lab-plus/pull/41), head `5288fae3f42065e3246f62e9f017098a1bad5cc4`, base `main` en `abc1c29744341afb707878d428c98fcf44acbbbd`.
- Runs de CI/E2E asociados a esos SHA.
- Índices y cortes canónicos de continuidad de Lite y Plus en `qa/syntax-audit-in625-a1`.
- Primera ejecución de automatización Windows de Bridge.

Este informe no cambia el estado de aceptación de ningún caso, no modifica ramas de producto, no reintenta Actions, no fusiona PR y no despliega servicios. Sus diagnósticos no sustituyen los contratos ni los documentos canónicos de cada repositorio.

## 2. Lite — PR #60 y gate de dependencias

### Evidencia observada

- Run CI [41179156491](https://github.com/c2melendez/precision-lab-lite/actions/runs/41179156491), SHA `c6813092c12b84212b64a14db540d67eb95b4915): `FAILURE`.
- Job `frontend`: `npm ci` SUCCESS; `QA dependency audit (hard gate)` FAILURE; typecheck, unit/parity tests y production build quedaron SKIPPED por el gate.
- Job `bridge-command-runner-contract`: SUCCESS.
- Artefacto de auditoría: [lite-npm-audit](https://github.com/c2melendez/precision-lab-lite/actions/runs/41179156491/artifacts/13033384772).

El JSON del artefacto reporta cuatro vulnerabilidades LOW y ninguna MODERATE/HIGH/CRITICAL. Las cuatro entradas pertenecen a una sola cadena:

- `deepmerge@4.3.1`: GHSA-gcqx-w48m-w2h4, prototype poisoning.
- Dependencia transitiva: `@rollup/plugin-node-resolve`.
- Efectos reportados: `workbox-build` y `vite-plugin-pwa`.

### Reconciliación con la remediación canónica

La rama canónica `qa/syntax-audit-in625-a1` contiene `vendor/deepmerge` versión privada `4.3.2`, con parche local documentado, además de `file:vendor/deepmerge` y override para resolver la dependencia vulnerable. El `package-lock.json` de esa rama apunta al paquete local.

La rama `feature/m2-command-runner-bridge` probada por PR #60 no contiene ese paquete local: su lock resuelve `deepmerge@4.3.1`. El PR modifica `package.json` y `package-lock.json` (incluido el salto de `vite-plugin-pwa` a `^2.0.0`), pero no incorpora la remediación local de la rama canónica. La rama `main` usada como base tampoco contiene esa remediación.

**Conclusión:** la aceptación bilateral SECURITY-S25 registrada en las ramas canónicas no se transfiere automáticamente a este árbol de integración basado en `main`. El hard gate de PR #60 está detectando una dependencia realmente vulnerable en el árbol que probó. No usar `npm audit fix --force` ni aceptar una bajada mayor propuesta por npm sin revisar compatibilidad.

**Acción propuesta:** portar/reconciliar explícitamente el parche local `deepmerge` y sus referencias de manifiesto/lockfile en la línea de integración de M2; después validar `npm ci`, audit, typecheck, tests y build. No se hizo ese cambio en esta revisión.

## 3. Plus — PR #41 y Playwright E2E

### Evidencia observada

- Run Playwright [41178121954](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121954), SHA `5288fae3f42065e3246f62e9f017098a1bad5cc4`: `FAILURE`.
- Instalación backend/frontend y Chromium: SUCCESS.
- Resultado: 171 pruebas PASS y 42 FAIL.
- Los 42 fallos son 14 casos repetidos en desktop, tablet y mobile Chromium.
- Artefacto Playwright: [plus-playwright-report](https://github.com/c2melendez/precision-lab-plus/actions/runs/41178121954/artifacts/13034445865).

La comparación de blobs confirma que `frontend/e2e/in625-syntax-native.spec.ts`, `frontend/src/components/BasicMode.tsx`, `backend/app/services/ast_validator.py` y `backend/app/services/integral_service.py` son idénticos en `main` y en la rama del PR. PR #41 añade el worker/workflow Bridge y actualiza el lockfile frontend; no modifica esos archivos de aplicación ni el test E2E. Por ello, no hay evidencia de que los fallos se hayan introducido por el código del worker. La actualización del lockfile sigue siendo una variable del entorno de prueba y no se descarta por completo una interacción de dependencias.

### Clasificación de los fallos por causa observable

| Casos | Evidencia del log/código | Clasificación |
|---|---|---|
| SY-R-13, SY-R-14 | La entrada contiene `=`; `BasicMode` enruta ecuaciones a `/solve` con campo `equation`. El helper E2E espera una petición con campo `expression` y por eso expira esperando respuesta. | Desalineación entre fixture/helper y enrutamiento actual; definir si la entrada es ecuación o sustitución antes de cambiar código. |
| SY-X-01, SY-X-05, SY-X-09 (recuperación) | Tras evaluar `2+3`, el DOM muestra `2+3` donde el test espera `5`. `evaluate_service` conserva el árbol SymPy no evaluado y usa `evalf()` para `result_approx`. | Brecha entre resultado exacto mostrado y expectativa de normalización numérica; contrastar contrato de `/evaluate`. |
| SY-X-02, SY-X-03, SY-R-12, SY-X-07 | Playwright informa strict-mode violation: `getByRole("alert")` resuelve dos elementos. | Selector E2E ambiguo; el test debe identificar el alert de la región que está verificando. |
| SY-X-06 | El schema `EvaluateRequest` restringe `expression` a 500 caracteres. El payload de 10,000 caracteres es rechazado por Pydantic antes de llegar a `parsing.validate_length`; el E2E espera el mensaje específico del parser. | Desalineación de mensaje/etapa de validación. Preservar el límite de 500; decidir si se traduce el error de schema a un mensaje legible o si se ajusta la expectativa. |
| SY-X-08 | La API devuelve `sqrt(-1)`; el test espera `I`. El parser usa `evaluate=False` y el servicio conserva `result.expr` al construir `result_text/result_latex`. | Falta de canonicalización/simplificación de un resultado complejo; confirmar semántica exacta esperada antes de corregir. |
| SY-X-10, SY-X-11 | La API devuelve `success: true`; el test espera `COMPLEXITY_LIMIT`. El validador limita exponentes cuando `exponent.is_Integer`, pero un exponente que es otra expresión `Pow` no satisface esa condición. | Brecha real en el límite de complejidad para potencias anidadas; requiere prueba unitaria y una cota segura que no expanda la torre. |
| SY-X-12 | La API devuelve `success: true` para `sin(x^x)`; el test espera `UNSUPPORTED_OPERATION`. | Conflicto contractual descrito abajo. |

### Conflicto contractual SY-X-12

Hay tres fuentes incompatibles en el mismo árbol Plus:

1. `README.md` indica que `/integral` debe rechazar cuando `manualintegrate` produce `DontKnowRule` o falla la verificación.
2. `backend/app/services/integral_service.py` hace fallback a `sympy.integrate()` cuando recibe `DontKnowRule`, incluso si el resultado queda como integral no evaluada.
3. `backend/tests/test_integrals.py::test_fallback_for_unmapped_rule_sin_of_sin` exige `success: true` para `sin(sin(x))`, mientras el E2E SY-X-12 exige `success: false`, `UNSUPPORTED_OPERATION` y mensaje de ausencia de forma elemental.

No cambiar solo el test ni solo el servicio. Resolver primero el contrato versionado de integrales no elementales y alinear README, backend unitario, router y E2E.

## 4. Continuidad matemática — reconciliación sin falsa paridad

### Lite

- `CURRENT_STATE.md`: corte r368; AS-EXP-07 figura PASS_SCOPED.
- `continuity.json`: `next_action=ALGEBRA114-AS-EXP-08-ORACLE-AUDIT`, estado `IN_PROGRESS`, test blob `08c80b237acf7d5c5ce072ee32ad904b54a29c25`, SHA de prueba `a1a69ae9429afc9481d9febf34885b9242968917`.
- Los gates de ese SHA ahora se verifican como completados SUCCESS: CI [41144965662](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144965662), cumulative [41144965700](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144965700) y H1d [41144965719](https://github.com/c2melendez/precision-lab-lite/actions/runs/41144965719).
- El test `tests/algebra114AsExp08.audit.test.ts` está presente en el SHA citado y usa el fixture fuente, multiconjunto simbólico y seis sustituciones con oráculo JavaScript independiente.
- No se encontró un informe de aceptación `ALGEBRA114_AS_EXP_08_ACCEPTANCE_*.md`. Por tanto, los gates verdes permiten elevar la tarea a revisión de aceptación, pero no declarar PASS_SCOPED desde esta inspección.

### Plus

- `CURRENT_STATE.md`: corte r368.
- `continuity.json`: siguiente acción `EDCX-B6-VC-FE-45-CONTRACT-CONFLICT`, estado BLOCKED.
- El conflicto sigue siendo matriz B6 solicita `asin(2)` complejo con ramas ± frente a EV-I-12 y el evaluador real que requieren `DOMAIN_ERROR` fuera del dominio real.
- No debilitar EV-I-12 ni aceptar VC-FE-45 sin decisión contractual versionada.

### Interpretación correcta

Lite AS-EXP-08 y Plus VC-FE-45 son tareas distintas y específicas de cada motor; no deben forzarse a compartir el mismo identificador de siguiente acción. Los valores de revisión del índice JSON y del corte CURRENT_STATE tampoco prueban por sí solos una contradicción. La reconciliación necesaria es actualizar los registros de cada repositorio con su evidencia más reciente y mantener separados los alcances Lite-only/Plus-only.

## 5. Automatización Windows de Bridge

La primera ejecución [41517602100](https://github.com/c2melendez/precision-lab-bridge/actions/runs/41517602100), SHA `f8cef11fc48e56459ffad7764c2cf10c0a0a3321`, continúa `queued` al 2026-11-02. No hay evidencia de que un runner compatible haya reclamado el job; no se declara ejecución ni PASS.

## 6. Secuencia de trabajo propuesta

1. **Lite M2:** incorporar la remediación `deepmerge` de la rama canónica a la línea del PR #60, sin bajar umbrales; después repetir los gates afectados.
2. **Plus M2:** corregir primero la brecha real de potencias anidadas (SY-X-10/11) con tests unitarios de límite seguro.
3. **Plus resultados/UI:** decidir contrato de canonicalización numérica/compleja (X-01/05/08/09), corregir mensajes de validación X-06 y acotar locators E2E ambiguos.
4. **Plus integral:** versionar la decisión sobre `DontKnowRule` y alinear README, backend unitario y E2E antes de cambiar implementación.
5. **R-13/R-14:** adaptar el fixture al flujo de sustituciones real o versionar el comportamiento de notación natural; no forzar el helper a esperar un payload distinto del que el router envía.
6. **Lite AS-EXP-08:** revisar logs completos y emitir aceptación versionada si el oráculo, el fixture y los gates exactos cumplen; hasta entonces mantenerlo pendiente de revisión.
7. **Plus VC-FE-45:** mantener BLOCKED hasta decisión contractual humana.
8. **Windows:** registrar el runner local; no se puede activar la suite central mientras el job permanezca queued.

## 7. Acciones no realizadas

No se editaron archivos de producto ni índices canónicos; no se modificaron secretos; no se ejecutaron Actions nuevas; no se hizo dispatch, merge, deploy, migración ni cambio de permisos. Este informe es solo una base de revisión y no autoriza esas acciones.
