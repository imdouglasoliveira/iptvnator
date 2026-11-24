---
plan_id: PLAN-001-m3u-download-timeout
selado_em: 2026-11-24T01:28:09.311Z
revisor: orquestrador
outra_sessao: false
motivo: null
docs_sha256: d0477f18a0db48dc362d89fa86a4d604d3cc4cdb934a56bc480eea149d21c193
---

# Revisao - PLAN-001-m3u-download-timeout

Modo `--revisao` (validate-plan), antes da execucao. Revisor: orquestrador (mesma sessao que planejou; sem `--agents`, sem revisor de outro provedor).

## Conferencia dos trechos literais contra a base (525adb045)

| trecho | existe? | assinatura bate? |
|---|---|---|
| `export const PLAYLIST_FETCH_TIMEOUT_MS = 30000;` em `playlist-source.ts:31` | sim | sim, comentario nas linhas 25-30 |
| `export async function fetchPlaylistFromUrl(` em `playlist-source.ts:86` | sim | sim: `(url, title?, options)`; chama `requestWithValidatedRedirects(url, {...}, { allowPrivateNetworks: true })` (linha 104) |
| `createPlaylistAgentFactory` em `util/secure-https.ts:43` | sim | sim; o mock da guarda segue `playlist-source.performance.spec.ts` |
| `requestWithValidatedRedirects` em `util/validated-axios.ts:241` | sim | sim |
| `timeout: 30000,` em `playlist.events.spec.ts:209` e `:481` | sim | sim |
| `timeout: 30000,` em `web-backend-app.spec.ts:151` (request de `https://provider.example/list.m3u`) | sim | sim, e o request de `/parse` |
| `export const PROVIDER_REQUEST_TIMEOUT_MS = {` em `host-guard.ts:47`, comentario em 35-46 | sim | sim, 5 chaves |
| `(30s, exported by` em `m3u-playlist-module.md:453` | sim | sim, paragrafo 453-456 |
| "playlist and XMLTV downloads 30 s." em `host-connectivity-guard.md:48` | sim | sim, frase 46-48 |
| `timeout: 30000, // 30 seconds timeout for Xtream API` em `xtream.events.ts:135` | sim | sim (regressao C-13) |

## Achados e correcoes

| origem | arquivo | achado | acao | motivo |
|---|---|---|---|---|
| orquestrador | checklist.md | `plan-gate` roda todo item sem `[fechamento]` a cada task; C-09 e C-11 so ficam verdes depois de T-001-02, entao o gate de T-001-01 sairia vermelho | aplicado: C-09 e C-11 com `[fechamento]`; EXECUTOR manda conferir os dois a mao ao fechar T-001-02 | reforca o roteiro sem mudar o que se entrega |
| orquestrador | remocoes.txt | `plan-gate` confere `remocoes.txt` em todo modo; a remocao do PWA ficaria presente durante T-001-01 e o contrato sairia vermelho | aplicado: `remocoes.txt` removido; C-08 a C-11 conferem o valor novo na mesma linha | o valor antigo e o novo ocupam a mesma linha; o grep do novo prova a troca |
| orquestrador | checklist.md, discovery/README.md | contagens de base estavam erradas (`events/playlist` casa 4 suites e 36 testes no Windows, nao 3 e 29) | aplicado: numeros remedidos (4/36, `host-guard` 1/22, `web-backend-app.spec` 1/30) | numero medido |
| orquestrador | EXECUTOR.md | `handoff_base: PENDENTE  # comentario` nao casa com o regex do `check-plan` (G-E1) | aplicado: comentario em linha propria | o template tem o mesmo defeito |
| orquestrador | checklist.md | C-12 esperava a playlist importada, mas com 380 mil entradas o import pode travar por causa do PLAN-002 | aplicado: C-12 observa so o download (sem `ECONNABORTED` aos 60 s) | separa as duas causas |
| orquestrador | specs.md | guarda 1 pode falhar por import de modulo em vez de valor | registrado na tabela de verdade (X-10): conferir no log da selagem | ja estava no specs |

## Parecer

Plano executavel. Escopo de 3 tasks pequenas, cada uma com arquivos, trecho literal e guarda que nasce vermelha na base. Nenhuma decisao `D-NN`, criterio ou artefato mapeado mudou na revisao.
