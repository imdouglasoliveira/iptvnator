---
plan_id: PLAN-002-m3u-large-playlist-benchmark
discovery_schema: v2
impact_class: critical-domain
modo: brownfield
generated_at: 2026-11-23T23:00:00-03:00
commit: 525adb045
---

# Discovery: importacao de playlist M3U com 380 mil entradas

Evidencia compartilhada com o PLAN-001: [../../PLAN-001-m3u-download-timeout/discovery/README.md](../../PLAN-001-m3u-download-timeout/discovery/README.md) (achado F-03). Arquivo irmao: [findings.md](./findings.md).

## Demanda

Depois de corrigir o timeout (PLAN-001), a mesma playlist de teste ainda pode falhar por tamanho: 380.100 entradas e 96 MB. O usuario aprovou tratar essa segunda causa num plano proprio. As regras de performance do `AGENTS.md` exigem reproduzir com o benchmark correspondente antes de mudar codigo, manter kill switch em mudanca visivel e deixar trade-off de UX para o mantenedor.

## Modo detectado

brownfield. Existe o benchmark de import inicial por URL no Electron (`pnpm nx run electron-backend-e2e:benchmark-m3u-import`, secao "Initial URL Import Performance Benchmark" de `docs/architecture/m3u-playlist-module.md`), com cenarios de 10k, 50k e 100k entradas sem atributos `tvg-*` e atribuicao por fase (download, parse, clone IPC em cada direcao, serializacao no worker, escrita e leitura no SQLite, publicacao e render).

## Problema

O caminho de import faz a playlist inteira cruzar processos varias vezes: main → renderer (resultado de `fetch-playlist-by-url`), renderer → main → worker de banco (upsert) e de volta (GET). Com 380 mil entradas, o objeto vira ~265 MB de JSON. O maior cenario medido pelo upstream tem 100 mil entradas sem atributos (cerca de 9 MB), entao nao ha numero para o tamanho real. Sem medir, qualquer correcao (persistir no main, paginar, limitar) e chute.

## Achados

| id | achado | evidencia | classe | status |
|---|---|---|---|---|
| F-01 | Parse da playlist real e rapido; o custo esta no que vem depois | parse local de 96 MB: 916 ms, heap 1.232 MB; `JSON.stringify` do resultado: 265 MB em 830 ms | in-scope | resolvido no plano: T-002-03 |
| F-02 | O maior cenario do benchmark (100k, ~9 MB, sem `tvg-*`) fica longe do caso real (380k, ~96 MB, com `tvg-id`, `tvg-name`, `tvg-logo`) | `synthetic-m3u.ts`, `synthetic-m3u.spec.ts` (assevera ausencia de `tvg-`) | in-scope | resolvido no plano: T-002-01 |
| F-03 | O benchmark espera o banco assentar por 120 s fixos; um cenario de 380k pode passar disso so pelo tamanho | `m3u-import.benchmark.ts` (`setDefaultTimeout(120_000)` e `waitForDatabaseSettlement`) | in-scope | resolvido no plano: T-002-02 |

## Alternativas

| id | alternativa | custo | efeito | risco |
|---|---|---|---|---|
| A-01 | Medir primeiro: cenario opt-in de 380k com formato de provedor no benchmark existente, rodar e registrar a primeira fase que falha ou domina; a correcao vira plano novo | fixture nova, cenario opt-in, 1 rodada smoke | numero real para decidir a correcao; segue a regra de reproduzir antes de mudar | correcao chega depois |
| A-02 | Corrigir direto: o main persiste a playlist no worker de banco e o renderer recebe so um resumo | muda contrato IPC, store NgRx e worker | provavel ganho grande | redesenho sem medicao, contra `AGENTS.md`; kill switch e decisao de UX pendentes |
| A-03 | Limitar: recusar M3U acima de N entradas e sugerir cadastrar como Xtream | guarda no import e mensagem traduzida | evita travar | decisao de UX do mantenedor; perde quem so tem M3U |

## Decisoes

| id | decisao | motivo |
|---|---|---|
| D-01 | A-01 neste plano | `AGENTS.md` (Performance threads): reproduzir com o benchmark antes de mudar codigo; a escolha entre A-02 e A-03 e trade-off de UX do mantenedor |
| D-02 | Cenario opt-in por `IPTVNATOR_PERF_M3U_CATALOG=1`; sem a variavel, os cenarios 10k/50k/100k e seus SHA-256 ficam identicos | mesmo padrao de `IPTVNATOR_JOURNEY_LARGE_LIBRARY=1`; nao muda baseline nem custo da rodada formal |
| D-03 | Fixture nova em arquivo proprio (`synthetic-m3u-catalog.ts`) | o upstream assevera que a fixture formal nao tem `tvg-*`; o formato de provedor fica separado |
| D-04 | 380.000 entradas: 1.800 live, 48.000 filmes, o resto episodios de serie; 90.544.398 bytes | proporcao e tamanho medidos na playlist real (1.817 / 47.956 / 330.327; 96.735.774 bytes), com URLs so em `127.0.0.1` |

## Nao pode quebrar

- Cenarios formais 10k/50k/100k: mesmos ids, mesmas contagens, mesmos SHA-256 (`synthetic-m3u.spec.ts`, `m3u-import-benchmark-contract.spec.ts`).
- Fixture so com URLs de loopback e sem dado de provedor real (`assertOnlyLoopbackUrls`, regra de dados sinteticos do `AGENTS.md`).
- Rodada formal sem a variavel nova gera o mesmo numero de iteracoes (21; smoke 9).

## Baseline

Medido em 2026-11-23 no commit 525adb045, Windows:

- `cd apps/electron-backend-e2e && npx --no-install tsx --test src/performance/m3u-import-benchmark-contract.spec.ts src/performance/synthetic-m3u.spec.ts` → exit 0, 11 testes.
- `cd apps/electron-backend-e2e && npx --no-install tsx --test src/performance/synthetic-m3u-server.spec.ts src/performance/m3u-import-report.spec.ts src/performance/m3u-import-summary.spec.ts` → exit 0, 10 testes.
- `pnpm nx lint electron-backend-e2e --output-style=static` → exit 0.
- `pnpm nx run electron-backend-e2e:test-performance-harness` → exit 1 na base no Windows (5 de 698 falham, entre eles "Electron forced termination" e "Xtream benchmark mode configuration"); por isso o plano roda so os specs que toca.

## Incertezas

- O harness de performance tem falhas na base no Windows; a rodada do benchmark pode nao completar nesta maquina por motivo do harness, nao do app. Nesse caso a medicao precisa de Linux ou macOS.
- Uma rodada smoke nao sustenta afirmacao de performance (`m3u-playlist-module.md`); serve para achar onde quebra. Rodada formal so se a smoke completar.
- O limite de 30 min do Playwright (`playwright.performance.config.ts`) pode estourar com 3 iteracoes de 380k.
