---
id: T-001-01
plan_id: PLAN-001-m3u-download-timeout
seq: 01
title: Subir o timeout de download de playlist do Electron para 120 s
area: infra
labels: [agent:backend, type:bug]
priority: P0
estimate: "2h"
status: concluido
valida_em: C-01
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O provedor de teste envia o primeiro byte da M3U depois de ~52 s e o Electron aborta em 30 s (discovery F-01, decisao D-01 do [plano](../plan.md)). O import por URL, o auto-update e o refresh manual usam a mesma constante `PLAYLIST_FETCH_TIMEOUT_MS`.

## Objetivo (O QUE)

`PLAYLIST_FETCH_TIMEOUT_MS` vale `120000`, uma guarda prova o valor e a passagem dele ao request, e o contrato em `m3u-playlist-module.md` diz 120s.

### Entrega

- Guarda `playlist-source.spec.ts` selada antes da implementacao.
- Constante e comentario novos em `playlist-source.ts`.
- Expectativas de `playlist.events.spec.ts` atualizadas.
- Linhas 453-456 de `m3u-playlist-module.md` atualizadas.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| criar | `apps/electron-backend/src/app/events/playlist-source.spec.ts` | guarda; copiar de `specs.md` |
| editar | `apps/electron-backend/src/app/events/playlist-source.ts:25-31` | comentario e `120000`; copiar de `specs.md` |
| editar | `apps/electron-backend/src/app/events/playlist.events.spec.ts:209` | `timeout: 120000,` |
| editar | `apps/electron-backend/src/app/events/playlist.events.spec.ts:481` | `timeout: 120000,` |
| editar | `docs/architecture/m3u-playlist-module.md:453-456` | trecho de `specs.md`; editar so essas linhas |

## Plano de execução (COMO)

- [ ] Criar `playlist-source.spec.ts` com o trecho de `specs.md` e rodar `plan-gate.js PLAN-001 --selar-aceite` (a guarda tem de nascer vermelha)
- [ ] Trocar o comentario e a constante em `playlist-source.ts`
- [ ] Atualizar as linhas 209 e 481 de `playlist.events.spec.ts`
- [ ] Atualizar `m3u-playlist-module.md:453-456` sem reformatar o resto do arquivo
- [ ] Rodar `plan-gate.js PLAN-001` e conferir `VEREDITO: VERDE`
- [ ] Commit `fix(playlist): wait up to 120s for slow M3U downloads` com os 4 arquivos da task

## Critérios de aceitação (DoD)

- [ ] Repetir o roteiro de C-01 em `checklist.md` → exit 0 com `playlist-source.spec.ts` listado
- [ ] `[não-ui]` Rodar `git grep -c -F "export const PLAYLIST_FETCH_TIMEOUT_MS = 120000;" -- apps/electron-backend/src/app/events/playlist-source.ts` → `1` (hoje exit 1)
- [ ] `[não-ui]` Voltar a constante para `30000` e rodar `node .a8z-local/run-guard.cjs apps/electron-backend/src/app/events/playlist-source.spec.ts` → exit 1 citando `120000`; restaurar e rodar de novo → exit 0

## Riscos & Rollback

- Host mudo leva 120 s para falhar no auto-update.
- Rollback: `git revert <sha do commit da task>`
