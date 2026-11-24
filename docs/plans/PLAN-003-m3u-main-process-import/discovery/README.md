---
plan_id: PLAN-003-m3u-main-process-import
discovery_schema: v2
impact_class: cross-cutting
modo: brownfield
generated_at: 2026-11-24T00:30:00-03:00
commit: 525adb045
---

# Discovery: import de M3U por URL persistido no processo principal

Evidencia de base: [PLAN-002 measurements.md](../../PLAN-002-m3u-large-playlist-benchmark/measurements.md) (rodada valida, commit `0d9986607`). Arquivo irmao: [findings.md](./findings.md).

## Demanda

O usuario escolheu a alternativa A-02 do PLAN-002: o processo principal grava a playlist importada por URL direto no worker de banco e o renderer recebe so a meta, com kill switch, como o `AGENTS.md` exige para mudanca de performance visivel.

## Modo detectado

brownfield. Fluxo atual no Electron, conferido no codigo:

1. `url-playlist-import.ts` chama `DataService.fetchPlaylistDefinition` → `window.electron.fetchPlaylistByUrl` → IPC `fetch-playlist-by-url` (`playlist.events.ts:93`) → `fetchPlaylistFromUrl` devolve o `Playlist` inteiro ao renderer.
2. O renderer aplica `applyPlaylistEpgImportPreference` e o titulo, e despacha `PlaylistActions.handleAddingPlaylistByUrl`.
3. `addPlaylist$` (`effects.ts:421`) chama `PlaylistsService.addPlaylist` → `upsertSqlitePlaylist` → IPC `DB_UPSERT_APP_PLAYLIST` com o `Playlist` inteiro → `databaseWorkerClient.request` no main → worker.
4. Depois navega para `/workspace/playlists/<id>`, que le a playlist de volta (`DB_GET_APP_PLAYLIST`) e publica os canais.

## Problema

Com 380.000 entradas (90,5 MB), o import leva 280 s. O main termina download, parse e normalizacao em 1,4 s; o worker grava em 9,7 s. O resto esta no renderer: 88 s ate o store receber o resultado (long task de 87,2 s), mais 86,5 s ate o renderer reenviar o objeto para o upsert, e 92,2 s entre a leitura do banco e o primeiro canal visivel. Os dois primeiros trechos (174,7 s) existem so porque o objeto inteiro vai ao renderer e volta.

## Achados

| id | achado | evidencia | classe | status |
|---|---|---|---|---|
| F-01 | 174,7 s entre o main terminar a normalizacao e o renderer pedir o upsert; inclui uma long task de 87,2 s | `measurements.md` do PLAN-002, timeline bruta (`store.m3u-import-dispatch` em 89,58 s; `DB_UPSERT_APP_PLAYLIST` com `sourceEpochMs` em 176,1 s) | in-scope | resolvido no plano: T-003-01 |
| F-02 | O renderer so precisa da meta para registrar a fonte, navegar e decidir o EPG; os itens so voltam na leitura da rota | `toEntityMeta` no reducer; `navigateToPlaylist` e `fetchPlaylistScopedEpg` usam `_id`, `serverUrl`, `macAddress`, `epgUrls`, `manualEpgUrls` | in-scope | resolvido no plano: T-003-02 |
| F-03 | 92,2 s entre `DB_GET_APP_PLAYLIST` e o primeiro canal visivel, com long task de 74 s | `measurements.md` do PLAN-002 | follow-up | fora deste plano: renderizacao da lista de canais grande, proximo plano |

## Alternativas

| id | alternativa | custo | efeito | risco |
|---|---|---|---|---|
| A-01 | IPC novo `import-playlist-by-url`: o main baixa, aplica titulo e preferencia de EPG, grava pelo `databaseWorkerClient` e devolve `{ persisted: true, playlist: PlaylistMeta }`; kill switch por variavel de ambiente devolve `{ persisted: false, playlist }` e o renderer segue o caminho antigo | 1 modulo novo no main, 1 IPC, tipo compartilhado, preload, `DataService`, acao e efeito no store | elimina os 174,7 s do F-01 | contrato IPC novo; dois caminhos ate o kill switch sair |
| A-02 | Mudar `fetch-playlist-by-url` para gravar e devolver a meta | menos superficie | mesmo efeito | quebra o contrato usado por `source-materializer.ts`, que precisa do snapshot sem gravar |
| A-03 | Transferir a playlist ao renderer como string JSON em vez de objeto clonado | troca a serializacao | reduz parte do clone | o renderer continua recebendo e reenviando 265 MB; nao resolve F-01 |

## Decisoes

| id | decisao | motivo |
|---|---|---|
| D-01 | A-01 | preserva `fetch-playlist-by-url` para `source-materializer.ts` e o PWA; o caminho antigo continua atras do kill switch |
| D-02 | Kill switch `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1`, lido no main | padrao do `performance-journeys.md` (variavel de ambiente como `IPTVNATOR_DISABLE_COMPILE_CACHE`); remocao em ate duas releases, data no PR |
| D-03 | So Electron; o PWA continua no caminho atual | o PWA nao tem `databaseWorkerClient` e o `DataService` base nao implementa o metodo novo |
| D-04 | F-03 fica para o plano seguinte | escopo do usuario: correcao A-02; a renderizacao da lista e outro gargalo |
| D-05 | Medicao antes/depois com o cenario `m3u-import-catalog-380k` do PLAN-002; "antes" = mesmo build com o kill switch ligado | mesma maquina e mesmo harness, so muda o caminho |

## Nao pode quebrar

- Import por URL com User-Agent, titulo e opt-out de EPG (`playlist-auto-refresh.e2e.ts`, `url-playlist-import.spec.ts`).
- Recuperacao de TLS invalido no dialogo (`playlistImportRecovery`).
- `fetch-playlist-by-url` para `source-materializer.ts` e para o auto-update.
- PWA: import por `/parse` sem mudanca.

## Baseline

Medido no PLAN-002 (Windows, smoke, commit `0d9986607`): import de 380k em 280 s ate o terminal no renderer; 174,7 s entre normalizacao e upsert; pico de RSS do main 2,28 GB; pico de heap do renderer 639 MB. Testes de base: `pnpm nx test electron-backend --runInBand --testPathPatterns=events/playlist` (4 suites, 36 testes) e `url-playlist-import.spec.ts` verdes em 525adb045.

## Incertezas

- O harness de medicao conta o upsert pelo marcador do preload; com o upsert no main, a condicao de assentamento do benchmark precisa mudar (T-003-04).
- A volta da playlist na rota (F-03) continua custando ~92 s; o ganho esperado deste plano e ~175 s, nao o import inteiro.
- O clone main → worker de 380k itens continua; estava dentro dos 9,7 s do upsert.
