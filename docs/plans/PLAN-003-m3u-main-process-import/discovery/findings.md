---
plan_id: PLAN-003-m3u-main-process-import
generated_at: 2026-11-24T00:30:00-03:00
---

# Achados complementares

| id | achado | evidencia | classe | status |
|---|---|---|---|---|
| F-04 | `fetch-playlist-by-url` tambem atende `source-materializer.ts`, que precisa do snapshot sem gravar | `libs/services/src/lib/source-sync/source-materializer.ts:62` | in-scope | resolvido por D-01 |
| F-05 | `addPlaylist$` emite `SourceHealthEvidenceService.connections` com a playlist gravada; o caminho novo precisa emitir com a meta | `playlists.service.ts:406` | in-scope | resolvido no plano: T-003-02 |
| F-06 | `effects.ts`, `main.preload.ts` e `electron-api.interface.ts` estao no `max-lines-baseline`; crescem poucas linhas | `tools/eslint/max-lines-baseline.mjs` | backlog | aberto |
| F-07 | O validador de relatorio do benchmark rejeita a ordem das fases com 380k (`phase-order`) | PLAN-002 `measurements.md` | follow-up | fora deste plano: harness de performance |
