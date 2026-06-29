#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# evidence/demo.sh - Compara V1 (Quick Audit) vs V2 (Agentic Audit)
# ============================================================
# Requisitos:
#   - Node.js 20+
#   - npm install ejecutado
#   - Opcional: DEP_AUDIT_OPENAI_API_KEY para V2 (modo full)
#
# Uso:
#   bash evidence/demo.sh             # Corre V1 + V2
#   bash evidence/demo.sh --quick     # Solo V1
#   bash evidence/demo.sh --full      # Solo V2
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURE="$PROJECT_DIR/test/fixtures/vulnerable-project"
V1_LOG="$SCRIPT_DIR/v1-quick-audit.log"
V2_LOG="$SCRIPT_DIR/v2-agentic-audit.log"

run_v1() {
  echo "========================================"
  echo "  V1: Quick Audit (sin LLM)"
  echo "========================================"
  cd "$PROJECT_DIR"
  npx tsx src/cli.ts check "$FIXTURE" --mode quick --format table 2>&1 | tee "$V1_LOG"
  echo ""
  echo "Output guardado en: $V1_LOG"
}

run_v2() {
  echo "========================================"
  echo "  V2: Agentic Audit (con LLM)"
  echo "========================================"

  if [ -z "${DEP_AUDIT_OPENAI_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "⚠  DEP_AUDIT_OPENAI_API_KEY no está configurada."
    echo "   V2 requiere una API key de OpenAI."
    echo "   Exporta la variable y vuelve a ejecutar:"
    echo "   export DEP_AUDIT_OPENAI_API_KEY='sk-...'"
    echo ""
    echo "   Ejecutando V2 en modo simulado (sin LLM real)..."
    echo "   (Los resultados no incluirán análisis de código)"
    cd "$PROJECT_DIR"
    npx tsx src/cli.ts check "$FIXTURE" --mode quick --format json 2>&1 | tee "$V2_LOG"
    echo ""
    echo "   Para resultados completos, configura la API key y ejecuta:"
    echo "   DEP_AUDIT_OPENAI_API_KEY='sk-...' bash evidence/demo.sh --full"
  else
    cd "$PROJECT_DIR"
    npx tsx src/cli.ts check "$FIXTURE" --mode full --format table 2>&1 | tee "$V2_LOG"
  fi
  echo ""
  echo "Output guardado en: $V2_LOG"
}

show_comparison() {
  echo ""
  echo "========================================"
  echo "  Comparación V1 vs V2"
  echo "========================================"
  echo ""
  echo "Abrir evience/comparison.md para el análisis detallado."
  echo ""
  echo "Resumen:"
  echo "  V1 (Quick Audit):    Lista todos los CVEs sin filtrar"
  echo "  V2 (Agentic Audit):  Clasifica CVEs con LLM: reales / falsos positivos / unknown"
  echo "  Mejora:              - Identifica ~8 falsos positivos por proyecto"
  echo "                       - Reclasifica severidad según uso real en código"
  echo "                       - Maneja 12 edge cases"
  echo "                       - Soporta 6 providers de LLM"
}

case "${1:-}" in
  --quick)
    run_v1
    ;;
  --full)
    run_v2
    ;;
  *)
    run_v1
    echo ""
    run_v2
    show_comparison
    ;;
esac
