---
plan_id: PLAN-002-m3u-large-playlist-benchmark
generated_at: 2026-11-23T23:00:00-03:00
---

# Specs: cenario de catalogo de 380k no benchmark de import M3U

## Tipos e interfaces

- `SyntheticM3uFixture.channelCount`: passa de `SyntheticM3uChannelCount` para `number` (a fixture de catalogo tem 380.000, fora da uniao). `createSyntheticM3uFixture` continua aceitando so 10k/50k/100k.
- `M3uImportScenario` e `M3uImportIterationDefinition`: `channelCount: number` e campo novo `settleTimeoutMs: number`.
- `M3uImportScenarioOptions`: `{ readonly catalog?: boolean }`.
- `M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K = 'm3u-import-catalog-380k'`.

## Endpoints e payloads

| Endpoint | Metodo | Request | Response | Observacoes |
|----------|--------|---------|----------|-------------|
| servidor sintetico `http://127.0.0.1:<porta>/synthetic-performance.m3u` | GET | sem query | corpo da fixture | inalterado; so muda o corpo servido no cenario de catalogo |

## Invariantes

- Sem `IPTVNATOR_PERF_M3U_CATALOG=1`, o benchmark roda exatamente os cenarios e iteracoes de hoje.
- Com a variavel, roda so o cenario de catalogo.
- Toda URL da fixture de catalogo usa `http://127.0.0.1/`.
- Nenhum dado de provedor real entra em fixture, spec, doc ou `measurements.md`.

## Trechos literais

### T-002-01 `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.ts` (arquivo novo)

```ts
import { createHash } from 'node:crypto';

import { SYNTHETIC_TITLE_VOCABULARY } from './synthetic-charset';
import { SYNTHETIC_M3U_SEED, type SyntheticM3uFixture } from './synthetic-m3u';

/**
 * Provider-shaped catalog: the entry count and mix of a large Xtream M3U
 * export (a few live channels, many movies, mostly series episodes), with
 * tvg attributes and loopback URLs only. Opt-in scenario; the formal
 * 10k/50k/100k fixtures stay attribute-free.
 */
export const SYNTHETIC_M3U_CATALOG_ENTRY_COUNT = 380_000;
export const SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES = 1_800;
export const SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES = 48_000;
const CATALOG_GROUP_COUNT = 300;

export function createSyntheticM3uCatalogFixture(): SyntheticM3uFixture {
    const titles = SYNTHETIC_TITLE_VOCABULARY.latin1;
    const lines = new Array<string>(1 + SYNTHETIC_M3U_CATALOG_ENTRY_COUNT * 2);
    lines[0] = '#EXTM3U';

    for (let offset = 0; offset < SYNTHETIC_M3U_CATALOG_ENTRY_COUNT; offset += 1) {
        const index = offset + 1;
        const stableIndex = String(index).padStart(6, '0');
        const group = String((offset % CATALOG_GROUP_COUNT) + 1).padStart(3, '0');
        const name = `${titles.channel} ${SYNTHETIC_M3U_SEED}-${stableIndex}`;
        const kind =
            offset < SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES
                ? 'live'
                : offset < SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES + SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES
                  ? 'movie'
                  : 'series';
        const extension = kind === 'live' ? 'ts' : 'mp4';
        const lineOffset = 1 + offset * 2;

        lines[lineOffset] =
            `#EXTINF:-1 tvg-id="synthetic-${stableIndex}" tvg-name="${name}" ` +
            `tvg-logo="http://127.0.0.1/logo/${SYNTHETIC_M3U_SEED}/${index}.png" ` +
            `group-title="${titles.group} ${group}",${name}`;
        lines[lineOffset + 1] =
            `http://127.0.0.1/${kind}/${SYNTHETIC_M3U_SEED}/${index}.${extension}`;
    }

    const body = `${lines.join('\n')}\n`;
    return Object.freeze({
        body,
        bytes: Buffer.byteLength(body, 'utf8'),
        channelCount: SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
        charset: 'latin1',
        sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    });
}
```

Valores de referencia, calculados pelo planejador com este trecho exato: 90.544.398 bytes, 760.001 linhas, SHA-256 `2d2028bb6f11354f2ee91f4c5006abb607a440d4c9a58f22cfa334a8dbe551bf`. Formatacao do Prettier pode quebrar linhas do codigo-fonte; o corpo gerado nao muda.

### T-002-01 `synthetic-m3u.ts`

Na interface `SyntheticM3uFixture`, `readonly channelCount: SyntheticM3uChannelCount;` vira `readonly channelCount: number;`. Nada mais muda no arquivo.

### T-002-01 guarda `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.spec.ts` (arquivo novo)

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createSyntheticM3uCatalogFixture,
    SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
    SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES,
    SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES,
} from './synthetic-m3u-catalog';

const CATALOG_GOLDEN_SHA256 =
    '2d2028bb6f11354f2ee91f4c5006abb607a440d4c9a58f22cfa334a8dbe551bf';

describe('synthetic provider-shaped M3U catalog', () => {
    const fixture = createSyntheticM3uCatalogFixture();
    const lines = fixture.body.trimEnd().split('\n');
    const urls = lines.filter((line) => !line.startsWith('#'));

    it('generates the 380k catalog deterministically', () => {
        assert.equal(SYNTHETIC_M3U_CATALOG_ENTRY_COUNT, 380_000);
        assert.equal(fixture.channelCount, 380_000);
        assert.equal(fixture.bytes, 90_544_398);
        assert.equal(fixture.sha256, CATALOG_GOLDEN_SHA256);
        assert.equal(lines[0], '#EXTM3U');
        assert.equal(lines.length, 1 + 380_000 * 2);
    });

    it('mixes live channels, movies and series episodes like a provider export', () => {
        const count = (kind: string) =>
            urls.filter((url) => url.startsWith(`http://127.0.0.1/${kind}/`))
                .length;

        assert.equal(count('live'), SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES);
        assert.equal(count('movie'), SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES);
        assert.equal(
            count('series'),
            380_000 -
                SYNTHETIC_M3U_CATALOG_LIVE_ENTRIES -
                SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES
        );
    });

    it('carries tvg attributes and only loopback URLs', () => {
        assert.match(
            lines[1],
            /^#EXTINF:-1 tvg-id="synthetic-000001" tvg-name="[^"]+" tvg-logo="http:\/\/127\.0\.0\.1\/logo\/\d+\/1\.png" group-title="[^"]+",/
        );
        for (const url of fixture.body.match(/https?:\/\/[^\s"]+/g) ?? []) {
            assert.ok(url.startsWith('http://127.0.0.1/'), url);
        }
    });
});
```

### T-002-02 `m3u-import-benchmark-contract.ts`

Imports novos no topo:

```ts
import {
    createSyntheticM3uCatalogFixture,
    SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
} from './synthetic-m3u-catalog';
import {
    createSyntheticM3uFixture,
    type SyntheticM3uFixture,
} from './synthetic-m3u';
```

(substitui `import type { SyntheticM3uChannelCount } from './synthetic-m3u';`)

Ids, tipos e cenarios:

```ts
export const M3U_IMPORT_SCENARIO_ID = {
    IMPORT_10K: 'm3u-import-10k',
    IMPORT_50K: 'm3u-import-50k',
    IMPORT_100K: 'm3u-import-100k',
    IMPORT_CATALOG_380K: 'm3u-import-catalog-380k',
} as const;

export interface M3uImportScenario {
    readonly channelCount: number;
    readonly id: M3uImportScenarioId;
    readonly settleTimeoutMs: number;
}

export interface M3uImportIterationDefinition {
    readonly channelCount: number;
    readonly kind: PerformanceIterationKind;
    readonly runId: string;
    readonly scenarioId: M3uImportScenarioId;
    readonly settleTimeoutMs: number;
}

export interface M3uImportScenarioOptions {
    /** Run only the provider-shaped 380k catalog (`IPTVNATOR_PERF_M3U_CATALOG=1`). */
    readonly catalog?: boolean;
}

const DEFAULT_SETTLE_TIMEOUT_MS = 120_000;
const CATALOG_SETTLE_TIMEOUT_MS = 900_000;
```

Cada um dos tres objetos de `SCENARIOS` ganha `settleTimeoutMs: DEFAULT_SETTLE_TIMEOUT_MS`. Depois de `SCENARIOS`:

```ts
const CATALOG_SCENARIOS: readonly M3uImportScenario[] = Object.freeze([
    Object.freeze({
        channelCount: SYNTHETIC_M3U_CATALOG_ENTRY_COUNT,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K,
        settleTimeoutMs: CATALOG_SETTLE_TIMEOUT_MS,
    }),
]);

export function isM3uImportCatalogRun(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    return env['IPTVNATOR_PERF_M3U_CATALOG'] === '1';
}

export function listM3uImportScenarios(
    options: M3uImportScenarioOptions = {}
): readonly M3uImportScenario[] {
    return options.catalog ? CATALOG_SCENARIOS : SCENARIOS;
}

export function createM3uImportScenarioFixture(
    scenario: M3uImportScenario
): SyntheticM3uFixture {
    return scenario.id === M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K
        ? createSyntheticM3uCatalogFixture()
        : createSyntheticM3uFixture(scenario.channelCount);
}
```

`createM3uImportIterationDefinitions(smoke: boolean, options: M3uImportScenarioOptions = {})` itera `listM3uImportScenarios(options)` em vez de `SCENARIOS`. `iteration()` acrescenta `settleTimeoutMs: scenario.settleTimeoutMs` ao objeto congelado.

### T-002-02 `m3u-import.benchmark.ts`

- Import de `./synthetic-m3u`: tirar `createSyntheticM3uFixture` (fica sem uso); manter `SYNTHETIC_M3U_SEED` e o tipo.
- Import de `./m3u-import-benchmark-contract`: acrescentar `createM3uImportScenarioFixture` e `isM3uImportCatalogRun`.
- Em `runM3uImportBenchmark`:

```ts
    const config = await resolveM3uImportBenchmarkConfiguration();
    const scenarioOptions = { catalog: isM3uImportCatalogRun() };
    const definitions = createM3uImportIterationDefinitions(
        config.smoke,
        scenarioOptions
    );

    for (const scenario of listM3uImportScenarios(scenarioOptions)) {
```

- Em `runScenario`: `const fixture = createM3uImportScenarioFixture(scenario);`
- Em `runIteration`: `app.mainWindow.setDefaultTimeout(definition.settleTimeoutMs);` e `await waitForDatabaseSettlement(app, definition.settleTimeoutMs);`
- `waitForDatabaseSettlement(app: LaunchedElectronApp, timeout: number)` usa `{ timeout }` no `expect.poll`.

### T-002-02 `m3u-import-benchmark-contract.spec.ts`

No teste "defines the exact 10k, 50k, and 100k synthetic scenarios", cada objeto esperado ganha `settleTimeoutMs: 120_000`. Os demais testes ficam.

### T-002-02 guarda `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-catalog.spec.ts` (arquivo novo)

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createM3uImportIterationDefinitions,
    createM3uImportScenarioFixture,
    isM3uImportCatalogRun,
    listM3uImportScenarios,
    M3U_IMPORT_SCENARIO_ID,
} from './m3u-import-benchmark-contract';

describe('opt-in provider-shaped catalog scenario', () => {
    it('runs only when IPTVNATOR_PERF_M3U_CATALOG is 1', () => {
        assert.equal(isM3uImportCatalogRun({}), false);
        assert.equal(isM3uImportCatalogRun({ IPTVNATOR_PERF_M3U_CATALOG: '0' }), false);
        assert.equal(isM3uImportCatalogRun({ IPTVNATOR_PERF_M3U_CATALOG: '1' }), true);
    });

    it('replaces the formal scenarios with the 380k catalog and a longer settle window', () => {
        assert.deepEqual(listM3uImportScenarios({ catalog: true }), [
            {
                channelCount: 380_000,
                id: M3U_IMPORT_SCENARIO_ID.IMPORT_CATALOG_380K,
                settleTimeoutMs: 900_000,
            },
        ]);
        assert.deepEqual(
            listM3uImportScenarios().map(({ id }) => id),
            [
                M3U_IMPORT_SCENARIO_ID.IMPORT_10K,
                M3U_IMPORT_SCENARIO_ID.IMPORT_50K,
                M3U_IMPORT_SCENARIO_ID.IMPORT_100K,
            ]
        );
    });

    it('schedules a smoke catalog run as warm-up, one measured run and the diagnostic', () => {
        const definitions = createM3uImportIterationDefinitions(true, {
            catalog: true,
        });

        assert.deepEqual(
            definitions.map(({ runId, settleTimeoutMs }) => ({
                runId,
                settleTimeoutMs,
            })),
            [
                { runId: 'warmup-01', settleTimeoutMs: 900_000 },
                { runId: 'run-01', settleTimeoutMs: 900_000 },
                { runId: 'diagnostic', settleTimeoutMs: 900_000 },
            ]
        );
        assert.equal(createM3uImportIterationDefinitions(false).length, 21);
    });

    it('serves the catalog fixture for the catalog scenario only', () => {
        const [catalog] = listM3uImportScenarios({ catalog: true });
        const [formal] = listM3uImportScenarios();

        assert.equal(
            createM3uImportScenarioFixture(catalog).sha256,
            '2d2028bb6f11354f2ee91f4c5006abb607a440d4c9a58f22cfa334a8dbe551bf'
        );
        assert.equal(createM3uImportScenarioFixture(formal).channelCount, 10_000);
    });
});
```

### T-002-02 `docs/architecture/m3u-playlist-module.md`

Inserir este paragrafo imediatamente antes da linha `The benchmark attributes these non-additive intervals:`:

```markdown
`IPTVNATOR_PERF_M3U_CATALOG=1` replaces the three formal scenarios with one
provider-shaped catalog (`m3u-import-catalog-380k`): 380,000 entries with
`tvg-id`, `tvg-name` and `tvg-logo`, mostly series episodes, about 90 MB, still
served only from the loopback server. Its settle window is 15 minutes instead
of 2. It is a diagnostic for very large provider exports, not a baseline: run
it with `IPTVNATOR_PERF_SMOKE=1` first and use a formal run only once the smoke
completes.
```

### T-002-03 `docs/plans/PLAN-002-m3u-large-playlist-benchmark/measurements.md` (arquivo novo)

Estrutura obrigatoria, com estes cinco titulos exatos:

```markdown
---
plan_id: PLAN-002-m3u-large-playlist-benchmark
measured_at: <iso>
commit: <sha curto da worktree>
---

# Medicao: import M3U de catalogo 380k

## Ambiente

<SO, CPU, RAM, versao do Electron do manifest.json, variant, se smoke>

## Controle

<resultado da rodada smoke padrao (10k/50k/100k): completou? totalMs mediano por cenario; ou erro do harness>

## Catalogo 380k

<para cada iteracao: completou ou nao; totalMs e cada campo de fase do summary.json (dataAcquireMs, m3uParsingMs, normalizationMs, mainToRendererCloneProxyMs, storeImportDispatchMs, rendererToMainCloneProxyMs, mainToDatabaseWorkerCloneProxyMs, playlistSerializationMs, sqliteWriteMs, sqliteReadMs, playlistDeserializationMs, databaseWorkerToMainCloneProxyMs, storePublishChannelsMs, angularRenderingMs); pico de RSS do main; ou a mensagem de erro e a ultima linha `[performance]` do log>

## Primeira fase que falha

<a fase onde a importacao parou ou a fase com maior tempo, com o numero; ou "inconclusivo: <motivo>">

## Proposta

<qual alternativa do discovery (A-02 ou A-03, ou outra) os numeros sustentam e por que; a decisao fica com o usuario>
```

## Tabela de verdade das guardas

| Guarda | Base (525adb045) | Depois da task | Mutacao que deixa vermelha |
|---|---|---|---|
| `apps/electron-backend-e2e/src/performance/synthetic-m3u-catalog.spec.ts` | vermelha: modulo `./synthetic-m3u-catalog` nao existe | verde depois de T-002-01 | trocar `SYNTHETIC_M3U_CATALOG_MOVIE_ENTRIES` para `47_000` → falham o SHA-256 e a contagem de `movie` |
| `apps/electron-backend-e2e/src/performance/m3u-import-benchmark-catalog.spec.ts` | vermelha: `isM3uImportCatalogRun` e `createM3uImportScenarioFixture` nao existem | verde depois de T-002-02 | fazer `listM3uImportScenarios` ignorar `options.catalog` → falha o segundo teste |

Falha de dependencia (X-10): a guarda de T-002-02 importa a fixture de T-002-01; se T-002-01 nao estiver feita, ela fica vermelha por modulo ausente. Ordem 01 → 02 obrigatoria.
