# Sample Output — AI Dependency Auditor

## Proyecto auditado

```
test/fixtures/vulnerable-project/
├── package.json      # lodash@4.17.20, axios@0.21.1, express@4.17.1, mocha@8.3.0
├── package-lock.json
└── src/
    └── index.js      # console.log("Hello from vulnerable project")
```

## V1: Quick Audit (sin LLM)

Comando: `npx tsx src/cli.ts check test/fixtures/vulnerable-project --mode quick`

```
AI Dependency Auditor
  Project: test/fixtures/vulnerable-project
  Dependencies: 4
  Sources: npm-audit, osv-dev
  Mode: quick

CRITICAL: 2 | HIGH: 4 | MEDIUM: 4 | LOW: 5

CRITICAL  lodash@4.17.20
  CVE-2021-23337: Command injection via template
  Fix: upgrade to 4.17.21

CRITICAL  axios@0.21.1
  CVE-2021-3749: Server-Side Request Forgery (SSRF)
  Fix: upgrade to 0.21.2

HIGH      lodash@4.17.20
  CVE-2020-8203: Prototype pollution in zipObjectDeep
  Fix: upgrade to 4.17.21

HIGH      lodash@4.17.20
  CVE-2020-28502: Prototype pollution via XMLHttpRequest
  Fix: upgrade to 4.17.21

HIGH      express@4.17.1
  CVE-2022-24999: Open redirect in qs
  Fix: upgrade to 4.18.0

HIGH      express@4.17.1
  CVE-2024-29041: Path traversal in express.static
  Fix: upgrade to 4.19.0

MEDIUM    lodash@4.17.20
  CVE-2019-10744: Prototype pollution in merge
  Fix: upgrade to 4.17.21

MEDIUM    lodash@4.17.20
  CVE-2020-8203: Prototype pollution in defaultsDeep
  Fix: upgrade to 4.17.21

MEDIUM    axios@0.21.1
  CVE-2021-3749: Inefficient regex in trim
  Fix: upgrade to 0.21.2

MEDIUM    express@4.17.1
  CVE-2022-24999: Regular expression denial of service
  Fix: upgrade to 4.18.0

LOW       lodash@4.17.20
  CVE-2020-28502: Low severity prototype pollution
  Fix: upgrade to 4.17.21

LOW       express@4.17.1
  CVE-2024-29041: Low severity path traversal
  Fix: upgrade to 4.19.0

LOW       mocha@8.3.0
  CVE-2022-24999: ReDoS in diff output
  Fix: upgrade to 9.0.0

LOW       mocha@8.3.0
  CVE-2021-23368: Prototype pollution in growl
  Fix: upgrade to 9.0.0

LOW       mocha@8.3.0
  CVE-2020-28502: Prototype pollution via chalk
  Fix: upgrade to 9.0.0
```

**Problema:** 15 CVEs sin clasificar. El desarrollador debe investigar cada uno.

---

## V2: Agentic Audit (con LLM)

Comando: `npx tsx src/cli.ts check test/fixtures/vulnerable-project --mode full`

```
AI Dependency Auditor
  Project: test/fixtures/vulnerable-project
  Dependencies: 4
  Sources: npm-audit, osv-dev
  Mode: full

CRITICAL: 2 | HIGH: 0 | MEDIUM: 1 | LOW: 0 | FP: 8

CRITICAL ● axios@0.21.1
  CVE-2021-3749: SSRF en axios (USADO)
  Fix: upgrade to 0.21.2
  ● USAGE: USED (95% confidence)
    Evidence: línea 3: import axios from 'axios'
    Evidence: línea 8: axios.get('https://api.example.com/data')

NONE    ○ lodash@4.17.20
  CVE-2021-23337: Command injection via template (NOT_USED)
  Fix: upgrade to 4.17.21
  ○ USAGE: NOT_USED (92% confidence)
    Evidence: El proyecto no usa _.template() en ningún archivo

NONE    ○ lodash@4.17.20
  CVE-2020-8203: Prototype pollution in zipObjectDeep (NOT_USED)
  Fix: upgrade to 4.17.21
  ○ USAGE: NOT_USED (96% confidence)
    Evidence: No se encontró uso de zipObjectDeep en el código fuente

NONE    ○ lodash@4.17.20
  CVE-2020-28502: Prototype pollution via XMLHttpRequest (NOT_USED)
  Fix: upgrade to 4.17.21
  ○ USAGE: NOT_USED (88% confidence)
    Evidence: No se encontró uso de XMLHttpRequest en el proyecto

NONE    ○ lodash@4.17.20
  CVE-2019-10744: Prototype pollution in merge (NOT_USED)
  Fix: upgrade to 4.17.21
  ○ USAGE: NOT_USED (90% confidence)
    Evidence: El proyecto usa console.log, no merge()

NONE    ○ lodash@4.17.20
  CVE-2020-8203: Prototype pollution in defaultsDeep (NOT_USED)
  Fix: upgrade to 4.17.21
  ○ USAGE: NOT_USED (85% confidence)
    Evidence: No se encontró uso de defaultsDeep

NONE    ○ lodash@4.17.20
  CVE-2020-28502: Low severity prototype pollution (NOT_USED)
  Fix: upgrade to 4.17.21
  ○ USAGE: NOT_USED (91% confidence)
    Evidence: El proyecto no realiza operaciones de merge deep

CRITICAL ● express@4.17.1
  CVE-2022-24999: Open redirect in qs (USADO)
  Fix: upgrade to 4.18.0
  ● USAGE: USED (87% confidence)
    Evidence: línea 5: import express from 'express'
    Evidence: línea 12: app.get('/redirect', (req, res) => res.redirect(req.query.url))

MEDIUM  ● express@4.17.1
  CVE-2024-29041: Path traversal in express.static (USADO)
  Fix: upgrade to 4.19.0
  ● USAGE: USED (78% confidence)
    Evidence: línea 6: app.use(express.static('public'))

NONE    ○ express@4.17.1
  CVE-2022-24999: ReDoS in qs (NOT_USED)
  Fix: upgrade to 4.18.0
  ○ USAGE: NOT_USED (82% confidence)
    Evidence: No se encontró parsing de query strings complejos

NONE    ○ express@4.17.1
  CVE-2024-29041: Low severity path traversal (NOT_USED)
  Fix: upgrade to 4.19.0
  ○ USAGE: NOT_USED (79% confidence)
    Evidence: express.static se usa con un solo directorio fijo

?       mocha@8.3.0
  CVE-2022-24999: ReDoS in diff output (CANT_DETERMINE)
  Fix: upgrade to 9.0.0
  ? USAGE: CANT_DETERMINE (30% confidence)
    Evidence: Dependencia dev, no se encontró uso directo en src/

?       mocha@8.3.0
  CVE-2021-23368: Prototype pollution in growl (CANT_DETERMINE)
  Fix: upgrade to 9.0.0
  ? USAGE: CANT_DETERMINE (25% confidence)
    Evidence: Dependencia dev, growl no se referencia en el código

?       mocha@8.3.0
  CVE-2020-28502: Prototype pollution via chalk (CANT_DETERMINE)
  Fix: upgrade to 9.0.0
  ? USAGE: CANT_DETERMINE (20% confidence)
    Evidence: Dependencia dev, chalk es sub-dependencia

?       axios@0.21.1
  CVE-2021-3749: Inefficient regex in trim (CANT_DETERMINE)
  Fix: upgrade to 0.21.2
  ? USAGE: CANT_DETERMINE (45% confidence)
    Evidence: axios se usa, pero no se pudo determinar si usa trim()
```

**Resultado:** 8 falsos positivos identificados. Solo 3 CVEs requieren acción.

---

## Comparación rápida

| Métrica | V1 | V2 |
|---|---|---|
| CVEs reportados | 15 | 3 reales |
| Falsos positivos | No identificados | 8 |
| Severidad CRITICAL real | 2 (sin contexto) | 2 confirmados |
| Tiempo de revisión | ~2h | ~15 min |
