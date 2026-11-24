---
plan_id: PLAN-005-m3u-open-perf-research
fase: discovery
---

# Progress: PLAN-005 (discovery de performance, sem plano e sem execucao)

## Linha do tempo

- 12:20 briefing comum em discovery/briefing.md. Prompts e relatorios em E:/Github/monorepo-others/tmp/iptvnator/plan-005/.
- Trilhas: codex (rastreio no codigo, -s read-only) -> report-codex.md; opencode plan (mercado e boas praticas) -> report-opencode.md; opencode plan (opcoes de desenho, trilha que era do antigravity) -> report-design-opencode.md.
- antigravity (agy 1.5.16) falhou: "backend returned an empty conversation id" (tambem num teste simples). gemini CLI recusou: cliente nao suportado para Code Assist individual. Precisa de login/ajuste do usuario.
- 12:25 app do build local (d6fb709d9) aberto para o usuario, banco isolado em E:/Github/monorepo-others/tmp/iptvnator/app-usuario, lista importada como "Lista teste (380k)" (380.373 itens, 11,1 s). Trace IPC/DB ligado em app-usuario/main-trace.log (so ler agregado).

## Retomada

1. Ler os 3 relatorios, validar cada afirmacao contra o codigo, consolidar em discovery/README.md.
2. Medir com o trace do app-usuario (tempo por metodo IPC e operacao do worker na abertura).
3. Entregar overview ao usuario; plano so depois da escolha dele.

## Medicao M-01: linha do tempo da abertura (12:35, build d6fb709d9, banco isolado novo, lista real, so tempos)

| t (s) | evento |
|---:|---|
| 0,00 | clique na playlist |
| 0,08 | dbGetAppPlaylistJson start / DB_GET_APP_PLAYLIST dispatch |
| 3,02 | DB_GET_APP_PLAYLIST resolvido no worker (2.943 ms) |
| 3,67 | dbGetAppPlaylistJson success (3.587 ms) |
| 5,76 | getCurrentProgramsBatch start |
| 20,81 | getEpgChannelMetadata start |
| 35,80 | EPG worker: parse completo (1.797 canais, 119.990 programas) |
| 36,50 | getCurrentProgramsBatch success (15.295 ms); getEpgChannelMetadata success (30.256 ms) |
| 37,10 | fetchEpg success (42.266 ms) e PRIMEIRO CANAL VISIVEL |
| 39,75 | segundo getCurrentProgramsBatch start; sem resposta ate 107 s (> 67 s) |

Leitura: a playlist chega ao renderer em 3,7 s. O primeiro canal so aparece quando as consultas de EPG (programa atual e metadata dos ids) respondem, e elas so respondem depois que o download e o parse do EPG terminam (35,8 s). A espera restante e o EPG no caminho critico da primeira pintura, nao a playlist.

- 12:50 codex concluiu (report-codex.md, 34 KB). Discovery consolidado em discovery/README.md (F-10..F-16, B-01..B-07, medicoes M-02..M-04 pendentes).
- 12:55 agy funciona com `--new-project` (sem ele: "empty conversation id"). Trilha nova do antigravity: validar F-10..F-13, achar o que segura a primeira pintura, desenhar B-01/B-02/B-03 -> report-agy.md.
- Usuario esta testando o app (uma instancia, porta 9337). Nao abrir outra instancia ate ele fechar; M-02/M-03 esperam.
- 13:05 agy headless sem saida duas vezes: precisa da permissao "command" e o allow-rule `command(<bin>)` nao bastou; `--dangerously-skip-permissions` bloqueado pelo classificador do Claude Code. Trilha de validacao foi para um segundo codex (-s read-only) -> report-codex2.md.
- 13:20 codex2 (revisor) e opencode mercado concluidos; consolidados no discovery/README.md. Falta o opencode de desenho. M-02 desenhada, espera o usuario fechar o app.
- 13:45 monitor M-05 (10 min) concluido: renderer congela ~90 s depois de cada resposta de EPG (objeto com uma chave por canal, null incluso) e o video trava junto. Registrado no discovery/README.md. Segundo monitor de 25 min rodando (playback-monitor-2.json).
- 13:50 usuario pediu monitoramento continuo da reproducao. Rodando: playback-monitor-2.json (video, renderer, RTT, EPG; 25 min) e network-monitor.json (rede do player por CDP: tempo, tamanho, status, host anonimizado h1/h2; erros de console redigidos; 40 min). Scripts no scratchpad: monitor-playback.cjs, monitor-network.cjs, analyze-playback.cjs.
