---
plan_id: PLAN-001-m3u-download-timeout
generated_at: 2026-11-23T22:30:00-03:00
---

# Specs: timeout de download de playlist

## Tipos e interfaces

- `PLAYLIST_FETCH_TIMEOUT_MS: number` (export de `apps/electron-backend/src/app/events/playlist-source.ts`): timeout de inatividade por salto HTTP de playlist. Valor novo: `120000`.
- `PROVIDER_REQUEST_TIMEOUT_MS` (export `as const` de `apps/web-backend/src/app/host-guard.ts`): `playlist` vai para `120_000`; `epg 30_000`, `stalker 15_000`, `stalkerCreateLink 30_000`, `xtream 30_000` ficam.

## Endpoints e payloads

| Endpoint | Metodo | Request | Response | Observacoes |
|----------|--------|---------|----------|-------------|
| IPC `fetch-playlist-by-url` | invoke | `url`, `title?`, opcoes (`userAgent`, `trustedInsecureTlsHosts`) | `Playlist` | sem mudanca de contrato; so o `timeout` do request |
| PWA `/parse` | GET | `url`, `userAgent?`, `targetId` | playlist JSON | `timeout: PROVIDER_REQUEST_TIMEOUT_MS.playlist` |

## Invariantes

- Os dois runtimes usam o mesmo numero para playlist (120 s).
- O timeout continua sendo de inatividade por salto (semantica do axios documentada em `host-guard.ts`), nunca prazo total.
- Xtream, Stalker e EPG nao mudam.

## Trechos literais

### T-001-01 `playlist-source.ts` (substitui as linhas 25-31)

```ts
/**
 * Idle timeout for every playlist download hop. Without it a host that accepts
 * the connection and then goes silent keeps the request pending forever, which
 * stalled the unattended startup auto-update indefinitely (issue #931).
 * Some Xtream panels build the M3U on demand and send the first byte only
 * after about a minute, so the budget leaves room for that wait.
 * Mirrored by the playlist refresh worker and the web backend.
 */
export const PLAYLIST_FETCH_TIMEOUT_MS = 120000;
```

### T-001-01 guarda `apps/electron-backend/src/app/events/playlist-source.spec.ts` (arquivo novo)

```ts
import {
    fetchPlaylistFromUrl,
    PLAYLIST_FETCH_TIMEOUT_MS,
} from './playlist-source';

const mockRequestWithValidatedRedirects = jest.fn();

jest.mock('@iptvnator/shared/m3u-utils', () => ({
    createPlaylistObject: jest.fn(() => ({ title: 'Synthetic' })),
    getFilenameFromUrl: jest.fn(() => 'slow.m3u'),
}));

jest.mock('iptv-playlist-parser', () => ({
    parse: jest.fn(() => ({ items: [] })),
}));

jest.mock('../util/secure-https', () => ({
    createPlaylistAgentFactory: jest.fn(() => jest.fn()),
}));

jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: (...args: unknown[]) =>
        mockRequestWithValidatedRedirects(...args),
}));

describe('playlist download timeout', () => {
    beforeEach(() => mockRequestWithValidatedRedirects.mockReset());

    it('allows a provider two minutes of silence per hop', () => {
        expect(PLAYLIST_FETCH_TIMEOUT_MS).toBe(120_000);
    });

    it('passes the playlist budget to the download request', async () => {
        mockRequestWithValidatedRedirects.mockResolvedValue({
            data: '#EXTM3U',
        });

        await fetchPlaylistFromUrl('https://example.test/slow.m3u');

        expect(mockRequestWithValidatedRedirects).toHaveBeenCalledWith(
            'https://example.test/slow.m3u',
            expect.objectContaining({ method: 'GET', timeout: 120_000 }),
            { allowPrivateNetworks: true }
        );
    });
});
```

### T-001-01 `playlist.events.spec.ts`

Nas linhas 209 e 481, `timeout: 30000,` vira `timeout: 120000,`. As mensagens simuladas `'timeout of 30000ms exceeded'` (linha 512 e `playlist-auto-update.spec.ts`) ficam: sao texto de mock, nao asseveram a constante.

### T-001-01 `docs/architecture/m3u-playlist-module.md:453-456`

```markdown
- Every HTTP hop uses the idle timeout `PLAYLIST_FETCH_TIMEOUT_MS` (120s, exported by
  `playlist-source.ts`). Without it a host that accepts the connection and then goes
  silent keeps the request pending forever. Some Xtream panels generate the M3U on
  demand and send the first byte only after about a minute, so 30s rejected them.
  Redirects are followed one hop at a time, so each hop is bounded separately.
```

### T-001-02 `host-guard.ts` (comentario e objeto, linhas 35-53)

```ts
/**
 * Per-route request timeouts, matching the Electron handlers so both runtimes
 * give up at the same point:
 *
 * - `xtream` — `xtream.events.ts` (30 s for the Xtream API)
 * - `stalker` / `stalkerCreateLink` — `stalker.events.ts`; `create_link` gets
 *   longer because the portal mints a stream URL before answering
 * - `playlist` — `PLAYLIST_FETCH_TIMEOUT_MS` in `playlist-source.ts` (120 s:
 *   some panels build the M3U on demand before sending the first byte)
 * - `epg` — the EPG worker streams its download with no explicit timeout, so
 *   there is no number to copy; it keeps 30 s, which bounds a silent host
 *   without capping a healthy long transfer (see the note above).
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = {
    epg: 30_000,
    playlist: 120_000,
    stalker: 15_000,
    stalkerCreateLink: 30_000,
    xtream: 30_000,
} as const;
```

### T-001-02 guarda `apps/web-backend/src/app/host-guard.spec.ts` (arquivo novo)

```ts
import { PROVIDER_REQUEST_TIMEOUT_MS } from './host-guard';

describe('provider request timeouts', () => {
    it('gives playlist downloads the Electron budget of two minutes', () => {
        expect(PROVIDER_REQUEST_TIMEOUT_MS.playlist).toBe(120_000);
    });

    it('keeps the portal and EPG budgets unchanged', () => {
        expect(PROVIDER_REQUEST_TIMEOUT_MS).toEqual({
            epg: 30_000,
            playlist: 120_000,
            stalker: 15_000,
            stalkerCreateLink: 30_000,
            xtream: 30_000,
        });
    });
});
```

### T-001-02 `web-backend-app.spec.ts`

Na linha 151 (expectativa do request de `/parse` para `https://provider.example/list.m3u`), `timeout: 30000,` vira `timeout: 120000,`. As linhas 264, 381, 419 e 616 (EPG, Xtream, Stalker) ficam.

### T-001-02 `docs/architecture/host-connectivity-guard.md:47-48`

```markdown
budgets: Xtream 30 s, Stalker 15 s (30 s for `create_link`, which mints a stream
URL before answering), playlist downloads 120 s (some panels build the M3U on
demand before the first byte) and XMLTV downloads 30 s.
```

### T-001-03 `.changes/playlist-slow-m3u-download.md` (arquivo novo)

```markdown
---
type: fix
area: playlist
---

M3U playlists from providers that take up to two minutes to start sending the file now import instead of failing with "Failed to fetch the playlist".
```

## Tabela de verdade das guardas

| Guarda | Base (525adb045) | Depois da task | Mutacao que deixa vermelha |
|---|---|---|---|
| `apps/electron-backend/src/app/events/playlist-source.spec.ts` | vermelha: constante vale 30000 e o request recebe `timeout: 30000` | verde depois de T-001-01 | voltar `PLAYLIST_FETCH_TIMEOUT_MS` para `30000` → os 2 testes falham |
| `apps/web-backend/src/app/host-guard.spec.ts` | vermelha: `playlist` vale 30_000 | verde depois de T-001-02 | trocar `epg` para `120_000` → o segundo teste falha (protege D-02) |

Falha de dependencia (X-10): se `@iptvnator/shared/m3u-utils` ou `iptv-playlist-parser` nao resolverem no jest do `electron-backend`, a guarda 1 sai vermelha por import, nao por valor. Conferir no log da selagem que a falha e de `toBe(120_000)`/`timeout`, nao de modulo.
