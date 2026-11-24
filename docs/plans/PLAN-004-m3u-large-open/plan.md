---
id: PLAN-004-m3u-large-open
plan_schema: v2
tela: Abrir playlist M3U grande no Electron (worker de banco, preload, PlaylistsService)
objetivo: correcao
plan_kind: backend
impact_class: cross-cutting
executor: externo
source: codigo
demand_id: null
demand_type: fix
status: pendente
parent_plan: PLAN-003-m3u-main-process-import
children_plans: []
arch_change: false
work_branch: perf/playlist-main-process-import
created_at: 2026-11-24T11:45:00-03:00
validated_at: null
---

# Levar a playlist ao renderer como texto JSON

## Contexto (POR QUE)

Com 380.373 entradas, abrir a playlist leva 143,9 s ate o primeiro canal. A leitura isolada `dbGetAppPlaylist`, chamada do renderer, leva de 106 a 111 s, enquanto o main le e desserializa em cerca de 4 s. O custo esta em copiar 380 mil objetos pelo IPC e pelo `contextBridge`. Um texto de 96 MB atravessa a mesma ponte em uma copia linear, e o `JSON.parse` no renderer custa poucos segundos. Detalhes: [discovery/README.md](./discovery/README.md) (F-01, alternativa A-01).

Prazo pratico: validar com a lista real antes de 2026-11-24 16:07 (Brasilia), quando o link de teste vence.

## Decisoes

| ID | Decisao | Motivo |
|---|---|---|
| D-01 | O canal continua `DB_GET_APP_PLAYLIST`, com o payload opcional `{ format: 'json' }`. Nao se cria canal novo. | Os harnesses de performance contam a operacao por esse nome (`database-request-identity-capture.ts`, `worker-performance-phase-events.ts` e outros). |
| D-02 | Metodo novo e opcional no bridge: `dbGetAppPlaylistJson`. O `dbGetAppPlaylist` fica como esta. | Outros chamadores (`stream-resolver`, `database-electron.service`) e o document store do servidor nao mudam. |
| D-03 | Kill switch `IPTVNATOR_DISABLE_JSON_PLAYLIST_READ=1`, lido no main. Com ele ligado, o worker devolve o objeto como hoje e o renderer aceita os dois formatos. | Regra do upstream: mudanca de performance visivel fica atras de um kill switch. |
| D-04 | O worker faz `JSON.stringify` do resultado de `parseAppPlaylist` em vez de devolver a coluna `payload` crua. | Preserva a mescla de colunas (`favorites`, `epgUrls` e outras) feita pelo codec; custa cerca de 1 a 2 s, uma vez. |
| D-05 | Ficam fora deste plano: EPG dos 380k ids (A-02), exclusao fora da fila (A-04) e canais em linhas com paginacao (A-03). | Cada um vira um plano proprio depois da validacao de A-01. |

## Artefatos mapeados

| Artefato | Papel hoje | Mudanca | Task |
|---|---|---|---|
| `apps/electron-backend/src/app/workers/database.worker.ts` (case `DB_GET_APP_PLAYLIST`, ~780) | devolve o objeto | com `format: 'json'`, devolve a string | T-004-01 |
| `apps/electron-backend/src/app/events/database/playlist.events.ts:36` | `({ playlistId })` | repassa `format` se o kill switch estiver desligado | T-004-01 |
| `apps/electron-backend/src/app/api/main.preload.ts:895` | `dbGetAppPlaylist` | acrescenta `dbGetAppPlaylistJson` | T-004-01 |
| `libs/shared/interfaces/src/lib/electron-api.interface.ts:1100` | tipo do bridge | metodo opcional `dbGetAppPlaylistJson` | T-004-01 |
| `libs/services/src/lib/playlist-storage-backend.ts:19` | `PlaylistDocumentStore` (Pick) | inclui `dbGetAppPlaylistJson` | T-004-02 |
| `libs/services/src/lib/playlists.service.ts:746` | `getPlaylistById` chama `dbGetAppPlaylist` | usa `dbGetAppPlaylistJson` quando existe e faz parse se vier string | T-004-02 |
| `apps/electron-backend-e2e/src/performance/database-request-identity-capture.ts:68`, `xtream-ipc-worker-identity-binding.ts:12` | mapa metodo para operacao | `dbGetAppPlaylistJson` → `DB_GET_APP_PLAYLIST` | T-004-02 |
| `docs/architecture/m3u-playlist-module.md` + `.changes/playlist-large-m3u-open.md` | - | uma secao curta e uma nota `type: perf` | T-004-03 |

## Tasks

| T-ID | Titulo | Executor | Valida em |
|---|---|---|---|
| T-004-01 | Devolver a playlist como texto JSON pelo worker e pelo preload | externo | C-01, C-03, C-05 |
| T-004-02 | Ler a playlist em texto no `PlaylistsService` | externo | C-02, C-04, C-06 |
| T-004-03 | Documentar e adicionar a nota de release | externo | C-07 |
| T-004-04 | Medir a abertura com a lista real e a sintetica | orquestrador | C-08, C-09 |

## Fora do escopo

- Os planos seguintes: A-02, A-04 e A-03 (ver discovery).
- A analise de canais indisponiveis, que esta so registrada: [discovery/canais-indisponiveis.md](./discovery/canais-indisponiveis.md).
