---
# Roteiro do executor externo - PLAN-004-m3u-large-open
handoff_base: 82fa5eb49
---

# Roteiro do executor externo - PLAN-004-m3u-large-open

> Leia este arquivo INTEIRO antes do primeiro comando. Ele substitui o `CLAUDE.md` para voce. Onde o `specs.md` traz bloco de codigo, COPIE.

Contexto em uma frase: abrir uma M3U de 380k leva 144 s porque o `Playlist` com 380 mil objetos atravessa o IPC e o context bridge; este plano manda a playlist como texto JSON e faz o parse no renderer, com o kill switch `IPTVNATOR_DISABLE_JSON_PLAYLIST_READ=1`.

PRAZO: o orquestrador precisa do codigo pronto ate 13:30 (Brasilia) para gerar o instalador e validar com a lista real antes das 16:07.

## 1. O que e seu

| Task | Sua? | Tempo maximo |
|---|---|---|
| T-004-01 Worker, handler, preload e tipo | sim | 40 min |
| T-004-02 Renderer (`PlaylistsService`) e mapas do harness | sim | 40 min |
| T-004-03 Doc e nota de release | sim | 15 min |
| T-004-04 Medicao com a lista real e a sintetica | nao (orquestrador) | - |

Ordem: 01 → 02 → 03. Estourou o tempo sem o teste verde: PARE e escreva no `progress.md` o que falta e o ultimo erro.

## 2. Arvore

Worktree `E:/Github/monorepo-others/worktrees/iptvnator/plan-004`, branch `perf/playlist-json-read`, criada pelo orquestrador a partir de `perf/playlist-main-process-import` (`82fa5eb49`), com `pnpm install --frozen-lockfile` feito. Trabalhe so nela.

## 3. Regras (valem em toda task)

1. **NAO COMMITE.** Nao rode `git add`, `git commit`, `git stash`, `git reset`, `git checkout -- <arq>` nem `push`. No fim de cada task, liste no `progress.md` os arquivos exatos e a mensagem sugerida (Conventional Commits em ingles). Quem commita e o orquestrador.
2. Nunca escreva coautoria de IA em nada.
3. Nao rode nada contra provedor real. So mocks e `example.test`.
4. Edite com a ferramenta de edicao de arquivo, nunca `sed -i`. Nunca `prettier --write` em arquivo inteiro do upstream; formate so os arquivos novos.
5. Nao invente nome de funcao, tipo ou campo. Se faltar, PARE e registre.
6. Nao mexa em arquivo fora da tabela "Artefatos mapeados" do `plan.md`. `main.preload.ts`, `electron-api.interface.ts` e `playlists.service.ts` estao no baseline de linhas: mexa so nas linhas do trecho.
7. Logs nunca levam URL completa nem credencial.
8. Recursos: rode um comando pesado por vez. Antes de cada Jest ou lint, confira a RAM livre; se estiver abaixo de 6 GB, espere.

## 4. Como testar

Na raiz da worktree, com `NX_DAEMON=false`:

- C-01 `pnpm nx test electron-backend --runInBand --testPathPatterns=events/database --output-style=static`
- C-02 `pnpm nx test services --runInBand --testPathPatterns=playlists.service --output-style=static`
- C-03 `pnpm run typecheck:backend`
- C-04 `pnpm run typecheck:web`
- C-05 `pnpm nx run-many -t lint -p electron-backend,shared-interfaces --output-style=static`
- C-06 `pnpm nx run-many -t lint -p services,electron-backend-e2e --output-style=static`
- C-07 `pnpm run release:notes:validate`

Prova de que o teste novo pega o erro: depois de verde, troque o `typeof value === 'string'` por `false` (T-004-02), rode o C-02 e anote o exit (esperado 1); restaure e rode de novo (esperado 0). Faca o mesmo no handler, removendo o `format` (T-004-01, C-01).

## 5. Devolucao

No `progress.md`, por task: status, comandos rodados com exit, a mutacao (exit 1 e depois 0), os arquivos exatos e a mensagem de commit sugerida. Termine com "PRONTO PARA COMMIT" ou com o bloqueio.
