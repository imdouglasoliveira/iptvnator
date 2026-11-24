---
plan_id: PLAN-002-m3u-large-playlist-benchmark
selado_em: 2026-11-24T01:28:09.659Z
revisor: orquestrador
outra_sessao: false
motivo: null
docs_sha256: 22c8d2cea240b16dd38fde11e0420759cfb93de0be819f0770ae39117837b845
---

# Revisao - PLAN-002-m3u-large-playlist-benchmark

Modo `--revisao` (validate-plan), antes da execucao. Revisor: orquestrador (mesma sessao que planejou; sem `--agents`, sem revisor de outro provedor).

## Conferencia dos trechos literais contra a base (525adb045)

| trecho | existe? | assinatura bate? |
|---|---|---|
| `SYNTHETIC_TITLE_VOCABULARY` em `synthetic-charset.ts:23`, `latin1.channel`/`latin1.group` | sim | sim ("Synthetic Channel", "Synthetic Group") |
| `SYNTHETIC_M3U_SEED = 240_724` em `synthetic-m3u.ts:9` | sim | sim |
| `interface SyntheticM3uFixture` em `synthetic-m3u.ts:20`, `channelCount` na linha 23 | sim | sim: `body`, `bytes`, `channelCount`, `charset`, `sha256` |
| `createSyntheticM3uFixture(channelCount: number = ..., options)` | sim | sim, aceita `number` e valida a uniao |
| `import type { SyntheticM3uChannelCount } from './synthetic-m3u';` no contrato | sim | sim |
| `PerformanceIterationKind` em `m3u-refresh-cancellation-contract.ts:14` | sim | sim |
| `listM3uImportScenarios()` e `createM3uImportIterationDefinitions(smoke)` no contrato | sim | sim; o spec do contrato faz `deepEqual` dos 3 cenarios, por isso T-002-02 edita o spec |
| `createSyntheticM3uFixture(scenario.channelCount)` em `m3u-import.benchmark.ts:76` | sim | sim |
| `app.mainWindow.setDefaultTimeout(120_000);` e `waitForDatabaseSettlement(app)` com `{ timeout: 120_000 }` (linhas 197, 218, 264-281) | sim | sim |
| `M3uImportScenarioId` usado em `m3u-import-summary*.ts` | sim | sim; o id novo entra na uniao derivada, sem edicao nesses arquivos |
| "The benchmark attributes these non-additive intervals:" em `m3u-playlist-module.md:330` | sim | sim, ancora do paragrafo novo |
| SHA-256 `2d2028bb...51bf` e 90.544.398 bytes | calculado pelo planejador com o trecho literal da fixture | sim |

## Achados e correcoes

| origem | arquivo | achado | acao | motivo |
|---|---|---|---|---|
| orquestrador | checklist.md | `plan-gate` roda todo item sem `[fechamento]` a cada task; C-02, C-04 e C-05 dependem de T-002-02 e deixariam vermelho o gate de T-002-01 | aplicado: `[fechamento]` nos tres; DoD de T-002-02 manda rodar C-02 a mao | reforca o roteiro sem mudar o que se entrega |
| orquestrador | remocoes.txt | `plan-gate` confere `remocoes.txt` em todo modo; as remocoes de T-002-02 ficariam presentes durante T-002-01 | aplicado: `remocoes.txt` removido; as duas remocoes viram C-07 (`[fechamento]`) e C-08 com `exit 1` esperado | mesma cobertura, sem quebrar o laco por task |
| orquestrador | checklist.md, plan.md, EXECUTOR.md | renumeracao dos itens depois de C-07/C-08 novos | aplicado: Manual vira C-09/C-10, Regressao C-11; referencias atualizadas | handles em sequencia continua |
| orquestrador | discovery/README.md | `test-performance-harness` tem 5 falhas de base no Windows | registrado no Baseline e no EXECUTOR como vermelho de base; o checklist roda so os specs tocados | evita culpar o executor por falha preexistente |
| orquestrador | context.md | escopo de commit citado sem conferir | aplicado: `test(performance): ...`, o que o upstream usou nesses arquivos (#1287, #1713) | numero/fato conferido |

## Parecer

Plano executavel como medicao. Nao muda codigo do app; a correcao da playlist grande depende de C-10 (decisao do usuario sobre `measurements.md`). Nenhuma decisao `D-NN`, criterio ou artefato mapeado mudou na revisao.
