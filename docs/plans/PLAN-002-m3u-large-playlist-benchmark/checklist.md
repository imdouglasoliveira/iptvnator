---
plan_id: PLAN-002-m3u-large-playlist-benchmark
checklist_schema: v3
manual_schema: v1
generated_at: 2026-11-23T23:00:00-03:00
---

# Checklist: benchmark de import M3U com catalogo de 380k

> Fonte unica do criterio de aceite. Contrato de linha: `- [ ] C-NN · <ACAO + ONDE> → <O QUE TEM DE APARECER>`.
> Itens que dependem de uma task posterior levam `[fechamento]`: o `plan-gate` roda todos os itens sem esse sufixo a cada task.

## Automatizavel

- [ ] C-01 · Rodar `cd apps/electron-backend-e2e && npx --no-install tsx --test src/performance/synthetic-m3u-catalog.spec.ts src/performance/synthetic-m3u.spec.ts` na raiz → exit 0 (hoje exit 1: modulo de catalogo ausente)
- [ ] C-02 · Rodar `cd apps/electron-backend-e2e && npx --no-install tsx --test src/performance/m3u-import-benchmark-catalog.spec.ts src/performance/m3u-import-benchmark-contract.spec.ts` na raiz → exit 0 (hoje exit 1) [fechamento]
- [ ] C-03 · Rodar `pnpm nx lint electron-backend-e2e --output-style=static` na raiz → exit 0 (hoje exit 0) [fechamento]

## Gates deterministicos

- [ ] C-04 · Rodar `git grep -c -F "IPTVNATOR_PERF_M3U_CATALOG=1" -- docs/architecture/m3u-playlist-module.md` na raiz → exit 0 e contagem 1 (hoje exit 1) [fechamento]
- [ ] C-05 · Rodar `git grep -c -F "createSyntheticM3uFixture(scenario.channelCount)" -- apps/electron-backend-e2e/src/performance/m3u-import-benchmark-contract.ts` na raiz → exit 0 e contagem 1 (hoje exit 1) [fechamento]
- [ ] C-06 · Rodar `git grep --untracked -c -E "^## (Ambiente|Controle|Catalogo 380k|Primeira fase que falha|Proposta)$" -- docs/plans/PLAN-002-m3u-large-playlist-benchmark/measurements.md` na raiz → exit 0 e contagem 5 (hoje exit 1) [fechamento]
- [ ] C-07 · Rodar `git grep -c -F "setDefaultTimeout(120_000)" -- apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts` na raiz → exit 1, sem ocorrencia (hoje exit 0, 1 ocorrencia) [fechamento]
- [ ] C-08 · Rodar `git grep -c -F "readonly channelCount: SyntheticM3uChannelCount;" -- apps/electron-backend-e2e/src/performance/synthetic-m3u.ts` na raiz → exit 1, sem ocorrencia (hoje exit 0, 1 ocorrencia)

## Manual

- [ ] C-09 · Se `measurements.md` disser "inconclusivo" por causa do harness no Windows, rodar a mesma smoke do catalogo numa maquina Linux ou macOS
      → `measurements.md` passa a ter os campos de fase da iteracao `run-01` preenchidos [humano: irreproduzivel: falha de base do harness no Windows]
- [ ] C-10 · Ler `## Primeira fase que falha` e `## Proposta` em `measurements.md` → o usuario registra a alternativa escolhida (A-02, A-03 ou outra) e pede o plano de correcao [humano: julgamento]

## Regressao

- [ ] C-11 · Rodar `cd apps/electron-backend-e2e && npx --no-install tsx --test src/performance/synthetic-m3u-server.spec.ts src/performance/m3u-import-report.spec.ts src/performance/m3u-import-summary.spec.ts` na raiz → exit 0 (hoje exit 0, 10 testes)

## Nao e defeito

- A rodada smoke do catalogo falhar, travar ou estourar o tempo  -  e o resultado que o plano quer medir; o defeito so existe se `measurements.md` nao registrar a falha.
- `pnpm nx run electron-backend-e2e:test-performance-harness` com exit 1  -  5 falhas de base no Windows, fora deste plano; o checklist roda so os specs tocados.
- A fixture de catalogo ter `tvg-*`  -  proposital (D-03); a formal continua sem.
