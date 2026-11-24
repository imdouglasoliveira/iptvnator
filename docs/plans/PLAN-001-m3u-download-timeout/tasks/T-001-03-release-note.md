---
id: T-001-03
plan_id: PLAN-001-m3u-download-timeout
seq: 03
title: Adicionar a nota de release do timeout de playlist
area: infra
labels: [agent:general, type:chore]
priority: P1
estimate: "2h"
status: concluido
valida_em: C-04
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

`AGENTS.md` exige uma nota em `.changes/` para toda mudanca visivel; playlist que antes falhava passa a importar (ver [plano](../plan.md), Artefatos mapeados).

## Objetivo (O QUE)

`.changes/playlist-slow-m3u-download.md` existe no formato de `.changes/README.md` e o validador aceita 144 notas.

### Entrega

- Nota `type: fix`, `area: playlist`, corpo de uma frase escrita para usuario.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| criar | `.changes/playlist-slow-m3u-download.md` | copiar de `specs.md` |

## Plano de execução (COMO)

- [x] Criar a nota com o trecho de `specs.md`
- [x] Rodar `plan-gate.js PLAN-001` e conferir `VEREDITO: VERDE`
- [ ] Commit `docs(playlist): add release note for slow M3U downloads` so com a nota (orquestrador; sandbox impede escrita no indice)

## Critérios de aceitação (DoD)

- [x] Repetir o roteiro de C-04 em `checklist.md` → exit 0 e "144 release note(s) valid."
- [x] `[não-ui]` Apagar a linha `area: playlist` e rodar `pnpm run release:notes:validate` → exit 1 citando o campo obrigatorio; restaurar → exit 0

## Riscos & Rollback

- Texto apenas.
- Rollback: `git revert <sha do commit da task>`
