---
id: T-003-04
plan_id: PLAN-003-m3u-main-process-import
seq: 04
title: Medir o import de 380k antes e depois com o benchmark de catalogo
area: tests
labels: [agent:tests, type:chore]
priority: P0
estimate: "4h"
status: em_andamento
valida_em: C-13
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O `AGENTS.md` exige a tabela antes/depois para mudanca de performance; a decisao D-05 usa o mesmo build com o kill switch como "antes" ([plano](../plan.md)).

## Objetivo (O QUE)

O benchmark de catalogo assenta nos dois caminhos e repassa o kill switch ao Electron; `measurements.md` traz os marcos antes/depois.

### Entrega

- Ajuste em `m3u-import.benchmark.ts`.
- `docs/plans/PLAN-003-m3u-main-process-import/measurements.md` (local, fora do PR).

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| editar | `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts:188` | env do kill switch e condicao de assentamento; ver `specs.md` T-003-04 |
| criar | `docs/plans/PLAN-003-m3u-main-process-import/measurements.md` | tabela antes/depois |

## Plano de execução (COMO)

- [x] Ler `readMainCaptureStatus` em `m3u-refresh-main-capture.ts` e ajustar `waitForDatabaseSettlement` como descreve `specs.md`
- [x] Repassar `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT` no `env` do `launchElectronApp`
- [ ] Rodar C-13; commit `test(performance): measure main-process URL imports in the catalog benchmark`
- [ ] Rodar as duas smokes (antes e depois) de `specs.md`; escrever `measurements.md` com: download, parse, normalizacao, ate o pedido de gravacao, gravacao, leitura, ate o primeiro canal, total, pico de RSS do main, pico de heap do renderer, maior long task
- [ ] Marcar `concluido`

## Critérios de aceitação (DoD)

- [x] Repetir o roteiro de C-13 → exit 0

Evidencia local: C-13 exit 0 (2 suites, 8 testes). Ultimo gate rapido: `VEREDITO: VERMELHO (comandos)` (C-01/C-03 bloqueados pelo cache SWC). medicao com o orquestrador: nao foram executados Electron/smokes nem criado measurements.md, conforme instrucao explicita. Commit delegado ao orquestrador.
- [ ] Abrir `measurements.md` → tabela com as colunas "antes" e "depois" preenchidas com numeros, ou o erro da rodada que falhou

## Riscos & Rollback

- Cada rodada leva 5 a 15 min; rode fora do sandbox se o Electron nao subir (o orquestrador roda, como no PLAN-002).
- Rollback: `git revert <sha>`
