---
plan_id: PLAN-003-m3u-main-process-import
generated_at: 2026-11-24T00:30:00-03:00
---

# Specs: import de M3U por URL persistido no processo principal

## Tipos e interfaces

Arquivo novo `libs/shared/interfaces/src/lib/playlist-url-import.ts`, exportado em `libs/shared/interfaces/src/index.ts`:

```ts
import type { ElectronBridgePlaylistFetchOptions } from './electron-api.interface';
import type { Playlist } from './playlist.interface';
import type { PlaylistMeta } from './playlist-meta.type';

/**
 * Kill switch for the main-process URL import (remove within two releases).
 * `IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1` returns the parsed playlist to the
 * renderer, which then persists it through the previous path.
 */
export const MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV =
    'IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT';

export interface PlaylistUrlImportOptions
    extends ElectronBridgePlaylistFetchOptions {
    /** Trimmed title chosen in the dialog; sets both title and filename. */
    title?: string;
    /** Dialog EPG choice; `false` applies the opt-out before persisting. */
    autoImportEpg?: boolean;
}

export type PlaylistUrlImportResult =
    | { readonly persisted: true; readonly playlist: PlaylistMeta }
    | { readonly persisted: false; readonly playlist: Playlist };
```

`ElectronBridge` (em `electron-api.interface.ts`, logo depois de `fetchPlaylistByUrl`):

```ts
    importPlaylistByUrl: (
        url: string,
        options?: PlaylistUrlImportOptions
    ) => Promise<PlaylistUrlImportResult>;
```

`DataService` (`libs/services/src/lib/data.service.ts`, depois de `fetchPlaylistDefinition`): metodo opcional, sem implementacao na base.

```ts
    /** Electron only: fetches, persists in the main process and returns the meta. */
    importPlaylistByUrl?(
        url: string,
        options?: PlaylistUrlImportOptions
    ): Promise<PlaylistUrlImportResult>;
```

Acao nova em `PlaylistActions` (`libs/m3u-state/src/lib/actions.ts`): `'Playlist Imported In Main': props<{ playlist: PlaylistMeta }>()` → `PlaylistActions.playlistImportedInMain`.

## Endpoints e payloads

| Endpoint | Metodo | Request | Response | Observacoes |
|----------|--------|---------|----------|-------------|
| IPC `import-playlist-by-url` | invoke | `url: string`, `options?: PlaylistUrlImportOptions` | `PlaylistUrlImportResult` | novo; so Electron |
| IPC `fetch-playlist-by-url` | invoke | inalterado | `Playlist` | continua para `source-materializer.ts` e auto-update |
| worker `DB_UPSERT_APP_PLAYLIST` | request | `Playlist` inteiro | `{ success: boolean }` | agora tambem chamado direto pelo main |

## Invariantes

- Com o kill switch desligado (padrao), o renderer nunca recebe nem reenvia os itens da playlist importada por URL.
- Com o kill switch ligado, o comportamento e byte a byte o de hoje: o renderer recebe o `Playlist` e despacha `handleAddingPlaylistByUrl`.
- O main espera o schema pronto (`getDatabase()`) antes de chamar o worker, como `worker-events.utils.ts`.
- Erro de download ou TLS continua chegando ao dialogo como hoje (mesmo `throw`, mesma recuperacao).
- Logs passam por `redactSensitiveData`; nunca URL completa nem credencial.

## Trechos literais

### T-003-01 `apps/electron-backend/src/app/events/playlist-url-import.ts` (arquivo novo)

```ts
import {
    MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV,
    type Playlist,
    type PlaylistMeta,
    type PlaylistUrlImportOptions,
    type PlaylistUrlImportResult,
} from '@iptvnator/shared/interfaces';
import { applyPlaylistEpgImportPreference } from '@iptvnator/shared/m3u-utils';
import { getDatabase } from '../database/connection';
import { databaseWorkerClient } from '../services/database-worker-client';
import type { M3uImportPerformanceCapture } from './playlist-import-performance';
import { fetchPlaylistFromUrl } from './playlist-source';

export function isMainPlaylistImportEnabled(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    return env[MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV] !== '1';
}

/** The playlist without its parsed items: what the renderer keeps in memory. */
export function toImportedPlaylistMeta(playlist: Playlist): PlaylistMeta {
    const { playlist: parsedItems, ...meta } = playlist;
    void parsedItems;
    return meta;
}

/**
 * URL import for Electron. Large M3U exports cost minutes when the parsed
 * playlist is cloned to the renderer and back for the database write, so the
 * main process persists it and returns only the meta.
 */
export async function importPlaylistFromUrl(
    url: string,
    options: PlaylistUrlImportOptions = {},
    performanceCapture: M3uImportPerformanceCapture | null = null
): Promise<PlaylistUrlImportResult> {
    const title = options.title?.trim() || undefined;
    const fetched = await fetchPlaylistFromUrl(url, title, {
        performanceCapture,
        userAgent: options.userAgent,
        trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
    });
    const playlist = applyPlaylistEpgImportPreference(
        fetched,
        options.autoImportEpg
    );
    if (!isMainPlaylistImportEnabled()) {
        return { persisted: false, playlist };
    }
    await getDatabase();
    await databaseWorkerClient.request('DB_UPSERT_APP_PLAYLIST', playlist);
    return { persisted: true, playlist: toImportedPlaylistMeta(playlist) };
}
```

Nota: `applyPlaylistEpgImportPreference(playlist, undefined)` usa o padrao `true`, igual ao dialogo hoje.

### T-003-01 handler em `apps/electron-backend/src/app/events/playlist.events.ts`

Logo depois do handler `fetch-playlist-by-url` (linha 93-117), e import de `importPlaylistFromUrl` de `./playlist-url-import` e do tipo `PlaylistUrlImportOptions`:

```ts
ipcMain.handle(
    'import-playlist-by-url',
    async (event, url: string, options?: PlaylistUrlImportOptions) => {
        try {
            const performanceCapture = createM3uImportPerformanceCapture({
                enabled: isPerformanceCaptureEnabled(),
            });
            return await importPlaylistFromUrl(url, options, performanceCapture);
        } catch (error) {
            console.error(
                'Error importing playlist:',
                redactSensitiveData(error)
            );
            throw error;
        }
    }
);
```

### T-003-01 preload `apps/electron-backend/src/app/api/main.preload.ts`

Logo depois de `fetchPlaylistByUrl` (linha 541-545):

```ts
    importPlaylistByUrl: (url: string, options?: PlaylistUrlImportOptions) =>
        ipcRenderer.invoke('import-playlist-by-url', url, options),
```

### T-003-01 guarda `apps/electron-backend/src/app/events/playlist-url-import.spec.ts` (arquivo novo)

```ts
import { MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV } from '@iptvnator/shared/interfaces';
import {
    importPlaylistFromUrl,
    isMainPlaylistImportEnabled,
} from './playlist-url-import';

const mockFetchPlaylistFromUrl = jest.fn();
const mockWorkerRequest = jest.fn();
const mockGetDatabase = jest.fn();

jest.mock('./playlist-source', () => ({
    fetchPlaylistFromUrl: (...args: unknown[]) =>
        mockFetchPlaylistFromUrl(...args),
}));
jest.mock('../services/database-worker-client', () => ({
    databaseWorkerClient: {
        request: (...args: unknown[]) => mockWorkerRequest(...args),
    },
}));
jest.mock('../database/connection', () => ({
    getDatabase: () => mockGetDatabase(),
}));

const parsed = {
    _id: 'synthetic-id',
    title: 'Synthetic list',
    filename: 'Synthetic list',
    count: 2,
    url: 'https://example.test/list.m3u',
    epgUrls: ['https://example.test/guide.xml'],
    detectedEpgUrls: ['https://example.test/guide.xml'],
    playlist: { items: [{ name: 'One' }, { name: 'Two' }] },
};

describe('main-process URL playlist import', () => {
    beforeEach(() => {
        Reflect.deleteProperty(process.env, MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV);
        mockFetchPlaylistFromUrl.mockReset().mockResolvedValue(parsed);
        mockWorkerRequest.mockReset().mockResolvedValue({ success: true });
        mockGetDatabase.mockReset().mockResolvedValue(undefined);
    });

    it('persists the whole playlist and returns only the meta', async () => {
        const result = await importPlaylistFromUrl(
            'https://example.test/list.m3u',
            { title: '  Synthetic list  ', userAgent: 'SyntheticAgent/1.0' }
        );

        expect(mockFetchPlaylistFromUrl).toHaveBeenCalledWith(
            'https://example.test/list.m3u',
            'Synthetic list',
            expect.objectContaining({ userAgent: 'SyntheticAgent/1.0' })
        );
        expect(mockGetDatabase).toHaveBeenCalledTimes(1);
        expect(mockWorkerRequest).toHaveBeenCalledWith(
            'DB_UPSERT_APP_PLAYLIST',
            parsed
        );
        expect(result.persisted).toBe(true);
        expect(result.playlist).not.toHaveProperty('playlist');
        expect(result.playlist).toMatchObject({ _id: 'synthetic-id', count: 2 });
    });

    it('applies the EPG opt-out before persisting', async () => {
        await importPlaylistFromUrl('https://example.test/list.m3u', {
            autoImportEpg: false,
        });

        expect(mockWorkerRequest).toHaveBeenCalledWith(
            'DB_UPSERT_APP_PLAYLIST',
            expect.objectContaining({ autoImportEpg: false, epgUrls: [] })
        );
    });

    it('returns the parsed playlist without writing when the kill switch is on', async () => {
        process.env[MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV] = '1';

        const result = await importPlaylistFromUrl(
            'https://example.test/list.m3u'
        );

        expect(isMainPlaylistImportEnabled()).toBe(false);
        expect(mockWorkerRequest).not.toHaveBeenCalled();
        expect(result).toEqual({ persisted: false, playlist: parsed });
    });
});
```

### T-003-02 `ElectronService` (`apps/web/src/app/services/electron.service.ts`, depois de `fetchPlaylistDefinition`)

```ts
    override importPlaylistByUrl(
        url: string,
        options: PlaylistUrlImportOptions = {}
    ): Promise<PlaylistUrlImportResult> {
        return window.electron.importPlaylistByUrl(url, {
            ...this.settingsStore.getTrustOptions(),
            ...options,
        });
    }
```

### T-003-02 `url-playlist-import.ts`

Dentro de `submit`, troca o bloco `const fetched = await data.fetchPlaylistDefinition(...)` ... `measureRendererPerformancePhase(...)` por:

```ts
            const url = draft.playlistUrl.trim();
            const userAgent = draft.userAgent?.trim() || undefined;
            const title = draft.playlistName?.trim();
            const imported = data.importPlaylistByUrl
                ? await data.importPlaylistByUrl(url, {
                      autoImportEpg: draft.autoImportEpg,
                      title,
                      userAgent,
                  })
                : null;
            if (!current()) return;
            if (imported?.persisted) {
                store.dispatch(
                    PlaylistActions.playlistImportedInMain({
                        playlist: imported.playlist,
                    })
                );
                completed();
                return;
            }
            const fetched =
                imported?.playlist ??
                (await data.fetchPlaylistDefinition(url, userAgent));
            if (!current()) return;
            const playlist = imported
                ? fetched
                : applyPlaylistEpgImportPreference(fetched, draft.autoImportEpg);
            measureRendererPerformancePhase(
                RENDERER_PERFORMANCE_PHASE.M3U_IMPORT_DISPATCH,
                () =>
                    store.dispatch(
                        PlaylistActions.handleAddingPlaylistByUrl({
                            isTemporary: false,
                            playlist: title
                                ? { ...playlist, title, filename: title }
                                : playlist,
                        })
                    )
            );
            completed();
```

(o `completed()` que vinha depois do `measureRendererPerformancePhase` original e substituido por estes dois; o `catch`/`finally` existentes ficam.)

### T-003-02 reducer (`libs/m3u-state/src/lib/reducers/playlist.reducers.ts`, antes do `on(PlaylistActions.handleAddingPlaylistByUrl, ...)`)

```ts
    on(
        PlaylistActions.playlistImportedInMain,
        (state, { playlist }): PlaylistState => ({
            ...state,
            playlists: playlistsAdapter.addOne(
                toEntityMeta(playlist),
                state.playlists
            ),
        })
    ),
```

### T-003-02 efeito (`libs/m3u-state/src/lib/effects.ts`, depois de `addPlaylist$`)

```ts
    // The main process already persisted the playlist (large URL imports):
    // register the inventory change, fetch its EPG and open it.
    playlistImportedInMain$ = createEffect(
        () =>
            this.actions$.pipe(
                ofType(PlaylistActions.playlistImportedInMain),
                tap(({ playlist }) => {
                    this.sourceHealthEvidence.connections.next({
                        id: playlist._id,
                        playlist,
                    });
                    this.fetchPlaylistScopedEpg(playlist);
                    this.navigateToPlaylist(playlist as Playlist);
                })
            ),
        { dispatch: false }
    );
```

Com `private readonly sourceHealthEvidence = inject(SourceHealthEvidenceService);` junto das outras injecoes da classe (`SourceHealthEvidenceService` de `@iptvnator/services`; se o efeito ja injeta servicos por `inject`, seguir o mesmo estilo).

### T-003-02 guarda `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.main-persist.spec.ts` (arquivo novo)

```ts
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService } from '@iptvnator/services';
import { Playlist, PlaylistUrlImportResult } from '@iptvnator/shared/interfaces';
import { createUrlPlaylistImport } from './url-playlist-import';

describe('URL playlist import persisted by the main process', () => {
    const draft = {
        playlistUrl: ' https://example.test/list.m3u ',
        playlistName: ' Synthetic list ',
        userAgent: ' SyntheticAgent/1.0 ',
        autoImportEpg: false,
    };
    let importPlaylistByUrl: jest.Mock;
    let fetchPlaylistDefinition: jest.Mock;
    let dispatch: jest.Mock;
    let completed: jest.Mock;

    function setup(result: PlaylistUrlImportResult) {
        importPlaylistByUrl = jest.fn().mockResolvedValue(result);
        fetchPlaylistDefinition = jest.fn();
        dispatch = jest.fn();
        completed = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { dispatch } },
                {
                    provide: DataService,
                    useValue: {
                        importPlaylistByUrl,
                        fetchPlaylistDefinition,
                        playlistImportRecovery: jest.fn(),
                    },
                },
            ],
        });
        return TestBed.runInInjectionContext(createUrlPlaylistImport);
    }

    it('dispatches only the meta when the main process persisted the playlist', async () => {
        const meta = { _id: 'synthetic-id', title: 'Synthetic list', count: 2 };
        const state = setup({ persisted: true, playlist: meta });

        await state.submit(draft, completed);

        expect(importPlaylistByUrl).toHaveBeenCalledWith(
            'https://example.test/list.m3u',
            {
                autoImportEpg: false,
                title: 'Synthetic list',
                userAgent: 'SyntheticAgent/1.0',
            }
        );
        expect(fetchPlaylistDefinition).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.playlistImportedInMain({ playlist: meta })
        );
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('falls back to the renderer write when the kill switch returns the playlist', async () => {
        const playlist = {
            _id: 'synthetic-id',
            title: 'Synthetic list',
            playlist: { items: [] },
        } as Playlist;
        const state = setup({ persisted: false, playlist });

        await state.submit(draft, completed);

        expect(fetchPlaylistDefinition).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.handleAddingPlaylistByUrl({
                isTemporary: false,
                playlist: {
                    ...playlist,
                    title: 'Synthetic list',
                    filename: 'Synthetic list',
                },
            })
        );
    });
});
```

### T-003-03 `docs/architecture/m3u-playlist-module.md`

Paragrafo novo no fim da secao que descreve o import por URL (antes de `## Initial URL Import Performance Benchmark (Electron)`):

```markdown
### Main-process persistence (Electron)

The Electron dialog imports through `import-playlist-by-url`
(`playlist-url-import.ts`): the main process downloads, applies the title and
the EPG choice, writes the playlist through the database worker and returns
only the meta (`PlaylistUrlImportResult`). The renderer registers the source
with `playlistImportedInMain`, fetches its EPG and opens it; the channels come
back through the normal playlist read. Cloning a 380k-entry playlist to the
renderer and back for the write cost about three minutes. Kill switch:
`IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1` returns the parsed playlist and the
renderer persists it as before. `fetch-playlist-by-url` is unchanged for
source sync and auto-update.
```

### T-003-03 `.changes/playlist-large-m3u-import.md` (arquivo novo)

```markdown
---
type: perf
area: playlist
---

Very large M3U playlists added by URL on desktop now import minutes faster: the app saves them without copying the whole list through the window first.
```

### T-003-04 `apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts`

`waitForDatabaseSettlement` aceita os dois caminhos. Os eventos `db-request`/`db-response` do status (`m3u-refresh-main-capture.ts:1662-1678`) vem dos handlers IPC `DB_*`; o upsert que o main faz direto no `databaseWorkerClient` nao passa por eles. Caminho novo: `databaseRequests === 1 && databaseGetsCompleted === 1 && databasePending === 0 && preloadSuccessMarkers === 1`. Caminho antigo (kill switch ligado): a condicao atual (`databaseRequests === 2`, `databaseUpsertsCompleted === 1`, `databaseGetsCompleted === 1`, `databasePending === 0`, `preloadSuccessMarkers === 2`). O caminho antigo (kill switch ligado) mantem a condicao atual. A escolha vem de `process.env[MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV] === '1'`.

O benchmark lanca o Electron com `environmentInheritance: 'runtime-only'` (linha 188), que nao herda variaveis arbitrarias. Acrescentar ao objeto `env` passado a `launchElectronApp` (o mesmo que ja tem `IPTVNATOR_PERF_CAPTURE: '1'`):

```ts
                ...(process.env[MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV] === '1'
                    ? { [MAIN_PLAYLIST_IMPORT_KILL_SWITCH_ENV]: '1' }
                    : {}),
```

Medicao (D-05), mesmo build, duas rodadas smoke do catalogo, saida em `dist/performance/` (gitignored):

```bash
IPTVNATOR_PERF_OUTPUT_DIR="$PWD/dist/performance/<ts>-catalog-before" IPTVNATOR_PERF_VARIANT=before IPTVNATOR_PERF_SMOKE=1 IPTVNATOR_PERF_M3U_CATALOG=1 IPTVNATOR_DISABLE_MAIN_PLAYLIST_IMPORT=1 pnpm nx run electron-backend-e2e:benchmark-m3u-import
IPTVNATOR_PERF_OUTPUT_DIR="$PWD/dist/performance/<ts>-catalog-after" IPTVNATOR_PERF_VARIANT=after IPTVNATOR_PERF_SMOKE=1 IPTVNATOR_PERF_M3U_CATALOG=1 pnpm nx run electron-backend-e2e:benchmark-m3u-import
```

Se o `summary.json` nao sair (validador `phase-order`, PLAN-002 F-07), ler os marcos da timeline bruta em `main-capture.json`/`renderer-capture.json`, como no `measurements.md` do PLAN-002, e registrar a tabela antes/depois em `docs/plans/PLAN-003-m3u-main-process-import/measurements.md`.

## Tabela de verdade das guardas

| Guarda | Base (525adb045) | Depois da task | Mutacao que deixa vermelha |
|---|---|---|---|
| `apps/electron-backend/src/app/events/playlist-url-import.spec.ts` | vermelha: modulo `./playlist-url-import` nao existe | verde depois de T-003-01 | tirar o `if (!isMainPlaylistImportEnabled())` → o terceiro teste falha |
| `libs/playlist/import/feature/src/lib/add-playlist-dialog/url-playlist-import.main-persist.spec.ts` | vermelha: `PlaylistActions.playlistImportedInMain` nao existe | verde depois de T-003-02 | despachar `handleAddingPlaylistByUrl` tambem no ramo `persisted` → o primeiro teste falha (`toHaveBeenCalledTimes(1)`) |

Falha de dependencia (X-10): a guarda 2 importa o tipo `PlaylistUrlImportResult`, criado em T-003-01. Ordem 01 → 02 obrigatoria.
