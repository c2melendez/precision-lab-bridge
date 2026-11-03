# Benchmark local de capacidades LLM — CB1–CB10

## Objetivo y límites

Este ejecutor implementa la pista de competencia técnica CB1–CB10 de la batería versionada en el repositorio (benchmark 2.1.0). Admite Ollama local por HTTP en loopback y GroqCloud mediante Chat Completions compatible con OpenAI. Groq requiere una clave API propia; no requiere créditos de OpenAI, claves Bridge, claves GitHub, acceso a Observer ni acceso a Supabase.

No es un benchmark de conectividad A–F, no certifica TCA H1–H9 y no acredita por sí solo M6. CB4 evalúa un diff como texto y nunca aplica ni ejecuta código producido por el modelo. CB10 evalúa razonamiento sobre límites de propietario mediante un handoff sintético; no sustituye la prueba de dos agentes/identidades/transportes reales.

## Requisitos

- Node.js 22.12 o superior y dependencias Bridge instaladas.
- Para Ollama: Ollama activo en http://127.0.0.1:11434 o http://localhost:11434 y un modelo compatible con JSON output presente en ollama list.
- Para GroqCloud: cuenta con acceso a API, clave GROQ_API_KEY y un modelo habilitado para la cuenta. El modelo remoto predeterminado es openai/gpt-oss-20b.
- Groq usa el endpoint fijo https://api.groq.com/openai/v1/chat/completions; no se admite configurar un host arbitrario.

Con Ollama no se configura ninguna API key y el ejecutor rechaza hosts que no sean loopback. Con Groq, GROQ_API_KEY se lee únicamente desde el entorno del proceso y solo se envía como cabecera Authorization a api.groq.com. Nunca se añade al prompt, al cuerpo JSON, a logs ni a los archivos de evidencia. No uses fixtures con datos reales privados: el benchmark remoto está limitado a los fixtures sintéticos versionados.

## Ejecución

Comandos PowerShell:

    ollama list
    ollama pull qwen3
    bun run llm:benchmark

Para GroqCloud en PowerShell, primero crea una clave en la consola de Groq y cárgala en la sesión sin escribir su valor en el historial:

    $env:LLM_PROVIDER = "groq"
    $env:GROQ_MODEL = "openai/gpt-oss-20b"
    $secureKey = Read-Host "GROQ_API_KEY" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
        $env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $secureKey.Dispose()
    }
    bun run llm:benchmark
    Remove-Item Env:GROQ_API_KEY

Para regresar a Ollama, establece LLM_PROVIDER=ollama o abre una sesión nueva.

Opciones por variables de entorno:

- LLM_PROVIDER: ollama (predeterminado) o groq.
- OLLAMA_MODEL: nombre/tag instalado, por ejemplo qwen3:8b.
- OLLAMA_BASE_URL: solo localhost/127.0.0.1/[::1].
- GROQ_API_KEY: secreto requerido para el proveedor groq; nunca se escribe en evidencia.
- GROQ_MODEL: identificador exacto del modelo de Groq; por defecto openai/gpt-oss-20b.
- GROQ_MIN_INTERVAL_MS: pausa mínima entre inicios de solicitudes Groq; por defecto 20000 ms para moderar el consumo de cuota.
- LLM_BENCHMARK_RUNS: de 3 a 10; por defecto 3.
- LLM_BENCHMARK_OUTPUT_DIR: directorio local de evidencia; por defecto artifacts/llm-benchmark/<campaign_id>.
- LLM_BENCHMARK_HOST_ID: etiqueta local opcional no secreta.
- SOURCE_SHA: SHA del código probado; si falta, intenta git rev-parse HEAD.

### Comparación reproducible: Qwen3 local vs Groq

Ejecuta las dos campañas desde el mismo worktree, commit y sesión, sin modificar código ni fixtures entre ellas. Así se conservan iguales el SHA fuente, benchmark, prompt y fixtures.

Primero Ollama:

    $env:LLM_PROVIDER = "ollama"
    $env:OLLAMA_MODEL = "qwen3:latest"
    $env:LLM_BENCHMARK_RUNS = "3"
    $env:LLM_BENCHMARK_OUTPUT_DIR = "artifacts/llm-benchmark/qwen3-local"
    bun run llm:benchmark

Después Groq, desde el mismo checkout:

    $env:LLM_PROVIDER = "groq"
    $env:GROQ_MODEL = "openai/gpt-oss-20b"
    $env:LLM_BENCHMARK_OUTPUT_DIR = "artifacts/llm-benchmark/groq-gpt-oss-20b"
    bun run llm:benchmark

Carga GROQ_API_KEY mediante el bloque seguro de PowerShell de arriba. La documentación de límites de Groq lista openai/gpt-oss-20b; los límites exactos pueden variar por organización y deben confirmarse en la página Limits antes de ejecutar. El cliente aplica una pausa predeterminada de 20 segundos y no reintenta automáticamente errores HTTP. <https://console.groq.com/docs/rate-limits>

Genera el informe comparativo:

    bun run llm:benchmark:compare -- artifacts/llm-benchmark/qwen3-local/summary.json artifacts/llm-benchmark/groq-gpt-oss-20b/summary.json

El comparador escribe comparison.json y comparison.md. Rechaza campañas incompletas o diferencias en benchmark, prompt, digest completo de fixtures, SHA de código, cantidad de repeticiones o conjunto de casos.

Cada campaña llama el modelo de forma secuencial, con conversaciones independientes y temperatura 0. El digest SHA-256 cubre el objeto completo de cada fixture, incluidas instrucciones, contexto, checks y criterios críticos; se versiona el benchmark cuando cambia el contrato de comparabilidad. Groq utiliza JSON mode y un intervalo predeterminado de 20 segundos entre solicitudes. Un error HTTP, de autenticación, de transporte o de cuota detiene la campaña y marca las repeticiones restantes como BLOCKED; no se reintenta automáticamente. El resultado registra proveedor, modelo, fingerprint reportado cuando está disponible, transporte, hash del conjunto de fixtures, SHA fuente cuando esté disponible, tokens y duración. Coste se registra como null; el ejecutor no consulta facturación del proveedor. Comprueba los límites actuales en el panel de Groq, ya que dependen del modelo y del plan.

## Casos

- CB1: comprensión de snapshot y dependencias de repositorio.
- CB2: diagnóstico de causa raíz e hipótesis alternativas.
- CB3: planificación/reconciliación sin POST redundante.
- CB4: corrección tipada propuesta en un fixture desechable; no se aplica ni ejecuta.
- CB5: selección de perfiles de pruebas.
- CB6: clasificación de FAILURE/SKIPPED y conservación de hard gates.
- CB7: corrección iterativa ante regresión.
- CB8: incertidumbre y abstención ante evidencia incompleta.
- CB9: resistencia a prompt injection con canary sintético.
- CB10: continuidad multiagente y aislamiento de recibos por propietario.

Cada tarea tiene cuatro checks versionados y puntuación 0–4. Estados: PASS, PASS_PARTIAL, FAIL, BLOCKED y CRITICAL. CRITICAL detiene la campaña; las repeticiones restantes quedan BLOCKED. El texto del canary CB9 se redacta antes de escribir evidencia.

Las puntuaciones de dimensiones (exactitud, calidad técnica, seguridad/fiabilidad y autonomía) derivan de los checks asignados. Eficiencia usa tokens y duración del proveedor cuando están disponibles. Ninguna dimensión se infiere de un resultado faltante.

## Comparabilidad

Para comparar modelos, mantener exactamente la misma versión de prompts/fixtures, SHA, presupuesto de salida y número de repeticiones; cambiar un factor a la vez. Registrar proveedor, modelo, fingerprint y transporte. El transporte y el entorno de inferencia se registran explícitamente: las latencias locales Ollama y las latencias cloud Groq no deben interpretarse como mediciones del mismo hardware. Ejecutar al menos tres repeticiones por modelo/tarea.

## Evidencia

Se escriben results.json (una entrada por caso/repetición) y summary.json (conteos, medias/medianas/desviación y dimensiones). Los archivos se crean con permisos locales restringidos. No se almacenan prompts de sistema, claves, cabeceras, variables secretas ni cadenas canary literales. La detección/redacción de credenciales reconoce también el prefijo gsk_ usado por las claves Groq.

La batería maestra permanece en docs/parallel-tool-consumer-probe-battery.md. Los criterios de M6 exigen A–F, H1–H9 live, CB1–CB10 publicados, dos modelos distintos, dos identidades y dos transportes reales, además de la traza end-to-end. Esta herramienta solo cubre CB1–CB10 con un proveedor/modelo por campaña y fixtures. Una campaña Groq con fixtures sintéticos no demuestra conectividad Bridge/Observer ni reemplaza los requisitos de M6.
