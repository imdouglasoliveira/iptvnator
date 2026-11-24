---
id: T-001-02
plan_id: PLAN-001-m3u-download-timeout
seq: 02
title: Igualar o timeout de playlist do proxy do PWA em 120 s
area: infra
labels: [agent:backend, type:bug]
priority: P0
estimate: "2h"
status: concluido
valida_em: C-02
depends_on_backend: []
assignees: []
links: []
---

## Contexto (POR QUE)

O proxy do PWA usa `PROVIDER_REQUEST_TIMEOUT_MS.playlist = 30_000` na rota `/parse`, e o contrato de `host-connectivity-guard.md` exige os dois runtimes no mesmo numero (discovery F-02, decisoes D-01 e D-02 do [plano](../plan.md)).

## Objetivo (O QUE)

`PROVIDER_REQUEST_TIMEOUT_MS.playlist` vale `120_000`, `epg` continua `30_000` com comentario proprio, uma guarda prova os cinco valores e o doc de orcamentos diz playlist 120 s.

### Entrega

- Guarda `host-guard.spec.ts` selada antes da implementacao.
- Comentario e objeto novos em `host-guard.ts`.
- Expectativa de `/parse` em `web-backend-app.spec.ts` atualizada.
- Linhas 47-48 de `host-connectivity-guard.md` atualizadas.

## Arquivos (ONDE)

| Operação | Path | Nota |
|----------|------|------|
| criar | `apps/web-backend/src/app/host-guard.spec.ts` | guarda; copiar de `specs.md` |
| editar | `apps/web-backend/src/app/host-guard.ts:35-53` | comentario e objeto; copiar de `specs.md` |
| editar | `apps/web-backend/src/app/web-backend-app.spec.ts:151` | `timeout: 120000,` so nesta linha |
| editar | `docs/architecture/host-connectivity-guard.md:47-48` | trecho de `specs.md`; editar so essas linhas |

## Plano de execução (COMO)

- [x] Criar `host-guard.spec.ts` com o trecho de `specs.md` e rodar `plan-gate.js PLAN-001 --selar-aceite` (nasce vermelha)
- [x] Trocar comentario e objeto em `host-guard.ts`
- [x] Atualizar a linha 151 de `web-backend-app.spec.ts`
- [x] Atualizar `host-connectivity-guard.md:47-48`
- [x] Rodar `plan-gate.js PLAN-001` e conferir `VEREDITO: VERDE`
- [ ] Commit `fix(playlist): match the 120s playlist timeout in the web backend` com os 4 arquivos da task (orquestrador; sandbox impede escrita no indice)

## Critérios de aceitação (DoD)

- [x] Repetir o roteiro de C-02 em `checklist.md` → exit 0 com `host-guard.spec.ts` listado
- [x] `[não-ui]` Rodar `git grep -c -F "playlist: 120_000," -- apps/web-backend/src/app/host-guard.ts` → `1` (hoje exit 1)
- [x] `[não-ui]` Trocar `epg: 30_000` por `epg: 120_000` e rodar `node .a8z-local/run-guard.cjs apps/web-backend/src/app/host-guard.spec.ts` → exit 1 no teste "keeps the portal and EPG budgets unchanged"; restaurar → exit 0

## Riscos & Rollback

- PWA e Electron divergem se so uma das tasks for mergeada: as duas entram no mesmo PR.
- Rollback: `git revert <sha do commit da task>`
