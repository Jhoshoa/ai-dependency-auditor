# AI Dependency Auditor

Auditor de vulnerabilidades en dependencias con inteligencia artificial.
Reduce falsos positivos usando LLMs para analizar si una vulnerabilidad
realmente afecta tu código.

## Características

- **Escaneo multi-fuente:** npm audit + OSV.dev API
- **Clasificación inteligente:** Usa LLM para filtrar falsos positivos
- **6 providers compatibles:** OpenAI, Anthropic, Gemini, Ollama, Azure, Groq
- **Análisis de código fuente:** Detecta si las funciones vulnerables se usan realmente
- **Compresión contextual:** Reduce tokens y costos de LLM
- **Múltiples formatos:** JSON (CI/CD), tabla coloreada (terminal), resumen
- **Cache local:** TTL configurable, modo offline
- **Edge cases:** 12 casos borde manejados (sin lockfile, timeouts, rate limiting, etc.)

## Instalación

```bash
# Instalar globalmente (recomendado)
npm install -g ai-dependency-auditor

# Verificar instalación
dep-audit --version

# Desinstalar
npm uninstall -g ai-dependency-auditor
```

## Comandos

Solo hay un comando principal:

| Comando | Descripción |
|---------|-------------|
| `dep-audit check [path]` | Escanea un proyecto en busca de vulnerabilidades |

Todos los flags de `check`:

| Flag | Descripción | Default |
|------|-------------|---------|
| `-m, --mode <mode>` | Modo: `quick` (sin LLM) o `full` (con IA) | `quick` |
| `-f, --format <format>` | Formato: `json`, `table`, `summary` | `table` |
| `--llm-provider <provider>` | Provider: openai, anthropic, gemini, ollama, azure, groq | `openai` |
| `--llm-model <model>` | Modelo específico (ej: gpt-4o-mini, claude-3-haiku) | — |
| `--api-key <key>` | API key del provider | — |
| `--llm-base-url <url>` | Base URL personalizada | — |
| `--temperature <value>` | Temperatura del LLM (0.0 = deterministico) | `0.0` |
| `--json` | Atajo para `--format=json` | — |
| `-h, --help` | Muestra ayuda completa | — |

Ver todos los flags:

```bash
dep-audit check --help
```

## Uso

```bash
# Escaneo rápido (sin LLM) — solo npm audit
dep-audit check .

# Escaneo completo con IA
dep-audit check . --mode full --api-key sk-...

# Formato JSON (para CI/CD)
dep-audit check . --mode quick --format json

# Usar Anthropic en vez de OpenAI
dep-audit check . --mode full --llm-provider anthropic --api-key sk-ant-...

# Ollama local (no requiere API key)
dep-audit check . --mode full --llm-provider ollama --llm-model llama3.2

# Azure
dep-audit check . --mode full --llm-provider azure --llm-base-url "https://tu-recurso.openai.azure.com" --api-key ...

# Escanear otro proyecto
dep-audit check ../mi-otro-proyecto
```

## Configuración

### 1. Auto-creación de config

La primera vez que ejecutes `dep-audit check`, se crea automáticamente
`~/.dep-audit/config.json` con valores por defecto:

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.0,
    "maxTokens": 16384
  },
  "audit": {
    "mode": "quick",
    "format": "table",
    "cacheTtlHours": 24,
    "strictMode": false
  }
}
```

Editalo para cambiar defaults sin usar flags cada vez.

### 2. Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `DEP_AUDIT_OPENAI_API_KEY` | API key de OpenAI |
| `DEP_AUDIT_ANTHROPIC_API_KEY` | API key de Anthropic |
| `DEP_AUDIT_GOOGLE_API_KEY` | API key de Google Gemini |
| `DEP_AUDIT_AZURE_API_KEY` | API key de Azure |
| `DEP_AUDIT_GROQ_API_KEY` | API key de Groq |
| `OPENAI_API_KEY` | Fallback para OpenAI |
| `ANTHROPIC_API_KEY` | Fallback para Anthropic |
| `GOOGLE_API_KEY` | Fallback para Gemini |

### 3. Flags CLI (mayor precedencia)

Los flags CLI siempre ganan sobre config file y env vars.

## Prioridad de configuración

```
Flags CLI  >  Env vars  >  ~/.dep-audit/config.json  >  Defaults
```

## Arquitectura

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│    CLI      │────▶│   Scanner    │────▶│  npm audit  │
│ (commander) │     │              │     │  OSV.dev    │
└──────┬──────┘     └──────┬───────┘     └─────────────┘
       │                   │
       │            ┌──────▼───────┐     ┌─────────────┐
       │            │   Agente     │────▶│  LLM Client │
       │            │ (orquestador)│     │  6 providers│
       │            └──────┬───────┘     └─────────────┘
       │                   │
       │            ┌──────▼───────┐     ┌─────────────┐
       │            │   Analysis   │     │  Compressor │
       │            │              │     │  Source     │
       │            └──────┬───────┘     └─────────────┘
       │                   │
┌──────▼───────────────────▼──────┐
│         Output Formatter        │
│   JSON  │  Table  │  Summary    │
└─────────────────────────────────┘
```

## Desarrollo

```bash
# Clonar y compilar
git clone <repo-url>
cd ai-dependency-auditor
npm install
npm run build

# Tests
npm test

# Type check
npm run lint

# Modo watch
npm run test:watch

# Coverage
npm run test:coverage
```

## Evidencia de mejora V1 → V2

Ver `evidence/comparison.md` para el análisis detallado:

| Aspecto | V1 (Quick) | V2 (Agentic) |
|---------|------------|---------------|
| CVEs reportados | 15 sin filtrar | 3 reales, 8 FP, 4 unknown |
| Severidad | Reportada (sin contexto) | Reclasificada por uso real |
| Edge cases | 0 | 12 cubiertos |
| Providers | 0 (hardcoded) | 6 configurables |
| Tiempo de revisión | ~2 horas | ~15 minutos |

## Licencia

MIT
