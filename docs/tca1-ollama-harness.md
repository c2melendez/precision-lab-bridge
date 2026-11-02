# TCA-1: harness local de Function Calling con Ollama

**Estado:** implementacion propuesta en rama aislada; pendiente de CI y ejecucion real en el host del operador.  
**Clasificacion:** H9-ALT (complementaria). No reemplaza ni modifica el criterio oficial H9, que exige OpenAI Responses API.

## Objetivo y limites

El harness ejecuta un modelo local mediante la API HTTP de Ollama y conecta sus Function Calls con el gateway TCA-1 ya desplegado. Comprueba estas dos funciones obligatorias:

- `precision_lab_bridge_capabilities` con argumentos vacios.
- `precision_lab_bridge_context_status` con `repo: "both"`.

El catalogo debe declarar `access_mode: "read"`. Solo se admiten las herramientas de lectura incluidas en una allowlist. El harness rechaza catalogos con herramientas de escritura, argumentos inesperados para capabilities, un status que no solicite ambos repositorios, redirecciones, gateway HTTP o endpoints Ollama no locales.

No llama submit, patch, validate, receipt, command dispatch ni Actions. No cambia secretos, despliegues ni feature flags. `BRIDGE_COMMAND_EXECUTION_ENABLED` debe continuar en `false`.

## Requisitos

1. Node.js 22.12 o superior.
2. Ollama instalado y ejecutandose en el mismo equipo.
3. Un modelo con soporte de tools/function calling. La configuracion por defecto es `qwen3`; validar que el modelo descargado aparezca en `ollama list`.
4. Gateway de staging HTTPS operativo en el host exacto `precision-lab-bridge.onrender.com` y credencial `TCA1_FUNCTION_GATEWAY_TOKEN` provisionada localmente, distinta de `TCA1_BRIDGE_KEY`.
5. La clave del gateway debe tener al menos 32 caracteres y permanecer en el entorno local. Nunca copiarla al prompt, argumento visible, issue, commit o conversacion.

Instalacion del modelo de referencia:

```powershell
ollama pull qwen3
ollama list
```

El API de Ollama soporta `POST /api/chat`, el campo `tools`, `stream: false`, respuestas `message.tool_calls` y mensajes de retorno con `role: "tool"`/`tool_name`. El harness utiliza ese protocolo sin anadir dependencias npm.

## Ejecucion en PowerShell

Desde la raiz del repositorio clonado:

```powershell
$env:OLLAMA_MODEL = "qwen3"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434/"
$env:TCA1_FUNCTION_GATEWAY_URL = "https://precision-lab-bridge.onrender.com/api/tca1/functions"
node scripts/tca1-ollama-e2e.mjs
```

Antes de ejecutar, cargar `TCA1_FUNCTION_GATEWAY_TOKEN` en el entorno del proceso desde el mecanismo local seguro ya usado para TCA-1. No imprimirlo ni anadirlo al historial de PowerShell. No introducir `TCA1_BRIDGE_KEY` en esta sesion: esa clave permanece exclusivamente en el servidor Bridge.

Tambien puede utilizarse un modelo compatible distinto sin cambiar el codigo, estableciendo `OLLAMA_MODEL` por su nombre exacto en `ollama list`. No usar un endpoint remoto: el harness permite unicamente `localhost`, `127.0.0.1` o `::1` mediante HTTP.

## Resultado esperado

El proceso devuelve JSON con `verified: true`, `provider: "ollama-local"`, el nombre de modelo, `access_mode: "read"`, dos llamadas exitosas y el texto final del modelo. No imprime cabeceras ni credenciales. Ante falta de Ollama, credencial, catalogo, respuesta de herramientas o invocacion de ambas funciones, termina como `TCA1_OLLAMA_E2E_BLOCKED_OR_FAILED` con un codigo seguro.

Los tests automatizados del harness usan un fetch mock: validan loopback/gateway, rechazo de herramientas write, secuencia de dos Function Calls y separacion de credenciales. Un test mock PASS no prueba el modelo local ni el staging live.

## Registro de evidencia

Por cada ejecucion real, registrar fuera de secretos:

- `test_id: H9-ALT-OLLAMA` y `status` (`PASS`, `FAIL` o `BLOCKED`).
- SHA del codigo probado, fecha UTC, version de Node y version de Ollama.
- Nombre/tag y digest del modelo segun `ollama list`/`ollama show`.
- Host local, gateway staging, `access_mode`, nombres y cantidad de llamadas; HTTP final del gateway si se ha instrumentado sin exponer cabeceras.
- Resumen de salida redactado y evidencia local saneada.
- `credential_exposure: false` unicamente despues de comprobar que el token no aparece en solicitudes Ollama, salida, logs ni artefactos.
- Confirmacion de que no se generaron comandos, workflows ni despachos.

No guardar cuerpo completo de herramientas ni metadatos que puedan incluir datos internos innecesarios. No registrar valores, hashes ni cabeceras de credenciales.

## Relacion con H9 oficial

- H9 oficial permanece `BLOCKED` por falta de creditos/API billing OpenAI mientras la bateria exija OpenAI Responses API.
- `H9-ALT-OLLAMA` es una via complementaria independiente. Solo puede obtener `PASS` despues de una ejecucion real con Ollama local, gateway staging y evidencia verificable.
- Un resultado PASS de Ollama no se suma ni se sustituye por H9; cualquier cambio futuro del criterio oficial requiere una modificacion versionada y aprobada de la bateria.

## Referencias tecnicas

- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
- Tool calling: https://github.com/ollama/ollama/blob/main/docs/capabilities/tool-calling.mdx
- Qwen3: https://ollama.com/library/qwen3
