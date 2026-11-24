# Specs: PLAN-004, playlist em texto JSON

> Copie os blocos. O que estiver entre `<...>` voce confere no codigo antes de escrever; se nao existir com esse nome, PARE e registre no `progress.md`.

## T-004-01 · Worker, handler, preload e tipo

### Tipo (`libs/shared/interfaces/src/lib/electron-api.interface.ts`, logo depois de `dbGetAppPlaylist`)

```ts
    /**
     * Same read as dbGetAppPlaylist, returned as JSON text so a large
     * playlist crosses IPC and the context bridge as one string.
     * Returns the object when the main process disables the text read
     * (IPTVNATOR_DISABLE_JSON_PLAYLIST_READ=1).
     */
    dbGetAppPlaylistJson?: (
        playlistId: string,
        operationId?: string
    ) => Promise<string | Playlist | null>;
```

### Kill switch (constante compartilhada; mesmo arquivo de `PLAYLIST_URL_IMPORT` do PLAN-003, `libs/shared/interfaces/src/lib/playlist-url-import.ts`)

```ts
export const JSON_PLAYLIST_READ_KILL_SWITCH_ENV =
    'IPTVNATOR_DISABLE_JSON_PLAYLIST_READ';
```

### Handler (`apps/electron-backend/src/app/events/database/playlist.events.ts:36`)

```ts
handleWorkerRequest(
    'DB_GET_APP_PLAYLIST',
    (playlistId: string, options?: { format?: 'json' }) => ({
        playlistId,
        ...(options?.format === 'json' &&
        process.env[JSON_PLAYLIST_READ_KILL_SWITCH_ENV] !== '1'
            ? { format: 'json' as const }
            : {}),
    })
);
```

### Worker (`apps/electron-backend/src/app/workers/database.worker.ts`, case `DB_GET_APP_PLAYLIST`)

```ts
        case 'DB_GET_APP_PLAYLIST': {
            const payload = message.payload as {
                playlistId: string;
                format?: 'json';
            };
            // ... capturePhase inalterado ...
            const playlist = await getAppPlaylist(
                db,
                payload.playlistId,
                capturePhase
            );
            return payload.format === 'json' && playlist
                ? JSON.stringify(playlist)
                : playlist;
        }
```

Se o tipo do payload do worker estiver declarado em `database-worker.types.ts` ou em `worker-ipc-contract.spec-data.ts`, acrescente `format?: 'json'` la tambem.

### Preload (`apps/electron-backend/src/app/api/main.preload.ts`, depois da linha 896)

```ts
    dbGetAppPlaylistJson: (playlistId: string, _operationId?: string) =>
        ipcRenderer.invoke('DB_GET_APP_PLAYLIST', playlistId, {
            format: 'json',
        }),
```

### Teste (novo): `apps/electron-backend/src/app/events/database/playlist-json-read.spec.ts`

Cobrir com o mesmo estilo de mock de `ipcMain`/`databaseWorkerClient` usado em `epg-db.events.spec.ts`:

1. `DB_GET_APP_PLAYLIST` com `(id, { format: 'json' })` envia ao worker `{ playlistId: id, format: 'json' }`.
2. Com `process.env.IPTVNATOR_DISABLE_JSON_PLAYLIST_READ = '1'`, envia `{ playlistId: id }`.
3. Sem opcoes, envia `{ playlistId: id }` (o chamador antigo nao muda).

## T-004-02 · Renderer

### `libs/services/src/lib/playlist-storage-backend.ts`

Acrescentar `| 'dbGetAppPlaylistJson'` ao `Pick<ElectronBridgeApi, ...>`.

### `libs/services/src/lib/playlists.service.ts`, `getPlaylistById`

```ts
                if (store) {
                    playlist = await this.readDocumentPlaylist(
                        store,
                        id,
                        operationId
                    );
                }
```

E o metodo privado:

```ts
    private async readDocumentPlaylist(
        store: PlaylistDocumentStore,
        id: string,
        operationId?: string
    ): Promise<Playlist | null> {
        const read = store.dbGetAppPlaylistJson
            ? store.dbGetAppPlaylistJson(id, operationId)
            : store.dbGetAppPlaylist(id, operationId);
        const value = await read;
        return typeof value === 'string'
            ? (JSON.parse(value) as Playlist)
            : (value ?? null);
    }
```

Mantenha a distincao atual entre `operationId === undefined` e definido, se algum teste depender dela.

### Teste (novo): `libs/services/src/lib/playlists.service.json-read.spec.ts`

Montar o service como em `playlists.service.spec.ts:100-145`, com o mock do store:

1. Com `dbGetAppPlaylistJson` devolvendo `JSON.stringify(playlist)`, `getPlaylistById` devolve o mesmo conteudo e `dbGetAppPlaylist` nao e chamado.
2. Com `dbGetAppPlaylistJson` devolvendo o objeto (kill switch), devolve o objeto.
3. Sem `dbGetAppPlaylistJson` (document store do servidor), usa `dbGetAppPlaylist`.
4. Com `null`, o resultado e o mesmo de hoje para playlist inexistente.

### Harness de performance

Nos dois mapas metodo para operacao, acrescentar `dbGetAppPlaylistJson: 'DB_GET_APP_PLAYLIST'`:

- `apps/electron-backend-e2e/src/performance/database-request-identity-capture.ts:67-70`
- `apps/electron-backend-e2e/src/performance/xtream-ipc-worker-identity-binding.ts:12`

Rode `git grep -n "dbGetAppPlaylist'" apps/electron-backend-e2e` e repita onde mais houver um mapa igual.

## T-004-03 · Doc e nota

- `docs/architecture/m3u-playlist-module.md`: na secao "Main-process persistence (Electron)" do PLAN-003, um paragrafo "Reading large playlists". O assunto e o texto JSON no lugar do objeto, o motivo e a copia por objeto no IPC e no context bridge, e o kill switch.
- `.changes/playlist-large-m3u-open.md`: seguir `.changes/README.md`, `type: perf`. Texto: "Large M3U playlists open much faster in the desktop app."
