---
id: PLAN-001-m3u-download-timeout
plan_schema: v2
tela: Download de playlist M3U por URL (Electron e PWA)
objetivo: correcao
plan_kind: backend
impact_class: critical-domain
executor: externo
source: codigo
figma_url: null
demand_id: null
demand_type: fix
status: pendente
abandon_reason: null
parent_plan: null
children_plans: []
stack_ref: docs/stack.md@PENDENTE
arch_change: false
work_branch: master
created_at: 2026-11-23T22:30:00-03:00
validated_at: null
---

# Timeout de download de playlist M3U para provedor lento

## Contexto (POR QUE)

Um provedor Xtream real leva cerca de 52 s para enviar o primeiro byte da M3U (`get.php?type=m3u_plus`). O IPTVnator aborta o download apos 30 s sem bytes e mostra "Failed to fetch the playlist". Reproducao, medicoes e alternativas: [discovery/README.md](./discovery/README.md). Decisao D-01: subir o timeout de inatividade de playlist para 120 s nos dois runtimes, mantendo a mesma constante por runtime que o upstream ja usa.

## Artefatos mapeados

| Artefato | Papel hoje | Mudanca prevista | Task |
|----------|------------|------------------|------|
| `apps/electron-backend/src/app/events/playlist-source.ts:31` | `PLAYLIST_FETCH_TIMEOUT_MS = 30000`, usado no import por URL e no auto-update | valor `120000` e comentario citando o provedor lento | T-001-01 |
| `apps/electron-backend/src/app/workers/playlist-refresh.worker.ts:123` | importa a mesma constante para o refresh | nenhuma (herda o valor) | T-001-01 |
| `apps/electron-backend/src/app/events/playlist.events.spec.ts:209,481` | espera `timeout: 30000` | espera `timeout: 120000` | T-001-01 |
| `apps/electron-backend/src/app/events/playlist-source.spec.ts` | nao existe | guarda nova do valor e da passagem para o request | T-001-01 |
| `docs/architecture/m3u-playlist-module.md:453` | documenta 30s | documenta 120s e o motivo | T-001-01 |
| `apps/web-backend/src/app/host-guard.ts:49` | `PROVIDER_REQUEST_TIMEOUT_MS.playlist = 30_000` | `120_000`; comentario do `epg` cita o valor proprio | T-001-02 |
| `apps/web-backend/src/app/web-backend-app.spec.ts:151` | espera `timeout: 30000` na rota `/parse` | espera `timeout: 120000` | T-001-02 |
| `apps/web-backend/src/app/host-guard.spec.ts` | nao existe | guarda nova dos orcamentos por rota | T-001-02 |
| `docs/architecture/host-connectivity-guard.md:47-48` | "playlist and XMLTV downloads 30 s" | playlist 120 s, XMLTV 30 s | T-001-02 |
| `.changes/playlist-slow-m3u-download.md` | nao existe | nota de release `type: fix`, `area: playlist` | T-001-03 |

## Interações & Estados

Caminhos de uso que precisam funcionar depois do plano:

1. Electron, "Add playlist" > M3U URL de host que demora ate 120 s para os headers → download completa → playlist importada.
2. Electron, startup auto-update de playlist com `autoRefresh` → mesmo limite de 120 s por salto → um host mudo falha em 120 s e nao trava o startup (issue #931).
3. Electron, refresh manual da fonte → worker de refresh usa a mesma constante.
4. PWA, import por URL via `/parse` → proxy usa `PROVIDER_REQUEST_TIMEOUT_MS.playlist` = 120 s.

Estados de erro e degradacao previstos:

- Host que nao responde em 120 s: erro de timeout, mesma mensagem de hoje ("Failed to fetch the playlist").
- Corpo que para de chegar no meio: corte apos 120 s de inatividade (antes 30 s).

## Componentes ausentes

- Spec dedicado para `playlist-source.ts` (hoje so existe `playlist-source.performance.spec.ts`).
- Spec dedicado para `host-guard.ts` (hoje so existe `web-backend-app.host-guard.spec.ts`).

## Aderência à Stack

- **Dados consumidos**: resposta HTTP do provedor via `requestWithValidatedRedirects` (Electron) e `ValidatedHttpClient` (PWA), ver `docs/stack.md` secao 6.
- **Padrão de fetching**: inalterado; so muda o numero do orcamento.
- **Auth requerida**: nao.
- **Restrições aplicáveis**: os dois runtimes desistem no mesmo ponto (`docs/architecture/host-connectivity-guard.md`); dados sinteticos em teste e doc (`AGENTS.md`); nota em `.changes/` para mudanca visivel.

## Fluxo de dados

```
dialog M3U URL → DataService.fetchPlaylistDefinition → IPC fetch-playlist-by-url
  → playlist-source.fetchPlaylistFromUrl → requestWithValidatedRedirects(timeout = PLAYLIST_FETCH_TIMEOUT_MS)
  → axios req.setTimeout(120000) → parse → Playlist → renderer
PWA: /parse → web-backend-app (timeout = PROVIDER_REQUEST_TIMEOUT_MS.playlist) → parse → JSON
```

## Plano de execução

1. **T-001-01 (Electron)**: escrever e selar `playlist-source.spec.ts`; mudar a constante para `120000`; atualizar as duas expectativas de `playlist.events.spec.ts`; atualizar `m3u-playlist-module.md:453`.
2. **T-001-02 (PWA)**: escrever e selar `host-guard.spec.ts`; mudar `playlist` para `120_000` e o comentario do `epg`; atualizar `web-backend-app.spec.ts:151`; atualizar `host-connectivity-guard.md`.
3. **T-001-03 (nota)**: criar `.changes/playlist-slow-m3u-download.md` e validar.

## Criterios de aceite

> Fonte unica: [`./checklist.md`](./checklist.md). Contratos tecnicos: [`./specs.md`](./specs.md).

## Backend pendings

Vazio. Nenhum endpoint ou schema novo.

## Knowledge mapped

- **Regras de negócio**: nao ha `docs/regras-de-negocio/`.
- **Postman**: nao ha `docs/postman/`.
- **Contratos lidos**: `docs/architecture/m3u-playlist-module.md` (download contract, User-Agent), `docs/architecture/host-connectivity-guard.md` (budgets), `AGENTS.md`.
- **Stack ref**: `docs/stack.md` (ainda nao commitado; `stack_ref` recebe o sha no commit do plano).

## Tabela de regressão

- Startup auto-update isola falha por playlist e nao trava em host mudo (`playlist-auto-update.spec.ts`).
- Xtream continua com 30 s (`xtream.events.ts:135`) e Stalker com 15 s / 30 s.
- EPG do PWA continua com 30 s.
- User-Agent, redirect validado e TLS confiavel continuam passados no request de playlist (`playlist.events.spec.ts`).

## Anti-padrões

- ❌ Mexer em `validated-axios.ts` ou criar timeout em duas fases (alternativa A-02 rejeitada).
- ❌ Criar setting de timeout por fonte (A-03 rejeitada).
- ❌ Mudar timeout de Xtream, Stalker ou EPG.
- ❌ Usar URL, titulo, credencial ou payload do provedor real em teste, doc, commit ou PR; so `example.test`/`example.com` ou mock local.
- ❌ Rodar `prettier --write` no arquivo inteiro em `docs/**`.

## Riscos & Rollback

- Host mudo passa a levar ate 120 s para falhar no auto-update; o limite de concorrencia (`AUTO_UPDATE_CONCURRENCY` = 3) continua impedindo fila serial.
- Rollback: reverter os commits de T-001-01 e T-001-02 (`git revert <sha>`).
