---
plan_id: PLAN-003-m3u-main-process-import
generated_at: 2026-11-24T00:30:00-03:00
---

# Contexto: import de M3U por URL persistido no main

## Arquivos relevantes

| Path | Função |
|------|--------|
| `apps/electron-backend/src/app/events/playlist-source.ts` | `fetchPlaylistFromUrl` (nao editar) |
| `apps/electron-backend/src/app/events/playlist.events.ts:93-117` | handler `fetch-playlist-by-url`; o novo vem logo depois |
| `apps/electron-backend/src/app/events/database/worker-events.utils.ts` | modelo: `getDatabase()` antes de `databaseWorkerClient.request` (nao editar) |
| `apps/electron-backend/src/app/services/database-worker-client.ts:82` | `request<T>(operation, payload)` (nao editar) |
| `apps/electron-backend/src/app/database/operations/playlist.operations.ts:152` | `upsertAppPlaylist` devolve `{ success }` (nao editar) |
| `apps/electron-backend/src/app/api/main.preload.ts:541` | `fetchPlaylistByUrl`; o novo vem logo depois |
| `libs/shared/interfaces/src/lib/electron-api.interface.ts:399,884` | `ElectronBridgePlaylistFetchOptions`, `fetchPlaylistByUrl` |
| `libs/shared/interfaces/src/lib/playlist-meta.type.ts` | `PlaylistMeta` |
| `libs/shared/m3u-utils/src/lib/playlist-epg-import-preference.ts` | `applyPlaylistEpgImportPreference` (nao editar) |
| `libs/services/src/lib/data.service.ts:48` | `fetchPlaylistDefinition` |
| `libs/services/src/lib/source-sync/source-materializer.ts:62` | usa `fetchPlaylistDefinition` (nao editar) |
| `apps/web/src/app/services/electron.service.ts:149` | `fetchPlaylistDefinition` |
| `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.ts` | `submit` do dialogo |
| `libs/m3u-state/src/lib/actions.ts`, `reducers/playlist.reducers.ts`, `effects.ts:421,582,615` | acao, reducer, `addPlaylist$`, `navigateToPlaylist`, `fetchPlaylistScopedEpg` |
| `libs/services` `SourceHealthEvidenceService` | `connections.next({ id, playlist })` |
| `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts:188,264` | `runtime-only` env e `waitForDatabaseSettlement` |
| `apps/electron-backend-e2e/src/performance/m3u-refresh-main-capture.ts` | `readMainCaptureStatus` (ler; editar so se necessario e listar o desvio) |

## Endpoints / regras-de-negócio referenciados

- IPC novo `import-playlist-by-url`; IPC existente `fetch-playlist-by-url`; worker `DB_UPSERT_APP_PLAYLIST`.

## Decisões tomadas durante o planejamento

- IPC novo em vez de mudar o existente (D-01).
- Kill switch por variavel de ambiente no main (D-02).
- So Electron (D-03); renderizacao da lista fica fora (D-04).
- Base na branch do PLAN-002 por causa da medicao (D-05).
- Commits `perf(playlist): ...` para codigo e `test(performance): ...` para o benchmark, em ingles.

## Riscos abertos

- Condicao de assentamento do benchmark com upsert no main (T-003-04).
- Os arquivos `effects.ts`, `main.preload.ts`, `electron-api.interface.ts` e `electron.service.ts` estao no `max-lines-baseline`: acrescimo minimo.

## Notas curtas (livre)

- Rodar uma guarda: `node .a8z-local/run-guard.cjs <spec>`.
- Testes de renderer: `pnpm nx test playlist-import-feature --runInBand --testPathPatterns=url-playlist-import` (conferir o nome do projeto com `pnpm nx show projects | grep import`).
