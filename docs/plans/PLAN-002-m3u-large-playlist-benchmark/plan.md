---
id: PLAN-002-m3u-large-playlist-benchmark
plan_schema: v2
tela: Benchmark de import M3U por URL no Electron com catalogo de 380 mil entradas
objetivo: correcao
plan_kind: backend
impact_class: critical-domain
executor: externo
source: codigo
figma_url: null
demand_id: null
demand_type: fix
status: pendente
abandon_reason: null
parent_plan: null
children_plans: []
stack_ref: docs/stack.md@PENDENTE
arch_change: false
work_branch: master
created_at: 2026-11-23T23:00:00-03:00
validated_at: null
---

# Medir o import de uma playlist M3U de 380 mil entradas

## Contexto (POR QUE)

Com o timeout resolvido (PLAN-001), a playlist de teste ainda tem 380.100 entradas e 96 MB, e o import manda o objeto inteiro por IPC varias vezes. O `AGENTS.md` exige reproduzir com o benchmark antes de mudar codigo de performance. Este plano estende o benchmark existente com um cenario opt-in no formato de provedor, roda e registra onde o import quebra. A correcao (persistir no main, limitar, ou outra) vira um plano novo depois da medicao. Detalhes: [discovery/README.md](./discovery/README.md).

## Artefatos mapeados

| Artefato | Papel hoje | Mudança prevista | Task |
|----------|------------|------------------|------|
| `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.ts` | nao existe | fixture de 380k com `tvg-*`, mix live/filme/serie, so loopback | T-002-01 |
| `apps/electron-backend-e2e/src/performance/synthetic-m3u.ts` | `SyntheticM3uFixture.channelCount` tipado na uniao 10k/50k/100k | tipo `number`; gerador formal inalterado | T-002-01 |
| `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.spec.ts` | nao existe | guarda da fixture | T-002-01 |
| `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-contract.ts` | 3 cenarios fixos, sem prazo por cenario | cenario opt-in `m3u-import-catalog-380k`, `settleTimeoutMs`, `isM3uImportCatalogRun`, `createM3uImportScenarioFixture` | T-002-02 |
| `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts` | gera fixture formal e espera 120 s | usa o contrato para fixture e prazo | T-002-02 |
| `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-contract.spec.ts` | espera cenarios sem `settleTimeoutMs` | espera `settleTimeoutMs: 120_000` | T-002-02 |
| `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-catalog.spec.ts` | nao existe | guarda do cenario opt-in | T-002-02 |
| `docs/architecture/m3u-playlist-module.md` (secao Initial URL Import Performance Benchmark) | 10k/50k/100k | paragrafo do `IPTVNATOR_PERF_M3U_CATALOG=1` | T-002-02 |
| `docs/plans/PLAN-002-m3u-large-playlist-benchmark/measurements.md` | nao existe | resultado da rodada smoke e proposta | T-002-03 |

## Interações & Estados

Caminhos de uso que precisam funcionar depois do plano:

1. `pnpm nx run electron-backend-e2e:benchmark-m3u-import` sem variavel nova → os mesmos 3 cenarios e 21 iteracoes (9 em smoke).
2. Mesmo comando com `IPTVNATOR_PERF_M3U_CATALOG=1 IPTVNATOR_PERF_SMOKE=1` → so `m3u-import-catalog-380k`, 3 iteracoes, prazo de assentamento de 15 min.
3. Resultado registrado em `measurements.md` com a primeira fase que falha ou domina.

Estados de erro e degradacao previstos:

- Import do catalogo trava, estoura memoria ou passa do prazo: a rodada falha e o erro vira o dado principal de `measurements.md`.
- Harness falha no Windows por motivo conhecido da base: `measurements.md` registra "inconclusivo" e a medicao vai para Linux/macOS (C-09).

## Componentes ausentes

- Fixture de catalogo no formato de provedor.
- Seletor de cenario opt-in no contrato do benchmark.
- Prazo de assentamento por cenario.

## Aderência à Stack

- **Dados consumidos**: so fixture sintetica servida por `synthetic-m3u-server.ts` em `127.0.0.1`.
- **Padrão de fetching**: inalterado; o benchmark dirige o fluxo real de import por URL do app.
- **Auth requerida**: nao.
- **Restrições aplicáveis**: dados sinteticos (`AGENTS.md`); padrao opt-in do upstream (`IPTVNATOR_JOURNEY_LARGE_LIBRARY=1`); smoke nao sustenta afirmacao de performance (`m3u-playlist-module.md`); limite de 400 linhas por arquivo de TS.

## Fluxo de dados

```
benchmark → contrato (isM3uImportCatalogRun → listM3uImportScenarios) → createM3uImportScenarioFixture
  → synthetic-m3u-server (127.0.0.1) → app Electron (import por URL real)
  → captura por fase (main, renderer, worker) → summary.json → measurements.md
```

## Plano de execução

1. **T-002-01**: escrever e selar a guarda da fixture; criar `synthetic-m3u-catalog.ts`; alargar o tipo em `synthetic-m3u.ts`.
2. **T-002-02**: escrever e selar a guarda do cenario; mudar contrato, benchmark e spec do contrato; documentar a variavel.
3. **T-002-03**: rodar a smoke padrao (controle) e a smoke do catalogo; escrever `measurements.md`.
4. Fora deste plano: o usuario escolhe a correcao com base em `measurements.md` (C-10) e um plano novo e criado.

## Criterios de aceite

> Fonte unica: [`./checklist.md`](./checklist.md). Contratos tecnicos: [`./specs.md`](./specs.md).

## Backend pendings

Vazio. Nenhum endpoint ou schema novo.

## Knowledge mapped

- **Regras de negócio**: nao ha `docs/regras-de-negocio/`.
- **Postman**: nao ha `docs/postman/`.
- **Contratos lidos**: `docs/architecture/m3u-playlist-module.md` (benchmark de import), `docs/architecture/performance-journeys.md` (regras de thread de performance), `AGENTS.md`.
- **Stack ref**: `docs/stack.md` (ainda nao commitado).

## Tabela de regressão

- Cenarios formais 10k/50k/100k com os mesmos SHA-256 e a mesma agenda de iteracoes (`synthetic-m3u.spec.ts`, `m3u-import-benchmark-contract.spec.ts`).
- Servidor sintetico, relatorio e resumo do benchmark (`synthetic-m3u-server.spec.ts`, `m3u-import-report.spec.ts`, `m3u-import-summary.spec.ts`).
- Benchmark de cancelamento de refresh continua usando `createSyntheticM3uFixture()` sem mudanca.

## Anti-padrões

- ❌ Mudar codigo do app (`apps/electron-backend/src`, `apps/web`, `libs/`) neste plano.
- ❌ Acrescentar `tvg-*` ao gerador formal `synthetic-m3u.ts` ou mudar os SHA-256 dourados.
- ❌ Usar a playlist real, URL, credencial, titulo ou contagem exata de outro provedor como fixture.
- ❌ Mudar `project.json`, `playwright.performance.config.ts` ou `package.json`.
- ❌ Afirmar ganho ou regressao de performance a partir de rodada smoke.
- ❌ Rodar `prettier --write` no arquivo inteiro em `docs/**`.

## Riscos & Rollback

- A rodada do catalogo pode levar dezenas de minutos e estourar o limite de 30 min do Playwright; isso e um dado, registrado em `measurements.md`.
- O harness tem falhas de base no Windows; a medicao pode exigir outra maquina.
- Rollback: reverter os commits de T-002-01 e T-002-02; `measurements.md` e so do fork.
