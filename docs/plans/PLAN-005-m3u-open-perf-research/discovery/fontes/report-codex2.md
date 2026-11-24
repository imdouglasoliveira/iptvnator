# PLAN-005 — CODEX 2: revisão de F-10 a F-13

**O código confirma consultas de EPG síncronas no main e trabalho proporcional ao catálogo inteiro. Não confirma, sozinho, qual dependência impede a primeira linha de aparecer aos 37,1 s.** O `forkJoin` atrasa o preenchimento dos mapas de EPG; a criação das linhas não depende explicitamente dele.

A distinção é relevante: tirar SQL do main tem fundamento arquitetural, mas prometer primeira pintura em 4–6 s ainda depende de medição.

## Escopo e base verificada

- Leitura realizada na branch `perf/playlist-json-read`, HEAD `918545a4f`.
- A M-01 fornecida no briefing corresponde a `d6fb709d9`. A comparação desses commits não mostrou diferenças nos arquivos centrais consultados de EPG, container, views, sessão M3U e configuração Angular.
- Os tempos da M-01 são evidência fornecida pelo orquestrador; não foram reproduzidos nesta revisão.
- Não abri `tmp/`, perfis, bancos ou arquivos de provedor. Não alterei arquivos, instalei dependências, executei builds, testes ou o app.

Os caminhos citados abaixo são relativos à raiz do repositório.

## 1. Achados verificados

### R-01 — Existe uma barreira de carregamento, mas ela termina com `setChannels`, sem esperar EPG

A sequência de abertura encontrada é:

1. A sessão marca `channelsLoading = true`.
2. Aguarda `PlaylistsService.getPlaylist`.
3. Publica `ChannelActions.setChannels`.
4. O reducer grava os canais e marca `channelsLoading = false`.

Evidências:

- `libs/playlist/m3u/feature-player/src/lib/m3u-workspace-route-session.service.ts:101`
- `libs/playlist/m3u/feature-player/src/lib/m3u-workspace-route-session.service.ts:110`
- `libs/playlist/m3u/feature-player/src/lib/m3u-workspace-route-session.service.ts:133`
- `libs/m3u-state/src/lib/reducers/channel.reducers.ts:33`

A configuração de User-Agent é disparada com `void`; sua resposta não é aguardada antes de publicar os canais.

**Evidência:** `libs/playlist/m3u/feature-player/src/lib/m3u-workspace-route-session.service.ts:124`.

Entretanto, **“playlist chegou ao renderer” precisa ter uma fronteira precisa**. `getPlaylist` ainda aguarda projeções de favoritos e histórico após a leitura persistida:

**Evidência:** `libs/services/src/lib/playlists.service.ts:610`.

Se o marcador de 3,7 s está no retorno do IPC, ele antecede a conclusão dessas projeções e a publicação no store. Se está na emissão final de `getPlaylist`, essas projeções já terminaram.

### R-02 — O `forkJoin` é uma barreira para o enriquecimento, não uma condição explícita para renderizar linhas

O setter do container publica a lista nos seus estados locais **antes** de iniciar EPG:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:303`.

O template escolhe entre loading e views por `channelsLoading()` e `showChannelViews()`. Os mapas de EPG entram como inputs; não aparecem como condição para criar a view.

**Evidências:**

- `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.html:1`
- `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.html:24`

Em `all`, o `cdkVirtualFor` recebe `filteredChannels()`. O programa pode estar ausente e o progresso assume zero:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/all-channels-view/all-channels-view.component.html:72`.

Em `groups`, ocorre o equivalente com `selectedGroupChannels()`:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/groups-view/groups-view.component.html:286`.

Já o callback que atualiza `channelEpgMap` e `channelIconMap` espera as duas consultas:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:542`.

**Conclusão:** a afirmação “a primeira linha não aguarda explicitamente EPG” está correta. A afirmação mais forte “EPG não pode atrasar a primeira linha” não está demonstrada.

### R-03 — `@defer` existe, mas não explica automaticamente o intervalo inteiro

A sidebar está em `@defer (on immediate)`:

**Evidência:** `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.html:36`.

Há também carregamento lazy dos helpers de consulta de EPG:

**Evidência:** `libs/epg/data-access/src/lib/epg-lookup-loader.ts:21`.

Porém, se a M-01 confirmar que as consultas observadas foram iniciadas pelo `fetchEpgForChannels` **dessa instância do container**, então, naquele instante:

- a sidebar e o container já foram instanciados;
- os helpers necessários para emitir aquelas consultas já carregaram.

Nesse cenário, o chunk inicial da sidebar não explica a espera **posterior** à emissão dessas consultas. Ainda seria necessário investigar viewport, agendamento de renderização ou outra dependência.

O desenvolvimento carrega HTTP local; o modo empacotado usa `loadFile`:

**Evidência:** `apps/electron-backend/src/app/app.ts:672`.

Isso não comprova que cada chunk fique aguardando JavaScript do main. Essa causalidade exige trace de recursos e do runtime Electron.

### R-04 — Não há fundamento para atribuir a espera à estabilidade de Zone.js

O app usa `provideZonelessChangeDetection()`:

**Evidência:** `apps/web/src/app/app.config.ts:98`.

Na cópia instalada do CDK consultada, o viewport inicializa medição e estratégia em uma microtask; a atualização usa `markForCheck` e `afterNextRender`:

- `node_modules/@angular/cdk/fesm2022/scrolling.mjs:653`
- `node_modules/@angular/cdk/fesm2022/scrolling.mjs:813`

Essa leitura auxilia o diagnóstico, mas não comprova a versão efetivamente empacotada na M-01.

**Conclusão:** “Promises de EPG impedem `NgZone.onStable`” não deve entrar no discovery como explicação estabelecida.

### R-05 — F-10 confirmado quanto à execução no main; causalidade completa da pintura permanece aberta

Os handlers IPC chamam diretamente o serviço de consultas:

- programas atuais: `apps/electron-backend/src/app/events/epg.events.ts:285`;
- metadata: `apps/electron-backend/src/app/events/epg.events.ts:301`.

O serviço importa `getDatabase` da conexão compartilhada:

**Evidência:** `apps/electron-backend/src/app/events/epg-query.service.ts:18`.

A conexão efetiva usa `better-sqlite3`, cria o handle nativo e o entrega ao Drizzle:

- `libs/shared/database/src/lib/connection.ts:32`
- `libs/shared/database/src/lib/connection.ts:1041`
- `libs/shared/database/src/lib/connection.ts:1075`

**Correção de referência:** `apps/electron-backend/src/app/database/connection.ts` é um reexport, nas linhas 6–14. A linha 1041 pertence à biblioteca compartilhada.

Os mappings dessas consultas também são resolvidos no main:

**Evidência:** `apps/electron-backend/src/app/events/epg-mapping.service.ts:48`.

Portanto, declarar métodos como `async` e usar `await` não desloca a execução nativa de SQL para outro thread. Durante cada execução síncrona, o main não atende seu event loop.

**Limite:** isso comprova o mecanismo capaz de travar o main. A distribuição dos 30 s entre SQL, construção de consultas, resolução de candidatos e transporte ainda precisa do perfil do main. Também não prova que o renderer precise esperar esse trabalho para pintar.

### R-06 — F-11 confirmado, com correções no volume

O container percorre todo o catálogo e deduplica as chaves:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:532`.

A chave segue `tvg-id → tvg-name → name`, com `trim`:

**Evidência:** `libs/m3u-state/src/lib/channel-epg-lookup.util.ts:3`.

Assim, **380 mil itens não comprovam 380 mil chaves únicas**. Os 0,5% com `tvg-id` também não determinam quantos nomes se repetem.

Os tamanhos verificados são:

| Trabalho | Tamanho por bloco | Evidência |
|---|---:|---|
| Mapping manual | 10.000 chaves | `apps/electron-backend/src/app/database/operations/epg-mapping.operations.ts:10` |
| Candidatos XMLTV | 500 chaves | `apps/electron-backend/src/app/events/epg-query.service.ts:49` |
| Programas atuais por ID | Limite de parâmetros menos parâmetros fixos e escopo | `apps/electron-backend/src/app/events/epg-query.service.ts:600` |

Os candidatos usam comparações diretas e `LOWER(id)`/`LOWER(displayName)`:

**Evidência:** `apps/electron-backend/src/app/events/epg-query.service.ts:824`.

Para **380 mil chaves únicas**, uma passagem completa de candidatos representa 760 statements. Não são necessariamente 760 mensagens IPC: o endpoint recebe o array e executa os blocos internamente.

Além disso:

- programas e metadata fazem resolução de mappings separadamente;
- programas procuram candidatos para as chaves ainda sem programa;
- metadata também consulta candidatos;
- fallbacks podem acrescentar passagens;
- o SELECT direto de programas usa blocos próximos de 32 mil IDs, não 500.

**Evidências:**

- `apps/electron-backend/src/app/events/epg-mapping.service.ts:59`
- `apps/electron-backend/src/app/events/epg-query.service.ts:227`
- `apps/electron-backend/src/app/events/epg-query.service.ts:377`

Logo, “38 mappings + 760 candidatos” descreve apenas uma aproximação de parte do trabalho, não o total da abertura.

### R-07 — F-12 parcialmente confirmado: os gatilhos repetem a tentativa, mas programas já têm cache

Os gatilhos encontrados são:

| Gatilho | Evidência no container |
|---|---|
| Alteração das fontes | `channel-list-container.component.ts:261` |
| Alteração do offset | `channel-list-container.component.ts:283` |
| Novo input de canais | `channel-list-container.component.ts:303` |
| EPG disponível, com debounce de 2 s | `channel-list-container.component.ts:480` |
| Timer de 60 s | `channel-list-container.component.ts:490` |

Todos encaminham a lista completa.

Contudo, programas atuais já têm:

- cache por chave e escopo;
- identidade que considera offset;
- TTL de 60 s;
- compartilhamento de lotes idênticos em andamento.

**Evidências:**

- `libs/epg/data-access/src/lib/epg-program-cache.ts:13`
- `libs/epg/data-access/src/lib/epg-program-cache.ts:46`
- `libs/epg/data-access/src/lib/epg-scoped-batch.lookup.ts:37`
- `libs/epg/data-access/src/lib/epg-scoped-batch.lookup.ts:57`

Portanto, **cada gatilho não implica uma consulta completa de programas no banco**. Ainda implica percorrer a lista para preparar as chaves; metadata continua sem cache nesse caminho.

Cancelar a subscription do container impede sua atualização antiga, mas não cancela o SQL. O transporte parte de Promises, e programas compartilham a execução com `shareReplay({ refCount: false })`.

**Evidências:**

- `libs/epg/data-access/src/lib/epg-channel-metadata.lookup.ts:80`
- `libs/epg/data-access/src/lib/epg-scoped-batch.lookup.ts:83`
- `apps/electron-backend/src/app/api/main.preload.ts:772`

Há ainda `timeout(5000)` no lookup scoped de programas. Um timeout pode liberar o consumidor enquanto a operação original continua no main:

**Evidência:** `libs/epg/data-access/src/lib/epg-scoped-batch.lookup.ts:118`.

A segunda chamada aos 39,8 s **não pode ser atribuída ao timer de 60 s sem conhecer sua origem**. Disponibilidade, escopo, substituição do input ou outra instância são candidatos.

### R-08 — F-13 confirmado; B-03 preserva a precedência atual dos logos

O container pede metadata para todas as chaves, sem filtrar por logo:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:547`.

Nesse consumidor, utiliza apenas `metadata.iconUrl`:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:553`.

A resolução visual já prefere `channel.tvg.logo.trim()` e só consulta o mapa XMLTV se esse valor estiver vazio:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-logo-fallback.util.ts:8`.

**Correção do risco de B-03:** nessa lista, deixar de pedir metadata para um item com logo preenchido preserva a precedência atual. Um URL de logo quebrado também já vence o fallback; esta proposta não introduz esse comportamento.

## 2. O que falta provar sobre a primeira pintura

Não encontrei uma espera explícita pelo `forkJoin` no caminho que cria as linhas. **A causa específica dos 37,1 s permanece não demonstrada nesta revisão estática.**

As hipóteses discrimináveis são:

| Hipótese | Medição que confirma ou descarta |
|---|---|
| **H-01 — Os 3,7 s marcam apenas o retorno do IPC; publicação dos canais ocorre depois.** | Marcar separadamente retorno do bridge, fim do parse, emissão final de `getPlaylist`, dispatch de `setChannels` e transição de loading. Se `setChannels` ocorrer perto de 37 s, a espera antecede a view. |
| **H-02 — O main bloqueado atrasa um recurso ou serviço necessário à renderização.** | Correlacionar perfil do main, requests de chunks e seus initiators com criação do container e do viewport. A hipótese exige identificar o recurso/dependência concreta. |
| **H-03 — O viewport existe, mas range ou dimensões atrasam a criação das linhas.** | Registrar dimensões, tamanho da coleção, primeiro range não vazio e primeira inserção de `app-channel-list-item`. Range vazio ou viewport sem altura até 37 s localiza a barreira no layout/CDK. |
| **H-04 — As linhas existem antes, mas a pintura ou sua observação chega depois.** | Instalar previamente `MutationObserver`, amostragem de `requestAnimationFrame` e trace de pintura. Distinguir inserção no DOM, retângulo visível e frame apresentado. Não usar somente o horário em que um comando externo respondeu. |
| **H-05 — A resposta de EPG apenas coincide com, ou provoca indiretamente, uma nova atualização visual.** | Comparar a linha do tempo com EPG desabilitada e verificar se os canais já estavam publicados. Se DOM/range continuarem tardios sem EPG, a hipótese perde força. |

A medição deve capturar os marcos **dentro do renderer**, mantendo-os em memória para coleta posterior. Assim, atraso na coleta não vira artificialmente atraso de criação.

Para M-02, remover só `x-tvg-url` pode ser insuficiente: fontes globais também habilitam EPG.

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:160`.

O teste precisa comprovar ausência das chamadas de programas e metadata. Todas as rodadas devem usar uma única instância e perfil sintético isolado.

## 3. Desenho de B-01 — consultas fora do main

### Encaixe preferencial: worker de banco existente

Minha preferência inicial é reutilizar `DatabaseWorkerClient` e sua conexão. É a alternativa com menor ampliação de infraestrutura e segue o procedimento documentado para operações pesadas.

**Evidência:** `docs/architecture/sqlite-db-worker.md:1245`.

O contrato atual mantém consultas de EPG no main deliberadamente; não proíbe uma migração fundamentada. Ele exclui migrações incidentais **sem evidência de bloqueio**:

**Evidências:**

- `docs/architecture/sqlite-db-worker.md:13`
- `docs/architecture/sqlite-db-worker.md:1235`

A mudança precisaria atualizar essa descrição de ownership.

### Fronteira proposta

Preservar os canais externos:

- `GET_CURRENT_PROGRAMS_BATCH`;
- `EPG_GET_CHANNEL_METADATA`.

O main delegaria a uma operação interna tipada. **A resolução dos mappings, a consulta e o remapeamento das respostas devem acontecer no worker.** Mover apenas `EpgQueryService`, deixando `queryByResolvedChannelIds` no main, preservaria parte do SQL que se pretende retirar.

A operação deve receber dados serializáveis, nunca callbacks. O serviço SQL precisaria receber a conexão como dependência, sem importar o barrel que inicializa o runtime do main.

O worker já dispõe de conexão com WAL e `busy_timeout = 5000`:

**Evidência:** `apps/electron-backend/src/app/workers/database.worker-connection.ts:85`.

### Comparação dos workers

| Alternativa | Ganho esperado | Custo | Risco e critério de escolha |
|---|---|---|---|
| **Worker de banco existente** | Retirar SQL e resolução pesada de candidatos do event loop principal | M | Pode atrasar outras operações do banco. Medir concorrência com leitura de playlist, favoritos e exclusão. |
| Worker de parse EPG | Reutilizar parte do bootstrap | G | Protocolo atual atende fetch/clear, com lifecycle ligado a essas operações. Misturaria consultas interativas e importação. |
| Novo worker de leitura EPG | Isolar consultas tanto do main quanto das operações do worker de banco | G | Nova conexão, lifecycle, bundle, contadores e validação de pacote. Justifica-se se a contenção do worker existente for medida. |

O parser não é hoje um servidor geral de consultas: suas mensagens são `FETCH_EPG`, `FORCE_FETCH`, `CLEAR_EPG` e `CLEAR_EPG_SOURCE`.

**Evidência:** `apps/electron-backend/src/app/workers/epg-parser.worker.ts:60`.

### Superfícies potencialmente tocadas

- `events/epg.events.ts`: delegação e seleção do caminho.
- `events/epg-mapping.service.ts`: extração/reutilização da resolução.
- `events/epg-query.service.ts`: separar consulta SQL da obtenção da conexão.
- `database/operations/`: operações de leitura e remapeamento.
- `workers/database-worker.types.ts` e `workers/database.worker.ts`: requests e dispatch.
- Testes de queries, mappings, transporte e worker empacotado.
- `docs/architecture/sqlite-db-worker.md` e nota em `.changes/`.

Preload e APIs do renderer podem permanecer com a mesma assinatura.

### Kill switch e limites

Nome proposto: `IPTVNATOR_DISABLE_EPG_QUERY_WORKER=1`, selecionando o caminho anterior no main. Não é uma flag existente.

O rollback não deve ser automático a cada falha do worker: isso poderia disparar novamente uma consulta pesada no main. Aplicam-se a remoção em até duas releases e a documentação exigidas pelo contrato:

**Evidência:** `docs/architecture/performance-journeys.md:2044`.

**B-01 não reduz, por si, a quantidade de SQL nem cancela um statement síncrono em execução.** Seu ganho principal é responsividade do main.

### Medição decisiva

Antes da implementação: perfil do main durante a abertura, com contagem e duração agregadas de mapping, candidatos e programas, sem registrar chaves ou URLs.

Na comparação futura: medir atraso do event loop principal, resposta de janela/IPC, tempo total de EPG e tempo de primeira linha. Se apenas a responsividade melhorar, esse é o resultado a declarar; os ganhos não são equivalentes.

## 4. Desenho de B-02 — EPG da janela renderizada

### Onde ligar

As views conhecem a coleção efetivamente ordenada e filtrada:

- `all`: `filteredChannels()`, em `all-channels-view.component.ts:142`;
- `groups`: `selectedGroupChannels()`, em `groups-view.component.ts:399`.

Cada view poderia expor ao container um output com a fatia de canais correspondente ao `renderedRangeStream` do seu `CdkVirtualScrollViewport`. Essa faixa já inclui o buffer de renderização do CDK.

O container passaria a consultar a união das chaves dessa fatia, em lugar de `_channelList`.

**Não basta trocar “playlist inteira” por “grupo selecionado”**: um grupo com 62.755 itens continuaria grande.

Os pontos atuais de integração estão em:

- `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.html:24`
- `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.html:43`

A primeira faixa deve ser emitida mesmo sem scroll. Busca, ordenação e mudança de grupo devem recalculá-la mesmo quando os índices numéricos forem iguais, pois os itens podem ter mudado.

### Cache e concorrência

Reutilizar o cache de programas existente. Para janelas sobrepostas, falta distinguir deduplicação por lote idêntico de deduplicação por chave em voo: hoje, dois lotes parcialmente sobrepostos podem repetir trabalho.

Proposta de comportamento:

- consultar somente chaves ausentes, expiradas ou invalidadas;
- coalescer mudanças rápidas de faixa;
- limitar requisições simultâneas;
- descartar publicação de contexto antigo por revisão;
- limitar retenção do cache para que percorrer toda a lista não acumule centenas de milhares de entradas.

Não reduzir escopo ou normalização de chave a apenas um ID: preservar fontes, offset e invalidações de importação/mapping.

### Timer de 60 s

O timer permanece como gatilho de atualização, mas atua **somente sobre a janela ativa**, deixando o cache decidir quais programas precisam de consulta.

O progresso visual de 30 s pode continuar local:

**Evidência:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:495`.

É preciso aplicar a mesma regra a `favorites` e `recent` e considerar sidebar mais painel fullscreen, evitando que outra instância continue consultando o catálogo inteiro.

### Ganho, risco e medição

- **Ganho esperado:** reduzir de centenas de milhares para dezenas de chaves por janela. A redução exata é `chaves únicas do catálogo ÷ chaves únicas do range`.
- **Custo:** M.
- **Riscos:** faixa inicial ausente, respostas antigas após mudança de grupo, rajadas durante scroll e cache sem limite.
- **Medição prévia:** contar chaves do catálogo, do range e de sua união em cenários sintéticos de abertura, scroll e troca de grupo.
- **Confirmação futura:** SQL e payloads devem acompanhar o range, sem lacunas persistentes de EPG ao navegar.
- **Kill switch proposto:** `IPTVNATOR_DISABLE_VIEWPORT_EPG=1`.

Não é necessário classificar filmes e episódios como inelegíveis para obter esse ganho; isso seria outra mudança de comportamento.

## 5. Desenho de B-03 — metadata apenas quando o logo falta

No container, derivar dois conjuntos a partir da janela:

1. Chaves para programas atuais.
2. Chaves dos itens cujo `tvg.logo?.trim()` está vazio.

Se dois itens compartilham a chave e apenas um não tem logo, a chave entra no segundo conjunto. O item com logo continua usando sua própria imagem.

Com conjunto vazio, não emitir IPC de metadata. O cache de metadata deve guardar acertos e ausências, compartilhar buscas em voo e invalidar quando mudarem fontes, mappings ou dados XMLTV. Esse cache pertence à camada `epg-data-access`, preservando o fallback playlist → fontes globais.

**Evidência do fallback:** `libs/epg/data-access/src/lib/epg-channel-metadata.lookup.ts:25`.

Programas e ícones podem ser publicados independentemente. Isso elimina a espera da atualização de programas pela consulta de metadata; o impacto na primeira pintura continua sujeito à medição descrita anteriormente.

- **Ganho esperado:** remover quase toda a metadata desnecessária nessa lista. Os 99,9% fornecidos sugerem grande redução, mas não determinam a distribuição na primeira janela.
- **Custo:** P para filtrar; M incluindo cache, invalidação e compartilhamento.
- **Risco:** cache de ausência sobreviver a importação/mapping; filtro baseado em presença bruta em vez de `trim`.
- **Medição prévia:** contar itens sem logo e suas chaves únicas por janela, além de tempo e SQL exclusivos de metadata.
- **Kill switch proposto:** `IPTVNATOR_DISABLE_EPG_METADATA_PRUNING=1`.

O timer de programas não precisa atualizar metadata a cada minuto; metadata pode acompanhar invalidação e política própria de expiração.

## 6. Validação aplicável a uma implementação futura

Nada desta seção foi executado.

| Área | Cobertura necessária |
|---|---|
| Semântica SQL | Reutilizar `epg-query.service.spec.ts`, `epg-query.service.sqlite.spec.ts` e testes de mapping; preservar Unicode, precedência, fontes, legado, misses e erros. |
| Transporte B-01 | Correlação de requests, erro/exit do worker, recuperação, shutdown e ausência de SQL no main para ambos os endpoints. |
| Concorrência real | Consultas durante importação EPG e operações do worker de banco, com SQLite real. |
| UI B-02/B-03 | Primeira janela, scroll, busca, ordenação, troca de grupo/fonte/offset, respostas fora de ordem, logos vazios e chaves duplicadas. |
| Regressão da barreira | EPG e metadata pendentes devem permitir linhas antes de resolver suas Promises; comprovar também com CDK real no Electron. |
| Runtime Windows | Abertura sintética grande, responsividade da janela e IPC durante consultas; pacote Windows com carregamento nativo correto. |

Projetos relevantes: `electron-backend`, `components`, `epg-data-access` e `electron-backend-e2e`, conforme os targets e o mapa de validação.

E2E existentes próximos incluem `epg.e2e.ts`, `m3u-epg-import.e2e.ts`, `m3u-epg-panel-refill.e2e.ts`, `playlist-epg-provenance.e2e.ts` e `epg-global-toggle.e2e.ts`.

**Há uma lacuna de benchmark:** J2 `open-source` mede abertura de portal Xtream, não abertura desta lista M3U.

**Evidência:** `docs/architecture/performance-journeys.md:14`.

Assim, os journeys atuais servem como proteção de regressão, mas não comprovam o ganho principal. O contrato manda estabelecer contador antes de otimizar uma lentidão que os journeys não medem:

**Evidência:** `docs/architecture/performance-journeys.md:2038`.

Para este caso, faltam uma medição explícita de abertura M3U até a primeira linha e contadores de chaves/SQL de EPG nessa janela. A escolha formal do journey cabe ao mantenedor.

## 7. Correções recomendadas no discovery consolidado

| Item | Redação sustentada pela revisão |
|---|---|
| **F-10** | Confirmado: queries e mappings dos endpoints de EPG executam SQLite síncrono no main. O perfil deve quantificar o bloqueio e identificar a dependência que adia a primeira pintura. |
| **F-11** | Confirmado: consulta baseada no catálogo inteiro, deduplicado por chave. “760” refere-se a uma passagem SQL de candidatos com 380 mil chaves; não ao total de IPC ou de SQL. |
| **F-12** | Confirmados os gatilhos e a ausência de cancelamento do SQL. Corrigir a repetição incondicional: programas já têm cache de 60 s e compartilhamento de lotes idênticos; metadata não. |
| **F-13** | Confirmado: metadata é pedida mesmo quando o logo M3U já vence no render. B-03 preserva essa precedência na lista. |
| **B-01** | Ganho esperado de responsividade, sem promessa automática de menor duração de EPG ou primeira pintura. |
| **B-04** | O código já permite linhas sem EPG. Antes de propor nova barreira ou removê-la, localizar a dependência indireta ou o atraso de observação. |
| **Meta de 4–6 s** | Hipótese a testar com fronteiras precisas e EPG efetivamente desabilitada. |

**A medição mais discriminante agora é a linha do tempo conjunta de `setChannels`, loading, viewport/range, inserção da primeira linha e frame apresentado, correlacionada ao perfil do main.** Ela resolve a ambiguidade que a coincidência entre resposta de EPG e primeiro elemento observado ainda deixa aberta.