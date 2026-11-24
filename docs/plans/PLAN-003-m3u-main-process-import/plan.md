---
id: PLAN-003-m3u-main-process-import
plan_schema: v2
tela: Import de playlist M3U por URL no Electron (main, worker de banco, store do renderer)
objetivo: correcao
plan_kind: backend
impact_class: cross-cutting
executor: externo
source: codigo
figma_url: null
demand_id: null
demand_type: fix
status: pendente
abandon_reason: null
parent_plan: null
children_plans: []
stack_ref: docs/stack.md@PENDENTE
arch_change: false
work_branch: test/m3u-catalog-benchmark
created_at: 2026-11-24T00:30:00-03:00
validated_at: null
---

# Persistir no processo principal o import de M3U por URL

## Contexto (POR QUE)

O PLAN-002 mediu o import de uma playlist de 380 mil entradas: 280 s, dos quais 174,7 s existem so porque o `Playlist` inteiro vai do main ao renderer e volta para a gravacao. O usuario escolheu a alternativa A-02: o main grava pelo worker de banco e devolve a meta. Detalhes, alternativas e decisoes: [discovery/README.md](./discovery/README.md). A renderizacao da lista na rota (92,2 s) fica para o plano seguinte (D-04).

Base de execucao: branch `test/m3u-catalog-benchmark` (`0d9986607`), porque a medicao usa o cenario de catalogo do PLAN-002.

## Artefatos mapeados

| Artefato | Papel hoje | Mudança prevista | Task |
|----------|------------|------------------|------|
| `libs/shared/interfaces/src/lib/playlist-url-import.ts` | nao existe | kill switch, `PlaylistUrlImportOptions`, `PlaylistUrlImportResult` | T-003-01 |
| `libs/shared/interfaces/src/index.ts` | barril de exports | exporta o arquivo novo | T-003-01 |
| `libs/shared/interfaces/src/lib/electron-api.interface.ts` | `fetchPlaylistByUrl` | `importPlaylistByUrl` no `ElectronBridge` | T-003-01 |
| `apps/electron-backend/src/app/events/playlist-url-import.ts` | nao existe | baixa, aplica titulo e EPG, grava pelo worker, devolve meta; kill switch | T-003-01 |
| `apps/electron-backend/src/app/events/playlist-url-import.spec.ts` | nao existe | guarda do modulo | T-003-01 |
| `apps/electron-backend/src/app/events/playlist.events.ts` | handler `fetch-playlist-by-url` | handler `import-playlist-by-url` | T-003-01 |
| `apps/electron-backend/src/app/api/main.preload.ts` | expoe `fetchPlaylistByUrl` | expoe `importPlaylistByUrl` | T-003-01 |
| `libs/services/src/lib/data.service.ts` | `fetchPlaylistDefinition` | metodo opcional `importPlaylistByUrl` | T-003-02 |
| `apps/web/src/app/services/electron.service.ts` | `fetchPlaylistDefinition` | implementa `importPlaylistByUrl` com as opcoes de TLS | T-003-02 |
| `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.ts` | busca e despacha `handleAddingPlaylistByUrl` | usa `importPlaylistByUrl` quando existe; `persisted` → `playlistImportedInMain` | T-003-02 |
| `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.main-persist.spec.ts` | nao existe | guarda do ramo novo e do fallback | T-003-02 |
| `libs/m3u-state/src/lib/actions.ts` | acoes de playlist | `Playlist Imported In Main` | T-003-02 |
| `libs/m3u-state/src/lib/reducers/playlist.reducers.ts` | `handleAddingPlaylistByUrl` adiciona a meta | `playlistImportedInMain` adiciona a meta | T-003-02 |
| `libs/m3u-state/src/lib/effects.ts` | `addPlaylist$` grava, busca EPG e navega | `playlistImportedInMain$` so emite evidencia, busca EPG e navega | T-003-02 |
| `docs/architecture/m3u-playlist-module.md` | descreve o import por URL | secao "Main-process persistence (Electron)" | T-003-03 |
| `.changes/playlist-large-m3u-import.md` | nao existe | nota `type: perf` | T-003-03 |
| `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts` | assentamento conta o upsert do preload | aceita o upsert feito no main; repassa o kill switch | T-003-04 |
| `docs/plans/PLAN-003-m3u-main-process-import/measurements.md` | nao existe | tabela antes/depois | T-003-04 |

## Interações & Estados

Caminhos que precisam funcionar depois do plano:

1. Electron, Add playlist > URL (com ou sem titulo, User-Agent, opt-out de EPG) → main grava → dialogo fecha → a fonte aparece na lista → navega para `/workspace/playlists/<id>` → os canais carregam pela leitura normal.
2. Mesmo caminho com `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1` → comportamento de hoje.
3. TLS invalido ou erro de download → o dialogo mostra a mesma mensagem e a mesma acao de confiar no host.
4. PWA → `/parse` sem mudanca (o `DataService` do PWA nao implementa `importPlaylistByUrl`).
5. Source sync e auto-update → continuam em `fetch-playlist-by-url`.

Estados de erro e degradacao:

- Falha do worker ao gravar → o IPC rejeita, o dialogo mostra o erro generico de import, nada entra no store.
- Dialogo fechado antes da resposta → a gravacao no main ja aconteceu; a fonte aparece na proxima carga da lista (o caminho antigo tinha o mesmo efeito de nao aparecer, sem gravar).

## Componentes ausentes

- Modulo de import no main com kill switch.
- IPC `import-playlist-by-url` e tipo de resultado compartilhado.
- Acao e efeito que registram uma playlist ja gravada.

## Aderência à Stack

- **Dados consumidos**: `fetchPlaylistFromUrl` (com o timeout de 120 s do PLAN-001 quando mergeado) e `databaseWorkerClient.request('DB_UPSERT_APP_PLAYLIST', ...)`, ver `docs/stack.md` secoes 5 e 6.
- **Padrão de fetching**: IPC `ipcMain.handle` + preload, como os vizinhos.
- **Auth requerida**: nao.
- **Restrições aplicáveis**: escolha de runtime por capacidade (`data.importPlaylistByUrl` existe), nao por `window.electron` generico (`AGENTS.md`); kill switch removido em ate duas releases; log redigido; dados sinteticos nos testes.

## Fluxo de dados

```
antes:  main fetch+parse → clone Playlist → renderer → store → clone Playlist → main → worker upsert
depois: main fetch+parse → worker upsert → clone PlaylistMeta → renderer → store (meta) → rota le a playlist
```

## Plano de execução

1. **T-003-01 (main)**: escrever e selar as duas guardas; tipo compartilhado, modulo `playlist-url-import.ts`, handler e preload.
2. **T-003-02 (renderer)**: `DataService`/`ElectronService`, `url-playlist-import.ts`, acao, reducer e efeito.
3. **T-003-03 (docs)**: secao no `m3u-playlist-module.md` e nota de release.
4. **T-003-04 (medicao)**: benchmark aceita o caminho novo; rodadas antes/depois; `measurements.md`.

## Criterios de aceite

> Fonte unica: [`./checklist.md`](./checklist.md). Contratos tecnicos: [`./specs.md`](./specs.md).

## Backend pendings

Vazio.

## Knowledge mapped

- **Regras de negócio**: nao ha.
- **Postman**: nao ha.
- **Contratos lidos**: `m3u-playlist-module.md`, `sqlite-db-worker.md` (worker como unico escritor), `performance-journeys.md` (kill switch), `AGENTS.md`.
- **Stack ref**: `docs/stack.md` (local).

## Tabela de regressão

- Import por URL com User-Agent e refresh (`playlist-auto-refresh.e2e.ts`).
- Opt-out de EPG e fronteira de fase de dispatch no caminho antigo (`url-playlist-import.spec.ts`).
- Handlers de playlist no main (`playlist.events.spec.ts`).
- Cenarios formais e catalogo do benchmark (specs do PLAN-002).

## Anti-padrões

- ❌ Mudar o contrato de `fetch-playlist-by-url` (D-01).
- ❌ Gravar no SQLite fora do worker de banco.
- ❌ Decidir o caminho por `window.electron` em vez de `data.importPlaylistByUrl`.
- ❌ Mexer na renderizacao da lista de canais (F-03, outro plano).
- ❌ Usar URL, titulo ou credencial de provedor real em teste, doc ou commit.
- ❌ `prettier --write` no arquivo inteiro em `docs/**` ou em arquivo do upstream que ja nao esta no formato.

## Riscos & Rollback

- Dois caminhos convivem ate o kill switch sair; o teste cobre os dois.
- Rollback imediato sem build: `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1`. Rollback de codigo: `git revert` dos commits do plano.
