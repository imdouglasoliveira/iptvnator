---
id: T-002-02
plan_id: PLAN-002-m3u-large-playlist-benchmark
seq: 02
title: Adicionar o cenario opt-in de catalogo ao benchmark de import
area: tests
labels: [agent:tests, type:feature]
priority: P0
estimate: "4h"
status: concluido
valida_em: C-02
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O benchmark so conhece os cenarios formais e espera o banco assentar por 120 s fixos (discovery F-03). O cenario de catalogo precisa ser opt-in para nao mudar a rodada formal (D-02) e precisa de prazo maior ([plano](../plan.md)).

## Objetivo (O QUE)

Com `IPTVNATOR_PERF_M3U_CATALOG=1`, o benchmark roda so `m3u-import-catalog-380k` com prazo de 900 s; sem a variavel, roda os 3 cenarios formais como hoje. O doc do benchmark descreve a variavel.

### Entrega

- Guarda `m3u-import-benchmark-catalog.spec.ts` selada antes da implementacao.
- Contrato com cenario opt-in, `settleTimeoutMs`, `isM3uImportCatalogRun` e `createM3uImportScenarioFixture`.
- Benchmark usando fixture e prazo do contrato.
- Spec do contrato atualizado e paragrafo novo no doc.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| criar | `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-catalog.spec.ts` | guarda; copiar de `specs.md` |
| editar | `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-contract.ts` | trechos de `specs.md` |
| editar | `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts` | imports, `runM3uImportBenchmark`, `runScenario`, `runIteration`, `waitForDatabaseSettlement` |
| editar | `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-contract.spec.ts:13-28` | `settleTimeoutMs: 120_000` nos 3 objetos |
| editar | `docs/architecture/m3u-playlist-module.md` | paragrafo antes de "The benchmark attributes these non-additive intervals:" |

## Plano de execução (COMO)

- [ ] Criar a guarda com o trecho de `specs.md` e rodar `plan-gate.js PLAN-002 --selar-aceite` (nasce vermelha)
- [ ] Aplicar os trechos de `specs.md` no contrato
- [ ] Aplicar as mudancas no benchmark; conferir que `m3u-import.benchmark.ts` continua abaixo de 400 linhas de codigo
- [ ] Atualizar o spec do contrato
- [ ] Inserir o paragrafo no doc, sem reformatar o resto
- [ ] Rodar `plan-gate.js PLAN-002` e conferir `VEREDITO: VERDE`
- [ ] Commit `test(performance): add an opt-in 380k catalog scenario to the M3U import benchmark` com os 5 arquivos da task

## Critérios de aceitação (DoD)

- [ ] Repetir o roteiro de C-02 em `checklist.md` → exit 0
- [ ] `[não-ui]` Fazer `listM3uImportScenarios` devolver sempre `SCENARIOS` e rodar `node .a8z-local/run-guard.cjs apps/electron-backend-e2e/src/performance/m3u-import-benchmark-catalog.spec.ts` → exit 1; restaurar → exit 0
- [ ] `[não-ui]` Rodar `git grep -c -F "setDefaultTimeout(120_000)" -- apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts` → exit 1 (hoje 1 ocorrencia)

## Riscos & Rollback

- Esquecer `settleTimeoutMs` em um dos 3 cenarios formais quebra o spec do contrato.
- Rollback: `git revert <sha do commit da task>`
