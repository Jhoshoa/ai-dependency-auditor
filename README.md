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
# Clonar el repositorio
git clone <repo-url>
cd ai-dependency-auditor

# Instalar dependencias
npm install

# (Opcional) Compilar para producción
npm run build
```

## Uso rápido

```bash
# Escaneo rápido (sin LLM)
npx tsx src/cli.ts check ./ruta/al/proyecto

# Escaneo completo con IA (requiere API key)
export DEP_AUDIT_OPENAI_API_KEY="sk-..."
npx tsx src/cli.ts check ./ruta/al/proyecto --mode full
```

## Ejemplos

### Escaneo del proyecto de prueba

```bash
# V1: Quick audit — lista todos los CVEs
npx tsx src/cli.ts check test/fixtures/vulnerable-project --mode quick

# V2: Agentic audit — clasifica con IA
DEP_AUDIT_OPENAI_API_KEY="sk-..." npx tsx src/cli.ts check test/fixtures/vulnerable-project --mode full
```

### Formato JSON (para CI/CD)

```bash
npx tsx src/cli.ts check ./ --mode quick --format json
```

### Usar otro provider

```bash
# Anthropic
npx tsx src/cli.ts check ./ --mode full --llm-provider anthropic

# Ollama (local)
npx tsx src/cli.ts check ./ --mode full --llm-provider ollama --llm-model llama3.2

# Azure
npx tsx src/cli.ts check ./ --mode full --llm-provider azure --llm-base-url "https://<tu-recurso>.openai.azure.com"
```

## Configuración

### 1. Variables de entorno

| Variable | Descripción |
|---|---|
| `DEP_AUDIT_OPENAI_API_KEY` | API key de OpenAI |
| `DEP_AUDIT_ANTHROPIC_API_KEY` | API key de Anthropic |
| `DEP_AUDIT_GOOGLE_API_KEY` | API key de Google Gemini |
| `DEP_AUDIT_AZURE_API_KEY` | API key de Azure |
| `DEP_AUDIT_GROQ_API_KEY` | API key de Groq |
| `OPENAI_API_KEY` | Fallback para OpenAI |
| `ANTHROPIC_API_KEY` | Fallback para Anthropic |
| `GOOGLE_API_KEY` | Fallback para Gemini |

### 2. Archivo de configuración (`~/.dep-audit/config.json`)

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.0,
    "maxTokens": 16384
  },
  "audit": {
    "mode": "full",
    "format": "table",
    "cacheTtlHours": 24,
    "strictMode": false
  }
}
```

### 3. Flags CLI (mayor precedencia)

```
    --mode <mode>            Modo: quick | full
    --format <format>        Formato: json | table | summary
    --llm-provider <prov>    Provider LLM
    --llm-model <model>      Modelo específico
    --api-key <key>          API key
    --llm-base-url <url>     Base URL personalizada
    --temperature <value>    Temperatura (0.0-1.0)
    --json                   Atajo para --format=json
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
|---|---|---|
| CVEs reportados | 15 sin filtrar | 3 reales, 8 FP, 4 unknown |
| Severidad | Reportada (sin contexto) | Reclasificada por uso real |
| Edge cases | 0 | 12 cubiertos |
| Providers | 0 (hardcoded) | 6 configurables |
| Tiempo de revisión | ~2 horas | ~15 minutos |

## Licencia

MIT
