---
plan_id: PLAN-002-m3u-large-playlist-benchmark
generated_at: 2026-11-23T23:00:00-03:00
---

# Contexto: benchmark de import M3U com catalogo de 380k

## Arquivos relevantes

| Path | Função |
|------|--------|
| `apps/electron-backend-e2e/src/performance/synthetic-m3u.ts` | gerador formal 10k/50k/100k sem `tvg-*`; tipo `SyntheticM3uFixture` |
| `apps/electron-backend-e2e/src/performance/synthetic-m3u.spec.ts` | SHA-256 dourados e ausencia de `tvg-` (nao editar) |
| `apps/electron-backend-e2e/src/performance/synthetic-charset.ts` | `SYNTHETIC_TITLE_VOCABULARY.latin1` (nao editar) |
| `apps/electron-backend-e2e/src/performance/synthetic-m3u-server.ts` | serve a fixture em `/synthetic-performance.m3u` (nao editar) |
| `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-contract.ts` | cenarios e agenda de iteracoes |
| `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-contract.spec.ts` | contrato dos cenarios |
| `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts` | executa cenario por cenario (345 linhas; limite 400) |
| `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-support.ts` | le `IPTVNATOR_PERF_*` (nao editar) |
| `apps/electron-backend-e2e/src/m3u-import.performance.ts` | teste Playwright que chama o benchmark (nao editar) |
| `apps/electron-backend-e2e/playwright.performance.config.ts` | timeout de 30 min (nao editar) |
| `apps/electron-backend-e2e/project.json` | alvo `benchmark-m3u-import` (nao editar) |
| `docs/architecture/m3u-playlist-module.md` | secao do benchmark, campos de fase |

## Endpoints / regras-de-negócio referenciados

- `pnpm nx run electron-backend-e2e:benchmark-m3u-import`  -  depende de `electron-backend:build-performance`
- Variaveis existentes: `IPTVNATOR_PERF_OUTPUT_DIR`, `IPTVNATOR_PERF_VARIANT`, `IPTVNATOR_PERF_SMOKE`, `IPTVNATOR_PERF_CDP_PORT`
- Variavel nova: `IPTVNATOR_PERF_M3U_CATALOG`

## Decisões tomadas durante o planejamento

- Medir antes de corrigir (motivo: discovery D-01, `AGENTS.md`)
- Cenario opt-in, formais intactos (motivo: discovery D-02)
- Fixture em arquivo novo (motivo: discovery D-03)
- Tamanho e mix proporcionais ao caso real, URLs so de loopback (motivo: discovery D-04)
- Commits em ingles com `test(performance): ...`, o tipo e escopo que o upstream usou nesses arquivos (`git log`: "test(performance): add formal M3U import benchmark (#1287)")

## Riscos abertos

- Base do harness com 5 falhas no Windows (ver discovery, Baseline).
- Limite de 30 min do Playwright.

## Notas curtas (livre)

- Rodar uma guarda: `node .a8z-local/run-guard.cjs <spec>` (usa `tsx --test` para `electron-backend-e2e`).
- Este plano nao depende do PLAN-001: o servidor sintetico responde na hora, sem os 52 s do provedor.
