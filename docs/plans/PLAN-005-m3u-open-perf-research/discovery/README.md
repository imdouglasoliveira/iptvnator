# Discovery PLAN-005: o que ainda trava a abertura de M3U grande no Windows

> 2026-11-24. Fase: discovery. Base: build local `d6fb709d9` (A-01 aplicada). Dados reais: só tempos agregados.
> Fontes: medição M-01 (progress.md), relatório codex (`tmp/iptvnator/plan-005/report-codex.md`), relatórios opencode (mercado e desenho, quando chegarem).

## Medição que decide (M-01)

A playlist chega ao renderer em 3,7 s. O primeiro canal aparece em 37,1 s, no mesmo instante em que as consultas de EPG respondem (programa atual 15,3 s; metadata 30,3 s). Uma segunda consulta de programa atual começa em 39,8 s e não termina em 67 s.

## Achados validados

| ID | Achado | Evidência | Validação do orquestrador |
|---|---|---|---|
| F-10 | As consultas de EPG da lista rodam com better-sqlite3 na conexão do **main** do Electron. SQLite síncrono no main trava o event loop: IPC, mensagens do worker, chunks lazy e eventos de janela esperam. É o travamento que o usuário vê no Windows. | `epg-query.service.ts:18`, `connection.ts:1041`, `docs/architecture/sqlite-db-worker.md:13`; M-01 | confirmado no código (`epg.events.ts:285-291` chama `epgQueryService` direto) e coerente com M-01 |
| F-11 | A lista pede EPG para todas as chaves do catálogo (tvg-id, senão tvg-name, senão nome): com 0,5% de tvg-id, quase 380k chaves por nome. Uma passagem gera cerca de 38 consultas de mapping (blocos de 10k) e 760 de candidatos (blocos de 500), com `LOWER(...)`, mais fallbacks legado e global. | `channel-list-container.component.ts:532-542`, `epg-query.service.ts:49/793/824`, `epg-mapping.operations.ts:10/46` | confirmado (leitura parcial) |
| F-12 | O ciclo repete: timer de 60 s, mudança de escopo, offset e "EPG disponível" refazem a consulta completa; metadata não tem cache; cancelar a subscription não cancela o SQL já enviado. | `channel-list-container.component.ts:261/283/303/480/490`, `epg-channel-metadata.lookup.ts:76`, `epg-scoped-batch.lookup.ts:83/118` | coerente com M-01 (segunda consulta > 67 s) |
| F-13 | A metadata XMLTV (nome e logo) é pedida mesmo com `tvg-logo` em 99,9% dos itens. | `channel-list-container.component.ts:542` | hipótese de ganho, medir taxa de uso |
| F-14 | A abertura aguarda projeções de favoritos e histórico; com referências M3U, cada uma pode calcular SHA-256 das 380k URLs em sequência. | `favorites-playlist-adapter.ts:121`, `history-playlist-adapter.ts:177`, `favorites-sync.reducer.ts:37` | condicional; na M-01 (banco novo, sem favoritos) o intervalo leitura→EPG foi 2,1 s, então não pesou ali. Medir com favoritos |
| F-15 | A-01 ainda faz `JSON.parse` + `JSON.stringify` do documento no worker antes de mandar a string. | `database.worker.ts:804/809`, `app-playlist-codec.ts:200` | confirmado; o worker gastou 2,9 s no total |
| F-16 | Favoritar ainda lê o documento inteiro e regrava com objeto completo pelo IPC (sem a A-01). | `playlists.service.ts:1008/391`, `main.preload.ts:887` | confirmado por leitura; medir |

## Propostas (ordem sugerida, cada uma mensurável sozinha)

| ID | Proposta | Ganho esperado | Custo | Risco |
|---|---|---|---|---|
| B-01 | Tirar as consultas de EPG do main: atendê-las num worker (o de banco ou um de leitura EPG), com o mesmo contrato IPC | o main deixa de travar; a janela responde durante a abertura e nos tiques | M | contrato de ownership do SQLite; journeys de EPG |
| B-02 (A-02) | Consultar EPG só das chaves da janela visível (CDK) com buffer, e cache por chave | de ~380k para dezenas de chaves por consulta | M | atualizar ao rolar e trocar de grupo |
| B-03 | Não pedir metadata XMLTV para itens que já têm `tvg-logo`; cache de metadata | tira a consulta mais lenta (30 s) da abertura | P | perder logo de fallback em casos raros |
| B-04 | Primeira pintura sem depender de nada além da leitura da playlist (EPG chega depois) | abertura perto de 4 a 6 s | P/M | confirmar o que hoje segura a pintura |
| B-05 | Worker devolve `playlists.payload` cru quando as colunas autoritativas batem (sem parse+stringify) | ~1 a 2 s a menos na leitura | M | semântica das colunas sobrepostas |
| B-06 | Projeções de favoritos/histórico fora da barreira da primeira pintura, com índice de hash em cache | depende do usuário (favoritos M3U) | M | identidade por URL |
| B-07 (A-03) | Canais em linhas SQLite com paginação; favoritos e recentes primeiro | abertura < 1 s, escala para milhões | G | migração; plano próprio |

Todas com kill switch, conforme AGENTS.md (mudança de performance visível ao usuário).

## Medições pendentes antes de planejar

1. M-02: mesma linha do tempo com a EPG desligada para a playlist (ou sem `x-tvg-url`), para provar que o primeiro canal cai para ~4 a 6 s.
2. M-03: CPU do main durante a abertura (perfil do main via `--inspect`), para confirmar F-10 em números.
3. M-04: abertura com favoritos e recentes M3U, para pesar F-14.
4. Medir só com uma instância do app aberta (o usuário testa em paralelo; duas instâncias travam a máquina dele).

## Revisão do codex 2 (validador do discovery acima)

- F-10, F-11 e F-13 confirmados. Os mappings também rodam no main (`epg-mapping.service.ts:48`).
- F-12 corrigido: programas atuais já têm cache por chave com TTL de 60 s e compartilhamento de lotes idênticos (`epg-program-cache.ts:13/46`, `epg-scoped-batch.lookup.ts:37/57`). Cada gatilho percorre a lista inteira para montar as chaves, mas nem todo gatilho vai ao banco. Metadata não tem cache.
- B-04 corrigido: o código já cria as linhas sem esperar o `forkJoin` do EPG (`channel-list-container.component.ts:303/542`, templates `all` e `groups`). O que segura a primeira linha ainda não está provado.
- **Cuidado com a M-01:** o "primeiro canal visível" foi observado por Playwright via CDP. No Electron o servidor de DevTools passa pelo processo principal; com o main travado em SQLite, a resposta do CDP também atrasa. Os 37,1 s podem ser em parte atraso de observação (H-04 do codex 2). A próxima medição registra os marcos dentro do renderer (MutationObserver e `performance.now()`), lidos só no fim.
- B-01: o encaixe preferido é o worker de banco existente, com a resolução de mappings, a consulta e o remapeamento todos no worker; mesmos canais IPC; kill switch sugerido `IPTVNATOR_DISABLE_EPG_QUERY_WORKER`. O ganho garantido é a janela responder; tempo de EPG e primeira pintura precisam de medição. Atualizar `docs/architecture/sqlite-db-worker.md` (ownership).
- B-02: ligar no `renderedRangeStream` do CDK nas views `all` e `groups` (grupo inteiro não basta: o maior tem 62.755). Consultar só chaves ausentes ou vencidas, coalescer, limitar concorrência e o tamanho do cache. Timer de 60 s só sobre a janela ativa.
- B-03: filtrar metadata para itens sem `tvg-logo` preserva a regra atual de logo (`channel-logo-fallback.util.ts:8`).
- Falta journey para "abrir M3U grande": a J2 mede portal Xtream. O contrato pede contador antes de otimizar; a escolha do journey é do mantenedor.

## Mercado e boas práticas (opencode, com fontes no relatório)

- O mesmo anti-padrão está documentado no Jellyfin: guia pedindo tudo de uma vez (jellyfin-web#7603: 870 canais, 9 s; o Emby pede só os 25 visíveis e abre na hora) e refresh refazendo todos os canais (jellyfin#17476).
- Players que abrem 300k+ rápido carregam por fases: favoritos e grupos primeiro, EPG só dos visíveis, resto em segundo plano, e guardam índice entre sessões (clubTivi testado com 324k; Megacubo, que é Electron, indexa em workers).
- Electron: a documentação de performance manda nunca bloquear o main; `postMessage` do Electron transfere só `MessagePort`, não `ArrayBuffer` (electron#34905), então "zero-copy" de buffer não existe; better-sqlite3 deve ficar em worker thread ou utilityProcess, nunca em Web Worker do renderer (o arranjo atual está certo).
- Windows: Defender e ASAR pesam no startup, não no clique-até-canal; aumentar heap do V8 não resolve (limite de 4 GB com pointer compression).
- Separar os 1.813 canais ao vivo dos 378k filmes e episódios aparece como técnica barata de "hot set" (Kodi, Hypnotix, Tentacle).

## Próxima medição (M-02), quando o usuário fechar o app dele

Uma instância só, banco isolado novo, lista real:
1. Marcos dentro do renderer, guardados em memória: retorno do bridge, fim do `getPlaylist`, `setChannels`, fim do loading, primeiro range do CDK, inserção da primeira linha (MutationObserver), frames de `requestAnimationFrame` para medir congelamento.
2. Perfil de CPU do main (`--inspect`) na mesma rodada, agregando tempo em SQL de EPG.
3. Rodada de controle com EPG desligado (sem fontes globais e sem `x-tvg-url`), conferindo zero chamadas de programas e metadata.

## Opções de desenho (opencode, trilha que era do antigravity; relatório em fontes/report-design-opencode.md)

Achados novos, conferidos por amostra no código:
- O `ChannelListContainer` existe duas vezes (sidebar e lista em tela cheia: `sidebar.component.html:1-2`, `m3u-fullscreen-channel-list.component.html:26-36`). Cada instância roda o próprio pipeline de EPG, então as consultas dobram.
- O worker de banco não tem fila, prioridade nem cancelamento de leitura; o cancelamento existente (`DB_CANCEL_OPERATION`) cobre só escritas.
- Não existe journey nem contador de "abrir M3U". O contrato de performance manda criar o contador antes de otimizar.
- O dashboard faz 19 leituras de payload inteiro no `launch-large`; já existem fast paths (`DB_GET_APP_PLAYLIST_FAVORITE_CHANNELS`, `DB_GET_APP_PLAYLIST_METAS`) para copiar.
- Arquivos centrais (`epg-query.service.ts`, `channel-list-container.component.ts`, `playlists.service.ts`, `database.worker.ts`) estão na baseline de 400 linhas: podem ser editados, mas a lógica nova vai para arquivos novos.

Sequência sugerida pelo relatório (uma entrega, um contador):

| # | Entrega | Contador |
|---|---|---|
| E0 | Journey `open-m3u` com fixture sintética de 380k (só instrumentação) | `clickToFirstChannelMs`, `main.epgLookupStatementsPerTick` |
| E1 | Um dono só para o EPG da lista + EPG da janela visível + teto de chaves (B-02, B-03) | `main.epgLookupStatementsPerTick` |
| E2 | Exclusão fora da fila de leitura (A-04) | espera de `dbGetAppPlaylist` com delete concorrente |
| E3 | Índice leve ao lado do blob (grupos, contagens, primeira página); documento inteiro em segundo plano | bytes lidos até o primeiro canal |
| E4 | Fast paths do dashboard | `launch-large` |
| E5a-c | A-03 em três partes (schema invisível, paginação keyset, FTS5) | por parte |

Divergência com o codex 2: o opencode deixa B-01 (EPG fora do main) para depois de medir e pede decisão do mantenedor sobre `sqlite-db-worker.md:595-612`; o codex 2 recomenda B-01 cedo pelo efeito na responsividade. A M-02 e o monitor de reprodução decidem.

## Travamentos na reprodução (monitor M-05, 10 min, app do usuário assistindo um canal ao vivo)

Monitor ligado por CDP à janela já aberta (sem segunda instância), amostra por segundo do `<video>` e do relógio do renderer, cruzado com o trace IPC do main. Só tempos.

| Medida | Valor |
|---|---:|
| Tempo observado | 626 s |
| Travamentos (vídeo tocando sem avançar) | 6, somando 369 s; os maiores 192 s e 164 s |
| Buffer à frente do ponto de reprodução | mediana 0,06 s; p90 19,9 s |
| Consultas de EPG longas no main | 19 (12 metadata, 6 programa atual, 1 programas do canal), de 9 a 31 s cada |
| Renderer congelado (timers sem rodar) | 3 vezes, 91 s, 93 s e 89 s |

Linha do tempo: as consultas de EPG terminam aos 188-199 s, 315-324 s e 508-509 s; o renderer congela logo depois, de 200 a 291 s, de 327 a 420 s e de 516 a 604 s. O vídeo trava nesses mesmos trechos.

Mecanismo (confirmado no código): a resposta de `GET_CURRENT_PROGRAMS_BATCH` e de `EPG_GET_CHANNEL_METADATA` tem uma entrada para **cada chave pedida**, inclusive `null` para quem não casou (`epg-mapping.service.ts:67-71`, `epg-query.service.ts:334`). Com ~380k chaves, cada resposta é um objeto de ~380k propriedades que atravessa o IPC e o `contextBridge` propriedade a propriedade, o mesmo custo que a A-01 removeu da leitura da playlist (lá eram 107 s). Com o renderer parado, o player (que roda no renderer e alimenta o `<video>` via MSE) não anexa os segmentos que chegam; o buffer zera e o vídeo congela. As duas instâncias do `ChannelListContainer` (sidebar e tela cheia) dobram o efeito.

Os 165 s iniciais de travamento coincidem com a abertura e a troca de canal; o provedor não foi descartado como causa secundária (buffer p90 de 19,9 s mostra que, quando o renderer está livre, os segmentos chegam).

Correções, todas já na lista (B-01 a B-03, E1), com uma adição:
- B-08: a resposta do EPG não devolve `null` por chave nem atravessa como objeto gigante; só os acertos, e só das chaves visíveis. Se ainda for grande, viaja como string JSON (como na A-01).
