---
# Roteiro do executor externo  -  PLAN-001-m3u-download-timeout
# handoff_base e gravado por plan-authorize.js record
handoff_base: 525adb045
---

# Roteiro do executor externo  -  PLAN-001-m3u-download-timeout

> Leia este arquivo INTEIRO antes do primeiro comando. Ele substitui o `CLAUDE.md` para voce. Onde o
> `specs.md` traz bloco de codigo, COPIE. Base: `origin/master` `525adb045` (2026-11-23).

Contexto em uma frase: o download de playlist M3U desiste apos 30 s sem bytes e um provedor real leva ~52 s para o primeiro byte; o plano sobe esse orcamento para 120 s no Electron e no proxy do PWA, no padrao de codigo do upstream (4gray/iptvnator).

## 1. O que e seu

| Task | Sua? | Tempo maximo |
|---|---|---|
| T-001-01 Subir o timeout de download de playlist do Electron para 120 s | sim | 45 min |
| T-001-02 Igualar o timeout de playlist do proxy do PWA em 120 s | sim | 45 min |
| T-001-03 Adicionar a nota de release do timeout de playlist | sim | 15 min |
| C-12 do `checklist.md` (teste com a conta real do provedor) | nao ([NOSSO], credencial) | - |

Ordem obrigatoria: 01 → 02 → 03. Estourou o tempo sem o teste da task verde: PARE e escreva no `progress.md`
o que falta e o ultimo erro. Itens do `checklist.md` com `[fechamento]`, `⏳` ou `[humano: ...]` nao sao seus.

## 2. Preparar a arvore (uma vez)

```bash
git fetch origin
git worktree add ../../worktrees/iptvnator/plan-001 -b fix/playlist-slow-m3u-download <handoff_base>
cd ../../worktrees/iptvnator/plan-001
pnpm install --frozen-lockfile
```

O projeto esta no workspace `monorepo-others` (`a8z.workspace.json`): a worktree vai em `<ws>/worktrees/iptvnator/plan-001` e os temporarios em `<ws>/tmp/iptvnator/`, nunca em `%TEMP%` nem `/tmp`. Cada worktree precisa do proprio `pnpm install --frozen-lockfile` (`AGENTS.md`). Copie `.a8z-local/` e `.a8z/config.json` do clone principal para a worktree (sao locais e nao estao no git): o `plan-gate` usa `.a8z-local/run-guard.cjs` para rodar as guardas.

## 3. Regras (valem em toda task)

1. Nao aplique migration, nao publique nada, nao mexa em segredo, nao rode nada contra provedor real.
2. Commit por task, so dos arquivos da task: `git commit -m "<msg>" -- <arquivos>`. Mensagem em Conventional
   Commits, descricao em ingles (padrao do upstream), com a mensagem indicada na task e o rodape
   `Refs: PLAN-001 T-001-NN`. Nunca `git add -A`, `git stash`, `git checkout -- <arq>`, `git reset --hard`.
3. Edite com a ferramenta de edicao de arquivo, nunca `sed -i` nem script de patch.
4. Escreva as guardas da task nos caminhos de `aceite.txt` ANTES de implementar e rode
   `plan-gate.js PLAN-001 --selar-aceite`; depois de selada, nao edite a guarda. Guarda errada: PARE e registre.
5. **Remover e apagar o codigo.** O valor antigo sai da linha; C-08 a C-11 do `checklist.md` conferem o valor novo.
6. Nao invente nome de funcao, constante ou campo; faltou, PARE e registre.
7. Nao mexa em arquivo fora da tabela `## Arquivos` da task; nao crie guia, retrospectiva ou doc, e nao mexa em
   `.gitattributes`, `package.json` ou config de teste.
8. Nunca rode `prettier --write` no arquivo inteiro em `docs/**`; edite so as linhas indicadas.
9. Dados sinteticos apenas: URLs `example.test`/`provider.example`. Nunca copie URL, usuario, senha ou titulo de provedor real.
10. Ao marcar a task `concluido` no frontmatter, atualize a MESMA linha do `progress.md`: o gate compara os dois.
11. Nao faca push. O push de plano delegado exige o recibo do fechamento.

### Nao toque

Gerado por `git grep -l -e PLAYLIST_FETCH_TIMEOUT_MS -e PROVIDER_REQUEST_TIMEOUT_MS` mais os vizinhos do fluxo. Estes arquivos nao entram no diff:

- `apps/electron-backend/src/app/workers/playlist-refresh.worker.ts` (herda a constante)
- `apps/web-backend/src/app/web-backend-app.ts` (le `PROVIDER_REQUEST_TIMEOUT_MS.playlist`)
- `apps/electron-backend/src/app/util/validated-axios.ts`
- `apps/electron-backend/src/app/events/xtream.events.ts`, `stalker.events.ts`
- `apps/electron-backend/src/app/events/playlist-auto-update.spec.ts`

## 4. Como testar (sempre a mesma linha)

- Durante a task: `node .a8z/scripts/tools/plan-gate.js PLAN-001`.
- No fim, uma vez: `node .a8z/scripts/tools/plan-gate.js PLAN-001 --fechamento`.
- O oraculo e a ultima linha `VEREDITO:` (0 verde, 1 vermelho, 2 inconclusivo), nunca so o `$?`. Logs em
  `.a8z-local/plan-gate/PLAN-001/`.
- Vermelhos da BASE (nao conserte): nenhum. Medido em 525adb045: testes de `events/playlist` (4 suites, 36), `host-guard` (22) e `web-backend-app.spec` (30) verdes, lint de `electron-backend` e `web-backend` e `typecheck:backend` com exit 0.

## 5. Task por task

### T-001-01 · Subir o timeout de download de playlist do Electron para 120 s

- Guardas: `apps/electron-backend/src/app/events/playlist-source.spec.ts`  -  escrever (trecho de `specs.md`), selar, depois implementar
- `playlist-source.ts:25-31`: comentario e `export const PLAYLIST_FETCH_TIMEOUT_MS = 120000;` (trecho de `specs.md`)
- `playlist.events.spec.ts:209` e `:481`: `timeout: 120000,`
- `docs/architecture/m3u-playlist-module.md:453-456`: trecho de `specs.md`
- Teste: deixa verde a linha 1 de `aceite.txt` e os itens C-01, C-08 e C-10

### T-001-02 · Igualar o timeout de playlist do proxy do PWA em 120 s

- Guardas: `apps/web-backend/src/app/host-guard.spec.ts`  -  escrever, selar, depois implementar
- `host-guard.ts:35-53`: comentario e objeto (trecho de `specs.md`)
- `web-backend-app.spec.ts:151`: `timeout: 120000,`
- `docs/architecture/host-connectivity-guard.md:47-48`: trecho de `specs.md`
- Teste: deixa verde a linha 2 de `aceite.txt` e os itens C-02, C-03, C-09, C-11 e C-14 (C-09 e C-11 sao `[fechamento]`: confira-os a mao ao fechar a task)

### T-001-03 · Adicionar a nota de release do timeout de playlist

- Sem guarda nova
- `.changes/playlist-slow-m3u-download.md`: trecho de `specs.md`
- Teste: C-04

## 6. Devolucao

No fim, preencha a secao `## Devolucao do executor` no `progress.md` com a ultima linha `VEREDITO:` do
`--fechamento` colada crua, o caminho do recibo (`.a8z-local/plan-gate/PLAN-001-fechamento.json`) e os desvios.

O PR para o upstream (feito depois, por quem autorizar o push) leva so os arquivos das tasks. `docs/plans/` e `docs/stack.md` sao do fork e ficam fora do PR. Titulo sugerido: `fix(playlist): wait up to 120s for slow M3U downloads`.
