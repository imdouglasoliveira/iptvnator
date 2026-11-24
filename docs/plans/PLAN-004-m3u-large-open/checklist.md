---
plan_id: PLAN-004-m3u-large-open
checklist_schema: v3
generated_at: 2026-11-24T11:45:00-03:00
---

# Checklist: playlist em texto JSON

## Automatizavel

- [ ] C-01 · `pnpm nx test electron-backend --runInBand --testPathPatterns=events/database --output-style=static` → exit 0, com `playlist-json-read.spec.ts` entre as suites
- [ ] C-02 · `pnpm nx test services --runInBand --testPathPatterns=playlists.service --output-style=static` → exit 0, com `playlists.service.json-read.spec.ts` entre as suites
- [ ] C-03 · `pnpm run typecheck:backend` → exit 0
- [ ] C-04 · `pnpm run typecheck:web` → exit 0
- [ ] C-05 · lint `electron-backend,shared-interfaces` → exit 0
- [ ] C-06 · lint `services,electron-backend-e2e` → exit 0
- [ ] C-07 · `pnpm run release:notes:validate` → exit 0, uma nota a mais

## Orquestrador

- [ ] C-08 · Instalador local com a branch e `open-profile.cjs` com a lista real (banco isolado) → `dbGetAppPlaylist` de 106 s para menos de 15 s e o primeiro canal visivel em menos de 30 s (hoje 143,9 s)
- [ ] C-09 · O mesmo com `IPTVNATOR_DISABLE_JSON_PLAYLIST_READ=1` → o tempo volta para a ordem de 100 s (prova do kill switch)
- [ ] C-10 · `pnpm nx run electron-backend-e2e:e2e` nos specs de playlist M3U, com o paralelismo ajustado a CPU e RAM livres → exit 0 (depois das 16:07; nao depende da lista real)

## Humano

- [ ] C-11 · O usuario abre a lista real no app instalado e confirma que a navegacao ficou usavel [julgamento]
