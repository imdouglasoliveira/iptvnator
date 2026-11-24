---
plan_id: PLAN-004-m3u-large-open
generated_at: 2026-11-24T11:45:00-03:00
---

# Progress: PLAN-004

| T-ID | titulo | status | executor | notas |
|------|--------|--------|----------|-------|
| T-004-01 | Worker, handler, preload e tipo | concluido | claude (usuario escolheu) | 8e517da2c; C-01 2 suites/100 testes exit 0; C-03 exit 0 |
| T-004-02 | Renderer e mapas do harness | concluido | claude | 707d17eec; C-02 5 suites/102 exit 0; C-04 exit 0 |
| T-004-03 | Doc e nota | concluido | claude | 918545a4f; C-07 exit 0 (145 notas) |
| T-004-04 | Medicao lista real + sintetica | em_andamento | orquestrador | C-08 e C-09 feitos com a lista real (11:45); sintetica pendente |

## Linha do tempo

- 11:45 discovery, plan, specs, EXECUTOR e checklist escritos. Falta: o usuario escolher quem inicia o executor, a worktree `plan-004` e a branch `perf/playlist-json-read`.

- 11:30 usuario escolheu: Claude implementa direto. Worktree plan-004, branch perf/playlist-json-read (de 82fa5eb49).
- 11:35 merge em chore/local-build-m3u (d6fb709d9); make em background, log tmp/iptvnator/local-build-make-004.log.
- 11:40 T-004-03 commit 918545a4f (C-07 exit 0, 145 notas). 11:55 C-05/C-06 lint 4 projetos exit 0 (0 erros, so warnings da base). Pendente: mutacoes; depois do make: open-profile.cjs (C-08) e kill switch (C-09).
- Atencao antes de PR upstream: journeys (J1/J2) contam chamadas por metodo; dbGetAppPlaylist passa a ser dbGetAppPlaylistJson no getPlaylistById. Rodar journeys antes do PR.

## Medicao com a lista real (local-build d6fb709d9, banco isolado, 2026-11-24 11:45)

| Medida | Antes (kill switch ligado) | Depois (A-01) |
|---|---:|---:|
| Import por URL | 13,2 s | 11,9 s |
| Clique ate o primeiro canal visivel | 147,7 s | 29,6 s |
| Leitura isolada vista do renderer | 193,7 s (objeto) | 3,5 s IPC + 1,3 s JSON.parse |
| Maior long task no renderer | 0,59 s | 0,54 s |

Os 29,6 s restantes: o perfil do renderer fica quase todo ocioso (45,6 s idle). A espera esta fora do renderer, no main ou no worker (candidatos: leituras duplicadas do documento na abertura e o EPG dos 380k ids, A-02). Proximo passo de discovery: perfil do main na abertura.

Instalador: worktrees/iptvnator/local-build/dist/executables/iptvnator-0.25.0-windows-x64-setup.exe (11:39).

## Retomada

1. Criar a worktree `plan-004` (branch `perf/playlist-json-read` a partir de `82fa5eb49`), com `pnpm install --frozen-lockfile` e as juncoes `docs/plans` e `.a8z` como no plan-003.
2. Disparar o executor com o EXECUTOR.md.
3. Revisar o diff e commitar sem coautoria; fazer o merge em `chore/local-build-m3u`; rodar o make com `--parallel=1`.
4. Rodar `open-profile.cjs` (scratchpad) contra o novo `win-unpacked`; anotar C-08 e C-09.
