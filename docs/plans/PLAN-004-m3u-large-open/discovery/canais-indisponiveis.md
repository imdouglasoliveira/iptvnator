# Analise: canais M3U indisponiveis

> 2026-11-24. Este documento so registra a analise; o usuario pediu para nao executar nada. Mapeamento por leitura de codigo, sem rodar nada contra provedor.

## Pergunta

Numa lista M3U muitos canais dao erro ao tocar. O app sabe, em algum momento, que um canal falhou ou funcionou? Da para esconder ou eliminar os mortos de forma automatica, mudando pouco o app?

## O que existe hoje

| Area | Comportamento | Onde |
|---|---|---|
| Player web (hls.js, mpegts.js, Video.js, ArtPlayer, Shaka) | Classifica a falha num codigo (`network-error`, `unsupported-codec`, `media-decode-error`, `drm-or-encryption`, `browser-access-error`, `unsupported-container`, `unknown-playback-error`) e mostra o painel de diagnostico. Sem retry, exceto o aviso manual de 15 s do Video.js. | `libs/ui/playback/.../html-video-player-diagnostics.ts:61-84`; `libs/playback/util/.../playback-diagnostics.model.ts:11-19`; `player-controls-contract.md:113-171` |
| Recuperacao no web | Recomenda outro player ou o player externo. O estado vive so na sessao, em memoria. | `web-player-recovery-policy.ts`, `playback-recommendation-policy.ts` |
| MPV/VLC externos | Classifica a saida (`connection-failed`, `access-denied` 403, `stream-not-found` 404, `timed-out` e outros) e envia um toast pelo IPC `player-error`. Sem retry. | `apps/electron-backend/src/app/events/external-player-runtime.ts:62-102` |
| MPV embutido | Reconecta com backoff, mas so um stream que ja chegou a `playing`. URL morta fica no Retry manual. | `embedded-mpv-reconnect.ts` |
| Persistencia | Nada registra falha ou sucesso por canal. `recently_viewed` guarda so a data; `playback_positions` cobre so VOD e episodio do Xtream. | `libs/shared/database/src/lib/schema.ts:144, 290` |
| "Source health" | Mede a fonte (URL da playlist ou conta), nao os canais. Na M3U le os primeiros 64 KiB da playlist. Historico em localStorage por playlist. | `m3u-playlist-module.md:2211-2300` |
| Esconder | So por grupo (`hiddenGroupTitles`). Nao existe esconder canal. | `playlist.interface.ts:124`; `channel-list-container.component.ts:651-662`; `content.operations.ts:607-612` |
| Probe de stream | `STREAM_PROBE_URL` (HEAD ou GET de 4 KiB, 10 s, com os headers da playlist). Hoje so o Xtream usa (VOD multi-source e catchup). Status 0 quer dizer "nao foi possivel checar", nao offline. | `apps/electron-backend/src/app/events/stream-probe.ts`; `libs/services/src/lib/stream-probe.service.ts` |

Resposta curta: hoje o app mostra o erro e esquece. Um canal que falhou nao fica marcado, e um que tocou tambem nao.

## Riscos de eliminar automaticamente

1. **Uma conexao por conta.** Muitos provedores aceitam uma conexao so. A documentacao registra o caso do mpegts.js, que segurava o socket e derrubava o canal seguinte (`nx-workspace-boundaries.md:180-196`). Testar 380 mil URLs em lote, ou ate 10 em paralelo, pode bloquear a conta ou derrubar o que o usuario esta assistindo.
2. **Falso negativo.** Os casos que parecem canal morto sem ser: falha de rede passageira, header faltando (User-Agent/Referer da 401/403), canal que so transmite em certos horarios, codec que um player nao toca e outro toca. Esconder por erro de codec ou DRM esconderia canais bons.
3. **Lista refeita no refresh.** O refresh da M3U reparseia o arquivo; qualquer marca por canal precisa sobreviver a ele, pela URL do canal, como os favoritos ja fazem.

## Opcoes (menor mudanca primeiro)

| ID | Opcao | Mudanca | Risco |
|---|---|---|---|
| O-1 | Registrar o resultado de cada tentativa de tocar: falha de rede/404/403/timeout e sucesso (`playing`). O registro e passivo, sem trafego extra. Guarda em localStorage por playlist, como o `SourceHealthHistoryService`: URL do canal com hash, codigo, data e contagem. | Ouvir `playbackIssue` (web), `player-error` (externo) e o evento de `playing`; um servico novo pequeno | baixo; nao gera conexao nova |
| O-2 | Na lista, deixar esmaecido o canal com N falhas de rede seguidas e nenhum sucesso nos ultimos X dias, com o filtro "Ocultar indisponiveis". Um sucesso limpa a marca. | Filtro na lista e na busca (`content.operations.ts:607`), igual ao `hiddenGroupTitles` | baixo; o usuario decide |
| O-3 | Botao "Verificar canais" num grupo ou na selecao, que usa o `STREAM_PROBE_URL` existente com concorrencia 1, os headers da playlist e um limite (ex.: 50 canais por vez); resultado em O-1. | Reaproveita o probe; UI de progresso | medio; respeita a conexao unica |
| O-4 | Campo `hiddenChannelUrls` no payload, ao lado de `hiddenGroupTitles`, para esconder de forma persistente (e no backup). | Interface, backup, `playlists.service`, `source-row-snapshot`, lista de campos que o refresh preserva, busca | medio; mexe no formato salvo |
| O-5 | Varredura automatica em segundo plano de todos os canais | - | alto; desaconselhado pelo risco 1 |

## Recomendacao

1. **Comecar por O-1 + O-2.** Usa so o que o usuario ja tocou, nao cria trafego e encaixa no padrao de saude da fonte. Conta so os codigos de rede (`network-error`, `connection-failed`, `stream-not-found`, `access-denied`, `timed-out`), nunca codec ou DRM. A acao padrao e "esmaecer e oferecer esconder"; nada some sozinho.
2. **O-3 depois**, se o usuario quiser limpar um grupo de uma vez, sempre sob demanda e com concorrencia 1.
3. **O-4 so se** o esconder precisar ir para o backup ou para outros aparelhos.
4. **Pre-requisito:** abrir listas grandes rapido (PLAN-004 A-01 a A-03). Filtrar 380 mil canais no renderer herda o mesmo custo de hoje.

Upstream: e uma funcionalidade visivel. Precisa de nota em `.changes/` e, pelas regras do repositorio, de decisao do mantenedor sobre a UX antes de um PR.
