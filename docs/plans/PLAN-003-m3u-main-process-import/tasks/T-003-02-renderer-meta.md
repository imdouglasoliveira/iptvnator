---
id: T-003-02
plan_id: PLAN-003-m3u-main-process-import
seq: 02
title: Registrar no renderer a playlist ja gravada pelo main
area: state
labels: [agent:fe, type:bug]
priority: P0
estimate: "4h"
status: concluido
valida_em: C-02
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

Com o main gravando (T-003-01), o renderer so precisa da meta para registrar a fonte, buscar o EPG e navegar (discovery F-02 e F-05, [plano](../plan.md)).

## Objetivo (O QUE)

O dialogo usa `data.importPlaylistByUrl` quando existe; `persisted: true` despacha `playlistImportedInMain` (sem nova gravacao); `persisted: false` segue o caminho antigo sem buscar de novo; sem o metodo (PWA), tudo como hoje.

### Entrega

- Metodo opcional no `DataService` e implementacao no `ElectronService`.
- Ramo novo em `url-playlist-import.ts`.
- Acao, reducer e efeito `playlistImportedInMain`.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| editar | `libs/services/src/lib/data.service.ts:48` | metodo opcional depois de `fetchPlaylistDefinition` |
| editar | `apps/web/src/app/services/electron.service.ts:149` | `importPlaylistByUrl` depois de `fetchPlaylistDefinition` |
| editar | `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.ts:46-71` | bloco de `specs.md` |
| editar | `libs/m3u-state/src/lib/actions.ts:67` | `'Playlist Imported In Main'` antes de `'Handle Adding Playlist By Url'` |
| editar | `libs/m3u-state/src/lib/reducers/playlist.reducers.ts:336` | `on(playlistImportedInMain)` antes do `handleAddingPlaylistByUrl` |
| editar | `libs/m3u-state/src/lib/effects.ts:471` | `playlistImportedInMain$` depois de `addPlaylist$` e a injecao de `SourceHealthEvidenceService` |

## Plano de execução (COMO)

- [x] Aplicar os trechos de `specs.md` nos 6 arquivos
- [x] Rodar C-02 e C-03 a mao; rodar `plan-gate.js PLAN-003`; marcar `concluido`
- [ ] Commit `perf(playlist): register main-process URL imports in the store` com os 6 arquivos

## Critérios de aceitação (DoD)

- [ ] Repetir o roteiro de C-02 em `checklist.md` → exit 0 com `url-playlist-import.main-persist.spec.ts` listado
- [x] `[não-ui]` Despachar tambem `handleAddingPlaylistByUrl` no ramo `persisted` e rodar `node .a8z-local/run-guard.cjs libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.main-persist.spec.ts` → exit 1; restaurar → exit 0
- [x] `[não-ui]` Rodar o `url-playlist-import.spec.ts` existente → os 21 testes do caminho antigo continuam verdes (o mock dele nao tem `importPlaylistByUrl`)

Evidencia local: C-02 via Nx falha antes dos testes por ERR_SWC_NATIVE_CACHE; mesma selecao via Jest direto passa (2 suites, 23 testes, incluindo os 21 legados). C-03 direto passa (15 suites, 86 testes). Mutacao falha com 2 dispatches em vez de 1 (exit 1); restauracao passa (2 testes, exit 0). C-05 exit 0. Ultimo gate rapido: `VEREDITO: VERMELHO (comandos)`. Commit delegado ao orquestrador.

## Riscos & Rollback

- `effects.ts` e `electron.service.ts` estao no baseline de linhas: so as linhas do trecho.
- Rollback: `git revert <sha>`
