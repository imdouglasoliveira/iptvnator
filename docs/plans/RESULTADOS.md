# Resultados de performance: listas M3U grandes no IPTVnator (Electron, Windows)

> Registro das melhorias feitas neste fork, com antes e depois medidos. Atualizado em 2026-11-24.
> Os detalhes de cada medição estão nas pastas `PLAN-00N` ao lado deste arquivo.

## Contexto

- App: IPTVnator, player IPTV com Angular no renderer, Electron 43 no main e SQLite (better-sqlite3) num worker thread.
- Caso de teste: uma lista M3U real de provedor com 380.373 entradas (96,5 MB): 1.813 canais ao vivo, 47.989 filmes e 330.571 episódios em 120 grupos.
- Máquina: Windows 11, AMD Ryzen 7 5700G, 32 GB de RAM.
- Método: o app empacotado roda com banco isolado (`IPTVNATOR_E2E_DATA_DIR`) e é controlado por CDP (Playwright `connectOverCDP`). Os perfis de CPU vêm do CDP Profiler; os tempos de IPC e de banco vêm dos traces do próprio app (`IPTVNATOR_TRACE_IPC`, `IPTVNATOR_TRACE_DB`). Só números agregados foram registrados; nenhum dado do provedor.
- Reprodutível sem a lista real: a fixture sintética de 380k do benchmark (`test/m3u-catalog-benchmark`) gera um catálogo com o mesmo formato.

## Melhorias entregues

| # | Problema | Antes | Depois | Ganho | Mudança |
|---|---|---:|---:|---:|---|
| 1 | Importar a lista por URL falhava: o provedor leva ~52 s até o primeiro byte e o app desistia em 30 s | falha ("Failed to fetch the playlist") | importa | passa a funcionar | timeout de inatividade de 30 s para 120 s no Electron e no backend PWA (PLAN-001; PR upstream #2347) |
| 2 | Importar a lista travava a janela | 280 s, janela congelada por mais de 1 min duas vezes (maior long task 87,2 s; pico de RSS do main 2,28 GB) | 9 a 12 s | ~25x | a playlist é gravada no processo principal e o renderer recebe só um resumo, em vez de clonar 380k objetos entre processos (PLAN-003) |
| 3 | Abrir a lista já importada | 147,7 s do clique ao primeiro canal | 29,6 s | 5x | a playlist atravessa o IPC e o `contextBridge` como texto JSON (uma cópia) em vez de grafo de objetos (cópia propriedade a propriedade), com kill switch (PLAN-004, A-01) |
| 3a | Leitura da playlist vista do renderer (dentro do item 3) | 193,7 s | 4,8 s (3,5 s de IPC + 1,3 s de `JSON.parse`) | 40x | mesma mudança |

Commits (branches deste fork; os de performance ainda passam pelo gate local antes de ir ao fork e ao upstream):

| Item | Branch | Commits |
|---|---|---|
| 1 | `fix/playlist-slow-m3u-download` | `d3bd32139`, `3e733314a`, `38afc34ab` |
| 2 | `perf/playlist-main-process-import` | `3c2b464c4`, `65d38f10c`, `0ca7109ab`, `7e57b3fd0`, `82fa5eb49` |
| 3 | `perf/playlist-json-read` | `8e517da2c`, `707d17eec`, `918545a4f` |
| benchmark | `test/m3u-catalog-benchmark` | `19365c140`, `2f685f874`, `0d9986607` |

Como cada causa foi achada:
- Item 1: `curl` mediu o tempo até o primeiro byte do provedor (52,5 s) contra o timeout do axios (30 s).
- Item 2: a timeline do benchmark mostrou 174,7 s entre o main pronto e o renderer pedindo o upsert, gastos em clonar o catálogo do main para o renderer.
- Item 3: o main lia a playlist em ~4 s, mas a mesma chamada vista do renderer levava ~107 s; o perfil do renderer tinha 92 s em código nativo. A cópia do grafo de objetos pelo IPC e pelo `contextBridge` era o custo.

## Linha de base das próximas melhorias (PLAN-005, em discovery)

Medido depois dos itens 1 a 3. A coluna "Depois" será preenchida quando cada correção for entregue.

| Medida | Antes | Depois | Correção proposta |
|---|---:|---:|---|
| Clique até o primeiro canal, com o guia (EPG) da lista ativo | 37,1 s (observado via CDP; pode incluir atraso de observação) | pendente | EPG só dos canais visíveis; consultas de EPG fora do processo principal |
| Consulta de EPG no processo principal (por chamada) | 9 a 99 s, travando o main | pendente | mesma |
| Reprodução de um canal ao vivo: tempo com vídeo travado | 369 s de 626 s (59%) | pendente | resposta de EPG sem uma entrada por canal (hoje ~380k chaves com `null` cruzam o `contextBridge`) |
| Renderer congelado durante a reprodução | 3 vezes, ~90 s cada, logo depois de cada resposta de EPG | pendente | mesma |
| Buffer à frente do ponto de reprodução | mediana 0,06 s | pendente | mesma |

Diagnóstico completo: `PLAN-005-m3u-open-perf-research/discovery/README.md`.
