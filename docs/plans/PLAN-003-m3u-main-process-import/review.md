---
plan_id: PLAN-003-m3u-main-process-import
selado_em: 2026-11-24T03:51:32.673Z
revisor: orquestrador
outra_sessao: false
motivo: null
docs_sha256: 3e08f00062bf2daf6ebde4772b3ca51062d6e2e2f4f08d01575919afc3c4ba9e
---

# Revisao - PLAN-003-m3u-main-process-import

Modo `--revisao` (validate-plan), antes da execucao. Revisor: orquestrador (mesma sessao que planejou; sem `--agents`). Base conferida: worktree do PLAN-002 em `0d9986607`.

## Conferencia dos trechos literais contra a base

| trecho | existe? | assinatura bate? |
|---|---|---|
| `fetchPlaylistFromUrl(url, title?, options)` em `playlist-source.ts:86` | sim | sim; `title` define `title` e `filename` via `createPlaylistObject` (`playlist.utils.ts:370-371`) |
| `applyPlaylistEpgImportPreference(playlist, autoImportEpg = true)` | sim | sim |
| `getDatabase` reexportado por `apps/electron-backend/src/app/database/connection.ts` | sim | sim, usado assim em `worker-events.utils.ts` |
| `databaseWorkerClient.request<T>(operation, payload)` | sim | sim |
| `DB_UPSERT_APP_PLAYLIST` no worker → `upsertAppPlaylist` devolve `{ success }` | sim | sim |
| handler `fetch-playlist-by-url` em `playlist.events.ts:93-117`, com `createM3uImportPerformanceCapture`, `isPerformanceCaptureEnabled`, `redactSensitiveData` ja importados | sim | sim |
| `fetchPlaylistByUrl` no preload (`main.preload.ts:541`) e no `ElectronBridge` (`electron-api.interface.ts:884`) | sim | sim |
| `ElectronBridgePlaylistFetchOptions` (`electron-api.interface.ts:399`) | sim | sim: `trustedInsecureTlsHosts`, `userAgent` |
| `Playlist.playlist?: any` (itens parseados) | sim | sim, removido em `toImportedPlaylistMeta` |
| `DataService.fetchPlaylistDefinition` (`data.service.ts:48`) e `ElectronService` (`electron.service.ts:149`, `settingsStore.getTrustOptions()`) | sim | sim |
| `url-playlist-import.ts` `submit` (`fetchPlaylistDefinition` → `applyPlaylistEpgImportPreference` → `handleAddingPlaylistByUrl`) | sim | sim |
| `PlaylistActions` em `actions.ts`, `'Handle Adding Playlist By Url'` na linha 67 | sim | sim |
| reducer `on(PlaylistActions.handleAddingPlaylistByUrl` (linha 336) e `toEntityMeta` | sim | sim |
| `effects.ts`: `inject(...)` como campos (linhas 73-77), `navigateToPlaylist(playlist: Playlist)`, `fetchPlaylistScopedEpg(Pick<...>)` | sim | sim; `playlist as Playlist` so no `navigateToPlaylist` |
| `SourceHealthEvidenceService` exportado por `@iptvnator/services` (`index.ts:35`), `connections: Subject<{ id?, playlist?: Partial<PlaylistMeta> }>` | sim | sim |
| benchmark: `environmentInheritance: 'runtime-only'` (linha 188); `buildElectronLaunchEnvironment` so herda variaveis de runtime | sim | sim, por isso o kill switch vai no `env` |
| status do main capture: `db-request`/`db-response` vem dos handlers IPC `DB_*` (`m3u-refresh-main-capture.ts:1662-1678`) | sim | sim; upsert direto no worker nao aparece |

## Achados e correcoes

| origem | arquivo | achado | acao | motivo |
|---|---|---|---|---|
| orquestrador | specs.md | a condicao de assentamento do caminho novo estava condicional ("se o upsert nao aparecer") | aplicado: condicao definitiva, com os dois caminhos | o status conta so eventos dos handlers IPC, conferido no codigo |
| orquestrador | specs.md | `launchElectronApp` com `runtime-only` nao repassaria o kill switch ao Electron | aplicado: trecho do `env` e comandos de medicao | sem isso o "antes" mediria o caminho novo |
| orquestrador | tasks/T-003-04 | ponteiro com intervalo de linhas reprovado pelo `check-plan` | aplicado: `m3u-import.benchmark.ts:188` | gate |
| orquestrador | EXECUTOR.md | `NX_PREFER_TS_NODE` quebrou os testes do ferramental de cobertura no PLAN-001 | registrado: usar so `NX_DAEMON=false` | evita falso vermelho |
| orquestrador | EXECUTOR.md | sandbox do Codex nega escrita em `.git` no Windows (PLAN-001/002) | registrado: executor lista arquivos e o orquestrador commita | fluxo ja usado |

## Parecer

Plano executavel. Quatro tasks, duas guardas que nascem vermelhas na base, kill switch coberto por teste, PWA e `fetch-playlist-by-url` preservados. Ganho esperado: os ~175 s do F-01; os ~92 s da rota (F-03) ficam para o plano seguinte, declarado em `## Nao e defeito`.
