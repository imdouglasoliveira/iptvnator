# Briefing comum da pesquisa PLAN-005 (discovery, sem plano e sem execução)

> 2026-11-24. Fase: discovery. Ninguém edita código, cria branch, commita ou instala nada.
> Pesquisadores: codex (rastreio no código), opencode (mercado e boas práticas), antigravity (opções de desenho no stack atual).
> O orquestrador (Claude) só lê os relatórios, valida e mede.

## Regras para todos os pesquisadores

1. Somente leitura no repositório. Não edite, não crie arquivos no repo, não rode `git commit`, `pnpm install` ou build.
2. Não abra `tmp/`, `~/.iptvnator`, nem nenhum arquivo com dados de provedor. Use só dados sintéticos e domínios `example.test`.
3. A resposta final é o relatório inteiro em Markdown, em pt-BR, impresso na saída. Cite `arquivo:linha` para código e URL para fonte externa.
4. Separe fato verificado (com evidência) de hipótese. Para cada hipótese, diga como medir.
5. Não proponha trocar de tecnologia (Angular, Electron, SQLite com better-sqlite3, Nx ficam). Foco: Windows, app Electron, carregamento e travamentos.

## O app

IPTVnator: player IPTV. Monorepo Nx. `apps/web` é a UI Angular (renderer). `apps/electron-backend` é o main do Electron 43: handlers IPC, um worker thread com SQLite (better-sqlite3), preload com `contextBridge`. Funcionalidades em `libs/` por domínio (playlist/m3u, epg, shared/database, services).

Uma fonte M3U fica gravada como uma linha JSON (`playlists.payload`) e é lida e gravada inteira.

## O problema e o que já foi medido (lista real com 380k entradas, 96,5 MB; números agregados)

| Passo | Antes | Depois da A-01 |
|---|---:|---:|
| Import por URL | 280 s (antes do PLAN-003) | 11,9 s |
| Clique na playlist até o primeiro canal visível | 147,7 s | 29,6 s |
| Leitura da playlist vista do renderer | 193,7 s (objeto) | 3,5 s IPC + 1,3 s `JSON.parse` |
| Maior long task no renderer | 0,59 s | 0,54 s |

Formato da lista: 120 grupos (o maior com 62.755 itens), 1.813 canais ao vivo, 47.989 filmes, 330.571 episódios, `tvg-logo` em 99,9%, `tvg-id` em 0,5%.

A-01 (já implementada na branch `perf/playlist-json-read`): o worker devolve a playlist como string JSON (`dbGetAppPlaylistJson`), o renderer faz `JSON.parse`. A causa era a cópia de um grafo de 380k objetos pelo IPC e pelo `contextBridge`. Kill switch: `IPTVNATOR_DISABLE_JSON_PLAYLIST_READ=1`.

Os 29,6 s que sobram: o perfil de CPU do renderer fica quase todo ocioso (45,6 s idle). A espera está fora do renderer (main ou worker). Suspeitos ainda não medidos:
- leituras duplicadas do documento inteiro na abertura;
- `fetchEpgForChannels` manda os 380k ids ao main na abertura e a cada 60 s (cerca de 760 lotes de 500);
- `getPlaylist` e `deletePlaylist` dividem a mesma fila por playlist.

Alternativas já mapeadas: A-02 EPG só dos canais visíveis; A-03 canais M3U em linhas no SQLite com paginação (favoritos e recentes primeiro); A-04 exclusão fora da fila de leitura.

## Saída esperada de cada pesquisador

- Achados numerados com evidência.
- Propostas com ganho esperado, custo (P/M/G), risco e encaixe no repositório.
- Para cada proposta, a medição que confirma ou descarta antes de implementar.
