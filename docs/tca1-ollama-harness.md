# TCA-1: harness local de Function Calling con Ollama

**Estado:** implementaciÃ³n propuesta en rama aislada; pendiente de CI y ejecuciÃ³n real en el host del operador.  
**ClasificaciÃ³n:** H9-ALT (complementaria). No reemplaza ni modifica el criterio oficial H9, que exige OpenAI Responses API.

## Objetivo y lÃ­mites

El harness ejecuta un modelo local mediante la API HTTP de Ollama y conecta sus Function Calls con el gateway TCA-1 ya desplegado. Comprueba estas dos funciones obligatorias:

- `precision_lab_bridge_capabilities` con argumentos vacÃ­os.
- `precision_lab_bridge_context_status` con `repo: "both"`.

El catÃ¡logo debe declarar `access_mode: "read"`. Solo se admiten las herramientas de lectura incluidas en una allowlist. El harness rechaza catÃ¡logos con herramientas de escritura, argumentos inesperados para capabilities, un status que no solicite ambos repositorios, redirecciones, gateway HTTP o endpoints Ollama no locales.

No llama submit, patch, validate, receipt, command dispatch ni Actions. No cambia secretos, despliegues ni feature flags. `BRIDGE_COMMAND_EXECUTION_ENABLED` debe continuar en `false`.

## Requisitos

1. Node.js 22.12 o superior.
2. Ollama instalado y ejecutÃ¡ndose en el mismo equipo.
3. Un modelo con soporte de tools/function calling. La configuraciÃ³n por defecto es `qwen3`; validar que el modelo descargado aparezca en `ollama list`.
4. Gateway de staging HTTPS operativo y credencial `TCA1_FUNCTION_GATEWAY_TOKEN` provisionada localmente, distinta de `TCA1_BRIDGE_KEY`.
5. La clave del gateway debe tener al menos 32 caracteres y permanecer en el entorno local. Nunca copiarla al prompt, argumento visible, issue, commit o conversaciÃ³n.

InstalaciÃ³n del modelo de referencia:

```powershell
ollama pull qwen3
ollama list
```

El API de Ollama soporta `POST /api/chat`, el campo `tools`, `stream: false`, respuestas `message.tool_calls` y mensajes de retorno con `role: "tool"`/`tool_name`. El harness utiliza ese protocolo sin aÃ±adir dependencias npm.

## EjecuciÃ³n en PowerShell

Desde la raÃ­z del repositorio clonado:

```powershell
$env:OLLAMA_MODEL = "qwen3"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434/"
$env:TCA1_FUNCTION_GATEWAY_URL = "https://precision-lab-bridge.onrender.com/api/tca1/functions"
node scripts/tca1-ollama-e2e.mjs
```

Antes de ejecutar, cargar `TCA1_FUNCTION_GATEWAY_TOKEN` en el entorno del proceso desde el mecanismo local seguro ya usado para TCA-1. No imprimirlo ni aÃ±adirlo al historial de PowerShell. No introducir `TCA1_BRIDGE_KEY` en esta sesiÃ³n: esa clave permanece exclusivamente en el servidor Bridge.

TambiÃ©n puede utilizarse un modelo compatible distinto sin cambiar el cÃ³digo, estableciendo `OLLAMA_MODEL` por su nombre exacto en `ollama list`. No usar un endpoint remoto: el harness permite Ãºnicamente `localhost`, `127.0.0.1` o `::1` mediante HTTP.

## Resultado esperado

El proceso devuelve JSON con `verified: true`, `provider: "ollama-local"`, el nombre de modelo, `access_mode: "read"`, dos llamadas exitosas y el texto final del modelo. No imprime cabeceras ni credenciales. Ante falta de Ollama, credencial, catÃ¡logo, respuesta de herramientas o invocaciÃ³n de ambas funciones, termina como `TCA1_OLLAMA_E2E_BLOCKED_OR_FAILED` con un cÃ³digo seguro.

Los tests automatizados del harness usan un fetch mock: validan loopback/gateway, rechazo de herramientas write, secuencia de dos Function Calls y separaciÃ³n de credenciales. Un test mock PASS no prueba el modelo local ni el staging live.

## Registro de evidencia

Por cada ejecuciÃ³n real, registrar fuera de secretos:

- `test_id: H9-ALT-OLLAMA` y `status` (`PASS`, `FAIL` o `BLOCKED`).
- SHA del cÃ³digo probado, fecha UTC, versiÃ³n de Node y versiÃ³n de Ollama.
- Nombre/tag y digest llamado segÃºn `ollama list`/`ollama show`.
- Host local, gateway staging, `access_mode`, nombres y cantidad de llamadas; HTTP final del gateway si se ha instrumentado sin exponer cabeceras.
- Resumen de salida redactado y evidencia local saneada.
- `credential_exposure: false` Ãºnicamente despuÃ©s de comprobar que el token no aparece en solicitudes Ollama, salida, logs ni artefactos.
- ConfirmaciÃ³n de que no se generaron comandos, workflows ni despachos.

No guardar cuerpo completo de herramientas ni metadatos que puedan incluir datos internos innecesarios. No registrar valores, hashes ni cabeceras de credenciales.

## RelaciÃ³n con H9 oficial

- H9 oficial permanece `BLOCKED` por falta de crÃ©ditos/API billing OpenAI mientras la baterÃ­a exija OpenAI Responses API.
- `H9-ALT-OLLAMA` es una vÃ­a complementaria independiente. Solo puede obtener `PASS` despuÃ©s de una ejecuciÃ³n real con Ollama local, gateway staging y evidencia verificable.
- Un resultado PASS de Ollama no se suma ni se sustituye por H9; cualquier cambio futuro del criterio oficial requiere una modificaciÃ³n versionada y aprobada de la baterÃ­a.

## Referencias tÃ©cnicas

- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
- Tool calling: https://github.com/ollama/ollama/blob/main/docs/capabilities/tool-calling.mdx
- Qwen3: https://ollama.com/library/qwen3
