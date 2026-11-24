---
plan_id: PLAN-002-m3u-large-playlist-benchmark
measured_at: 2026-11-24T00:00:00-03:00
commit: 0d9986607
---

# Medicao: import M3U de catalogo 380k

## Ambiente

Windows 10.0.26300; AMD Ryzen 7 5700G; RAM 33.607.815.168 bytes.
Electron 43.8.7 (package.json instalado; manifest.json nao gerado).
Node 24.14.0; pnpm 10.33.0; worktree com alteracoes; smoke=1.
Variants: control, catalog. NX_PREFER_TS_NODE=true; NX_DAEMON=false.

## Controle

10k warmup-01: falhou; 50k e 100k nao executados. totalMs mediano indisponivel.

Erro do harness (caminho temporario omitido):
`Error: EBUSY: resource busy or locked, unlink '<temporary-profile>/user-data/lockfile'`

Ultima linha:
`[performance] control/m3u-import-10k/warmup-01 starting`

## Catalogo 380k

warmup-01: falhou. run-01 e diagnostic: nao executados.
summary.json nao gerado; totalMs, campos de fase e pico de RSS do main indisponiveis.

Erro do harness (caminho temporario omitido):
`Error: EBUSY: resource busy or locked, unlink '<temporary-profile>/user-data/lockfile'`

Ultima linha:
`[performance] catalog/m3u-import-catalog-380k/warmup-01 starting`


### Rodada valida (2026-11-24, commit 0d9986607, fora do sandbox, smoke warm-up)

Fonte: `dist/performance/20261124T025105Z-m3u-import-catalog-amend/catalog/m3u-import-catalog-380k/warmup-01/{main-capture,renderer-capture}.json`. O import completou; o `summary.json` nao foi gerado porque `deriveM3uImportPhaseMetrics` rejeitou a ordem das fases (`m3u-import-phase-attribution-invalid:phase-order`). Os tempos abaixo vem direto da timeline bruta, com t=0 no clique do botao Add.

| Marco | t (s) | Duracao |
|---|---:|---|
| `data.acquire` (download loopback, 90.544.398 bytes) | 0,00 → 0,20 | 0,2 s |
| `parse.m3u` (380.000 itens) | 0,20 → 1,07 | 0,87 s |
| `normalize` | 1,07 → 1,42 | 0,35 s |
| main pronto → renderer pede `DB_UPSERT_APP_PLAYLIST` | 1,42 → 176,1 | 174,7 s (clone main → renderer e dispatch no store) |
| renderer → main do upsert | 176,1 → 177,9 | 1,8 s |
| upsert no worker de banco | 177,9 → 187,7 | 9,7 s |
| `DB_GET_APP_PLAYLIST` (ida e volta) | 187,7 → 191,9 | 4,2 s |
| rota pronta → primeiro canal visivel | 187,7 → 279,9 | 92,2 s |
| terminal / UI pintada | 280,0 | total 280 s (4 min 40 s) |

Memoria e bloqueio:

- Main: pico de RSS 2,28 GB (inclui worker threads e memoria nativa), RSS pos-GC 507 MB; pico de heap 352 MB.
- Renderer: pico de heap 639 MB; 4 long tasks, maior 87,2 s, p95 74,2 s. A janela fica congelada por mais de um minuto, duas vezes.
- Worker de banco: utilizacao de event loop 0,10; CPU ~4,4 s.

## Primeira fase que falha

Nenhuma fase falha no app: nesta maquina o import de 380k completa em 280 s. O custo esta no renderer: 174,7 s entre o main terminar o parse e o renderer pedir o upsert, e 92,2 s entre a leitura do banco e o primeiro canal visivel; os dois trechos coincidem com long tasks de 74 a 87 s. Download, parse, normalizacao e SQLite somam ~16 s.

## Proposta

Os numeros sustentam a alternativa A-02 do discovery: o main ja faz parse e normalizacao em 1,4 s e o worker grava em 9,7 s, mas o objeto de 380k itens atravessa o renderer duas vezes (resultado do fetch e leitura do banco) e e processado no thread de UI. Persistir direto no main (fetch → worker de banco) e entregar ao renderer so o resumo e paginas tira os ~267 s do renderer do caminho do import. A-03 (limitar e sugerir Xtream) continua valida como guarda barata, mas nao resolve playlists entre 100k e o limite. Decisao do usuario (C-10).

Gaps do harness achados nesta medicao (registrados no `progress.md`):

- O prazo de 120 s do probe do renderer e o prazo de 5 s da amostra do worker eram fixos; corrigidos no commit `0d9986607` so para o cenario de catalogo.
- `deriveM3uImportPhaseMetrics` rejeita a ordem das fases neste tamanho; sem `summary.json`, a rodada formal continua impossivel ate esse validador ser entendido.
- No Windows, a limpeza falha com `EBUSY` no `lockfile`/`iptvnator.db-wal` quando a iteracao falha, escondendo o erro original.
