# Automatización local de Precision Lab (Windows)

## Alcance

El runner ejecuta en secuencia validaciones de Bridge, Lite, Plus y Observer en el equipo Windows que mantiene Ollama. Cada ejecución genera evidence.json y logs por etapa como artefacto de 30 días.

- Bridge: instalación Bun, tests, lint y build.
- Lite: npm ci, auditoría npm estricta, typecheck, tests y build.
- Plus: pytest backend con cobertura mínima del 75%; typecheck, tests, build y auditoría informativa del frontend, según su CI actual.
- Observer: dependencias de desarrollo y pytest.
- TCA1: sonda real Ollama/Qwen3 de solo lectura. No usa OpenAI API ni consume créditos.
- La rama canónica de Lite/Plus se obtiene desde qa/certification/README.md en ambos main y se exige coincidencia antes de ejecutar.

Esta suite solo puede producir PASS_SCOPED para las etapas ejecutadas; no sustituye la certificación matemática ni declara cerrados bloqueos conocidos.

## Requisitos Windows

1. Windows 10/11 x64 actualizado.
2. Git for Windows.
3. Ollama instalado y ejecutándose localmente; modelo qwen3 descargado.
4. Bun instalado desde el instalador oficial.
5. Internet para clonar repositorios e instalar dependencias.
6. Node.js 22.12 y Python 3.12 serán preparados por el workflow.

Verifica localmente:

```powershell
git --version
node --version
npm.cmd --version
python --version
bun --version
ollama --version
ollama list
```

## Registro del runner (acción local única)

El runner se registra a nivel del repositorio Bridge, no como runner global:

1. Abre https://github.com/c2melendez/precision-lab-bridge/settings/actions/runners.
2. Selecciona New self-hosted runner → Windows → x64.
3. Sigue las instrucciones oficiales para descargar y configurar el runner.
4. Asigna nombre precision-lab-windows y etiqueta adicional precision-lab.
5. Instálalo como servicio de Windows y verifica que aparezca Idle en GitHub.

El token de registro es temporal. Introdúcelo únicamente en la consola local que GitHub indica; nunca lo pegues en ChatGPT, issues, commits o logs. No compartas el directorio de configuración del runner.

## Secreto TCA1

En Bridge, abre Settings → Secrets and variables → Actions → New repository secret y crea:

- Nombre: TCA1_FUNCTION_GATEWAY_TOKEN
- Valor: token TCA1 vigente, introducido directamente en GitHub.

No añadas el secreto a Variables, archivos .env, scripts, commits o artefactos. El workflow lo inyecta solo en el paso de la sonda TCA1 y no imprime su valor. Si no existe, la sonda queda BLOCKED_MISSING_REPOSITORY_SECRET; las demás pruebas pueden ejecutarse.

El endpoint queda fijado al host y ruta que valida el harness. El workflow no configura ni modifica secretos de Render, Supabase u OpenAI. La prueba OpenAI queda fuera porque requiere créditos/API key y el entorno actual no dispone de ellos.

## Seguridad del runner

Los cuatro repositorios consultados son públicos. Por ello, el workflow deliberadamente no escucha pull_request ni pull_request_target; admite workflow_dispatch desde main por la cuenta propietaria, push de código a main por la cuenta propietaria y un horario diario. No ejecutes código de PRs no revisados en este runner. Mantén el runner limitado al repositorio Bridge y evita etiquetas genéricas compartidas.

No se concede contents: write ni actions: write al GITHUB_TOKEN. El workflow no hace commits, no fusiona PRs, no modifica ramas, no despacha otros workflows ni despliega servicios.

## Activación y primera ejecución

Este cambio se entrega como PR borrador. Tras revisar y fusionar el PR, registrar el runner y guardar el secreto TCA1:

1. En Actions → Precision Lab — Windows local automation → Run workflow, selecciona main y deja activada la sonda Ollama.
2. Espera a que el runner pase de Idle a In progress.
3. Descarga precision-lab-windows-evidence-* y conserva JSON y logs con el SHA exacto.
4. La suite corre al actualizar código en Bridge main (no en cambios solo documentales), por ejecución manual y diariamente a las 06:00 hora de Honduras (12:00 UTC). Para Lite/Plus/Observer, los cambios se detectan en el ciclo diario; los repositorios externos no están conectados por webhook a Bridge.

## Límites y aprobación

Automático: clonar repositorios públicos, instalar dependencias, ejecutar tests/builds de solo lectura y publicar artefactos.

Requiere aprobación explícita: merge de PRs, cambios a permisos/runners, escritura de secretos, despliegues a Render, migraciones o cambios de datos, cambios de ramas canónicas, borrado de recursos y cualquier comando que modifique repositorios o servicios.

El primer registro del runner y la creación del secreto son pasos locales/de configuración no disponibles mediante las conexiones actuales; no se solicita ni se recibe ningún valor secreto en esta conversación.
