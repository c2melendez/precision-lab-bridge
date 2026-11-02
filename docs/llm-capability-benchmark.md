# Benchmark local de capacidades LLM — CB1–CB10

## Objetivo y límites

Este ejecutor implementa la pista de competencia técnica CB1–CB10 de la batería v2.2.2. Utiliza Ollama local por HTTP en loopback y no requiere OpenAI API, claves Bridge, claves GitHub, acceso a Observer ni acceso a Supabase.

No es un benchmark de conectividad A–F, no certifica TCA H1–H9 y no acredita por sí solo M6. CB4 evalúa un diff como texto y nunca aplica ni ejecuta código producido por el modelo. CB10 evalúa razonamiento sobre límites de propietario mediante un handoff sintético; no sustituye la prueba de dos agentes/identidades/transportes reales.

## Requisitos

- Node.js 22.12 o superior y dependencias Bridge instaladas.
- Ollama activo en http://127.0.0.1:11434 o http://localhost:11434.
- Un modelo local compatible con JSON output; por defecto qwen3.
- El modelo debe aparecer en ollama list.

No se configura ningún API key. No expongas el puerto Ollama a la red; el ejecutor rechaza hosts que no sean loopback.

## Ejecución

Comandos PowerShell:

    ollama list
    ollama pull qwen3
    bun run llm:benchmark

Opciones por variables de entorno:

- OLLAMA_MODEL: nombre/tag instalado, por ejemplo qwen3:8b.
- OLLAMA_BASE_URL: solo localhost/127.0.0.1/[::1].
- LLM_BENCHMARK_RUNS: de 3 a 10; por defecto 3.
- LLM_BENCHMARK_OUTPUT_DIR: directorio local de evidencia; por defecto artifacts/llm-benchmark/<campaign_id>.
- LLM_BENCHMARK_HOST_ID: etiqueta local opcional no secreta.
- SOURCE_SHA: SHA del código probado; si falta, intenta git rev-parse HEAD.

Cada campaña llama el modelo de forma secuencial, con conversaciones independientes y temperatura 0. El resultado registra versión/digest del modelo, hash del conjunto de fixtures, SHA fuente cuando esté disponible, tokens y duración si Ollama los devuelve. Coste se registra como null (no hay facturación de proveedor).

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

Las puntuaciones de dimensiones (exactitud, calidad técnica, seguridad/fiabilidad y autonomía) derivan de los checks asignados. Eficiencia usa tokens y duración locales cuando están disponibles. Ninguna dimensión se infiere de un resultado faltante.

## Comparabilidad

Para comparar modelos, mantener exactamente la misma versión de prompts/fixtures, SHA, transporte, permisos y presupuesto; cambiar un factor a la vez. Ejecutar al menos tres repeticiones por modelo/tarea y registrar hardware/host. La campaña inicial Qwen3 es un resultado local de un solo modelo; no representa comparativa multi-modelo.

## Evidencia

Se escriben results.json (una entrada por caso/repetición) y summary.json (conteos, medias/medianas/desviación y dimensiones). Los archivos se crean con permisos locales restringidos. No se almacenan prompts de sistema, claves, cabeceras, variables secretas ni cadenas canary literales.

La batería maestra permanece en docs/parallel-tool-consumer-probe-battery.md. Los criterios de M6 exigen A–F, H1–H9 live, CB1–CB10 publicados, dos modelos distintos, dos identidades y dos transportes reales, además de la traza end-to-end. Esta herramienta solo cubre la primera parte de CB1–CB10 con un modelo local y fixtures.
