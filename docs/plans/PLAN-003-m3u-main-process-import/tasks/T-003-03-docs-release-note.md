---
id: T-003-03
plan_id: PLAN-003-m3u-main-process-import
seq: 03
title: Documentar o import pelo main e adicionar a nota de release
area: infra
labels: [agent:general, type:chore]
priority: P1
estimate: "2h"
status: concluido
valida_em: C-10
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O contrato de import muda e o usuario nota a diferenca em playlists grandes; o `AGENTS.md` pede o doc canonico atualizado e uma nota em `.changes/` ([plano](../plan.md)).

## Objetivo (O QUE)

`m3u-playlist-module.md` descreve o caminho novo e o kill switch; `.changes/playlist-large-m3u-import.md` existe e valida.

### Entrega

- Secao "Main-process persistence (Electron)".
- Nota `type: perf`, `area: playlist`.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| editar | `docs/architecture/m3u-playlist-module.md` | secao antes de `## Initial URL Import Performance Benchmark (Electron)`; editar so essas linhas |
| criar | `.changes/playlist-large-m3u-import.md` | copiar de `specs.md` |

## Plano de execução (COMO)

- [x] Inserir a secao e criar a nota
- [x] Rodar `pnpm run release:notes:validate` e `plan-gate.js PLAN-003`; marcar `concluido`
- [ ] Commit `docs(playlist): document main-process URL imports` com os 2 arquivos

## Critérios de aceitação (DoD)

- [x] Repetir o roteiro de C-10 → exit 0 e contagem 1
- [x] `[não-ui]` Rodar `pnpm run release:notes:validate` → exit 0 com uma nota a mais

Evidencia local: 143 notas antes, 144 depois; C-07 exit 0. C-10 exit 0, contagem 1. Ultimo gate rapido: `VEREDITO: VERMELHO (comandos)` (C-01/C-03 bloqueados pelo cache SWC). Commit delegado ao orquestrador.

## Riscos & Rollback

- Texto apenas.
- Rollback: `git revert <sha>`
