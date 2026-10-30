# Diseño: recuperación administrativa de solo lectura para registros históricos RUNNING

Solo diseño y revisión. No se edita código, no se ejecuta SQL, no se cambian datos ni permisos y no se publica nada.

## 1. Hallazgo clave: la reconciliación actual escribe

`lookupRequest` (en `src/lib/bridge/lookup.server.ts`) llama a `reconcileRunning` cuando `state === "RUNNING"`. Si todos los runs de GitHub están `completed`, esa función ejecuta:

```text
supabaseAdmin.from("bridge_idempotency")
  .update({ state, outcome_state, workflow_result, updated_at, finished_at })
  .eq("id", record.id).eq("state", "RUNNING")
```

Es una **escritura** (UPDATE condicional). Por eso:
- El endpoint admin **no puede** llamar a `lookupRequest` ni a `reconcileRunning`.
- Tampoco puede reutilizar `runStatus` de `core.server.ts`, que también persiste el estado final.
- Sí puede calcular un estado **observado** (`observed_state: SUCCEEDED|FAILED|RUNNING|UNKNOWN`) en memoria, a partir de GETs a GitHub, y devolverlo **junto al** `stored_state` sin guardarlo. Ambos campos se muestran por separado y nunca se mezclan.

## 2. Superficie y separación de servicio

- **Servidor interno, no ruta pública:** una función de servidor (`createServerFn`, método POST) en un módulo nuevo y aislado, p. ej. `src/lib/bridge/admin-history.functions.ts` + `admin-history.server.ts`. No se crea nada bajo `/api/` ni `/api/public/`, para no exponer otra superficie HTTP a clientes con bridge key.
- **Sin imports de dispatch:** el módulo `.server.ts` no importa `core.server.ts` (`trigger`, `dispatch`, `gh` con POST), ni `idempotency.server.ts` (RPC de claim/prepare/begin/record/finish). Tiene su propio helper `ghGetReadOnly` que solo acepta GET contra `/actions/runs/{id}` y `/actions/runs/{id}/jobs`.
- **Solo SELECT:** el cliente solo usa `.select(...)`. Ni `update`, `insert`, `delete`, `upsert` ni `rpc`. Lo garantizan los tests y una regla nueva en AGENTS.md.
- **Sin bridge keys:** el endpoint no acepta `X-Bridge-Key`, no restaura ni reasigna claves y no usa la clave activa de otro propietario. La autorización es administrativa, nunca de propietario.

## 3. Límites de autorización (mitigación IDOR/BOLA)

Varias capas, todas obligatorias:
1. **Autenticación admin:** `assertAdmin(password)` igual que las demás funciones admin (secret `BRIDGE_ADMIN_PASSWORD`). Comparación de hashes de longitud fija (ya se hace con SHA-256). Si falla, la respuesta es genérica.
2. **Allowlist cerrada en el servidor:** los tres `idempotency_id` (UUID) históricos se fijan en una constante del servidor (o en un secret `BRIDGE_HISTORY_ALLOWLIST`). El cliente envía un `id`, y si no está en la allowlist la respuesta es 404, **antes** de leer la base de datos. No hay búsqueda libre por `idempotency_key`, `key_id` ni listados.
3. **Predicado de la consulta (defensa en profundidad):** `.eq("id", id).eq("state", "RUNNING")` y un join o segunda lectura que confirme que su `key_id` corresponde a una `bridge_keys` con `revoked_at IS NOT NULL`. Si cualquier condición falla, 404 sin detalle. Así, aunque la allowlist se configure mal, nunca se puede leer un registro activo ni de otro propietario vigente.
4. **Proyección mínima:** se devuelven `idempotency_id`, `stored_state`, `outcome_state`, `run_id`, `gh_runs` (repo, run_id, html_url), `job_ids`, `error_code`, timestamps y `key_prefix` (nunca el hash ni la clave). Nunca `request_payload` completo, `lease_token`, `response` ni `dispatch_intents`.
5. **Validación de entrada:** zod con `password` (1–200 caracteres) e `id` (`uuid()`), sin parámetros adicionales (`.strict()`).
6. **Límite de uso:** el contador de intentos fallidos solo se lleva en memoria por instancia. Hay que documentar que no hay un rate limit durable, porque eso requeriría escritura.

## 4. Auditoría sin escribir en la base de datos

Exigir "auditable" y "sin cambiar estado en la base de datos" choca entre sí. Propuesta:
- **Por defecto:** una línea JSON estructurada en los logs del servidor (`console.info`) por cada llamada, con `event: "admin_history_read"`, timestamp, `id` solicitado, decisión (`allowed|denied_auth|denied_allowlist|not_found|github_error`), `stored_state` y `observed_state`. Sin password, sin hash ni datos de GitHub sensibles. Se consulta con las herramientas de logs del servidor.
- **Opcional (requiere tu aprobación explícita, porque es una escritura):** un INSERT append-only en `bridge_calls` con `endpoint="admin/history"`. No toca `bridge_idempotency`. Si lo apruebas, debe hacerse después de la decisión de autorización y un fallo de esta escritura no debe cambiar la respuesta.

## 5. Respuestas y errores

| Caso | Resultado |
|---|---|
| Password incorrecta o secret ausente | error `UNAUTHORIZED` (genérico) |
| Entrada inválida | `INVALID_INPUT` |
| `id` fuera de la allowlist, no RUNNING o con clave no revocada | `NOT_FOUND` (idéntico en los tres casos, para no filtrar existencia) |
| Error de almacenamiento | `STATUS_STORE_UNAVAILABLE` |
| GitHub falla o sin `run_id` | 200 con `observed_state: "UNKNOWN"` y `stored_state` intacto |
| Éxito | 200 con `stored_state: "RUNNING"`, `observed_state`, `runs[]` (status, conclusion, url), `persisted: false` |

`persisted: false` deja claro de forma explícita que nada se guardó.

## 6. Pruebas (vitest, todo mockeado, sin red real)

Positivas:
- Un id de la allowlist con clave revocada y runs `completed/success` devuelve `observed_state=SUCCEEDED`, `stored_state=RUNNING` y `persisted=false`.
- Con un run fallido devuelve `observed_state=FAILED`. Con runs en progreso devuelve `RUNNING`.

Negativas (IDOR/BOLA y auth):
- Password incorrecta o ausente: no hay lectura de base de datos ni fetch.
- Un UUID válido fuera de la allowlist da `NOT_FOUND` sin lectura de base de datos.
- Un id de la allowlist cuya clave **no** está revocada da `NOT_FOUND`.
- Un id de la allowlist ya en estado final da `NOT_FOUND` (o devuelve el estado sin consultar GitHub, según se decida).
- Campos extra en la entrada se rechazan.
- Si GitHub falla o devuelve 5xx, la respuesta es `UNKNOWN` y no hay escritura.

Invariantes de solo lectura (en cada test):
- `update`, `insert`, `delete`, `upsert` y `rpc` nunca se llaman.
- Todo fetch es GET y ninguna URL contiene `/dispatches`.
- Un test estático lee el código fuente de `admin-history.server.ts` y falla si contiene `core.server`, `idempotency.server`, `.update(`, `.insert(`, `.rpc(` o `dispatches`.
- La respuesta nunca incluye `key_hash`, `lease_token` ni `request_payload`.

## 7. Verificación del despliegue (cuando se autorice implementar)

1. Build limpio y tests del bridge en verde.
2. Publicar solo con tu autorización.
3. En vivo: llamar a la función admin para los tres ids y confirmar `observed_state=SUCCEEDED` y `persisted=false`.
4. Con una consulta SELECT, antes y después, comprobar que `state`, `updated_at` y `finished_at` de esas tres filas **no cambiaron** y que el número de filas de `bridge_idempotency` y `bridge_runs` es el mismo.
5. Comprobar que GitHub no tiene nuevos runs `workflow_dispatch` desde la verificación.
6. Revisar en los logs las líneas `admin_history_read`.
7. Prueba negativa en vivo: un UUID aleatorio debe devolver `NOT_FOUND`.

## 8. Decisiones pendientes

- Auditoría solo en logs (recomendado, cero escrituras) o también un INSERT en `bridge_calls`.
- Allowlist como constante en el código o como secret.
- Si más adelante quieres **cerrar** esas tres filas como SUCCEEDED, hará falta una operación administrativa de escritura separada, con su propia autorización. Queda fuera de este diseño.