I'll research the market/best-practices track with batched web searches. Starting with IPTV players and Electron IPC.
Strong first batch. Continuing with Electron internals, Windows, SQLite, Angular, and perceived performance.
Now SQLite, Angular, perceived performance, and remaining IPTV players.
Final web batch (remaining players, Windows/GPU, EPG window) plus light repo context for the "fit" section.
Let me pin down specific file:line anchors for the repo-fit section.
Reading the key anchors to ground the recommendations.
A few final verification reads: exact Electron version, existing FTS/queue patterns, and official IPC transferable docs.
One last batch for Windows GPU/hang specifics, then I'll write the report.
# Relatório OPENCODE — PLAN-005 (mercado e boas práticas)

**Data:** 2026-11-24 · **Fase:** discovery (somente leitura) · **Trilha:** mercado, Electron, SQLite, Angular, percepção · **Stack mantido:** Angular + Electron 43 + better-sqlite3 + Nx, foco Windows, carregamento e travamentos.

Não editei nada no repositório, não instalei, não commitei, não abri `tmp/`, `~/.iptvnator` nem dados de provedor. Todas as medições propostas usam fixtures sintéticas servidas em `127.0.0.1`/`example.test`, coerente com o harness já documentado em `docs/architecture/m3u-playlist-module.md:315-329`.

---

## 0. Como ler e qualidade da evidência

- **[Fato]** = verificado em documentação oficial, código-fonte, spec ou benchmark com metodologia publicada; sempre com URL.
- **[Hipótese]** =推断 não verificada neste caso; cada uma tem "como medir" na seção 7 e na seção 9.
- **Qualidade da fonte:** (A) docs/spec/código oficial; (B) benchmark com metodologia e números; (C) fornecedor, blog SEO, fórum, Reddit — tratado como indício, nunca como prova. Vários textos de "players IPTV" de 2026 são claramente conteúdo de marketing/SEO (possivelmente gerado); estão marcados **(C)** e não devem embasar decisão sem medição local.
- Os números de terceiros vêm de macOS/Linux/outras cargas; **não são transferíveis** para o caso Windows/96,5 MB, servem para ordem de grandeza e direção.

**Achado 0.1 [Fato, A]** O app já roda Electron `^43.8.7` (`package.json:277`), versão que **já inclui** o backport `v43.5.0` do PR de performance #52923: IPC na casa dos MB ~1/3 mais barato, chamadas `contextBridge` 25–57% mais baratas, arquivos grandes do ASAR mais rápidos ([releases.electronjs.org/pr/53018](https://releases.electronjs.org/pr/53018), [PR #52923](https://github.com/electron/electron/pull/52923)). Ou seja: **não há ganho pendente "de graça" por upgrade**; o gargalo restante é arquitetural.

---

## 1. Players IPTV com listas grandes (100k–1M entradas)

### Quadro comparativo

| Player | Parse em streaming | Linhas por canal no BD | Índice/FTS | Carga por grupo | Cache entre sessões | EPG por janela | Evidência |
|---|---|---|---|---|---|---|---|
| Kodi IPTV Simple | Não: arquivo inteiro em `std::string`, depois `stringstream` linha a linha | Não (vetores em memória) | Não | Sim (grupos; Kodi PVR) | Sim, arquivo local explícito | Sim, "Kodi só carrega EPG quando precisa" | [A] |
| Hypnotix | Não (arquivo inteiro, regex) | Não | Não | Sim (`show_channels(group.channels)`) | Sim, `~/.cache/hypnotix/providers/` | Não (usa IMDb p/ VOD) | [A/C] |
| Megacubo (Electron) | Parsing em workers, "shortest-job-first" | Índice/banco em workers | Índice de listas | Sim (menu/grupos) | Sim (index/caching) | Parser EPG em worker | [A] |
| Threadfin/xTeVe | Não (split por `#EXTINF` em array) | Não (coleções All/Active/Inactive) | Não | Sim (filtros por grupo) | Sim (agenda de update) | XEPG mapeado | [A] |
| TiviMate | — | Sim, SQLite local (não auditável) | — | Sim (ocultar grupos) | Sim, persistente | Sim: 1/4/12/24 h, "past days", "update on startup" | [C] |
| Channels DVR | — | — | — | Sim, com **limite 750** canais por fonte | — | Guia do DVR | [A/C] |
| Jellyfin Live TV | Guia em uma request só (anti-padrão) | Sim (EF Core/SQLite) | — | Não no web (issue #7603) | Sim | Não (issue #7603 pede paginação) | [A] |
| VLC 3 | Não (preparse de tudo) | Não | Não | Não | — | — | [C] |
| clubTivi (324k testados) | Faseado | IndexedDB/estado | — | Sim (sidebar groups) | Sim (sessão: último canal, scroll) | Sim (~6 h, favoritos) | [A] |

### 1.1 Kodi PVR IPTV Simple Client [Fato, A]

`LoadPlayList()` baixa/carrega o M3U inteiro numa `std::string`, cria um `std::stringstream` e itera linha a linha, acumulando `Channel`/`MediaEntry` em vetores e grupos em memória — **não é streaming de rede nem linhas em SQLite** ([PlaylistLoader.cpp](https://github.com/kodi-pvr/pvr.iptvsimple/blob/a5f312c20643889c2f73334be36bba995280fa6d/src/iptvsimple/PlaylistLoader.cpp)). O README documenta "Cache M3U at local storage", "Cache XMLTV at local storage", auto-refresh (que **desabilita** o cache) e: *"Kodi will only load the EPG data when it needs to"* ([kodi-pvr/pvr.iptvsimple](https://github.com/kodi-pvr/pvr.iptvsimple/)). Medição pública: 169.583 canais parseados em **29,682 ms** e EPG em **15,197 ms**, mas o PVR manager levou **mais de 30 min** para abrir o player — ou seja, o parse não era o gargalo, e sim trabalho por canal a jusante; o próprio tópico aponta que separar VOD em "media/recordings" no v20 "sped things a lot" ([forum.kodi.tv/showthread.php?pid=3130009](https://forum.kodi.tv/showthread.php?pid=3130009)). Guias de mercado corroboram cache local e EPG sob demanda ([iptvwire.org](https://iptvwire.org/iptv-player-for-large-playlists/) [C]).

> **Relevância direta:** no caso real, apenas **1.813 de 380.000** entradas são canais ao vivo (0,48%); 47.989 filmes + 330.571 episódios são VOD. A lição do Kodi v20 é separar o catálogo por tipo antes de qualquer pipeline de UI/EPG.

### 1.2 Hypnotix [Fato, A]

`Manager.load_channels()` parseia o arquivo baixado com regex para `provider.channels/movies/series`, classifica por `group-title` (TV/VOD/SERIES) e a UI só renderiza o grupo clicado: `on_category_button_clicked()` → `show_channels(group.channels)` ([hypnotix.py](https://github.com/linuxmint/hypnotix/blob/master/usr/lib/hypnotix/hypnotix.py)). Cache em arquivos `~/.cache/hypnotix/providers/{slug}` e logos por canal; reload por timer (2 h para Xtream) ([DeepWiki Provider System](https://deepwiki.com/linuxmint/hypnotix/4.1-provider-system), [DeepWiki Content Management](https://deepwiki.com/linuxmint/hypnotix/4-content-management)). Sem BD, sem FTS; EPG é IMDb para VOD ([issue #129](https://github.com/linuxmint/hypnotix/issues/129)).

### 1.3 Megacubo (Electron, Windows) [Fato, A] — o precedente mais próximo do stack

Projeto open source GPL-3.0, Electron no desktop (v17.7.0 usa Electron 44.1.1; 43.x no win x86), Svelte no renderer ([GitHub](https://github.com/EdenwareApps/Megacubo), [finds.dev review](https://finds.dev/repo/EdenwareApps/Megacubo)). Técnicas publicadas nos changelogs:

- v17.6.5: *"Lists loader: reduce download concurrency and implement shortest-job-first parsing by selecting smallest downloaded file first"* ([tags](https://github.com/EdenwareApps/Megacubo/tags)).
- v17.6.9: *"Enhance indexing, caching, database, and worker performance and reliability"*; parser/`ParserFactory`/`multi-worker`/`UpdateListIndex` rejeitam HTML e distribuem parsing em workers ([releases](https://github.com/EdenwareApps/megacubo/releases), [commit 3ba5281](https://github.com/EdenwareApps/Megacubo/commit/3ba5281ba13de2ca17e110f167131a19ae1e5f9f)).
- v17.7.0: *"Worker memory: zero-copy emitBinary ... Support binary events across multiple workers"* ([releases](https://github.com/EdenwareApps/megacubo/releases)).
- v17.5.0: troca de jQuery por Svelte *"Boosted startup speed and trimmed memory usage"*; v17.5.5: OffscreenCanvas em vez de Jimp ([tags](https://github.com/EdenwareApps/Megacubo/tags)).
- v17.6.4: *"Added a 'Back to top' button for long lists"* — reconhecimento explícito de listas longas ([releases](https://github.com/EdenwareApps/megacubo/releases)).

**Leitura:** o concorrente Electron resolve 324k–380k com **índice construído em worker + eventos binários + UI leve**, não com um documento JSON inteiro atravessando o IPC. [Hipótese H1]: um índice persistido entre sessões é o que permite "primeiro bloco < 1 s" (medição na seção 7/P2).

### 1.4 Threadfin / xTeVe [Fato, A]

Parser divide o conteúdo por `#EXTINF`, gera `tvg-id` por MD5 da URL quando ausente e guarda tudo em array estruturado; `buildDatabaseDVR()` produz `Data.Streams.All/Active/Inactive`, aplica filtros por `group-title` e gera M3U só com canais ativos ([DeepWiki Playlist Management](https://deepwiki.com/Threadfin/Threadfin/3.2-playlist-management), [xTeVe M3U](https://deepwiki.com/xteve-project/xTeVe/3.1-m3u-playlist-management)). Há **limites explícitos**: `System.UnfilteredChannelLimit` e `PlexChannelLimit` = 480 por padrão, com avisos ao ultrapassar, e recomendação de agendar updates de playlists grandes em horários de baixo uso e **evitar updates frequentes** ([Threadfin docs](https://docsearch.algolia.com/mcp/docs/repo/threadfin/threadfin), [DeepWiki](https://deepwiki.com/xteve-project/xTeVe/3.1-m3u-playlist-management)). Buffer em RAM, não em arquivo ([GitHub](https://github.com/Threadfin/Threadfin)).

### 1.5 TiviMate / OTT Navigator [Fato C — indício, não prova]

Fontes de fornecedor/comunidade descrevem: **SQLite local** para playlist + EPG, cache persistente entre reinícios, intervalo de update configurável (1/4/12/24 h), opção "Update on startup", "Past days to keep", tamanho de cache 100–200 MB, ocultação de grupos — com o detalhe importante de que **grupos ocultos ainda custam overhead** e que escritas de EPG concorrendo com leituras da UI causam *"Database locked"/UI lag* ([iptvwire.org](https://iptvwire.org/iptv-player-for-large-playlists/), [tivimateplayer.co.uk](https://tivimateplayer.co.uk/tivimate-epg-not-updating-fixes/), [dualiptv](https://www.dualiptv.com/guide/epg-caching-tivimate), [r/TiviMate](https://www.reddit.com/r/TiviMate/comments/1hfmcqs/epg_database_and_hidden_groupschannels/), [r/TiviMate large scale](https://www.reddit.com/r/TiviMate/comments/1pk04wm/large_scale_playlist_issues/)). A v5.3.0 Beta anuncia *"Improved processing of large playlists"* ([r/TiviMate](https://www.reddit.com/r/TiviMate/comments/1tbfset/tivimate_530_beta_premium_update/)). XMLTV grande (100 MB+ descomprimido) é apontado como causa de OOM em dispositivos de 1–1,5 GB ([tivimateplayer.co.uk](https://tivimateplayer.co.uk/tivimate-epg-not-updating-fixes/)).

### 1.6 Channels DVR [Fato, A]

Documentação oficial impõe **limite de 750 canais por fonte M3U** e declara: *"we do not provide technical support for large IPTV sources"*, recomendando filtrar a lista com M3U4U ([getchannels.com/docs](https://getchannels.com/docs/channels-dvr-server/how-to/custom-channels/)). O ecossistema open source confirma a estratégia de **fatiar**: `channelforge` mantém estado em SQLite, usa índice O(1) para regras de match e *"chunked M3Us ... default 1200 channels per file because Channels DVR handles several medium playlists better than one giant one"* ([channelforge](https://github.com/Eagle383/channelforge)); `iptv-catalog` achata 40k canais em tabela SQLite local e serve M3U/XMLTV por playlist ([zackwag/iptv-catalog](https://github.com/zackwag/iptv-catalog)).

### 1.7 Jellyfin Live TV [Fato, A] — evidência mais forte para A-02

- **#7603 (web):** com ~870 canais, o guia faz **uma** request `GET /LiveTv/Programs` que devolve **2.138 programas / 1,27 MB em ~9 s**; o Emby faz 2 requests, a primeira com `Limit=25` (só o visível) e a segunda para 13 IDs específicos, e renderiza "basically instantly". O issue pede explicitamente paginação, lazy loading no scroll e端点 combinado ([jellyfin-web#7603](https://github.com/jellyfin/jellyfin-web/issues/7603)).
- **#10947:** 2.700+ canais, XMLTV de 24 MB gz / 200 MB descomprimido → **> 2 h** de refresh; em 10.11.2, **10–12 h**, contra 1–2 min em apps Android ([jellyfin#10947](https://github.com/jellyfin/jellyfin/issues/10947)). **#7164:** o parser duplicava o XML baixado **para cada canal** ([jellyfin#7164](https://github.com/jellyfin/jellyfin/issues/7164)).
- **PR #17476** (fechado por política de contribuição, não por mérito técnico) lista as causas: `Contains` em `Guid[]` (O(n·m)) → `HashSet`, query de programas existentes mesmo para canais sem EPG, re-persistência e re-download de logo **de todos os canais a cada refresh**, e dois `LogInformation` por canal ("tens of thousands of lines"). Propõe `PreCacheGuideImages=false` (imagens lazy) e só salvar canais que mudaram: *"a large refresh completes in minutes"* ([jellyfin#17476](https://github.com/jellyfin/jellyfin/pull/17476)).
- **Tentacle** (tuner open source para Jellyfin) documenta **two-phase sync**: "Phase 1 (fetching groups) gets just the group list with channel counts — this is fast. Phase 2 fetches the actual channels for enabled groups only", EPG em cache de disco por 8 h, e a constatação de que 7 tuners × 1.734 canais > 1 h de refresh contra ~2 min para **uma lineup** de 5.669 ([jellyfin-tentacle docs](https://lucas-romanenko.github.io/jellyfin-tentacle/features/live-tv/)).

> **Achado 1.7 [Fato]:** "mandar todos os IDs de cada vez e repetir a cada 60 s" é um anti-padrão documentado com números em projeto open source do mesmo domínio. É o suspeito mais bem respaldado da lista do briefing.

### 1.8 VLC / IPTV Smarters [Fato C — o anti-padrão]

VLC 3.0.12 levava **> 5 min** para abrir um M3U de 50.000 entradas / 14,5 MB; desenvolvedor: *"This is normal in VLC v3. It will behave correctly and a lot faster in v4"* — e usuário confirma em 2023 que 26k canais carregam "quase instantaneamente" no v4, desligar "Automatically preparse items" não ajudava ([forum.videolan.org](https://forum.videolan.org/viewtopic.php?t=156744)). Documentação da Smarters diz que VLC **crasha com listas > 10.000 itens** e recomenda reduzir canais/VOD ([iptv.smarters.pro](https://iptv.smarters.pro/setup-install-vlc-player/)); guias recomendam dividir playlists grandes em arquivos < 200 entradas e citam 100.000+ linhas excedendo limites de memória ([edgeiptv.ca](https://edgeiptv.ca/how-to-choose-between-vlc-and-iptv-smarters-for-playlist-playback/), [smartertv.live](https://smartertv.live/blog/en/iptv-windows-pc-macos-setup)). Guia de mercado resume: *"A player that renders the visible part of the list first and fills in the rest as you scroll will open a 40,000-channel list almost instantly, while one that builds the entire grid before showing anything will sit frozen"* ([mtivi.app](https://mtivi.app/iptv-player-large-playlist/) [C]).

### 1.9 Padrão "primeiro bloco + janela" em código aberto [Fato, A]

- **clubTivi:** *"324K+ channels tested — handles massive playlists with instant startup via phased loading"*: *"favorites and providers load first (Phase 0), everything else loads in background"*, sequência *"splash → favorites → sidebar groups → EPG → full channel list"*, *"Lazy EPG loading — guide data fetched only for visible/favorite channels first"*, *"Session persistence — remembers your last channel, scroll position, and sidebar state"* ([clubanderson/clubTivi](https://github.com/clubanderson/clubTivi)).
- **ThunderTV phase 18:** guia deliberadamente limitada a **favoritos × janela fixa de ~6 h**, "cells materialized for the visible window only", uma query `IDBKeyRange.bound` por favorito por mudança de janela, cache LRU por canal compartilhado, shifts throttled por `requestAnimationFrame`, tripwire se o número de células estourar ([ThunderTV phase-18](https://github.com/D-dezeeuw/ThunderTV/blob/main/masterplan/phases/phase-18-epg-guide-and-mapping.md)).
- **iptv-org/epg PR #3298:** o parser re-parseava o arquivo de 100 MB **para cada canal e cada dia**; indexar por canal uma vez reduziu, num fixture de 12 MB com 20 canais × 2 dias, **47,5 s / 946 MiB → 0,5 s / 318 MiB**, saída idêntica ([PR #3298](https://github.com/iptv-org/epg/pull/3298)). É o análogo exato do suspeito "leituras duplicadas do documento inteiro".

---

## 2. Electron: custo de dados grandes do main ao renderer

### 2.1 O mecanismo [Fato, A]

`ipcRenderer.invoke`/`send` serializam argumentos e resultados com o **Structured Clone Algorithm**, "prototype chains will not be included" ([docs/api/ipc-renderer.md](https://github.com/electron/electron/blob/main/docs/api/ipc-renderer.md), [webContents.send](https://www.electronjs.org/docs/latest/api/web-contents)). O `contextBridge` é pior: a doc oficial diz *"Function values are proxied ... and all other values are copied and frozen"* ([contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)); o código confirma cópia **propriedade a propriedade** — `CreateProxyForAPI()` itera `GetOwnPropertyNames` e faz `CreateDataProperty` por chave, `DeepFreeze()` congela recursivamente cada objeto, com limite de 1000 níveis de recursão ([electron_api_context_bridge.cc](https://github.com/electron/electron/blob/main/shell/renderer/api/electron_api_context_bridge.cc)). Primitivos (string/number/boolean) passam **direto, sem cópia** — *"this is significantly more performant than copying them"* ([PR #24531](https://github.com/electron/electron/pull/24531), comentário no fonte). Issue #41511 (Windows 11, Electron 25): *"function calls through contextBridge actually involve parameter passing by copying, this leads to poor performance in scenarios with large amounts of data"*, 10 ms para um ArrayBuffer de 8 MB, com workaround `window.postMessage` ([electron#41511](https://github.com/electron/electron/issues/41511)).

> Isso explica **por que a A-01 funcionou**: trocar um grafo de 380k objetos por uma string primitiva remove a cópia por propriedade + freeze + structured clone. [Fato, A] `docs/architecture/m3u-playlist-module.md:305-313` registra 107 s → 4 s de worker + 3,5 s IPC + 1,3 s `JSON.parse`, com `dbGetAppPlaylistJson` em `apps/electron-backend/src/app/api/main.preload.ts:900-903` e `readDocumentPlaylist` em `libs/services/src/lib/playlist-storage-backend.ts:131-145`.

### 2.2 Números públicos [Fato, B]

Benchmark de nov/2026, Electron **45.2.3** (já com as melhorias do #52923), macOS M1 Pro, payload idêntico de 50 MiB / 201.331 linhas, mediana de 5 chamadas, tempo até o array parseado na página ([wolinski.com](https://wolinski.com/blog/tauri-vs-electron-ipc-memory.html)):

| Rota Electron | 1 MiB | 10 MiB | 50 MiB | Pico de RAM da página (50 MiB) |
|---|---:|---:|---:|---:|
| Objeto via `invoke` (parse no main) | 16 ms | 127 ms | **652 ms** | 617 MiB |
| **String + `JSON.parse` na página** | 4,8 ms | 33 ms | **108 ms** | 600 MiB |
| `Buffer`/`Uint8Array` | 7 ms | 45 ms | 128 ms | 709 MiB |
| `protocol.handle` + `fetch` | 7,2 ms | 174 ms | 178 ms | 452 MiB |
| Parse no main + **só as primeiras 100 linhas** | 7,6 ms | 20 ms | 102 ms | **22 MiB** |

Achados do mesmo estudo: com `contextIsolation` desligado, o objeto cai de 652 → **301 ms** (> metade do tempo era a cópia do `contextBridge`); o backend que já tem as linhas gasta 567 ms devolvendo objeto vs **144 ms** com `JSON.stringify`; entregar 50 MiB de bytes levou 32 ms e o `JSON.parse` 74 ms (V8) — *"the page needs objects, and JSON text becomes objects only by parsing ... the rule that covers all of it is to serialise once"*; *"never return a large object through Electron IPC; return its JSON text and parse it where you need it"*; em todas as rotas que enviam o array inteiro, **50 MiB de texto viraram 309–914 MiB de pico no renderer** (texto + cópia decodificada + objetos + lixo do parser). Benchmark independente de markdown no Electron 42 mede o "IPC tax": +6,5 ms com objeto profundo vs **+2,9 ms com string** ([inkdropapp/markdown-parser-benchmark](https://github.com/inkdropapp/markdown-parser-benchmark)).

**PR #52923 (presente no 43.8.7):** 1 MB round-trip 4,2 → 2,8 ms; 4 MB 14,2 → 9,2 ms; chamadas bridge 25–57% mais baratas; chamadas vazias 0,30 → 0,13 µs; lista de 400 itens 757 → 684 µs; arquivo de 16 MB do ASAR 35 → 22 ms; first contentful paint 633 → 452 ms ([PR #52923](https://github.com/electron/electron/pull/52923), [releases.electronjs.org/pr/52923](https://releases.electronjs.org/pr/52923), [backport 43 v43.5.0](https://releases.electronjs.org/pr/53018)). **Ainda assim, no Electron 45 o objeto é 6× mais lento que a string.**

### 2.3 `ArrayBuffer`, `MessagePort`, `MessageChannelMain`, `utilityProcess` [Fato, A — com uma correção importante]

- **Correção a blogs:** `ipcRenderer.postMessage(channel, message, transfer)` aceita **`MessagePort[]`** e `webContents.postMessage` aceita **`MessagePortMain[]`** — **não `ArrayBuffer`**. A spec oficial tem teste que **lança "Invalid value for transfer" ao passar um `ArrayBuffer`** ([ipc-renderer.md](https://github.com/electron/electron/blob/main/docs/api/ipc-renderer.md), [web-contents docs](https://www.electronjs.org/docs/latest/api/web-contents), [spec/api-ipc-spec.ts](https://github.com/electron/electron/blob/c16c6da2/spec/api-ipc-spec.ts), [tutorial/message-ports.md](https://github.com/electron/electron/blob/main/docs/tutorial/message-ports.md)). Artigos que afirmam "zero-copy de ArrayBuffer via `postMessage` no Electron" ([vpawar.hashnode](https://vpawar.hashnode.dev/electron-ipc-deep-dive-main-preload-renderer), [mibeon.com](https://mibeon.com/docs/electron/ipc/messageport/)) descrevem a semântica da **Web平台**, não a implementação Electron → **[Hipótese descartada]**.
- **Issue #34905** (aberto desde 2022, comentário em 2026): transferir ArrayBuffer de renderer → main perde os dados; nornagon: *"we currently only support transferring ports"* e *"The data is copied either way, and there's no way to use shared memory between processes. I don't think this is more performant than not 'transferring' the buffer"*. Relato de 2026: enviar **98 MB** de buffer enquanto o usuário digita **causa freezes**, com workaround de streaming em chunks ([electron#34905](https://github.com/electron/electron/issues/34905), [PR #22404](https://github.com/electron/electron/pull/22404)).
- **`MessagePort` ainda vale** para streaming/chunking e para evitar o round-trip pelo main: benchmark com 16 cenários mede MessagePort ~**40% mais rápido** que `ipcRenderer` para payloads binários grandes e **>2× para JSON de 500 kb** ([johnnyd710/electron-ipc-tests](https://github.com/johnnyd710/electron-ipc-tests)); canal direto renderer↔renderer sem passar pelo main ([tutorial/message-ports.md](https://github.com/electron/electron/blob/main/docs/tutorial/message-ports.md)).
- **`utilityProcess`:** doc oficial recomenda para *"untrusted services, CPU intensive tasks or crash prone components"*, com `MessagePort` para renderers ([Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)). A doc de performance: *"Under no circumstances should you block this process"*, usar worker threads / evitar IPC síncrono / `fs` assíncrono; no renderer, `requestIdleCallback` e Web Workers ([Performance](https://www.electronjs.org/docs/latest/tutorial/performance)). **Ressalva crítica:** `docs/tutorial/multithreading.md` diz que módulos nativos em Web Workers **não são seguros** (`process.dlopen` não é thread-safe) ([multithreading.md](https://github.com/electron/electron/blob/main/docs/tutorial/multithreading.md)) — logo `better-sqlite3` deve ficar em `worker_threads`/`utilityProcess`, **nunca em Web Worker do renderer**. O arranjo atual do app (worker thread com better-sqlite3) é o correto; não é necessário trocá-lo.

---

## 3. Electron no Windows: travamento e lentidão com muitos dados

### 3.1 Windows Defender / ASAR [Fato, A/B]

- **#29868** (Win10, Electron 13): o primeiro arquivo referenciado pelo `index.html` levava **1.775 ms** e os seguintes 0–1 ms; desligar a proteção em tempo real eliminou o atraso; workaround = pasta do app na lista de exclusão; **assinar o binário não resolveu** ([electron#29868](https://github.com/electron/electron/issues/29868)). StackOverflow mede **2.800 ms → 500 ms** ao desligar RTP ([SO 67982430](https://stackoverflow.com/questions/67982430/windows-defender-slowing-down-electron-startup)); benchmark de 2026: app mínimo 2,8 → 1,5 s, app real 8,2 → 3,5 s, ~1.200 eventos de scan, 145 → 82 MB de I/O, com `app.asar` e `node_modules` entre os mais escaneados ([javascriptroom.com](https://www.javascriptroom.com/blog/windows-defender-slowing-down-electron-startup/) [B/C]).
- **Microsoft (A):** binários não assinados disparam scan de RTP a cada execução; *"Using HTA's, CHM's and different files as databases. Anytime that Microsoft Defender Antivirus must extract and/or scan complex file formats, higher CPU utilization can occur"*; exclusions de processo+path como workaround; validar com `MpCmdRun.exe -CheckExclusion -Path`; mesmo com exclusão de path, **Behavior Monitoring e Network Inspection ainda podem causar problemas** ([troubleshoot-performance-issues](https://learn.microsoft.com/en-us/defender-endpoint/troubleshoot-performance-issues), [exclusions overview](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-antivirus-exclusions-overview)). Ferramenta oficial de medição: `New-MpPerformanceRecording` + `Get-MpPerformanceReport -TopFiles 3 -TopScansPerFile 10` ([performance analyzer](https://learn.microsoft.com/en-us/defender-endpoint/tune-performance-defender-antivirus)).
- **ASAR:** além do #52923 (lookups 5,3 → 1,3 µs; 393 → 347 ms), relato de 2026 mostra **1.600 arquivos não usados** empacotados no ASAR fazendo o Electron indexar milhares de arquivos no boot ([Electron.NET#1024](https://github.com/ElectronNET/Electron.NET/issues/1024)).
- **Limite de escopo [Hipótese H6]:** tudo isso é **startup**, não o intervalo "clique → primeiro canal" de 29,6 s. Medir antes de culpar o AV (seção 7/P8).

### 3.2 `backgroundThrottling` [Fato, A]

`webPreferences.backgroundThrottling` (default `true`) *"throttle animations and timers when the page becomes background"* ([WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)); `--disable-renderer-backgrounding` impedeChromium de baixar prioridade de páginas invisíveis ([command-line-switches](https://www.electronjs.org/docs/latest/api/command-line-switches)). Issue #9567: `requestAnimationFrame` é fortemente throttled em background mesmo com a flag; nornagon recomenda `setInterval`/`setTimeout` + `disable-background-timer-throttling`, com relatos divergentes até 2024/2026 ([electron#9567](https://github.com/electron/electron/issues/9567)); pedido para mudar o default foi **wontfix** ([electron#28672](https://github.com/electron/electron/issues/28672)). **[Hipótese H5]:** o `setInterval` de 60 s de EPG (`channel-list-container.component.ts:490-493`) e uma carga progressiva em background podem ser throttled/pausados com a janela oculta, empilhando lotes ao voltar — medir com `visibilitychange` + contadores.

### 3.3 GPU [Fato, A]

- Electron 38+ no Windows: `app.disableHardwareAcceleration()` não anexava `--disable-gpu`; o processo GPU seguia usando **~10,7% de GPU e ~375 MB de memória GPU**. Corrigido no PR #51817 e **backportado para 43-x-y** (portanto presente no 43.8.7). WebGL em software cai no **D3D11 WARP (CPU)** desde o Electron 40 e aparece como "GPU" no Task Manager ([PR #51817](https://github.com/electron/electron/pull/51817), [issue #51363](https://github.com/electron/electron/issues/51363)).
- Falhas do processo GPU derrubam apps inteiros no Windows: *"GPU process isn't usable. Goodbye."* no Win11 25H2 + AMD RX 9070 afetando Obsidian, Signal e Discord ([electron#52255](https://github.com/electron/electron/issues/52255)); Electron 16 com janelas em branco em várias GPUs ([electron#32440](https://github.com/electron/electron/issues/32440)). **[Hipótese H7]:** parte dos "travamentos" relatados pode ser ambiental (GPU/Driver), não tamanho de dados — medir eventos `gpu-process-crashed` / `render-process-gone`.

### 3.4 Heap do V8 e GC [Fato, A/B]

- `jsHeapSizeLimit` ~**3,76 GB** em 64-bit; nornagon: o limite é ~`min(system_memory/2, 2GB)` (4 GB com ≥16 GB) e **pointer compression impede passar de 4 GB**, então `--max-old-space-size` **só reduz**, não aumenta ([electron#22705](https://github.com/electron/electron/issues/22705), [SO 68546611](https://stackoverflow.com/questions/68546611/increase-javascript-heap-memory-in-electron-renderer-process), [SO 43643406](https://stackoverflow.com/questions/43643406/raise-chrome-js-heap-limit)). Há relato de **OOM com apenas 319 MB usados de 2.144 MB** ([electron#37214](https://github.com/electron/electron/issues/37214)) e de flags conflitantes anulando o `--js-flags` ([electron#41248](https://github.com/electron/electron/issues/41248)). Conclusão prática: **aumentar heap não é solução**.
- GC: *"marking of the whole heap potentially taking more than 100 ms for large web applications"*; maior GC tem finalização atômica de vários ms; *"when we allocate a lot of long-living objects, we pay a high cost to copy these objects"*; incremental/concurrent marking e idle-time GC reduzem pausas, mas **70–85% do trabalho só migra para idle**, não desaparece ([v8.dev/blog/trash-talk](https://v8.dev/blog/trash-talk), [CACM idle-time GC](https://cacm.acm.org/practice/idle-time-garbage-collection-scheduling/), [v8.dev free-garbage-collection](https://v8.dev/blog/free-garbage-collection)). **[Hipótese H4]:** 380k objetos de longa vida no renderer amplificam GC e pico de heap mesmo sem OOM; o "45,6 s idle" do perfil pode esconder trabalho de clone/GC no main/worker. Medir com `performance.memory` + heap snapshot CDP.

---

## 4. SQLite com better-sqlite3 para catálogos grandes

### 4.1 Biblioteca, WAL e worker [Fato, A/B]

O README oficial: API síncrona, *"Worker thread support (for large/slow queries)"*, *"it is generally important to set the WAL pragma"*, ~**2.000 queries/s com joins de 5 vias em BD de 60 GB**, e *"If you have a performance problem, the most likely causes are inefficient queries, improper indexing, or a lack of WAL mode — not better-sqlite3 itself"*. Também alerta: **não é apropriado para "high volume of concurrent reads each returning many megabytes of data"** ([WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3?tab=readme-ov-file)) — descrição exata do `playlists.payload` de 96,5 MB. WAL: *"readers do not block writers and a writer does not block readers"*, mas **leitura degrada conforme o WAL cresce**, e leitores concurrentes sobrepostos causam *checkpoint starvation* ([sqlite.org/wal.html](https://sqlite.org/wal.html)); `better-sqlite3` recomenda `wal_checkpoint(RESTART)` quando o `-wal` passa de um limite e usa `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` (NORMAL) por padrão ([docs/performance.md](https://github.com/vazra/better-sqlite3/blob/HEAD/docs/performance.md)).

Benchmark com `worker_threads` + better-sqlite3 (51.898 linhas, uma conexão read-only por thread, `cache_size=-32000`, `temp_store=MEMORY`, `mmap_size=1GB`, `query_only=ON`): **2 processos × 1 worker = 8.274 QPS** é o melhor; 2 × 8 workers cai para **1.629 QPS** — *"Adding workers beyond available cores produces diminishing returns and eventually regressions"* ([dev.to/lovestaco](https://dev.to/lovestaco/scaling-sqlite-with-node-worker-threads-and-better-sqlite3-4189)). [Fato] `PRAGMA`s úteis: `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size` (negativo = KiB), `temp_store=MEMORY`, `mmap_size`, `page_size`, `query_only=ON`, `ANALYZE` + `PRAGMA optimize` ([sqlite.org/compile.html](https://www.sqlite.org/compile.html), [dev.to](https://dev.to/lovestaco/scaling-sqlite-with-node-worker-threads-and-better-sqlite3-4189)).

### 4.2 Paginação por keyset [Fato, B com números]

`OFFSET n` exige percorrer n linhas: custo **proporcional à profundidade**. Em SQLite com 1.000.000 de linhas e índice `(created_at DESC, id DESC)`: 10.000 → 0,22 ms, 990.000 → **18,9 ms** com OFFSET vs **0,03 ms** com keyset ([syedtasavour.com](https://syedtasavour.com/journal/keyset-pagination-vs-offset-sql)). Outro benchmark com 900.540 eventos, página de 100: 0,09 ms → **22,83 ms** no OFFSET 800.000, keyset **0,10 ms** em todas as profundidades, e `COUNT(*)` sozinho **20,98 ms** ([sxz.io](https://sxz.io/keyset-cursor-pagination-fastapi-sqlite-tutorial/)). Regras: chave de ordenação **determinística e única** (tiebreaker `id`), índice composto na mesma ordem, `EXPLAIN QUERY PLAN` deve mostrar `SEARCH` e não `SCAN`, e cursores são amarrados à ordenação ([use-the-index-luke.com](https://use-the-index-luke.com/sql/partial-results/fetch-next-page), [sxz.io](https://sxz.io/keyset-cursor-pagination-fastapi-sqlite-tutorial/)). Trade-off: **não dá para pular para a página N** e o total exige `COUNT` separado — relevante para decidir UI de scroll infinito vs páginas numeradas.

### 4.3 FTS5 [Fato, B com números e custo]

`LIKE '%term%'` é scan linear (~**10 ms por 100k linhas** por coluna, pior justamente quando o termo é raro) ([dev.to/maptosite](https://dev.to/maptosite/five-indexes-five-different-answers-what-a-two-character-search-query-costs-in-sqlite-and-d1-ea5)). FTS5 com `tokenize='trigram'` indexa substring e `LIKE`/`GLOB`: em **18,2 M** de linhas, 1,75 s → **10–30 ms (50–100×)**, mas o índice custou **191 s de build + 50 s de VACUUM** e o BD foi de ~1,3 para **3,7 GiB (~3×)** ([andrewmara.com](https://andrewmara.com/blog/faster-sqlite-like-queries-using-fts5-trigram-indexes), [sqlite.org/fts5.html](https://sqlite.org/fts5.html)). Em 1 M de produtos: FTS5 `MATCH` 0–64 ms vs `LIKE` 127–189 ms, com **diferenças semânticas** entre engines ([pilotbase.pro](https://pilotbase.pro/articles/full-text-search-postgres-tsvector-mysql-fulltext-sqlite-fts5)). Limitação: substring com **menos de 3 caracteres** não casa no trigram ([fts5.html](https://sqlite.org/fts5.html), [dev.to](https://dev.to/maptosite/five-indexes-five-different-answers-what-a-two-character-search-query-costs-in-sqlite-and-d1-ea5)).

> **[Fato, encaixe]:** o repositório **já tem o padrão correto** para índice grande: `apps/electron-backend/src/app/workers/content-title-fts-build.ts:17-23` constrói FTS em **lotes de 5.000** (~20–60 ms cada), cede ao worker entre lotes, retoma de cursor após crash, mantém índice live até o swap e atrasa o início em 3 s para não competir com as primeiras leituras (`:7-15`, `:45-60`). Replicar para canais M3U é extensão, não invenção.

### 4.4 Inserção em lote [Fato, B com números]

| Variante | Linhas/s |
|---|---:|
| Autocommit, journal DELETE, `synchronous=FULL` | **500** |
| Autocommit, WAL + `synchronous=NORMAL` | 88.569 |
| **1 transação**, statement preparado reutilizado | 1,6–1,8 M |
| 1 transação, `INSERT` multi-row (500 linhas) | **3,07 M** |
| `journal=OFF`/`sync=OFF` (inseguro) | 1,9 M |

Fontes: [zeroexp.dev benchmark](https://zeroexp.dev/library/sqlite-insert-transactions-benchmark), [zeroexp better-sqlite3 vs node:sqlite](https://zeroexp.dev/library/sqlite-better-sqlite3-node), [voidstar.tech](https://voidstar.tech/sqlite_insert_speed/), [better-sqlite3#125](https://github.com/JoshuaWise/better-sqlite3/issues/125), [avi.im](https://avi.im/blag/2021/fast-sqlite-inserts/). Regras: preparar **uma vez**, uma transação, lotes de ~1.000 mantêm o write lock < 100 ms, e **cada índice extra encarece todos os inserts**. **[Hipótese H3]:** migrar 380k entradas para linhas é questão de segundos, não minutos — medir com fixture sintética antes de desenhar a A-03.

---

## 5. Angular com listas enormes

**[Fato, A]** `cdk-virtual-scroll-viewport` + `*cdkVirtualFor` renderizam **apenas os itens visíveis**, simulando a altura total; aceitam `Array`, `Observable` ou `DataSource`; suportam `trackBy`, **view recycling** via `templateCacheSize`, e buffers `minBufferPx`/`maxBufferPx` ([angular/components scrolling.md](https://github.com/angular/components/blob/main/src/cdk/scrolling/scrolling.md)).

**[Fato, A]** Issue #22109: com 1–2 M de itens, o virtual scroll degradava porque, **em dev mode**, o `devModeEqual` faz deep-check do array de input a cada ciclo (75% do tempo); `enableProdMode()` levou o frame de **~122 ms → ~1,2 ms** e `OnPush` também resolve ([angular/components#22109](https://github.com/angular/components/issues/22109)).

**[Fato, B]** *"OnPush components and signals reduce how often you render. They don't reduce how much you render. With 100,000 rows, the problem is the number of nodes, not change detection. Only virtualization, pagination or loading in chunks solves it."* Pitfalls: viewport **precisa de altura**, `itemSize` deve ser exato, `trackBy` com referência estável (campo da classe, não arrow inline), `checkViewportSize()` quando o contêiner muda ([angularatlas.dev](https://angularatlas.dev/virtual-scroll), [nxhhuy.tech](https://nxhhuy.tech/en/blog/angular/virtual-scrolling)). Padrão com signals: manter **janela/cache** ao redor do viewport, `prefetch` à frente/atrás, páginas lazy ([AngularUX 200k rows](https://blog.angularux.com/blog/data-virtualization-in-angular-20-smooth-200krow-tables-with-angular-material-an)). OctoPerf mede **0,01 ms por change detection** e 3,4 ms por update com `BehaviorSubject` + `*cdkVirtualFor` em 100k itens ([blog.octoperf.com](https://blog.octoperf.com/angular-performance-optimization---virtual-scroll/)).

**[Fato, A]** Para trabalho em background no renderer, a doc Electron recomenda `requestIdleCallback()` e Web Workers; mas **módulos nativos não devem entrar em Web Worker** ([Performance](https://www.electronjs.org/docs/latest/tutorial/performance), [multithreading.md](https://github.com/electron/electron/blob/main/docs/tutorial/multithreading.md)). Busca em Web Worker deve operar sobre dados JS ou delegar ao worker thread de BD via IPC — nunca abrir `better-sqlite3` no renderer.

**[Hipótese H2]:** manter 380k objetos na store é o amplificador de memória/GC e de change detection; medir tamanho retido em heap snapshot antes/depois de paginar.

---

## 6. Percepção de velocidade

**[Fato, A]** RAIL: **0–100 ms** = resultado imediato; **100–1000 ms** = progressão natural; **> 1 s** o usuário perde o foco na tarefa; **> 10 s** abandona. Meta: *"deliver the first meaningful paint in under 1 second"*, priorizando o caminho crítico e **deferindo o não essencial para idle/lazy** ([Smashing Magazine RAIL](https://www.smashingmagazine.com/2015/10/rail-user-centric-model-performance/), [web.dev/articles/rail](https://web.dev/articles/rail), [MDN How long is too long](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_long_is_too_long)).

**[Fato, A]** MDN: *"it is usually better to provide a quick response and regular status updates than make the user wait until an operation fully completes"*; *"download the content the user is going to interact with immediately first, and download the rest after 'in the background'"* ([MDN Perceived performance](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/Perceived_performance)). NNGroup: skeleton screens para esperas **< 10 s**, **progress bars acima de 10 s** (com estimativa), e **nenhum indicador se < 1 s** (o flash incomoda) — para 29,6 s, skeleton sozinho é insuficiente: precisa de **conteúdo real + progresso com estado** ([nngroup.com](https://www.nngroup.com/articles/skeleton-screens/)).

**[Fato, A]** Padrão "último grupo/favoritos/recentes primeiro + carga faseada + persistência de sessão" existe em código aberto para 324k canais (clubTivi, seção 1.9) e em guia limitado a favoritos × janela de ~6 h (ThunderTV). **[Fato, encaixe]:** o repositório já expõe `dbGetAppPlaylistFavoriteChannels` (`apps/electron-backend/src/app/api/main.preload.ts:904`) e `getPortalRecentlyViewed` (ex.: `libs/portal/downloads/feature/src/lib/offline-detail/download-offline-metadata.service.ts:221`) — ou seja, o "primeiro bloco" não exige nova persistência, só uma query pequena antes do documento inteiro.

---

## 7. Propostas (ganho, custo, risco, encaixe, medição que confirma ou descarta)

Custo: **P** = pequeno, **M** = médio, **G** = grande. "Medição" = experimento **antes de implementar**, com fixture sintética de 380k entradas, sobre o benchmark E2E já existente (`docs/architecture/m3u-playlist-module.md:315-329`) e kill switch por variável de ambiente, sem tocar em dados reais.

### P1 — EPG só dos canais visíveis/favoritos, com janela de tempo e sem "update on startup" (A-02)
- **Ganho esperado:** elimina os ~760 lotes de 500 ids por abertura e por ciclo de 60 s; em Jellyfin, trocar "tudo de uma vez" por `Limit=25` tirou o guia de ~9 s para "instantâneo" ([jellyfin-web#7603](https://github.com/jellyfin/jellyfin-web/issues/7603)); indexar EPG por canal uma vez deu 47,5 s → 0,5 s ([PR #3298](https://github.com/iptv-org/epg/pull/3298)). É o candidato a explicar boa parte dos 29,6 s fora do renderer.
- **Custo M. Risco:** "sem informação" ao rolar rápido; now/next desatualizado; apenas 0,5% dos itens têm `tvg-id`, então o matching por nome é dominante e sensível a mudança de escopo; regressão no refresh de 60 s.
- **Encaixe:** `libs/ui/components/src/lib/channel-list-container/channel-list-container.component.ts:522-559` (`channelIds` derivado de `_channelList` inteiro, `forkJoin` de 2 consultas), `:490-493` (`setInterval` 60 s), `:480-488` (debounce de `epgAvailable$`), `:273`, `:295`, `:309` (demais disparos).
- **Medição:** instrumentar `getCurrentProgramsForChannels` / `getChannelMetadataForChannels` com contador de IDs e duração; rodar o clique→primeiro canal com `channelIds` limitado às primeiras N linhas visíveis (flag de medição) e comparar com o baseline 29,6 s; medir também o 2º e 3º ciclos de 60 s. **Confirma** se o tempo cair proporcionalmente aos IDs; **descarta** se o tempo permanecer ~29,6 s (gargalo é outro).

### P2 — Primeiro bloco útil em < 1 s: último grupo + favoritos + recentes + skeleton/progresso, resto em background
- **Ganho esperado:** percebido de 29,6 s → < 1 s para interação (RAIL/MDN); **não reduz o tempo total**, reduz abandono ([web.dev/rail](https://web.dev/articles/rail), [nngroup](https://www.nngroup.com/articles/skeleton-screens/), [clubTivi](https://github.com/clubanderson/clubTivi)).
- **Custo M. Risco:** duas fontes de verdade durante a carga; estado do último grupo; consistência de seleção/favoritos quando o documento completo chega; skeleton piscando se o bloco chegar em < 1 s.
- **Encaixe:** `main.preload.ts:904` (`dbGetAppPlaylistFavoriteChannels`), `libs/services/src/lib/playlist-storage-backend.ts:131-145` (`readDocumentPlaylist`), `download-offline-metadata.service.ts:221` (`getPortalRecentlyViewed`), `requestIdleCallback` ([Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)).
- **Medição:** `performance.mark` do clique até primeiro canal **interativo** + filmstrip CDP, A/B com e sem cache do primeiro bloco, em fixture sintética. **Confirma** se o usuário consegue navegar/tocar um canal antes de 1 s; **descarta** se o bloco for só visual e a UI continuar bloqueada.

### P3 — Canais M3U em linhas no SQLite + paginação keyset, favoritos/recentes primeiro (A-03)
- **Ganho esperado:** tira o documento de 96,5 MB do caminho crítico; página com `SEARCH` ~0,10 ms mesmo em 900k linhas ([sxz.io](https://sxz.io/keyset-cursor-pagination-fastapi-sqlite-tutorial/)); primeiro paint só com os 1.813 canais ao vivo; busca via FTS5 < 100 ms; pico de heap do renderer cai de ~600 MiB para ~22 MiB no análogo de 50 MiB ([wolinski.com](https://wolinski.com/blog/tauri-vs-electron-ipc-memory.html)).
- **Custo G. Risco:** **migração de dados persistidos** — `AGENTS.md` exige ordem de dependência, preservar dados, segurança em startup repetido e testes com esquemas SQLite históricos reais; mudança do formato de `playlists.payload`; dual-read + kill switch; 380k inserts; `cdkVirtualFor` exige altura fixa; `COUNT(*)` para total é caro (20,98 ms isolado).
- **Encaixe:** `main.preload.ts:898-903`, `playlist-storage-backend.ts:137-144`, `docs/architecture/m3u-playlist-module.md:305-313` (contrato A-01) e `:315-329` (harness 10k/50k/100k), `apps/electron-backend/src/app/workers/content-title-fts-build.ts:7-23` (padrão de build em lotes), `apps/electron-backend/src/app/workers/database.worker.ts:406+` (dispatch de payload).
- **Medição:** protótipo de migração com fixture sintética de 380k: tempo de insert em 1 transação, tamanho final do BD, tempo de build do índice FTS em lotes, `EXPLAIN QUERY PLAN` da query keyset (exigir `SEARCH`), e tempo de `SELECT ... LIMIT 100`. **Confirma** se insert < alguns segundos e página < 5 ms; **descarta** se o ganho desaparecer porque o gargalo real é o EPG (P1) ou se a migração violar esquemas históricos.

### P4 — Exclusão fora da fila de leitura (A-04)
- **Ganho esperado:** `DELETE` deixa de esperar atrás de leitura de 96,5 MB; WAL já permite leitores não bloquearem escritores ([sqlite.org/wal.html](https://sqlite.org/wal.html)); doc Electron proíbe bloquear o main ([Performance](https://www.electronjs.org/docs/latest/tutorial/performance)).
- **Custo P. Risco:** ordenação/cancelamento de operações por `operationId`, corrida com refresh/auto-update, mudança de semântica de progresso.
- **Encaixe:** `main.preload.ts:910-911` (`dbDeletePlaylist`), `apps/electron-backend/src/app/api/main.preload.performance.identity.spec.ts:70-75`, `apps/electron-backend/src/app/workers/database-worker-operation-lifecycle.spec.ts`, `main.preload.performance.contract.spec.ts:81-89`.
- **Medição:** teste determinístico que dispara `dbDeletePlaylist` durante uma leitura de 96,5 MB e cronometra o delete; contar mensagens enfileiradas por playlist. **Confirma** se hoje o delete espera; **descarta** se a fila por playlist já não existir/ não houver espera.

### P5 — Eliminar leituras duplicadas do documento na abertura
- **Ganho esperado:** cada leitura extra custa ~3,5 s de IPC + 1,3 s de `JSON.parse` (números A-01 em `docs/architecture/m3u-playlist-module.md:305-313`); o spec de identidade já mostra **3 chamadas `DB_GET_APP_PLAYLIST` no mesmo refresh**; o PR #3298 mostra 95× de ganho ao não re-parsear por canal ([PR #3298](https://github.com/iptv-org/epg/pull/3298)).
- **Custo P. Risco:** cache stale entre refresh/auto-update; invalidação por `operationId`.
- **Encaixe:** `main.preload.performance.identity.spec.ts:70-75`, `main.preload.performance.contract.spec.ts:81-89`, `main.preload.ts:898-903`, `playlist-storage-backend.ts:131-145`.
- **Medição:** contador de `DB_GET_APP_PLAYLIST` por abertura + trace de operações com fixture sintética. **Confirma** se há ≥ 2 leituras do mesmo ID na abertura; **descarta** se houver exatamente uma.

### P6 — Consolidar "serialise once": nunca objeto; avaliar `protocol.handle`+`fetch` e chunks
- **Ganho esperado:** A-01 já deu ~6×; rotas de bytes dão 108–178 ms para 50 MiB e pico de 452–709 MiB vs 617 do objeto; enviar só o primeiro bloco mantém a página em **22 MiB** ([wolinski.com](https://wolinski.com/blog/tauri-vs-electron-ipc-memory.html)). `protocol.handle` + `Content-Length` ficou 49 → 40 ms em 16 MB com #52923 ([PR #52923](https://github.com/electron/electron/pull/52923)).
- **Custo P/M. Risco:** `protocol.handle` muda superfície de segurança/CSP e exige `Content-Length`; **não tentar transfer de `ArrayBuffer`** — a spec oficial lança "Invalid value for transfer" ([spec/api-ipc-spec.ts](https://github.com/electron/electron/blob/c16c6da2/spec/api-ipc-spec.ts), [electron#34905](https://github.com/electron/electron/issues/34905)); chunks exigem backpressure explícito (MessagePort não tem) ([tutorial/message-ports.md](https://github.com/electron/electron/blob/main/docs/tutorial/message-ports.md)).
- **Encaixe:** `main.preload.ts:900-903`, `playlist-storage-backend.ts:142-143`, kill switch `IPTVNATOR_DISABLE_JSON_PLAYLIST_READ` (`docs/architecture/m3u-playlist-module.md:311`, `libs/shared/interfaces/src/lib/playlist-url-import.ts:15`).
- **Medição:** benchmark com 96,5 MB sintética comparando string atual vs `protocol.handle` vs chunks de 1 MiB, medindo tempo **e pico de heap do renderer via CDP**. **Descarta** se o ganho for < 10% sobre A-01 (o gargalo já migrou para main/worker).

### P7 — Busca/índice no worker com FTS5 + virtual scroll, sem 380k objetos na store
- **Ganho esperado:** `LIKE` linear → FTS5 50–100× ([andrewmara.com](https://andrewmara.com/blog/faster-sqlite-like-queries-using-fts5-trigram-indexes)); DOM de centenas em vez de milhares de nós; `timeChangeDetection` ~0,01 ms em 100k com virtual scroll ([octoperf](https://blog.octoperf.com/angular-performance-optimization---virtual-scroll/)); menos GC (menos objetos long-lived, [v8.dev](https://v8.dev/blog/trash-talk)).
- **Custo M. Risco:** índice FTS pode ~3× o BD e levar minutos para build em escala; trigram não casa < 3 caracteres; semântica de busca muda; `cdkVirtualFor` + `itemSize` + `trackBy` estável; dev-mode deep-check ([angular#22109](https://github.com/angular/components/issues/22109)).
- **Encaixe:** `apps/electron-backend/src/app/workers/content-title-fts-build.ts:1-23` (reutilizar o padrão de lotes/cursor/swap), `libs/ui/components/src/lib/channel-list-container/`, `[angular/components scrolling.md](https://github.com/angular/components/blob/main/src/cdk/scrolling/scrolling.md)`.
- **Medição:** em fixture sintética de 380k títulos, comparar `LIKE '%term%'` vs FTS5 `MATCH` (termos comuns e raros), medir tamanho do índice e tempo de build em lotes; contar nós DOM e `timeChangeDetection()`. **Descarta** se o custo de build/índice superar a economia ou se a semântica de busca ficar inaceitável.

### P8 — Separar 1.813 canais ao vivo de 378k VOD/episódios; grupos sob demanda
- **Ganho esperado:** o "hot set" cai ~200×; precedente Kodi v20 ("Show media as recordings"/"Include VODs as media" *"sped things a lot"*, [forum.kodi.tv](https://forum.kodi.tv/showthread.php?pid=3130009)); Hypnotix classifica por grupo e só renderiza o grupo clicado ([hypnotix.py](https://github.com/linuxmint/hypnotix/blob/master/usr/lib/hypnotix/hypnotix.py)); Threadfin filtra antes de exibir e limita canais ([DeepWiki](https://deepwiki.com/Threadfin/Threadfin/3.2-playlist-management)); TiviMate/Channels dependem de ocultar grupos ([iptvwire](https://iptvwire.org/iptv-player-for-large-playlists/), [getchannels](https://getchannels.com/docs/channels-dvr-server/how-to/custom-channels/)).
- **Custo M. Risco:** mudança de navegação/rotas; favoritos e recentes podem apontar para VOD; EPG só faz sentido para o subconjunto live;两份 estado.
- **Encaixe:** `libs/playlist/*`, `libs/portal/xtream/*`, `channel-list-container.component.ts`; o `show_groups()` do Hypnotix é o modelo de "grupo com contagem primeiro" (como Tentacle Phase 1, [jellyfin-tentacle](https://lucas-romanenko.github.io/jellyfin-tentacle/features/live-tv/)).
- **Medição:** contar objetos materializados no renderer e tempo de parse por tipo ao abrir, com e sem split, em fixture sintética; medir "grupo com contagem" sem carregar itens. **Confirma** se o primeiro canal visível deixa de depender dos 330k episódios; **descarta** se a UI já filtra sem custo.

### P9 — Higiene Windows + WAL/pragmas (medir antes de mexer)
- **Ganho esperado:** remove travamentos **ambientais** (Defender 2,8 → 0,5 s; GPU "Goodbye"; GC), não o tempo de abertura; WAL/checkpoint evita degradação de leitura com o tempo ([sqlite.org/wal.html](https://sqlite.org/wal.html), [docs/performance.md](https://github.com/vazra/better-sqlite3/blob/HEAD/docs/performance.md)).
- **Custo P. Risco:** pedir exclusão de AV ao usuário é **protection gap** e a Microsoft recomenda parcimônia ([exclusions overview](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-antivirus-exclusions-overview)); `--max-old-space-size` **não aumenta** heap ([electron#22705](https://github.com/electron/electron/issues/22705)); `backgroundThrottling: false` aumenta consumo e não conserta RAF ([electron#28672](https://github.com/electron/electron/issues/28672), [electron#9567](https://github.com/electron/electron/issues/9567)).
- **Encaixe:** `package.json:277` (já inclui backport #53018), `apps/electron-backend/src/app/app.ts`, `webPreferences`, `database.worker.ts`.
- **Medição:** em VM Windows controlada: `New-MpPerformanceRecording` + `Get-MpPerformanceReport -TopFiles` ([MS analyzer](https://learn.microsoft.com/en-us/defender-endpoint/tune-performance-defender-antivirus)), ProcMon, A/B com RTP desligado, eventos `gpu-process-crashed`/`render-process-gone`, `performance.memory`, tamanho do `-wal` ao longo de 3 ciclos de 60 s, e `visibilitychange` durante carga em background. **Descarta** se o delta no clique→canal for < 1 s e não houver eventos de crash.

---

## 8. Hipóteses consolidadas e como medir

| # | Hipótese (não verificada neste caso) | Como medir (antes de implementar) |
|---|---|---|
| **H1** | Um índice persistido entre sessões (como Megacubo/clubTivi) é o que viabiliza primeiro bloco < 1 s | Cronometrar cold vs warm load com fixture sintética; medir tempo de reconstrução do índice e tamanho em disco |
| **H2** | 380k objetos na store são o amplificador de heap/GC/change detection | Heap snapshot CDP (retained size), `performance.memory`, contagem de nós DOM e `timeChangeDetection()` antes/depois de paginar |
| **H3** | Migrar 380k entradas para linhas custa segundos, não minutos | Inserção em 1 transação com statement preparado, em fixture sintética; medir linhas/s e tamanho do BD |
| **H4** | O "45,6 s idle" do renderer esconde clone/GC no main/worker | CPU profile do **main e do worker** (não só renderer) durante o clique; `performance.memory` do renderer; contar structured clones por chamada |
| **H5** | O `setInterval` de 60 s e a carga em background são throttled com janela oculta, empilhando lotes | Contadores de lotes + `visibilitychange`, comparando janela em foco vs minimizada por 3 ciclos |
| **H6** | Defender/ASAR explicam os 29,6 s | A/B com RTP desligado + `Get-MpPerformanceReport`; **esperado: impacto só no startup**, medir especificamente o clique→canal |
| **H7** | Parte dos travamentos é GPU/driver, não volume de dados | Eventos `gpu-process-crashed`/`render-process-gone` + log `--enable-logging` em Windows com drivers distintos |
| **H8** | O WAL cresce durante os ciclos de EPG e degrada leituras | `PRAGMA wal_checkpoint`/tamanho de `*.db-wal` a cada 60 s por 3 ciclos, com e sem lotes de EPG |
| **H9** | `ArrayBuffer` transferido dá zero-copy no Electron | **Já descartada**: spec oficial lança "Invalid value for transfer" e #34905 afirma que "the data is copied either way" ([spec](https://github.com/electron/electron/blob/c16c6da2/spec/api-ipc-spec.ts), [#34905](https://github.com/electron/electron/issues/34905)) |

---

## 9. As 10 técnicas mais promissoras para este caso

Ordenadas por **(ganho esperado ÷ custo)** considerando que o renderer está ocioso e a espera está no main/worker.

| # | Técnica | Ganho esperado | Custo | Risco principal | Fonte |
|---|---|---|---|---|---|
| 1 | **Primeiro bloco útil < 1 s** (último grupo + favoritos + recentes + skeleton/progresso; resto em background) | Percebido 29,6 s → < 1 s de interação; reduz abandono | **M** | Duas fontes de verdade; estado do último grupo | [web.dev/rail](https://web.dev/articles/rail), [MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/Perceived_performance), [clubTivi](https://github.com/clubanderson/clubTivi) |
| 2 | **EPG só dos canais visíveis/favoritos + janela de tempo + sem update no startup** (A-02) | Remove ~760 lotes × 500 ids por abertura/ciclo; 9 s → instantâneo no análogo Jellyfin; candidato a maior fatia dos 29,6 s | **M** | "Sem informação" ao rolar; matching por nome (só 0,5% tvg-id); regressão no 60 s | [jellyfin-web#7603](https://github.com/jellyfin/jellyfin-web/issues/7603), [jellyfin#17476](https://github.com/jellyfin/jellyfin/pull/17476), [PR #3298](https://github.com/iptv-org/epg/pull/3298), [tivimateplayer.co.uk](https://tivimateplayer.co.uk/tivimate-epg-not-updating-fixes/) |
| 3 | **Separar 1.813 live de 378k VOD/episódios; grupos sob demanda com contagem** | Hot set ~200× menor; primeiro canal independente dos episódios | **M** | Navegação, favoritos/recentes apontando VOD | [forum.kodi.tv](https://forum.kodi.tv/showthread.php?pid=3130009), [hypnotix.py](https://github.com/linuxmint/hypnotix/blob/master/usr/lib/hypnotix/hypnotix.py), [jellyfin-tentacle](https://lucas-romanenko.github.io/jellyfin-tentacle/features/live-tv/) |
| 4 | **Eliminar leituras duplicadas do documento na abertura** | ~2 × (3,5 s + 1,3 s) por leitura extra; 95× no análogo de re-parse | **P** | Cache stale / invalidação por `operationId` | [PR #3298](https://github.com/iptv-org/epg/pull/3298), `main.preload.performance.identity.spec.ts:70-75` |
| 5 | **Exclusão fora da fila de leitura** (A-04) | Delete deixa de esperar leitura de 96,5 MB | **P** | Ordem/cancelamento de operações | [sqlite.org/wal.html](https://sqlite.org/wal.html), [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance) |
| 6 | **"Serialise once" consolidado**: string/bytes, nunca objeto; avaliar `protocol.handle`+`fetch` / chunks | 652 → 108 ms em 50 MiB; pico 617 → 452 MiB; 22 MiB se só o primeiro bloco | **P/M** | CSP/segurança; `ArrayBuffer` transfer **não existe** no Electron; backpressure | [wolinski.com](https://wolinski.com/blog/tauri-vs-electron-ipc-memory.html), [ipc-renderer.md](https://github.com/electron/electron/blob/main/docs/api/ipc-renderer.md), [electron#34905](https://github.com/electron/electron/issues/34905) |
| 7 | **Linhas por canal no SQLite + paginação keyset, favoritos/recentes primeiro** (A-03) | Página ~0,10 ms em 900k linhas; remove 96,5 MB do caminho crítico; first paint só com live | **G** | Migração de dados persistidos, esquemas históricos, dual-read, kill switch | [sxz.io](https://sxz.io/keyset-cursor-pagination-fastapi-sqlite-tutorial/), [use-the-index-luke](https://use-the-index-luke.com/sql/partial-results/fetch-next-page), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3?tab=readme-ov-file) |
| 8 | **FTS5 no worker para busca, em lotes com cursor/swap** (padrão já no repo) | `LIKE` → 50–100× mais rápido; busca < 100 ms | **M** | Índice até ~3× o BD; build longo; trigram não casa < 3 chars | [andrewmara.com](https://andrewmara.com/blog/faster-sqlite-like-queries-using-fts5-trigram-indexes), [fts5.html](https://sqlite.org/fts5.html), `content-title-fts-build.ts:17-23` |
| 9 | **`cdk-virtual-scroll` + `OnPush` + `trackBy` estável + signals, sem 380k na store** | DOM de centenas de nós; 0,01 ms/CD; 122 → 1,2 ms/frame em prod mode; menos GC | **M** | `itemSize`/altura obrigatórios; dev-mode deep-check; sem sinais de "página N" | [scrolling.md](https://github.com/angular/components/blob/main/src/cdk/scrolling/scrolling.md), [angular#22109](https://github.com/angular/components/issues/22109), [angularatlas.dev](https://angularatlas.dev/virtual-scroll), [v8.dev](https://v8.dev/blog/trash-talk) |
| 10 | **Higiene Windows + WAL/pragmas/checkpoint no worker** (medir, não assumir) | Remove travamentos ambientais (2,8 → 0,5 s no startup; GPU; WAL crescendo) | **P** | Exclusão de AV é protection gap; heap não aumenta além de 4 GB; throttling não se conserta com flag | [MS troubleshoot](https://learn.microsoft.com/en-us/defender-endpoint/troubleshoot-performance-issues), [electron#29868](https://github.com/electron/electron/issues/29868), [electron#52255](https://github.com/electron/electron/issues/52255), [electron#22705](https://github.com/electron/electron/issues/22705), [sqlite.org/wal.html](https://sqlite.org/wal.html) |

**Leitura final da trilha:** o mercado converge em quatro invariantes que o caso ainda não adotou por completo — (i) **nunca materializar o catálogo inteiro** para mostrar a primeira tela (Kodi v20, clubTivi, Hypnotix, Tentacle, Channels DVR); (ii) **EPG por janela/visível**, não por lista inteira nem a cada 60 s (Jellyfin #7603, TiviMate, ThunderTV); (iii) **índice/banco local construído em worker e persistido entre sessões** (Megacubo, TiviMate, iptv-catalog, padrão `content-title-fts-build.ts` do próprio repo); (iv) **bytes, não grafos de objetos**, atravessando o IPC (A-01 + "serialise once"). A evidência mais forte e mais barata de testar primeiro é a combinação **P5 → P1 → P2**: todas são de custo P/M, usam instrumentação já existente e confirmam ou descartam a hipótese "a espera está no main/worker" antes de qualquer migração de esquema (P3, custo G). Nenhuma proposta troca Angular, Electron, better-sqlite3 ou Nx.
