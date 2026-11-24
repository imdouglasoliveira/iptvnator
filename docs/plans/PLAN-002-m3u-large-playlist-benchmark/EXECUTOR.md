---
# Roteiro do executor externo  -  PLAN-002-m3u-large-playlist-benchmark
# handoff_base e gravado por plan-authorize.js record
handoff_base: 525adb045
---

# Roteiro do executor externo  -  PLAN-002-m3u-large-playlist-benchmark

> Leia este arquivo INTEIRO antes do primeiro comando. Ele substitui o `CLAUDE.md` para voce. Onde o
> `specs.md` traz bloco de codigo, COPIE. Base: `origin/master` `525adb045` (2026-11-23).

Contexto em uma frase: o import de uma M3U de 380 mil entradas manda a playlist inteira por IPC varias vezes e ninguem mediu esse tamanho; o plano acrescenta ao benchmark existente um cenario opt-in no formato de provedor, roda e registra onde o import quebra. Nenhum codigo do app muda.

## 1. O que e seu

| Task | Sua? | Tempo maximo |
|---|---|---|
| T-002-01 Criar a fixture sintetica de catalogo com 380 mil entradas | sim | 45 min |
| T-002-02 Adicionar o cenario opt-in de catalogo ao benchmark de import | sim | 90 min |
| T-002-03 Rodar a smoke do catalogo e registrar a primeira fase que falha | sim | 120 min (rodadas incluidas) |
| C-09 e C-10 do `checklist.md` | nao ([humano]) | - |

Ordem obrigatoria: 01 → 02 → 03. Estourou o tempo sem o teste da task verde: PARE e escreva no `progress.md`
o que falta e o ultimo erro. Em T-002-03 o benchmark falhar nao e estouro: registre a falha e siga.

## 2. Preparar a arvore (uma vez)

```bash
git fetch origin
git worktree add ../../worktrees/iptvnator/plan-002 -b test/m3u-catalog-benchmark <handoff_base>
cd ../../worktrees/iptvnator/plan-002
pnpm install --frozen-lockfile
```

Workspace `monorepo-others`: worktree em `<ws>/worktrees/iptvnator/plan-002`, temporarios em `<ws>/tmp/iptvnator/`. Copie `.a8z-local/` e `.a8z/config.json` do clone principal para a worktree (locais, fora do git); o `plan-gate` usa `.a8z-local/run-guard.cjs`, que roda specs de `electron-backend-e2e` com `tsx --test`.

## 3. Regras (valem em toda task)

1. Nao mexa em codigo do app (`apps/electron-backend/src`, `apps/web`, `libs/`), nem em `project.json`, `playwright.*.config.ts` ou `package.json`.
2. Commit por task, so dos arquivos da task: `git commit -m "<msg>" -- <arquivos>`. Conventional Commits em ingles
   (padrao do upstream), mensagem da task, rodape `Refs: PLAN-002 T-002-NN`. Nunca `git add -A`, `git stash`,
   `git checkout -- <arq>`, `git reset --hard`.
3. Edite com a ferramenta de edicao de arquivo, nunca `sed -i` nem script de patch.
4. O `--selar-aceite` exige TODAS as guardas de `aceite.txt` presentes: escreva as duas guardas (T-002-01 e T-002-02) no inicio da T-002-01, rode `plan-gate.js PLAN-002 --selar-aceite` uma vez (as duas nascem vermelhas) e so entao implemente;
   depois de selada, nao edite a guarda. Guarda errada: PARE e registre.
5. Codigo removido sai do arquivo; C-07 e C-08 do `checklist.md` conferem as remocoes no fechamento.
6. Nao invente nome de funcao, campo ou variavel; faltou, PARE e registre.
7. Nao mexa em arquivo fora da tabela `## Arquivos` da task.
8. Nunca `prettier --write` no arquivo inteiro em `docs/**`.
9. Dados sinteticos apenas. Nenhuma playlist, URL ou credencial de provedor real; `measurements.md` leva so numeros e nomes de fase.
10. Ao marcar a task `concluido`, atualize a MESMA linha do `progress.md`.
11. Nao faca push.

### Nao toque

Gerado por `git grep -l -e SyntheticM3uFixture -e m3u-import-benchmark-contract -- apps/electron-backend-e2e/src` (ver `censo.txt`), menos os arquivos das tasks:

- `synthetic-m3u.spec.ts`, `synthetic-m3u-server.ts`, `synthetic-m3u-server.spec.ts`
- `m3u-import-summary.ts`, `m3u-import-summary-contract.ts`
- `m3u-refresh-cancellation.benchmark.ts`, `charset-parse-workloads.ts`

## 4. Como testar (sempre a mesma linha)

- Durante a task: `node .a8z/scripts/tools/plan-gate.js PLAN-002`.
- No fim, uma vez: `node .a8z/scripts/tools/plan-gate.js PLAN-002 --fechamento`.
- O oraculo e a ultima linha `VEREDITO:`. Logs em `.a8z-local/plan-gate/PLAN-002/`.
- Vermelhos da BASE (nao conserte): `pnpm nx run electron-backend-e2e:test-performance-harness` tem 5 falhas no Windows ("reaps a real Windows shell child...", "Electron forced termination", "a phase is stamped at the first batch...", "the cache root defaults under node_modules...", "Xtream benchmark mode configuration"). O checklist nao roda esse alvo.

## 5. Task por task

### T-002-01 · Criar a fixture sintetica de catalogo com 380 mil entradas

- Guardas: `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.spec.ts`  -  escrever, selar, depois implementar
- `synthetic-m3u-catalog.ts`: trecho de `specs.md`
- `synthetic-m3u.ts:23`: `readonly channelCount: number;`
- Teste: linha 1 de `aceite.txt`, C-01 e C-08

### T-002-02 · Adicionar o cenario opt-in de catalogo ao benchmark de import

- Guardas: `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-catalog.spec.ts`  -  escrever, selar, depois implementar
- Contrato, benchmark, spec do contrato e doc: trechos de `specs.md`
- Teste: linha 2 de `aceite.txt`, C-02, C-04, C-05, C-07 e C-11 (C-02, C-04, C-05 e C-07 sao `[fechamento]`: rode C-02 a mao para fechar a task)

### T-002-03 · Rodar a smoke do catalogo e registrar a primeira fase que falha

- Sem guarda
- Comandos e estrutura de `measurements.md`: task e `specs.md`
- Teste: C-06 (no fechamento)

## 6. Devolucao

No fim, preencha `## Devolucao do executor` no `progress.md` com a ultima linha `VEREDITO:` do `--fechamento`
colada crua, o caminho do recibo (`.a8z-local/plan-gate/PLAN-002-fechamento.json`) e os desvios. `measurements.md`
e `docs/plans/` ficam fora de qualquer PR upstream; T-002-01 e T-002-02 podem ir num PR `test(performance): ...`
se o usuario quiser.
