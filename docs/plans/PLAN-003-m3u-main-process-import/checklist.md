---
plan_id: PLAN-003-m3u-main-process-import
checklist_schema: v3
manual_schema: v1
generated_at: 2026-11-24T00:30:00-03:00
---

# Checklist: import de M3U por URL persistido no main

> Fonte unica do criterio de aceite. Contrato de linha: `- [ ] C-NN · <ACAO + ONDE> → <O QUE TEM DE APARECER>`.
> Itens que dependem de task posterior levam `[fechamento]`: o `plan-gate` roda os demais a cada task.
> Base medida em `0d9986607` (branch `test/m3u-catalog-benchmark`).

## Automatizavel

- [ ] C-01 · Rodar `pnpm nx test electron-backend --runInBand --testPathPatterns=events/playlist --output-style=static` na raiz → exit 0, com `playlist-url-import.spec.ts` entre as suites (hoje 4 suites, 36 testes)
- [ ] C-02 · Rodar `pnpm nx test playlist-import-feature --runInBand --testPathPatterns=url-playlist-import --output-style=static` na raiz → exit 0 com `url-playlist-import.main-persist.spec.ts` entre as suites (hoje 1 suite, 21 testes) [fechamento]
- [ ] C-03 · Rodar `pnpm nx test m3u-state --runInBand --output-style=static` na raiz → exit 0 (hoje 7 suites, 53 testes)
- [ ] C-04 · Rodar `pnpm run typecheck:backend` na raiz → exit 0 (hoje exit 0)
- [ ] C-05 · Rodar `pnpm run typecheck:web` na raiz → exit 0 (hoje exit 0) [fechamento]
- [ ] C-06 · Rodar `pnpm nx run-many -t lint -p electron-backend,shared-interfaces,services,web,m3u-state,playlist-import-feature,electron-backend-e2e --output-style=static` na raiz → exit 0 (hoje exit 0) [fechamento]
- [ ] C-07 · Rodar `pnpm run release:notes:validate` na raiz → exit 0 e uma nota a mais que antes da task T-003-03 [fechamento]

## Automatizavel por agente

- [ ] C-08 · Rodar `pnpm nx run electron-backend-e2e:e2e -- src/playlist-auto-refresh.e2e.ts` na raiz → exit 0: import por URL com User-Agent passa pelo caminho novo [fechamento]

## Gates deterministicos

- [ ] C-09 · Rodar `git grep -c -F "'import-playlist-by-url'" -- apps/electron-backend/src/app/events/playlist.events.ts apps/electron-backend/src/app/api/main.preload.ts` na raiz → exit 0, uma ocorrencia em cada arquivo (hoje exit 1)
- [ ] C-10 · Rodar `git grep -c -F "IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT" -- docs/architecture/m3u-playlist-module.md` na raiz → exit 0 e contagem 1 (hoje exit 1) [fechamento]
- [ ] C-11 · Rodar `git grep -c -F "fetch-playlist-by-url" -- apps/electron-backend/src/app/events/playlist.events.ts` na raiz → exit 0 e contagem 1: o IPC antigo continua (hoje 1)

## Manual

- [ ] C-12 · Ler a tabela antes/depois em `docs/plans/PLAN-003-m3u-main-process-import/measurements.md`
      → o trecho "normalizacao ate o pedido de gravacao" cai de ~175 s para poucos segundos no "depois" e o total ate o terminal cai na mesma ordem; o usuario aceita o ganho e o custo de dois caminhos ate a remocao do kill switch [humano: julgamento]

## Regressao

- [ ] C-13 · Rodar `cd apps/electron-backend-e2e && npx --no-install tsx --test src/performance/m3u-import-benchmark-catalog.spec.ts src/performance/m3u-import-benchmark-contract.spec.ts` na raiz → exit 0 (hoje exit 0)

## Nao e defeito

- O caminho antigo continua no codigo  -  e o kill switch (D-02); sai em ate duas releases.
- O PWA nao muda (D-03).
- A rota ainda leva ~90 s para mostrar os canais de uma playlist de 380k  -  F-03, plano seguinte.
- O `summary.json` do benchmark pode nao sair por `phase-order` (PLAN-002 F-07); a medicao usa a timeline bruta.
