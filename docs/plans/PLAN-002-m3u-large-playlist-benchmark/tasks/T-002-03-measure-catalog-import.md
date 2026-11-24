---
id: T-002-03
plan_id: PLAN-002-m3u-large-playlist-benchmark
seq: 03
title: Rodar a smoke do catalogo e registrar a primeira fase que falha
area: tests
labels: [agent:tests, type:chore]
priority: P0
estimate: "4h"
status: concluido
valida_em: C-06
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O objetivo do [plano](../plan.md) e um numero que decida a correcao (discovery D-01). Esta task roda o cenario criado em T-002-02 e escreve o resultado.

## Objetivo (O QUE)

`measurements.md` na pasta do plano, com os cinco titulos de `specs.md`, os campos de fase da rodada (ou o erro), a primeira fase que falha ou domina e uma proposta.

### Entrega

- `docs/plans/PLAN-002-m3u-large-playlist-benchmark/measurements.md`.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| criar | `docs/plans/PLAN-002-m3u-large-playlist-benchmark/measurements.md` | estrutura de `specs.md` |

## Plano de execução (COMO)

- [ ] Fechar outros apps Electron e liberar a porta 9222 (smoke pode usar `IPTVNATOR_PERF_CDP_PORT` se ela estiver ocupada)
- [ ] Controle: `IPTVNATOR_PERF_OUTPUT_DIR="$PWD/dist/performance/<timestamp>-m3u-import-control" IPTVNATOR_PERF_VARIANT=control IPTVNATOR_PERF_SMOKE=1 pnpm nx run electron-backend-e2e:benchmark-m3u-import`
- [ ] Catalogo: `IPTVNATOR_PERF_OUTPUT_DIR="$PWD/dist/performance/<timestamp>-m3u-import-catalog" IPTVNATOR_PERF_VARIANT=catalog IPTVNATOR_PERF_SMOKE=1 IPTVNATOR_PERF_M3U_CATALOG=1 pnpm nx run electron-backend-e2e:benchmark-m3u-import`
- [ ] Copiar para `measurements.md` so numeros, nomes de fase e a mensagem de erro (sem caminho absoluto da maquina); os brutos ficam em `dist/performance/` (gitignored)
- [ ] Escrever `## Primeira fase que falha` e `## Proposta` citando A-02 ou A-03 do discovery
- [ ] Commit `docs(performance): record the 380k M3U catalog import measurement` so com `measurements.md` (arquivo do fork, fora do PR upstream)

## Critérios de aceitação (DoD)

- [ ] Repetir o roteiro de C-06 em `checklist.md` → exit 0 e contagem 5
- [ ] Abrir `measurements.md` e procurar `dataAcquireMs` → aparece com numero ou a secao `## Catalogo 380k` traz a mensagem de erro da rodada

## Riscos & Rollback

- Cada rodada pode levar de 10 a 40 min; o limite do Playwright e 30 min.
- Rollback: `git revert <sha do commit da task>`
