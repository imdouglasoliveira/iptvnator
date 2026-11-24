---
plan_id: PLAN-003-m3u-main-process-import
generated_at: 2026-11-24T00:30:00-03:00
---

# Progress: import de M3U por URL persistido no main

> Complementa o `progress.txt` global (indice do plano ativo); nao o substitui.

## Tasks

| T-ID | titulo | status | iniciado | concluido | notas |
|------|--------|--------|----------|-----------|-------|
| T-003-01 | Gravar no processo principal a playlist importada por URL | concluido | 2026-11-24 | 2026-11-24 | Guarda selada; Jest direto 5 suites/39 testes; mutacao exit 1, restauracao exit 0. Gate rapido VERMELHO por cache nativo SWC no sandbox (C-01/C-03); C-04/C-09/C-11/C-13 verdes. |
| T-003-02 | Registrar no renderer a playlist ja gravada pelo main | concluido | 2026-11-24 | 2026-11-24 | Jest direto: 23 testes do import (21 legados + 2 novos), 86 do estado; typecheck:web exit 0; mutacao exit 1 e restauracao exit 0. C-02/Nx e gate rapido VERMELHO pelo cache SWC. |
| T-003-03 | Documentar o import pelo main e adicionar a nota de release | concluido | 2026-11-24 | 2026-11-24 | C-07 exit 0: 143 para 144 notas validas; C-10 exit 0, contagem 1. Gate rapido VERMELHO (C-01/C-03 no cache SWC). |
| T-003-04 | Medir o import de 380k antes e depois com o benchmark de catalogo | em_andamento | 2026-11-24 | | condicao de assentamento corrigida em `82fa5eb49`; rodada em `measure-003c.log` |

## Blockers

| id | tipo | descricao | status |
|----|------|-----------|--------|

## Backend pendings

| gap-key | ClickUp ID | status | bloqueia |
|---------|------------|--------|----------|

## Devolucao do executor

Executor: codex, local, worktree `perf/playlist-main-process-import`, base `0d9986607`. Autorizacao confirmada com exit 0. T-003-01, T-003-02 e T-003-03 concluidas na implementacao; os comandos Nx de aceite continuam pendentes de repeticao fora do bloqueio de ambiente. T-003-04 em_andamento: **medicao com o orquestrador**.

### Ultima linha do plan-gate rapido por task

| Task | Ultima linha |
|------|--------------|
| T-003-01 | VEREDITO: VERMELHO (comandos) |
| T-003-02 | VEREDITO: VERMELHO (comandos) |
| T-003-03 | VEREDITO: VERMELHO (comandos) |
| T-003-04 | VEREDITO: VERMELHO (comandos) |

O gate rapido foi rodado depois de cada task. Em todas, C-01/C-03 falharam antes de executar testes, na descoberta do Nx; C-04/C-09/C-11/C-13 passaram. Aviso de handoff_base sem aceite.txt acessivel esperado. Nao foi usado `--fechamento`.

### Arquivos exatos para commit pelo orquestrador

T-003-01 — `perf(playlist): persist URL imports in the main process` (8 arquivos):

- `apps/electron-backend/src/app/events/playlist-url-import.spec.ts`
- `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.main-persist.spec.ts`
- `libs/shared/interfaces/src/lib/playlist-url-import.ts`
- `libs/shared/interfaces/src/index.ts`
- `libs/shared/interfaces/src/lib/electron-api.interface.ts`
- `apps/electron-backend/src/app/events/playlist-url-import.ts`
- `apps/electron-backend/src/app/events/playlist.events.ts`
- `apps/electron-backend/src/app/api/main.preload.ts`

T-003-02 — `perf(playlist): register main-process URL imports in the store` (6 arquivos):

- `libs/services/src/lib/data.service.ts`
- `apps/web/src/app/services/electron.service.ts`
- `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.ts`
- `libs/m3u-state/src/lib/actions.ts`
- `libs/m3u-state/src/lib/reducers/playlist.reducers.ts`
- `libs/m3u-state/src/lib/effects.ts`

T-003-03 — `docs(playlist): document main-process URL imports` (2 arquivos):

- `docs/architecture/m3u-playlist-module.md`
- `.changes/playlist-large-m3u-import.md`

T-003-04 — `test(performance): measure main-process URL imports in the catalog benchmark` (1 arquivo; task ainda aberta):

- `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts`

Os arquivos locais do plano, incluindo esta devolucao e os quatro frontmatters, ficam fora dos commits e do PR. Nao foi criado `measurements.md`: o orquestrador executa e documenta as duas smokes.

### Evidencias e mutacoes do DoD

- Selagem unica: `VEREDITO: SELADO (2 guardas)`, ambas exit 1 antes da implementacao. Guarda 1 falhou por modulo inexistente; guarda 2 falhou comportamentalmente nos dois testes (o runner transpila sem exigir o tipo/acao ainda ausentes). As guardas nao foram editadas depois de seladas.
- T-003-01: desativar o ramo do kill switch com `if (false)` produziu exit 1 no terceiro teste, por escrita indevida no worker. Restaurar produziu exit 0, 3 testes verdes.
- T-003-02: adicionar dispatch de `handleAddingPlaylistByUrl` no ramo persisted produziu exit 1, por 2 dispatches em vez de 1. Restaurar produziu exit 0, 2 testes verdes.
- Jest direto com os configs dos projetos: import backend 5 suites/39 testes; import renderer 2 suites/23 testes (21 legados + 2 novos); m3u-state 15 suites/86 testes. Todos exit 0. Esses resultados nao substituem o exit dos comandos Nx exigidos.
- C-04 typecheck backend e C-05 typecheck web: exit 0.
- C-07: release:notes:validate exit 0, 143 para 144 notas validas. C-10: exit 0, uma ocorrencia.
- C-13 manual: exit 0, 2 suites/8 testes. Typecheck do programa de specs electron-backend-e2e: exit 0.
- C-06 via Nx: exit 1 pelo mesmo bloqueio de cache. ESLint direto nos 15 arquivos TypeScript tocados: exit 0, 5 warnings em linhas anteriores; regra de fronteiras Nx ignorada por falta de ProjectGraph. Nao equivale ao C-06 completo.
- agents:validate: exit 0 (3 arquivos de orientacao). git diff --check: exit 0. Diff inteiro revisado; apenas dados sinteticos.

### Desvios, limites e ponto de retomada

- Nx nao descobre o grafo mesmo com NX_DAEMON=false: o SWC retorna ERR_SWC_NATIVE_CACHE por dono do cache padrao nao confiavel no sandbox; cache temporario tambem foi recusado pela DACL. Nao foram alteradas permissoes, dependencias, configuracoes ou protecoes para contornar isso. Nao foi usado NX_PREFER_TS_NODE.
- Node disponivel no PATH: v24.14.0; .nvmrc exige 24.22.1. Essa versao nao esta instalada no NVM local. pnpm 10.33.0. Instalacao preparada foi preservada; lockfiles diferem apenas em finais de linha (git diff --no-index sem diferenca textual).
- C-01/C-02/C-03/C-06 via Nx precisam ser repetidos no ambiente do orquestrador. C-08 Electron E2E ficou pendente pelo bloqueio Nx/ambiente; nao houve prova de runtime Electron. C-12 continua humano e depende das medicoes.
- Nenhum git add, commit, stash, escrita de indice ou push foi executado. Nenhum provedor real foi acessado. Nenhuma smoke antes/depois foi iniciada.
- Retomada: orquestrador revisa/commita os grupos acima, repete os comandos Nx, executa C-08 e as duas smokes no mesmo build conforme specs.md, escreve measurements.md, e mantem T-003-04 aberta ate registrar as medidas e o julgamento humano C-12.

## Sessao 2026-11-24, orquestrador

### Commits (branch `perf/playlist-main-process-import`, sem push)

- `3c2b464c4` perf(playlist): persist URL imports in the main process
- `65d38f10c` perf(playlist): register main-process URL imports in the store
- `0ca7109ab` docs(playlist): document main-process URL imports
- `7e57b3fd0` test(performance): measure main-process URL imports in the catalog benchmark
- `82fa5eb49` test(performance): expect the worker upsert on both catalog import paths

### Medicao (T-003-04)

- Antes (kill switch ligado), 1a rodada: warmup `total=279946ms` (igual ao PLAN-002); run-01 caiu em "exactly one application GET" (causa nao confirmada).
- Depois: o import de 380k chega a lista (print do usuario), mas o teste travava no assentamento do banco.
- Causa: a premissa da revisao ("upsert direto no worker nao aparece no status") estava errada. Diagnostico com log temporario: no caminho novo o status assenta em `requests=2, upserts=1, gets=1, pending=0, preloadMarkers=1`. A condicao exigia `requests=1`. Corrigido em `82fa5eb49`: mesma condicao nos dois caminhos, so `preloadSuccessMarkers` difere (2 antigo, 1 novo). Lint do electron-backend-e2e: 0 erros.
- Rodadas anteriores tambem cairam porque a janela foi fechada a mao (Electron `code=0`). Nao ha crash do main.
- Rodada de 02:03 (-03) interrompida a pedido do usuario: "antes" caiu em 4,0 min com a janela fechada; "depois" foi encerrada no meio (02:12). Nenhum numero novo; repetir a medicao completa com a maquina livre.

### Build local para o usuario

- Worktree `local-build`, branch `chore/local-build-m3u` (merge de `fix/playlist-slow-m3u-download` sobre este plano), sem push.
- `pnpm nx run electron-backend:make --arch=x64 --publishPolicy=never --parallel=1` (em paralelo o `web:build` falha por concorrencia).
- Instalador `dist/executables/iptvnator-0.25.0-windows-x64-setup.exe` instalado pelo usuario; `app.asar` conferido identico. Sem Embedded MPV (runtime ausente).

### Lista real

- Teste do provedor venceu 2026-11-24 01:38; a URL responde 200 com 1 canal "Assinatura vencida". Com banco isolado o build importa e grava em ~0,45 s. Validacao com lista grande real exige link novo.
- Incidente: o primeiro script de teste nao isolou o banco (`IPTVNATOR_E2E_DATA_DIR`) e gravou a playlist "Teste local" no banco real do usuario; a segunda execucao deu `SqliteError: database is locked` com o app aberto. Usuario pode apagar a playlist.

### Achados para depois (issues no fork, nao no upstream)

- imdouglasoliveira/iptvnator#1: erro de gravacao vira "Failed to fetch the playlist" (`importErrorKey`).
- imdouglasoliveira/iptvnator#2: exclusao de playlist M3U nao conclui.

### Retomada

1. Rodar de novo `bash E:/Github/monorepo-others/tmp/iptvnator/measure-003.sh` com a maquina livre (sem fechar janelas); com `before_exit=0` e `after_exit=0`, escrever `measurements.md`.
2. C-08 e repeticao de C-01/C-02/C-03/C-06 via Nx fora do sandbox.
3. `plan-gate.js PLAN-003 --fechamento`; fechar T-003-04; C-12 com o usuario.
