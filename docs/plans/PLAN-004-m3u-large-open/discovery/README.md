# Discovery: abrir uma playlist M3U de 380k canais

> Data: 2026-11-24. Base medida: build local `chore/local-build-m3u` (`e3a380bb4`, PLAN-001 + PLAN-003).
> Dados reais: apenas números agregados. Nenhum título, grupo, host ou credencial foi registrado.

## Sintoma

Depois do import, abrir a playlist mostra a lista em esqueleto e o chip "1 loading" por mais de 2 minutos. Às vezes o app fecha.

## Formato da lista real (agregado)

| Medida | Valor |
|---|---:|
| Entradas | 380.373 |
| Bytes | 96,5 MB |
| Grupos | 120 (mediana de 45 itens; 37 grupos com mais de 1.000 itens; o maior tem 62.755) |
| Tipos (pelo caminho da URL) | 1.813 ao vivo, 47.989 filmes, 330.571 episódios de série |
| `tvg-logo` / `tvg-id` | 99,9% / 0,5% |
| Download | 2,2 s |

## Medições (script CDP com banco isolado, `IPTVNATOR_E2E_DATA_DIR`)

| Passo | Tempo |
|---|---:|
| Import por URL (`importPlaylistByUrl`, caminho do PLAN-003) | 9,0 a 10,5 s (antes do PLAN-003: 280 s) |
| Clique na playlist até o primeiro `app-channel-list-item` | 143,9 s |
| `window.electron.dbGetAppPlaylist(id)` isolado, chamado do renderer | 106,6 s e 111,3 s |
| `DB_GET_APP_PLAYLIST` medido no main (PLAN-002) | 4,2 s |

No perfil de CPU do renderer durante a abertura há 92,3 s em código nativo sem URL e 62,7 s ociosos. As long tasks em JS passam no máximo de 0,74 s. `fetchEpgForChannels` gasta apenas 0,3 s de CPU no renderer.

## Achados

| ID | Achado | Evidência | Classe |
|---|---|---|---|
| F-01 | Quase todo o custo está em levar o `Playlist` inteiro, com 380k objetos, do main ao renderer. O main lê em cerca de 4 s; a chamada vista do renderer leva cerca de 107 s. A hipótese é a cópia do grafo de objetos pelo `contextBridge`/IPC; um string de 96 MB atravessaria barato. | as duas linhas da tabela; o perfil nativo de 92 s | bloqueante |
| F-02 | O armazenamento é um blob JSON por playlist (`playlists.payload`). Toda leitura, favorito ou busca faz parse do documento inteiro. Não existem linhas por canal nem paginação. | `schema.ts:26-59`, `app-playlist-codec.ts:177/197`, `playlist.operations.ts:298-327` | estrutural |
| F-03 | O EPG busca o programa atual e a metadata dos 380k ids na abertura e a cada 60 s; no main isso dá cerca de 760 lotes de 500. | `channel-list-container.component.ts:303-310, 491, 522-565`; `epg-query.service.ts:192` | provável (main não perfilado) |
| F-04 | `getPlaylist` e `deletePlaylist` usam a mesma fila por playlist, sem cancelamento e sem timeout. Uma leitura de cerca de 107 s atrasa a exclusão. Para M3U não há linha de progresso. | `playlists.service.ts:439-467, 601-667`; `source-removal.service.ts:253-288` | ligado à issue do fork #2 |
| F-05 | Outros leitores também carregam o documento inteiro: favoritos unificados, recentes, dashboard, stream-resolver, second-stream e a busca global (LIKE no payload). | relatório de mapeamento | follow-up |

## Alternativas

| ID | Alternativa | Ganho esperado | Custo |
|---|---|---|---|
| A-01 | `dbGetAppPlaylist` devolve o payload como string JSON (do worker ao preload sem parse) e o renderer faz `JSON.parse`. Fica atrás de um kill switch. | de cerca de 107 s para alguns segundos (a medir) | pequeno: worker op, handler, preload, `database-electron.service` |
| A-02 | EPG só para os canais visíveis ou em janelas, sem o refresh dos 380k a cada 60 s | tira carga do main e do worker durante a navegação | médio, na UI de lista |
| A-03 | Canais M3U em linhas com API paginada no worker; grupos, contagem e busca em SQL | escala para milhões; abertura em menos de 1 s | grande: migração, vários leitores |
| A-04 | Exclusão fora da fila de leitura, com progresso para M3U | resolve a issue do fork #2 | pequeno a médio |

Recomendação: A-01 primeiro, porque é pequeno, mede-se no mesmo dia e ataca o F-01. Depois A-02 e A-04. A-03 vira um plano próprio, com discovery de migração.
