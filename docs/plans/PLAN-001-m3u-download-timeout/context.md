---
plan_id: PLAN-001-m3u-download-timeout
generated_at: 2026-11-23T22:30:00-03:00
---

# Contexto: timeout de download de playlist

## Arquivos relevantes

| Path | Função |
|------|--------|
| `apps/electron-backend/src/app/events/playlist-source.ts` | download e parse de M3U por URL; exporta `PLAYLIST_FETCH_TIMEOUT_MS` |
| `apps/electron-backend/src/app/workers/playlist-refresh.worker.ts` | refresh manual; importa a constante (nao editar) |
| `apps/electron-backend/src/app/events/playlist.events.ts` | handlers IPC `fetch-playlist-by-url` e auto-update (nao editar) |
| `apps/electron-backend/src/app/events/playlist.events.spec.ts` | espera `timeout: 30000` nas linhas 209 e 481 |
| `apps/electron-backend/src/app/events/playlist-source.performance.spec.ts` | modelo de mocks para o spec novo (nao editar) |
| `apps/electron-backend/src/app/util/validated-axios.ts` | cliente HTTP com redirects validados (nao editar) |
| `apps/web-backend/src/app/host-guard.ts` | `PROVIDER_REQUEST_TIMEOUT_MS` por rota do proxy |
| `apps/web-backend/src/app/web-backend-app.ts:612` | rota `/parse` usa `.playlist` (nao editar) |
| `apps/web-backend/src/app/web-backend-app.spec.ts` | espera `timeout: 30000` na linha 151 |
| `docs/architecture/m3u-playlist-module.md` | contrato de download, linha 453 |
| `docs/architecture/host-connectivity-guard.md` | orcamentos por runtime, linhas 47-48 |
| `.changes/README.md` | formato da nota de release |
| `node_modules/.pnpm/axios@1.21.0/node_modules/axios/lib/adapters/http.js:1538` | `req.setTimeout(timeout)`: inatividade de socket |

## Endpoints / regras-de-negócio referenciados

- IPC `fetch-playlist-by-url`  -  `playlist.events.ts:93`  -  método: invoke
- `/parse` do PWA  -  `web-backend-app.ts:612`  -  método: GET
- Issue upstream #931 (auto-update travado em host mudo)  -  motivo do timeout existir

## Decisões tomadas durante o planejamento

- 120 s em vez de timeout em duas fases (motivo: discovery D-01, A-02 rejeitada)
- EPG fica com 30 s (motivo: discovery D-02, XMLTV medido em 12,9 s)
- Dois planos separados; este so trata o timeout (motivo: pedido do usuario, discovery D-04)
- Commits e PR em ingles, Conventional Commits com escopo `playlist` (motivo: padrao do upstream, `git log` tem `fix(playlist)` e `feat(playlist)`)

## Riscos abertos

- Provedor que leve mais de 120 s continua falhando.
- O PR upstream deve conter so o codigo, os specs, os docs e a nota; a pasta `docs/plans/` e `docs/stack.md` sao do fork e ficam fora do PR.

## Notas curtas (livre)

- Comando de teste de uma guarda: `node .a8z-local/run-guard.cjs <spec>` (configurado em `.a8z/config.json`, so local).
- Base medida: lint de `electron-backend` e `web-backend` e `typecheck:backend` com exit 0 no commit 525adb045.
