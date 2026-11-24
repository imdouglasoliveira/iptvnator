---
plan_id: PLAN-001-m3u-download-timeout
checklist_schema: v3
manual_schema: v1
generated_at: 2026-11-23T22:30:00-03:00
---

# Checklist: timeout de download de playlist

> Fonte unica do criterio de aceite. Contrato de linha: `- [ ] C-NN · <ACAO + ONDE> → <O QUE TEM DE APARECER>`.

## Automatizavel

- [ ] C-01 · Rodar `pnpm nx test electron-backend --runInBand --testPathPatterns=events/playlist --output-style=static` na raiz → exit 0, com `playlist-source.spec.ts` entre as suites (hoje 4 suites, 36 testes)
- [ ] C-02 · Rodar `pnpm nx test web-backend --runInBand --testPathPatterns=host-guard --output-style=static` na raiz → exit 0, com `host-guard.spec.ts` entre as suites (hoje 1 suite, 22 testes)
- [ ] C-03 · Rodar `pnpm nx test web-backend --runInBand --testPathPatterns=web-backend-app.spec --output-style=static` na raiz → exit 0 (hoje 1 suite, 30 testes)
- [ ] C-04 · Rodar `pnpm run release:notes:validate` na raiz → exit 0 e "144 release note(s) valid." (hoje 143)
- [ ] C-05 · Rodar `pnpm nx lint electron-backend --output-style=static` na raiz → exit 0 (hoje exit 0) [fechamento]
- [ ] C-06 · Rodar `pnpm nx lint web-backend --output-style=static` na raiz → exit 0 (hoje exit 0) [fechamento]
- [ ] C-07 · Rodar `pnpm run typecheck:backend` na raiz → exit 0 (hoje exit 0) [fechamento]

## Gates deterministicos

- [ ] C-08 · Rodar `git grep -c -F "export const PLAYLIST_FETCH_TIMEOUT_MS = 120000;" -- apps/electron-backend/src/app/events/playlist-source.ts` na raiz → exit 0 e contagem 1 (hoje exit 1)
- [ ] C-09 · Rodar `git grep -c -F "playlist: 120_000," -- apps/web-backend/src/app/host-guard.ts` na raiz → exit 0 e contagem 1 (hoje exit 1) [fechamento]
- [ ] C-10 · Rodar `git grep -c -F "(120s, exported by" -- docs/architecture/m3u-playlist-module.md` na raiz → exit 0 e contagem 1 (hoje exit 1)
- [ ] C-11 · Rodar `git grep -c -F "playlist downloads 120 s" -- docs/architecture/host-connectivity-guard.md` na raiz → exit 0 e contagem 1 (hoje exit 1) [fechamento]

## Manual

- [ ] C-12 · No Electron (`pnpm run serve:backend` + `pnpm run serve:frontend`), Add playlist → M3U URL com a conta de teste do provedor lento
      → aos 60 s o dialogo ainda esta carregando, sem "Failed to fetch the playlist", e o terminal do main nao mostra `ECONNABORTED` [humano: credencial]

## Regressao

- [ ] C-13 · Rodar `git grep -c -F "timeout: 30000, // 30 seconds timeout for Xtream API" -- apps/electron-backend/src/app/events/xtream.events.ts` na raiz → exit 0 e contagem 1 (hoje 1)
- [ ] C-14 · Rodar `git grep -c -F "epg: 30_000," -- apps/web-backend/src/app/host-guard.ts` na raiz → exit 0 e contagem 1 (hoje 1)

## Nao e defeito

- Host mudo leva ate 120 s para falhar no import e no auto-update  -  e o novo limite; o processo continua limitado (issue #931).
- Specs com a mensagem simulada `timeout of 30000ms exceeded`  -  texto de mock que nao assevera a constante.
- C-12 depende de playlist grande: se o download completar e a importacao travar depois, o defeito e o do PLAN-002, nao deste plano.
