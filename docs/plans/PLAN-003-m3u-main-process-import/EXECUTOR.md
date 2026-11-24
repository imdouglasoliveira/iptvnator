---
# Roteiro do executor externo  -  PLAN-003-m3u-main-process-import
# handoff_base e gravado por plan-authorize.js record
handoff_base: 0d9986607
---

# Roteiro do executor externo  -  PLAN-003-m3u-main-process-import

> Leia este arquivo INTEIRO antes do primeiro comando. Ele substitui o `CLAUDE.md` para voce. Onde o
> `specs.md` traz bloco de codigo, COPIE. Base: branch `test/m3u-catalog-benchmark` `0d9986607` (2026-11-24).

Contexto em uma frase: importar por URL uma M3U de 380 mil entradas leva 280 s, e 175 s sao o `Playlist` indo do main ao renderer e voltando para gravar; este plano faz o main gravar pelo worker de banco e devolver so a meta, com o kill switch `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1` para o caminho antigo.

## 1. O que e seu

| Task | Sua? | Tempo maximo |
|---|---|---|
| T-003-01 Gravar no processo principal a playlist importada por URL | sim | 60 min |
| T-003-02 Registrar no renderer a playlist ja gravada pelo main | sim | 60 min |
| T-003-03 Documentar o import pelo main e adicionar a nota de release | sim | 20 min |
| T-003-04 Medir o import de 380k antes e depois | sim (as rodadas do Electron podem ficar com o orquestrador se o sandbox bloquear) | 90 min |
| C-12 do `checklist.md` | nao ([humano: julgamento]) | - |

Ordem obrigatoria: 01 → 02 → 03 → 04. Estourou o tempo sem o teste da task verde: PARE e escreva no `progress.md`
o que falta e o ultimo erro.

## 2. Preparar a arvore (uma vez)

O orquestrador prepara a worktree em `<ws>/worktrees/iptvnator/plan-003` a partir de `test/m3u-catalog-benchmark`, com `pnpm install --frozen-lockfile` e as juncoes `.a8z`, `.a8z-local` e `docs/plans`. Se ja estiver pronta, pule esta secao.

## 3. Regras (valem em toda task)

1. Nao rode nada contra provedor real; so `example.test` e o servidor sintetico do benchmark.
2. Commit por task, so dos arquivos da tabela `## Arquivos`: `git commit -m "<msg>" -- <arquivos>`. Conventional Commits em ingles (padrao do upstream), mensagem da task. Nunca `git add -A`, `git stash`, `git checkout -- <arq>`, `git reset --hard`. Se o sandbox negar escrita em `.git`, nao force: liste os arquivos e o orquestrador commita.
3. Edite com a ferramenta de edicao de arquivo, nunca `sed -i` nem script de patch.
4. O `--selar-aceite` exige as duas guardas presentes: escreva as duas no inicio da T-003-01, sele uma vez (as duas nascem vermelhas) e so entao implemente; depois de selada, nao edite a guarda. Guarda errada: PARE e registre.
5. Nao invente nome de funcao, acao, campo ou canal; faltou, PARE e registre.
6. Nao mexa em arquivo fora da tabela da task. Arquivos do baseline de linhas (`effects.ts`, `main.preload.ts`, `electron-api.interface.ts`, `electron.service.ts`): so as linhas do trecho.
7. Nunca `prettier --write` em arquivo inteiro do upstream; formate so o arquivo novo.
8. Logs com `redactSensitiveData`; nunca URL completa nem credencial.
9. Ao marcar a task `concluido`, atualize a MESMA linha do `progress.md`.
10. Nao faca push.

### Nao toque

Gerado a partir de `censo.txt` (`git grep -l -e fetchPlaylistDefinition -e fetchPlaylistByUrl -e handleAddingPlaylistByUrl`), menos os arquivos das tasks:

- `libs/services/src/lib/source-sync/source-materializer.ts`
- `apps/web/src/app/services/pwa.service.ts`
- `apps/electron-backend/src/app/events/playlist-source.ts`, `playlist-auto-update.ts`, `workers/playlist-refresh.worker.ts`
- `libs/m3u-state/src/lib/effects.ts` fora do efeito novo e da injecao

## 4. Como testar (sempre a mesma linha)

- Durante a task: `node .a8z/scripts/tools/plan-gate.js PLAN-003`.
- No fim, uma vez: `node .a8z/scripts/tools/plan-gate.js PLAN-003 --fechamento`.
- O oraculo e a ultima linha `VEREDITO:`. Logs em `.a8z-local/plan-gate/PLAN-003/`.
- Vermelhos da BASE (nao conserte): nenhum nos itens do checklist. Medido em `0d9986607`: C-01 (4 suites, 36), C-02 (1 suite, 21), C-03 (7 suites, 53), `typecheck:web`, `typecheck:backend` e lint dos 6 projetos com exit 0. Se o Nx falhar no cache nativo, `NX_DAEMON=false` (nao use `NX_PREFER_TS_NODE`, que quebra os testes do ferramental de cobertura).
- Aviso esperado do gate: "handoff_base sem aceite.txt acessivel" (a pasta do plano fica fora do git por decisao do usuario).

## 5. Task por task

### T-003-01 · Gravar no processo principal a playlist importada por URL

- Guardas: as duas de `aceite.txt`, escritas e seladas aqui
- Tipo, modulo, handler e preload: trechos de `specs.md`
- Teste: linha 1 de `aceite.txt`, C-01, C-04, C-09, C-11

### T-003-02 · Registrar no renderer a playlist ja gravada pelo main

- `DataService`, `ElectronService`, `url-playlist-import.ts`, acao, reducer, efeito: trechos de `specs.md`
- Teste: linha 2 de `aceite.txt`, C-02 (`[fechamento]`, rode a mao), C-03

### T-003-03 · Documentar o import pelo main e adicionar a nota de release

- Doc e nota: trechos de `specs.md`
- Teste: C-07 e C-10 (`[fechamento]`, rode a mao)

### T-003-04 · Medir o import de 380k antes e depois

- Benchmark e comandos de medicao: `specs.md` T-003-04
- Teste: C-13; `measurements.md` com a tabela

## 6. Devolucao

No fim, preencha `## Devolucao do executor` no `progress.md` com a ultima linha `VEREDITO:` do `--fechamento`
colada crua, os commits (sha + assunto) ou a lista de arquivos por task se nao pode commitar, e os desvios.
`docs/plans/` e `docs/stack.md` ficam fora de qualquer PR.
