---
plan_id: PLAN-001-m3u-download-timeout
discovery_schema: v2
impact_class: critical-domain
modo: brownfield
generated_at: 2026-11-23T22:30:00-03:00
commit: 525adb045
---

# Discovery: download de M3U por URL falha em provedor lento

Arquivos irmaos: [findings.md](./findings.md).

## Demanda

Uma playlist M3U de teste, de um provedor Xtream real, nao importa no IPTVnator por nenhuma configuracao (M3U URL). O pedido e reproduzir, achar a causa e planejar a correcao seguindo o padrao de codigo do upstream (4gray/iptvnator). A execucao fica com um executor externo (Codex ou OpenCode).

## Modo detectado

brownfield. O download de playlist ja existe em dois runtimes: Electron (`apps/electron-backend/src/app/events/playlist-source.ts`, mais o worker de refresh) e PWA (`apps/web-backend/src/app/host-guard.ts` com a rota `/parse` em `web-backend-app.ts`). Os dois compartilham o mesmo orcamento de timeout por contrato (`docs/architecture/host-connectivity-guard.md`, secao "Request timeouts are the precondition").

## Problema

O provedor leva cerca de 52 s para enviar o primeiro byte de `get.php?type=m3u_plus` (a lista tem 96 MB e 380.100 entradas, gerada sob demanda). O IPTVnator corta qualquer salto HTTP de playlist apos 30 s sem bytes (`PLAYLIST_FETCH_TIMEOUT_MS = 30000`). O axios aborta com `ECONNABORTED timeout of 30000ms exceeded` e a tela mostra "Failed to fetch the playlist".

## Achados

| id | achado | evidencia | classe | status |
|---|---|---|---|---|
| F-01 | Timeout de inatividade de 30 s no download de playlist do Electron e menor que o tempo ate o primeiro byte do provedor | curl: `ttfb=52.479 total=55.290 size=96735774`; axios 1.21.0 do repo com `timeout: 30000`: `ECONNABORTED` em 30.033 ms; com `timeout: 120000`: `200`, 96.443.209 bytes | in-scope | resolvido no plano: T-001-01 |
| F-02 | O proxy do PWA usa o mesmo orcamento de 30 s para `/parse` (`PROVIDER_REQUEST_TIMEOUT_MS.playlist`) e falharia igual | `apps/web-backend/src/app/host-guard.ts:49`; comentario "matching the Electron handlers so both runtimes give up at the same point" | in-scope | resolvido no plano: T-001-02 |
| F-03 | Depois do download, a playlist inteira (380.100 itens, ~265 MB em JSON) cruza o IPC main para renderer e volta para o worker de banco | parse local: 916 ms, heap 1.232 MB, `JSON.stringify` 265 MB; `playlist.events.ts:105` devolve o objeto `Playlist` | follow-up | fora deste plano: PLAN-002-m3u-large-playlist-benchmark |

Achados restantes em [findings.md](./findings.md).

## Alternativas

| id | alternativa | custo | efeito | risco |
|---|---|---|---|---|
| A-01 | Subir o timeout de inatividade de playlist de 30 s para 120 s nos dois runtimes (uma constante em cada) | 2 constantes, 2 specs, 2 docs | Cobre provedor que leva ate 120 s para o primeiro byte; host morto continua limitado (issue #931) | Host mudo passa a levar 120 s para falhar, em vez de 30 s |
| A-02 | Timeout em duas fases: 120 s ate os headers e 30 s de inatividade no corpo | Hook novo em `validated-axios.ts` para trocar o `socket.setTimeout` depois da resposta, nos dois runtimes | Mesmo efeito de A-01 com corte mais rapido de corpo travado | Codigo novo no cliente HTTP compartilhado; o upstream ja documenta que o `timeout` do axios vale como inatividade do corpo e nao tem essa separacao |
| A-03 | Timeout configuravel pelo usuario por fonte | Campo novo em `Playlist`, formulario e migracao | Resolve qualquer provedor | Mudanca de UI e de dados persistidos para um caso que A-01 resolve |

## Decisoes

| id | decisao | motivo |
|---|---|---|
| D-01 | A-01 com 120 s | Menor mudanca que resolve o caso medido (52 s) com folga de 2x; segue o padrao do upstream de uma constante por runtime e mantem os dois runtimes iguais |
| D-02 | EPG continua com 30 s no PWA | XMLTV do mesmo provedor respondeu em 12,9 s; o comentario de `host-guard.ts` deixa de dizer que o EPG "takes the playlist budget" e passa a citar o valor proprio |
| D-03 | Xtream e Stalker nao mudam | Categorias Xtream respondem em menos de 0,5 s; `get_vod_streams` 19,3 s e `get_series` 12,6 s ficam abaixo de 30 s (registrado como backlog F-05) |
| D-04 | Escopo do usuario: so as duas causas principais (timeout e playlist grande); a playlist grande vai para PLAN-002 | Pedido do usuario em 2026-11-23 ("2 planos") |

## Nao pode quebrar

- Startup auto-update nao pode travar indefinidamente em host mudo (issue #931): `pnpm nx test electron-backend --runInBand --testPathPatterns=events/playlist` cobre `playlist-auto-update.spec.ts`.
- Os dois runtimes desistem no mesmo ponto (contrato de `host-connectivity-guard.md`).
- Timeouts de Xtream (30 s), Stalker (15 s, 30 s em `create_link`) e EPG (30 s) ficam como estao.
- User-Agent opcional, redirects validados, TLS e cancelamento do download continuam iguais (`m3u-playlist-module.md`, secao do User-Agent).

## Baseline

Medido em 2026-11-23 no commit 525adb045:

- `pnpm nx test electron-backend --runInBand --testPathPatterns=events/playlist --output-style=static` → exit 0, 4 suites, 36 testes.
- `pnpm nx test web-backend --runInBand --testPathPatterns=host-guard --output-style=static` → exit 0, 1 suite, 22 testes.
- `pnpm nx test web-backend --runInBand --testPathPatterns=web-backend-app.spec --output-style=static` → exit 0, 1 suite, 30 testes.
- `pnpm run release:notes:validate` → exit 0, "143 release note(s) valid."
- `git grep -c -F "export const PLAYLIST_FETCH_TIMEOUT_MS = 30000;" -- apps/electron-backend/src/app/events/playlist-source.ts` → 1.

## Incertezas

- O tempo ate o primeiro byte do provedor varia com a carga. 52 s foi uma medicao unica; 120 s cobre o dobro, mas um provedor mais lento ainda falha.
- O provedor pode limitar por User-Agent: `curl/*` recebe 403 do Cloudflare, enquanto axios, VLC, Chrome e okhttp recebem 200. O UA padrao do IPTVnator (axios) passou; nao ha garantia de que continue.
- Nao foi testado no app real se, com o timeout corrigido, a importacao de 380 mil itens completa. Isso e o PLAN-002.
