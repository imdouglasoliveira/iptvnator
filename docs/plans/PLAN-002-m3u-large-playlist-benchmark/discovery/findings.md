---
plan_id: PLAN-002-m3u-large-playlist-benchmark
generated_at: 2026-11-23T23:00:00-03:00
---

# Achados complementares

| id | achado | evidencia | classe | status |
|---|---|---|---|---|
| F-04 | O handler `fetch-playlist-by-url` devolve o objeto `Playlist` inteiro ao renderer, que o reenvia ao main para o upsert | `apps/electron-backend/src/app/events/playlist.events.ts:105`; `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.ts` (dispatch `handleAddingPlaylistByUrl`) | follow-up | fora deste plano: plano de correcao decidido a partir de `measurements.md` |
| F-05 | O import nao avisa nem limita playlist muito grande | ausencia de guarda de tamanho no fluxo de import | follow-up | fora deste plano: alternativa A-03, decisao de UX do mantenedor |
| F-06 | Issue upstream #2081 relata CPU em 100% no main com M3U grande; #2199 relata `413 PROVIDER_RESPONSE_TOO_LARGE` com catalogo Xtream grande no PWA | `gh issue view` em 4gray/iptvnator | backlog | aberto |
