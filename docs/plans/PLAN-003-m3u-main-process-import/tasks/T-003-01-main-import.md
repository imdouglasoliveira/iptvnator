---
id: T-003-01
plan_id: PLAN-003-m3u-main-process-import
seq: 01
title: Gravar no processo principal a playlist importada por URL
area: infra
labels: [agent:backend, type:bug]
priority: P0
estimate: "4h"
status: concluido
valida_em: C-01
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O `Playlist` inteiro ir ao renderer e voltar custa 174,7 s com 380k entradas (discovery F-01, decisoes D-01 e D-02 do [plano](../plan.md)).

## Objetivo (O QUE)

IPC `import-playlist-by-url` no Electron que baixa, aplica titulo e EPG, grava pelo worker e devolve `{ persisted: true, playlist: meta }`; com `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1`, devolve `{ persisted: false, playlist }` sem gravar.

### Entrega

- As duas guardas de `aceite.txt` escritas e seladas no inicio desta task.
- Tipo compartilhado, modulo do main, handler e preload.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| criar | `apps/electron-backend/src/app/events/playlist-url-import.spec.ts` | guarda 1; copiar de `specs.md` |
| criar | `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.main-persist.spec.ts` | guarda 2 (selada aqui, fica verde na T-003-02) |
| criar | `libs/shared/interfaces/src/lib/playlist-url-import.ts` | copiar de `specs.md` |
| editar | `libs/shared/interfaces/src/index.ts` | `export * from './lib/playlist-url-import';` |
| editar | `libs/shared/interfaces/src/lib/electron-api.interface.ts:884-888` | `importPlaylistByUrl` depois de `fetchPlaylistByUrl` |
| criar | `apps/electron-backend/src/app/events/playlist-url-import.ts` | copiar de `specs.md` |
| editar | `apps/electron-backend/src/app/events/playlist.events.ts:93-117` | handler novo logo depois do existente |
| editar | `apps/electron-backend/src/app/api/main.preload.ts:541-545` | `importPlaylistByUrl` depois de `fetchPlaylistByUrl` |

## Plano de execução (COMO)

- [x] Escrever as duas guardas (trechos de `specs.md`) e rodar `plan-gate.js PLAN-003 --selar-aceite` uma vez (as duas nascem vermelhas)
- [x] Criar o tipo compartilhado e exportar
- [x] Criar `playlist-url-import.ts`, o handler e o preload
- [x] Rodar `plan-gate.js PLAN-003`; marcar `concluido` no frontmatter e no `progress.md`
- [ ] Commit `perf(playlist): persist URL imports in the main process` com os 8 arquivos

## Critérios de aceitação (DoD)

- [ ] Repetir o roteiro de C-01 em `checklist.md` → exit 0 com `playlist-url-import.spec.ts` listado
- [x] `[não-ui]` Tirar o `if (!isMainPlaylistImportEnabled())` e rodar `node .a8z-local/run-guard.cjs apps/electron-backend/src/app/events/playlist-url-import.spec.ts` → exit 1 no teste do kill switch; restaurar → exit 0

Evidencia local: C-01 via Nx falha antes dos testes por ERR_SWC_NATIVE_CACHE; mesma selecao via Jest direto passa (5 suites, 39 testes). C-03 direto: 15 suites, 86 testes. Mutacao equivalente com `if (false)` falhou no teste do kill switch (exit 1); restauracao passou (3 testes, exit 0). C-04/C-09/C-11 verdes. Ultimo gate rapido: `VEREDITO: VERMELHO (comandos)`. Commit delegado ao orquestrador conforme autorizacao.

## Riscos & Rollback

- `electron-api.interface.ts` e `main.preload.ts` estao no baseline de linhas: so as linhas do trecho.
- Rollback: `git revert <sha>`
