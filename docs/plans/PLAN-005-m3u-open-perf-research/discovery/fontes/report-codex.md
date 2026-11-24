# PLAN-005 — Discovery CODEX: abertura M3U e custos posteriores

Data: 24/11/2026. Branch verificada: `perf/playlist-json-read`, commit `918545a4f`.

Pesquisa estática, somente leitura. Nenhum arquivo alterado; nenhum install, build, teste ou benchmark executado. Não foram abertos `tmp/`, perfil pessoal ou arquivos de provedor. Os tempos e a distribuição da lista são os agregados fornecidos no briefing, não medições reproduzidas nesta pesquisa.

**O código ainda não permite atribuir os 29,6 s a uma causa única.** Há três achados que mudam a investigação:

1. Antes de publicar os canais, a abertura aguarda projeções de favoritos e histórico. Condicionalmente, elas calculam hashes das **380k URLs sequencialmente**.
2. As consultas EPG da lista executam SQLite **no main**, não no worker da playlist. Os lotes de 500 são consultas SQL internas.
3. Existe serialização explícita por playlist no renderer; o worker, porém, **não implementa uma fila global de uma requisição completa por vez**.

## 1. Caminho do clique ao primeiro canal

### Achado 1 — A rota faz uma leitura completa explícita; depois aguarda projeções

O clique M3U navega para `/workspace/playlists/:id`, que redireciona para `all`.

Evidências:

- Clique: `libs/playlist/shared/ui/src/lib/recent-playlists/recent-playlists.component.ts:200`.
- Rota lazy: `apps/web/src/app/app.routes.ts:114`.
- Redirecionamento e componente: `libs/playlist/m3u/feature-player/src/lib/m3u-workspace.routes.ts:6`.
- Sessão de carregamento: `libs/playlist/m3u/feature-player/src/lib/m3u-workspace-route-session.service.ts:60`.

| Ordem | Operação | Volume aproximado | Dependência |
|---|---|---|---|
| 1 | Navegar e carregar o módulo M3U | Código do módulo; sem documento da playlist | Antes da construção da tela |
| 2 | Sessão identifica playlist e seção; marca loading e reseta canal ativo | IDs e estado pequeno | Síncrona |
| 3 | `PlaylistsService.getPlaylist(id)` entra em `serializePlaylistWrite` | ID | Aguarda operações anteriores da mesma playlist |
| 4 | `getPlaylistById` aguarda inicialização/migrações da persistência | Normalmente promessa já resolvida; primeira execução pode trabalhar | Sequencial |
| 5 | `window.electron.dbGetAppPlaylistJson(id)` → `DB_GET_APP_PLAYLIST` | Pedido pequeno: ID + `format:'json'` | Sequencial |
| 6 | Main aguarda schema pronto e disponibilidade do worker; envia pedido | ID + formato | Sequencial |
| 7 | Worker lê a linha inteira e executa `parseAppPlaylist` | JSON de aproximadamente 96,5 MB → grafo de 380k entradas | Sequencial |
| 8 | Worker executa `JSON.stringify(playlist)` | Grafo inteiro → string completa | Sequencial |
| 9 | String retorna worker → main → preload/contextBridge → renderer | String completa em cada fronteira | Sequencial |
| 10 | `readDocumentPlaylist` executa `JSON.parse` | String completa → 380k entradas | Sequencial |
| 11 | Normalização rasa e `prepareHistory` | Mesmo array de canais; import dinâmico de módulo quando aplicável | Sequencial |
| 12 | `favoriteSync.project(playlist)` | Sidecar pequeno; condicionalmente percorre todo o catálogo | **Aguardada** |
| 13 | `historySync.project(playlist)` | Sidecar pequeno; condicionalmente percorre todo o catálogo | **Aguardada depois dos favoritos** |
| 14 | Hidratar grupos ocultos; chamar `setUserAgent` | Metadados pequenos | `setUserAgent` não é aguardado |
| 15 | Dispatch `ChannelActions.setChannels` | Referência para o array de 380k entradas | Publica canais e remove loading |
| 16 | Sidebar recebe o array e chama `fetchEpgForChannels` | Percorre 380k entradas; produz até 380k chaves distintas | Inicia antes de concluir a atualização da view |
| 17 | View `all` entrega o array ao CDK; instancia as linhas da janela virtual | Array completo como fonte; DOM limitado à janela | Não aguarda resposta EPG |
| 18 | Surge o primeiro `app-channel-list-item` | Uma linha com nome, logo e estado | Não depende do download do logo |

Evidências do trecho persistência/publicação:

- Fila e projeções: `libs/services/src/lib/playlists.service.ts:602`.
- Leitura: `libs/services/src/lib/playlists.service.ts:747`.
- Parse no renderer: `libs/services/src/lib/playlist-storage-backend.ts:132`.
- Preload: `apps/electron-backend/src/app/api/main.preload.ts:900`.
- Handler: `apps/electron-backend/src/app/events/database/playlist.events.ts:39`.
- Espera pelo schema: `apps/electron-backend/src/app/events/database/worker-events.utils.ts:47`.
- Worker: `apps/electron-backend/src/app/workers/database.worker.ts:780`.
- SELECT e desserialização: `apps/electron-backend/src/app/database/operations/playlist.operations.ts:298`.
- Codec: `libs/shared/database/src/lib/app-playlist-codec.ts:197`.
- Publicação: `libs/playlist/m3u/feature-player/src/lib/m3u-workspace-route-session.service.ts:124`.

A sidebar também possui um `@defer (on immediate)`, portanto existe um trecho de carregamento/agendamento de UI fora da chamada de banco. Evidência: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.html:36`.

### Achado 2 — Existe uma espera assíncrona potencialmente grande depois do IPC

`getPlaylist()` só resolve após:

```text
getPlaylistById → favoriteSync.project → historySync.project
```

No adaptador de favoritos, havendo entradas locais ou ordenação local, a projeção resolve os favoritos. Havendo uma entrada M3U, pode construir um índice de todas as URLs:

```text
para cada canal:
    await m3uFavoriteReference(channel.url)
```

O histórico faz construção semelhante quando seu estado contém referências M3U. As duas construções são independentes e a abertura as aguarda em sequência.

Evidências:

- Favoritos: `apps/web/src/app/services/favorites-playlist-adapter.ts:50` e `:121`.
- Histórico: `apps/web/src/app/services/history-playlist-adapter.ts:77` e `:177`.
- Hash com `crypto.subtle.digest('SHA-256', bytes)`: `libs/shared/interfaces/src/lib/favorites-sync/favorites-sync.reducer.ts:37`.

**Hipótese H1:** parte relevante da espera está em hashes assíncronos sequenciais, e não em main/worker. CPU ociosa do renderer não exclui essa possibilidade.

Essa hipótese é **condicional**:

- Favoritos retornam cedo quando não há entradas nem ordenação local.
- Histórico retorna cedo quando não há contexto/estado aplicável.
- Índices já construídos podem ser reutilizados.
- A presença de favoritos tradicionais no documento, isoladamente, não prova que o índice completo será construído.

Também há varreduras por favorito/recente: `playlistFavorite` usa `filter` para IDs legados e `find` por URL. Com F favoritos e R recentes, esse caminho pode atingir ordem de grandeza `O((F+R) × N)`.

Evidência: `apps/web/src/app/services/favorites-reference-adapters.ts:67`.

**Como confirmar:** separar o intervalo entre a resolução de `dbGetAppPlaylistJson`, o término de cada `project` e o dispatch `setChannels`. Em fixture sintética, comparar sidecars vazios, uma referência M3U e múltiplas referências; contar chamadas de hash e comparar abertura fria/quente do índice. Se os adaptadores retornarem cedo na execução lenta, H1 é descartada para aquela execução.

## 2. Quantidade de leituras, passes e cópias

### Achado 3 — A-01 ainda parseia e serializa a playlist no worker

A-01 evita transportar o grafo completo pelas fronteiras, mas o worker não devolve diretamente `playlists.payload`:

```text
SELECT linha → JSON.parse(payload) → sobreposição de colunas
→ JSON.stringify(playlist) → transporte de string
→ JSON.parse no renderer
```

Evidências:

- Worker parseia antes de escolher o formato: `apps/electron-backend/src/app/workers/database.worker.ts:804`.
- Serialização: mesmo arquivo, `:809`.
- Parse do payload: `libs/shared/database/src/lib/app-playlist-codec.ts:200`.

Para **uma abertura simples**, sem tarefas concorrentes nem sidecars que carreguem outro catálogo:

| Trabalho completo | Quantidade verificável |
|---|---:|
| Leitura SQL do documento | 1 |
| Parse completo no worker | 1 |
| Stringify completo no worker | 1 |
| Transporte lógico da string worker → main | 1 |
| Transporte lógico da string main → preload | 1 |
| Retorno da string pelo contextBridge | 1 |
| Parse completo no renderer | 1 |
| Clone profundo explícito adicional no reducer/selector | 0 |

Isso não determina quantos buffers físicos o Electron/V8 mantém durante cada transporte.

### Achado 4 — Não encontrei uma segunda leitura obrigatória no caminho direto

A sessão de rota faz uma chamada explícita a `getPlaylist`. Os adaptadores de catálogo retornam a própria fonte quando ela já contém `playlist.items`, evitando uma releitura nesse caso.

Evidência: `apps/web/src/app/services/favorites-m3u-catalog.ts:20`.

Existem, contudo, leituras adicionais **condicionais**:

- Dashboard tem fallback que lê a playlist inteira: `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.ts:1088`.
- O endpoint otimizado de favoritos seleciona o payload inteiro e pode parseá-lo no worker, embora devolva somente favoritos: `apps/electron-backend/src/app/database/operations/playlist.operations.ts:329`.
- Refresh lê o documento anterior antes de persistir o atualizado: `libs/services/src/lib/playlists.service.ts:730`.
- Alteração de metadados lê e regrava o documento: `libs/services/src/lib/playlists.service.ts:799`.
- Favoritar lê o documento: `libs/services/src/lib/playlists.service.ts:1014`.
- Sincronização de fontes possui leitura de catálogo: `apps/web/src/app/services/source-sync-runtime.ts:45`.

**Hipótese H2:** trabalho iniciado antes do clique continua vivo e provoca leituras adicionais ou ocupa o worker/main.

**Como confirmar:** contar, entre clique e primeiro item, `DB_GET_APP_PLAYLIST`, `DB_GET_APP_PLAYLIST_FAVORITE_CHANNELS` e upserts, incluindo operações iniciadas antes do clique. Duas chamadas no trace comprovam duplicação naquela execução; a análise estática não comprova que ela sempre ocorre.

### Achado 5 — Os passes adicionais dependem da seção e dos recursos ativos

| Local | Trabalho sobre N canais | Quando acontece |
|---|---|---|
| Container | `map(resolveChannelEpgLookupKey)` + `filter` + deduplicação | Cada chamada de `fetchEpgForChannels` |
| Controle parental | `filter` | Quando há grupos retidos |
| `all` | `filter` por nome | Quando existe busca |
| Ordenação | Spread de referências + sort | Ordem alfabética selecionada |
| `groups` | Agrupamento completo | Ao avaliar `groupedChannels` |
| `groups` | Outro agrupamento para contagens de gestão | Ao avaliar `managementGroups` |
| `groups` | Índice URL → grupo | Quando necessário para localizar canal ativo |
| Favoritos/histórico sincronizados | Índices de hashes completos | Conforme H1 e cache |
| Lista legada de recentes | Dois `map` para índices URL/ID | Se essa view do container for usada |

Evidências:

- EPG: `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:532`.
- Controle parental: mesmo arquivo, `:381`.
- Agrupamentos: mesmo arquivo, `:395` e `:407`.
- Recentes: mesmo arquivo, `:411`.
- Busca em `all`: `libs/ui/components/src/lib/channel-list-container/all-channels-view/all-channels-view.component.ts:142`.
- Ordenação: `libs/ui/components/src/lib/channel-list-container/channel-list-sort.util.ts:44`.
- Índice de grupos: `libs/ui/components/src/lib/channel-list-container/groups-view/groups-view.component.ts:444`.

**Não é correto somar todos esses passes como trabalho obrigatório da abertura em `all`.** Os `computed` são consumidos conforme a view; favoritos e recentes possuem rotas próprias.

### Achado 6 — Número de grafos residentes: base pequena, retenções condicionais importantes

| Processo | Caminho simples com A-01 | Retenção adicional possível |
|---|---|---|
| Renderer | 1 grafo parseado de N canais, referenciado por store, componente e views | Documento anterior, leituras concorrentes, índices e histórico de desenvolvimento |
| Main | Nenhum grafo completo de canais exigido pela leitura JSON; encaminha string | Upserts recebem objetos completos; EPG mantém arrays/mapas de até U chaves |
| Worker não EPG | 1 grafo transitório durante parse/stringify, além das strings | Outras leituras/parse de favoritos e operações intercaladas |

O reducer guarda `action.channels` diretamente; selector e sidebar não duplicam o grafo.

Evidências:

- Reducer: `libs/m3u-state/src/lib/reducers/channel.reducers.ts:33`.
- Selector: `libs/m3u-state/src/lib/selectors.ts:40`.
- Sidebar: `libs/ui/playback/src/lib/video-player/sidebar/sidebar.component.html:1`.

Ressalvas relevantes:

- Grupos e filtros criam arrays de **referências**, não cópias profundas de canais.
- O índice de histórico cria até N **cópias rasas** com `{ ...channel }` e mantém referência ao array original: `apps/web/src/app/services/history-playlist-adapter.ts:159`.
- Store DevTools de desenvolvimento retém até 25 entradas de histórico; isso não significa 25 grafos completos distintos: `apps/web/src/environments/store-devtools.providers.dev.ts:7`.

**Como medir a quantidade simultânea real:** heap snapshots por processo, caminhos de retenção e comparação antes/depois da abertura e da troca de fonte. Não se pode converter os 96,5 MB do JSON diretamente em uso de heap.

## 3. EPG: payload, SQL e periodicidade

### Achado 7 — São chaves EPG, não necessariamente 380k IDs de canal

`fetchEpgForChannels` percorre o array completo, mas envia chaves deduplicadas:

```text
tvg.id → tvg.name → name → vazio
```

Evidências:

- Extração/deduplicação: `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:532`.
- Prioridade: `libs/m3u-state/src/lib/channel-epg-lookup.util.ts:3`.

Definindo **U = quantidade de chaves não vazias distintas**, vale `U ≤ N`. Com apenas 0,5% de `tvg-id`, o fallback por nome é especialmente relevante. Não há filtro que limite a consulta aos 1.813 canais ao vivo ou às linhas visíveis.

### Achado 8 — Há duas chamadas lógicas paralelas, com possíveis fallbacks sequenciais

O container inicia um `forkJoin`:

1. `getCurrentProgramsForChannels`: programas atuais.
2. `getChannelMetadataForChannels`: nomes/logos XMLTV.

Evidência: `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:542`.

No Electron:

| Bridge | IPC | Entrada | Atendimento |
|---|---|---|---|
| `getCurrentProgramsBatch` | `GET_CURRENT_PROGRAMS_BATCH` | Até U strings + opções | Main → resolução de mappings → `EpgQueryService` |
| `getEpgChannelMetadata` | `EPG_GET_CHANNEL_METADATA` | Até U strings + escopo | Main → resolução de mappings → `EpgQueryService` |

Evidências:

- Preload: `apps/electron-backend/src/app/api/main.preload.ts:772`.
- Handlers: `apps/electron-backend/src/app/events/epg.events.ts:82` e `:102`.
- Delegação/mappings: mesmo arquivo, `:285` e `:301`.
- Consulta e remapeamento: `apps/electron-backend/src/app/events/epg-mapping.service.ts:59`.

Os dois pedidos são concorrentes do ponto de vista do renderer; não executam SQL simultaneamente no mesmo main.

### Achado 9 — “760 lotes de 500” é uma estimativa de uma etapa SQL

Para U próximo de 380k:

- Mappings: blocos de 10.000, aproximadamente **38 consultas por pedido lógico**.
- Candidatos de canal: blocos de 500, aproximadamente **760 consultas por passagem**.
- Programas por ID: blocos próximos de 32.763, aproximadamente **12 consultas por passagem**, variando com o escopo.

Evidências:

- Mappings: `apps/electron-backend/src/app/database/operations/epg-mapping.operations.ts:10` e `:46`.
- Candidatos: `apps/electron-backend/src/app/events/epg-query.service.ts:49` e `:793`.
- Programas: mesmo arquivo, `:617`.

O total pode crescer por tentativas com escopo local, legado e fontes globais. Não são 760 chamadas IPC nem 760 mensagens para o worker.

A busca de candidatos inclui ID, nome e versões com `LOWER(...)`. A possibilidade de scans caros precisa de `EXPLAIN QUERY PLAN`; a presença de `LOWER` sozinha não demonstra o plano efetivamente escolhido.

Evidência: `apps/electron-backend/src/app/events/epg-query.service.ts:824`.

### Achado 10 — O custo EPG ocupa o main

`EpgQueryService` usa a conexão do main com Drizzle/better-sqlite3. A aparência `async/await` não transforma a execução síncrona de SQLite em trabalho de worker.

Evidências:

- Conexão usada: `apps/electron-backend/src/app/events/epg-query.service.ts:18`.
- Conexão better-sqlite3: `libs/shared/database/src/lib/connection.ts:1041`.
- Contrato de ownership: `docs/architecture/sqlite-db-worker.md:13`.

Consequências:

- Os lotes EPG **não bloqueiam diretamente uma fila do worker não EPG**.
- Podem impedir o main de despachar pedidos, tratar mensagens do worker e entregar respostas IPC.
- Worker de importação XMLTV e worker não EPG são caminhos distintos.
- Contenção SQLite entre conexões é possível, mas não foi medida; WAL e `busy_timeout=5000` existem.

Evidência da configuração do worker: `apps/electron-backend/src/app/workers/database.worker-connection.ts:99`.

**Hipótese H3:** EPG já em andamento no main contribui para a espera da leitura. O EPG disparado pelo array recém-publicado também pode pesar depois da publicação, mas não há `await` dele condicionando a criação do primeiro item.

**Como confirmar:** correlacionar dispatch/resolução DB com CPU do main e eventos SQL; verificar se o intervalo lento coincide com consultas EPG. Comparação sintética com EPG habilitado/desabilitado isola o efeito agregado, sem demonstrar sozinha qual consulta é culpada.

### Achado 11 — A cada 60 s repete-se a preparação completa

O timer chama novamente `fetchEpgForChannels(this._channelList)`; não usa grupo selecionado nem janela virtual.

Evidência: `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:490`.

Também há novos fetches por:

- Recebimento do array.
- Mudança de escopo EPG.
- Mudança do offset.
- EPG disponível após debounce de 2 s.

Evidências: mesmo arquivo, `:261`, `:283`, `:303` e `:480`.

Nuances:

- Programas têm cache com TTL de 60 s: `libs/epg/data-access/src/lib/epg-program-cache.ts:13`.
- A consulta pode reutilizar programas ainda frescos; portanto não se pode afirmar que todo tique faz todas as consultas.
- Metadados não têm cache equivalente nesse lookup: `libs/epg/data-access/src/lib/epg-channel-metadata.lookup.ts:76`.
- Cancelar a subscription não cancela o trabalho SQLite já enviado por Promise.
- O batch scoped usa `shareReplay` com `refCount:false`: `libs/epg/data-access/src/lib/epg-scoped-batch.lookup.ts:83`.
- O timeout de 5 s dos programas não é cancelamento do trabalho no main: mesmo arquivo, `:118`.

Existe ainda um tique de progresso de **30 s**. Um detalhe importante: o utilitário de enriquecimento cria uma entrada para cada chave do mapa, **inclusive quando o programa é null**. Assim, um mapa com U resultados negativos pode gerar U pequenos objetos a cada reconstrução.

Evidência: `libs/ui/components/src/lib/channel-list-container/epg-enrichment.util.ts:61`.

## 4. Filas e interferência entre operações

### Achado 12 — A fila explícita é por playlist, no renderer

`serializePlaylistWrite` encadeia Promises por ID. Leitura de abertura e exclusão entram nessa mesma fila.

Evidências:

- Implementação: `libs/services/src/lib/playlists.service.ts:437`.
- Leitura: mesmo arquivo, `:610`.
- Exclusão: mesmo arquivo, `:627`.

Podem ficar à frente da abertura:

- Refresh.
- Favoritar/reordenar favoritos.
- Alterações de metadados.
- Atualizações de histórico.
- Exclusão e reset global, conforme a reserva.

Essa serialização protege contra perda de atualização e ressurreição após exclusão. Retirá-la exige preservar essas garantias.

### Achado 13 — Worker único não equivale a FIFO de requisições completas

O cliente envia cada pedido com `postMessage` e mantém várias Promises em `pendingRequests`.

Evidência: `apps/electron-backend/src/app/services/database-worker-client.ts:98`.

O listener do worker é `async`, sem corrente global de Promises ou `concatMap`. Operações podem se intercalar quando cedem execução. Trechos síncronos SQL, parse e stringify ocupam o único thread enquanto executam.

Evidência: `apps/electron-backend/src/app/workers/database.worker.ts:1372`.

| Trabalho concorrente possível | Como interfere |
|---|---|
| Inicialização/schema/migrações | Pode ser pré-requisito antes de enviar o pedido ao worker |
| Refresh/import e upserts | SQL, serialização e eventual fila por playlist |
| Favoritos/recentes globais | Consultas no mesmo worker |
| Sidecars de favoritos/histórico/atividade | Pedidos ao mesmo worker |
| Busca global/in-source | Consultas e processamento no mesmo worker |
| Construção FTS | Trabalho no mesmo worker, com possibilidade de intercalamento |
| Contadores/inventário do dashboard | Conforme os pedidos concretos iniciados pela tela |
| EPG da lista | Ocupa o main; não entra nesse worker |

Evidências:

- Pré-requisito schema: `apps/electron-backend/src/app/events/database/worker-events.utils.ts:27`.
- Sidecars: `apps/electron-backend/src/app/workers/database.worker.ts:443`.
- Busca global: mesmo arquivo, `:692`.
- Favoritos/recentes: mesmo arquivo, `:1175`.
- FTS: mesmo arquivo, `:1386`.

A ordem efetiva depende da execução; não é possível afirmar estaticamente que todos esses trabalhos precedem cada clique.

## 5. Renderização, grupos, busca e logos

### Achado 14 — Há virtual scroll e trackBy; o array fonte continua completo

A view `all` usa `cdk-virtual-scroll-viewport`, `cdkVirtualFor` e trackBy por `channel.id`.

Evidências:

- Template: `libs/ui/components/src/lib/channel-list-container/all-channels-view/all-channels-view.component.html:72`.
- TrackBy: componente correspondente, `:193`.

Sem busca, bloqueio parental ou ordenação alfabética, o CDK recebe o array completo por referência. A virtualização limita o DOM; não elimina leitura, parse, busca ou índices sobre N canais.

Em grupos, o CDK recebe apenas `selectedGroupChannels`, podendo chegar aos 62.755 itens do maior grupo, com DOM virtualizado.

Evidência: `libs/ui/components/src/lib/channel-list-container/groups-view/groups-view.component.html:286`.

### Achado 15 — Trocar de grupo é local; buscar e ordenar continuam proporcionais ao catálogo

- `all` ↔ `groups`, dentro da sessão já carregada, não exige nova leitura pela condição da sessão.
- Sair para uma seção não carregada e retornar pode provocar releitura.
- Seleção de grupo usa os grupos já calculados.
- Busca geral em grupos percorre canais dos grupos cujo título não satisfaz a busca.
- Ordenação alfabética clona referências e faz sort; ordem original reutiliza o array.

Evidências:

- Controle de releitura: `libs/playlist/m3u/feature-player/src/lib/m3u-workspace-route-session.service.ts:70`.
- Busca em grupos: `libs/ui/components/src/lib/channel-list-container/groups-view/groups-view.component.ts:335`.
- Seleção/ordenação: mesmo arquivo, `:385`.
- Sort: `libs/ui/components/src/lib/channel-list-container/channel-list-sort.util.ts:49`.

**Como medir:** separar primeira entrada em grupos, troca entre grupos já preparados, busca e ordenação; registrar N examinado, tamanho do resultado e duração de CPU. Não misturar esses cenários em um único tempo de navegação.

### Achado 16 — Logos geram pedidos para a janela renderizada, não 380k imagens

Cada item instanciado cria um `<img [src]="logo()">`. Não há `loading="lazy"` nesse elemento; a limitação principal vem do CDK.

Evidência: `libs/ui/components/src/lib/channel-list-container/channel-list-item/channel-list-item.component.html:25`.

Não existe um número fixo dedutível apenas do código: depende da altura, itemSize, buffers, cache, URLs repetidas e recriações. O componente comenta uma ordem típica de aproximadamente 50 linhas, não uma garantia.

Evidência: `libs/ui/components/src/lib/channel-list-container/all-channels-view/all-channels-view.component.ts:184`.

**Como confirmar:** contar linhas e `<img>` no DOM e pedidos de imagem pelo CDP, separando cache de rede. A existência do primeiro `app-channel-list-item` não aguarda `load` da imagem.

### Achado 17 — Favoritar ainda pode transportar e regravar todo o documento

O caminho tradicional faz:

```text
toggle → efeito → fila por playlist → leitura completa
→ mutação → dbUpsertAppPlaylist(objeto completo)
→ main → worker → stringify → SQLite
```

Evidências:

- Efeito: `libs/m3u-state/src/lib/effects.ts:88`.
- Mutação: `libs/services/src/lib/playlists.service.ts:1008`.
- Upsert: mesmo arquivo, `:391`.
- Transporte de objeto: `apps/electron-backend/src/app/api/main.preload.ts:887`.
- Serialização/escrita: `apps/electron-backend/src/app/database/operations/playlist.operations.ts:152`.

A-01 acelera a leitura, mas não elimina o transporte de objetos no upsert. O caminho com sidecar pode ter comportamento diferente e deve ser medido separadamente.

## 6. Traces disponíveis sem alterar código

As flags comuns são verificadas por ambiente, sem bloqueio por `app.isPackaged`; o código indica disponibilidade no empacotado. Isso não foi validado lançando um executável nesta pesquisa.

| Flag | O que fornece | Destino/limite |
|---|---|---|
| `IPTVNATOR_TRACE_IPC=1` | Início/sucesso/erro das APIs envolvidas pelo preload, argumentos/resultados resumidos, duração | Preload envia ao main, que imprime `[renderer-api]`; não cronometra a fila anterior à chamada da bridge |
| `IPTVNATOR_TRACE_DB=1` | Criação do worker, dispatch, resposta/erro com `requestId` e duração, eventos DB | Console do main/worker; também habilita trace SQL |
| `IPTVNATOR_TRACE_SQL=1` | Statements resumidos de main e worker | Console; não fornece duração individual por statement |
| `IPTVNATOR_TRACE_STARTUP=1` | Fases de startup e traces IPC/DB/SQL/window/player | Mais abrangente e mais intrusivo |
| `IPTVNATOR_TRACE_WINDOW=1` | Lifecycle e eventos de janela não responsiva | Console do main |
| `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` | Espelha console do renderer | Console do main |
| `IPTVNATOR_TRACE_PLAYER=1` | Atividade de players e diagnóstico delimitado | Útil após iniciar reprodução |
| `IPTVNATOR_PERF_CAPTURE=1` | Marcadores e contadores existentes de benchmark | Uso de desenvolvimento/teste; não é um relatório pronto apenas por definir a flag |
| `IPTVNATOR_PERF_WORKER_PROFILING=1` | Receive/work/response-post, CPU e fases do worker | Uso de desenvolvimento/teste; requer coletor para analisar os dados |
| `IPTVNATOR_PERF_COUNT_SQL=1` | Contagem adicional de statements junto de PERF_CAPTURE | Instrumenta execução e altera overhead |
| `IPTVNATOR_DISABLE_JSON_PLAYLIST_READ=1` | Kill switch A-01 | Volta ao transporte de objeto |
| `IPTVNATOR_DISABLE_COMPILE_CACHE=1` | Desabilita cache de compilação | Controle de startup; não mede a abertura M3U isoladamente |

Evidências:

- Flags e saída: `apps/electron-backend/src/app/services/debug-trace.ts:54` e `:190`.
- Wrapper IPC: `apps/electron-backend/src/app/api/main.preload.ts:151`.
- Recepção no main: `apps/electron-backend/src/app/events/electron.events.ts:33`.
- Duração DB: `apps/electron-backend/src/app/services/database-worker-client.ts:339`.
- SQL worker: `apps/electron-backend/src/app/workers/database.worker-connection.ts:90`.
- Profiling: `apps/electron-backend/src/app/workers/worker-performance-capture.ts:41`.
- Escopo documentado das flags PERF: `docs/development/electron-debugging.md:33`.

**Destino no Windows:** os traces usam `console.log`, portanto stdout dos processos; erros podem sair por stderr. Não há, nesses caminhos, criação automática de arquivo de log. A captura depende de como o executável é lançado. As variáveis precisam estar presentes antes do lançamento, especialmente as lidas na inicialização do preload.

**Limite de precisão:** a duração DB começa depois de `ensureWorker`; não inclui toda a preparação do worker. A duração da bridge não inclui a espera anterior em `serializePlaylistWrite`, nem as projeções posteriores. Subtrair os dois números não produz automaticamente “tempo de fila”.

## 7. Propostas para avaliação, sem plano de implementação

P/M/G representam custo de engenharia relativo.

| Proposta | Ganho esperado | Custo | Risco e encaixe | Medição anterior que confirma ou descarta |
|---|---|---:|---|---|
| Evitar índices SHA-256 completos na barreira do primeiro canal; compartilhar/reutilizar resolução | Pode retirar até duas passagens assíncronas de N hashes da abertura | M | Preservar identidade exata por URL, conflitos e projeções locais; adaptadores existentes | H1: tempo e contagem de hashes; descartar como prioridade se ambos retornarem cedo |
| A-02: EPG da janela visível com buffer limitado | Reduz U para V; uma passagem de candidatos cai de ~760 blocos para `ceil(V/500)` | M | Atualização ao rolar, troca de grupo, escopos e disponibilidade; container + CDK + EpgService | CPU main/SQL/latência com U e V; descartar como explicação da abertura se não houver sobreposição relevante |
| Evitar consultas XMLTV de ícones onde já existe logo; cache de metadados | Reduz o ramo de metadados para os itens que precisam dele | P/M | Preservar fallback de logo e invalidação por fonte; lookup de metadados | Medir separadamente duração de metadata e taxa de fallback; 99,9% de logos sugere benefício, não o quantifica |
| Eliminar releituras comprovadas e compartilhar somente leitura equivalente em andamento | Economiza um ciclo completo por leitura redundante removida | M | Revisões e frescor; não compartilhar snapshots anteriores a refresh | H2: contagem e sobreposição de pedidos; sem duplicação, sem ganho correspondente |
| Evitar parse/stringify completos no worker para resposta JSON | Remove duas passagens sobre o documento nesse ponto | M | JSON precisa refletir colunas autoritativas; devolver payload cru pode alterar semântica | Profiling de parse e stringify; stringify de resposta precisa ser distinguido do restante |
| A-03: canais em linhas SQLite, com leitura paginada e projeções de favoritos/recentes | Retira documento completo da necessidade de primeira tela; permite busca/grupo proporcionais ao resultado | G | Migração histórica, ordenação, compatibilidade e preservação de dados | Só priorizar após separar tempo do documento, projeções e EPG; comparar protótipo sintético de consulta, sem mudar tecnologia |
| A-04: reduzir espera de exclusão atrás de leitura com coordenação explícita | Melhora cancelamento/exclusão de fonte ocupada | M | Risco elevado de ressurreição e leitura obsoleta se apenas remover fila | Medir espera por playlist e corrida read/refresh/delete; descartar como solução de abertura se fila estiver vazia |

## 8. Gargalos prováveis, em ordem de investigação

A ordem abaixo é uma **priorização de hipóteses**, não uma decomposição medida dos 29,6 s.

| Ordem | Gargalo | Custo estimado do trabalho | Evidência | Confirmação ou descarte |
|---:|---|---|---|---|
| 1 | Projeção aguardada de favoritos/histórico com hashes sequenciais | Até duas passagens de N hashes, mais varreduras por favorito/recente; zero índice completo quando os guardas retornam cedo | `apps/web/src/app/services/favorites-playlist-adapter.ts:121`; `apps/web/src/app/services/history-playlist-adapter.ts:177` | Cronometrar cada `project`; contar hashes; comparar índice frio/quente |
| 2 | Espera anterior à leitura: fila da playlist, inicialização e trabalho concorrente | Sem limite temporal dedutível do código; depende do trabalho anterior | `libs/services/src/lib/playlists.service.ts:437`; `apps/electron-backend/src/app/events/database/worker-events.utils.ts:47` | Linha temporal clique → bridge → dispatch → resposta; identificar cada operação anterior |
| 3 | EPG de todo o catálogo ocupando o main | O(U) em preparação/resultados e centenas ou milhares de consultas de candidatos com fallbacks | `apps/electron-backend/src/app/events/epg-query.service.ts:793` | CPU main + SQL + IPC; verificar precedência e sobreposição com a abertura |
| 4 | Documento completo no worker e transporte, inclusive leituras adicionais | Uma leitura, parse, stringify e transporte por pedido; briefing informa 3,5 s de IPC e 1,3 s de parse renderer | `apps/electron-backend/src/app/workers/database.worker.ts:804`; `libs/services/src/lib/playlist-storage-backend.ts:142` | Perfil worker e contagem de pedidos; distinguir parse, stringify, transporte e espera |
| 5 | Busca, agrupamentos e ordenação locais | O(N), O(N log N) quando ordena, arrays de referências e mapas | `libs/ui/components/src/lib/channel-list-container/all-channels-view/all-channels-view.component.ts:142`; `libs/ui/components/src/lib/channel-list-container/groups-view/groups-view.component.ts:335` | CPU por interação, tamanho do resultado e ordem selecionada |
| 6 | Reconstruções periódicas de mapas EPG, inclusive negativos | O(U) a cada atualização; até U objetos auxiliares no tique de progresso | `libs/ui/components/src/lib/channel-list-container/epg-enrichment.util.ts:61` | Medir alocações/GC e duração dos tiques de 30/60 s |
| 7 | DOM e logos | Proporcional à janela virtual e seus buffers | `libs/ui/components/src/lib/channel-list-container/all-channels-view/all-channels-view.component.html:72` | Contar DOM, pedidos de imagem e tempo até primeira linha/pintura |

Os 29,6 s permanecem sem atribuição quantitativa. A evidência mais importante que falta é a divisão **antes da bridge / dentro da leitura / depois da leitura e antes de `setChannels` / publicação até primeira linha**. Em particular, os 45,6 s idle do perfil não podem ser tratados como tempo integral no main ou worker sem excluir as projeções assíncronas do renderer.