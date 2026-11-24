---
id: T-002-01
plan_id: PLAN-002-m3u-large-playlist-benchmark
seq: 01
title: Criar a fixture sintetica de catalogo com 380 mil entradas
area: tests
labels: [agent:tests, type:feature]
priority: P0
estimate: "2h"
status: concluido
valida_em: C-01
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O maior cenario do benchmark tem 100 mil entradas sem atributos (~9 MB); o caso real tem 380 mil com `tvg-*` (~96 MB). Sem fixture desse tamanho nao ha como reproduzir (discovery F-02, decisoes D-03 e D-04 do [plano](../plan.md)).

## Objetivo (O QUE)

`createSyntheticM3uCatalogFixture()` gera sempre o mesmo corpo de 90.544.398 bytes e SHA-256 `2d2028bb...51bf`, com 1.800 live, 48.000 filmes e 330.200 episodios, so com URLs de `127.0.0.1`.

### Entrega

- Guarda `synthetic-m3u-catalog.spec.ts` selada antes da implementacao.
- Modulo `synthetic-m3u-catalog.ts`.
- Tipo `SyntheticM3uFixture.channelCount` alargado para `number`.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| criar | `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.spec.ts` | guarda; copiar de `specs.md` |
| criar | `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.ts` | copiar de `specs.md` |
| editar | `apps/electron-backend-e2e/src/performance/synthetic-m3u.ts:23` | `readonly channelCount: number;` |

## Plano de execução (COMO)

- [ ] Criar a guarda com o trecho de `specs.md` e rodar `plan-gate.js PLAN-002 --selar-aceite` (nasce vermelha: modulo ausente)
- [ ] Criar `synthetic-m3u-catalog.ts` com o trecho de `specs.md`; rodar o Prettier so nesse arquivo novo
- [ ] Alargar o tipo em `synthetic-m3u.ts:23`
- [ ] Rodar `plan-gate.js PLAN-002` e conferir `VEREDITO: VERDE`
- [ ] Commit `test(performance): add a provider-shaped 380k M3U catalog fixture` com os 3 arquivos da task

## Critérios de aceitação (DoD)

- [ ] Repetir o roteiro de C-01 em `checklist.md` → exit 0
- [ ] `[não-ui]` Trocar `SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES` para `47_000` e rodar `node .a8z-local/run-guard.cjs apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.spec.ts` → exit 1 no SHA-256; restaurar → exit 0

## Riscos & Rollback

- Gerar 90 MB em memoria custa ~1 s e algumas centenas de MB no processo de teste.
- Rollback: `git revert <sha do commit da task>`
