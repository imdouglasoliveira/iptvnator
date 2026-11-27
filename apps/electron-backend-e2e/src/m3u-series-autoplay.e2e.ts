import type { Locator, Page } from '@playwright/test';
import {
    buildM3uContent,
    closeElectronApp,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    saveSettings,
    sourceRowByTitle,
    test as electronTest,
    waitForM3uCatalog,
} from './electron-test-fixtures';
import {
    startSyntheticM3uServer,
    SYNTHETIC_M3U_RESOURCE_PATH,
} from './performance/synthetic-m3u-server';

const SERIES = 'Synthetic Observatory';
const OPEN_GROUP = 'Synthetic Open';
const LOCKED_GROUP = 'Synthetic Restricted';
const CLIP_SECONDS = 30;
// Restart requires progress above 10 s, and M3U resume needs more than 15 s remaining.
const SAVED_SECOND = 12;
const episodes = [
    { code: 'S01E01', title: 'First Light', color: '#306080' },
    { code: 'S01E02', title: 'Meridian', color: '#805030' },
    { code: 'S02E01', title: 'New Orbit', color: '#308050' },
] as const;
const [first, second, third] = episodes;

type Episode = (typeof episodes)[number];
const clipPath = (episode: Episode) => `/series/${episode.code}.webm`;

const test = electronTest.extend<{ seriesPage: Page }>({
    seriesPage: async ({ dataDir }, use) => {
        const app = await launchElectronApp(dataDir, {
            environmentInheritance: 'runtime-only',
        });
        let server:
            Awaited<ReturnType<typeof startSyntheticM3uServer>> | undefined;
        try {
            const page = app.mainWindow;
            const videos = new Map<string, Buffer>();
            for (const episode of episodes) {
                videos.set(
                    clipPath(episode),
                    await makeWebm(page, episode.color)
                );
            }
            await page.route('https://media.example.test/**', (route) =>
                route.abort()
            );
            server = await startSyntheticM3uServer((origin) => {
                const body = buildM3uContent([
                    {
                        name: 'Synthetic Open Channel',
                        groupTitle: OPEN_GROUP,
                        url: 'https://media.example.test/live/open.m3u8',
                    },
                    {
                        name: 'Synthetic Restricted Channel',
                        groupTitle: LOCKED_GROUP,
                        url: 'https://media.example.test/live/restricted.m3u8',
                    },
                    ...episodes.map((episode) => ({
                        name: `${SERIES} ${episode.code} ${episode.title}`,
                        groupTitle:
                            episode === second ? LOCKED_GROUP : OPEN_GROUP,
                        url: `${origin}${clipPath(episode)}`,
                    })),
                ]);
                return { body, bytes: Buffer.byteLength(body) };
            }, videos);
            await importM3uPlaylistFromUrl(page, server.resourceUrl);
            await waitForM3uCatalog(page);
            await use(page);
        } finally {
            try {
                await closeElectronApp(app);
            } finally {
                await server?.close();
            }
        }
    },
});

test('@electron @playback M3U shows A seguir and advances within and across seasons', async ({
    seriesPage: page,
}) => {
    await openSettings(page);
    await page.getByTestId('select-language').click();
    await page.getByTestId('pt-BR').click();
    await saveSettings(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await reopenCatalog(page, 'Fontes');
    await openSeries(page, 'Séries');

    const video = inlineVideo(page);
    await episodeRow(page, first)
        .locator('[data-testid="episode-play-target"]')
        .click();
    await expectPlaying(video, first);
    await pauseAndSeek(video, CLIP_SECONDS - 5);
    await play(video);

    const upNext = page.getByTestId('player-controls-up-next');
    await expect(upNext).toBeVisible();
    await expect(upNext).toHaveAccessibleName(/^A seguir: S01E02\b/);
    await expect(upNext.locator('.player-up-next__eyebrow')).toContainText(
        /A seguir.*em [1-6] s/s
    );
    await expect(upNext).toContainText(second.code);

    await test.step('S01E02 plays after S01E01 reaches the end', async () => {
        await expectPlaying(video, second);
    });
    await test.step('S02E01 plays after the last episode of season one', async () => {
        await pauseAndSeek(video, CLIP_SECONDS - 2);
        await play(video);
        await expectPlaying(video, third);
    });
});

test('@electron @playback M3U resumes saved progress and can play from beginning', async ({
    seriesPage: page,
}) => {
    const catalog = new URL(page.url()).pathname.match(
        /\/playlists\/([^/]+)\/all$/
    );
    if (!catalog) throw new Error('Expected the M3U catalog route');
    const playlistId = decodeURIComponent(catalog[1]);
    await openSeries(page, 'Series');

    const row = episodeRow(page, first);
    const episodePlay = row.locator('[data-testid="episode-play-target"]');
    const video = inlineVideo(page);
    await episodePlay.click();
    await expectPlaying(video, first);
    await pauseAndSeek(video, SAVED_SECOND);
    await closePlayer(page);

    await expect
        .poll(() =>
            page.evaluate(
                (id) => window.electron.dbGetAllPlaybackPositions(id),
                playlistId
            )
        )
        .toEqual([
            expect.objectContaining({
                episodeNumber: 1,
                positionSeconds: SAVED_SECOND,
                durationSeconds: CLIP_SECONDS,
            }),
        ]);

    await openSeries(page, 'Series');
    const resumedAt = await capturePlaybackStart(page, first, episodePlay);
    expect(Math.abs(resumedAt - SAVED_SECOND)).toBeLessThan(0.35);
    await closePlayer(page);

    await row.locator('[data-testid="episode-more-button"]').click();
    const restartedAt = await capturePlaybackStart(
        page,
        first,
        page.getByRole('menuitem', { name: 'Play from beginning' })
    );
    expect(restartedAt).toBeLessThan(0.35);
});

test('@electron @playback cancelling the M3U group PIN leaves the ended episode mounted', async ({
    seriesPage: page,
}) => {
    await openSettings(page);
    await openSettingsSection(page, 'parental');
    await page.getByTestId('parental-lock-enabled').getByRole('switch').click();
    const pin = page.locator('app-parental-lock-pin-dialog');
    await pin.getByTestId('parental-lock-pin').fill('2468');
    await pin.getByTestId('parental-lock-pin-confirm').fill('2468');
    await pin.getByTestId('parental-lock-pin-submit').click();
    await expect(page.getByTestId('parental-lock-lock-now')).toBeVisible();

    await reopenCatalog(page, 'Sources');
    await openWorkspaceSection(page, 'Groups');
    await page
        .getByRole('button', { name: 'Manage groups', exact: true })
        .click();
    const groups = page.getByRole('dialog');
    const lock = groups.getByTestId(`group-lock-${LOCKED_GROUP}`);
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    await groups.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(groups).toBeHidden();

    await openSettings(page);
    await openSettingsSection(page, 'parental');
    await page.getByTestId('parental-lock-lock-now').click();
    await expect(page.getByTestId('parental-lock-unlock')).toBeVisible();
    await reopenCatalog(page, 'Sources');
    await openSeries(page, 'Series');

    const video = inlineVideo(page);
    await episodeRow(page, first)
        .locator('[data-testid="episode-play-target"]')
        .click();
    await expectPlaying(video, first);
    await pauseAndSeek(video, CLIP_SECONDS - 2);
    await play(video);

    await expect(pin.getByTestId('parental-lock-pin-submit')).toHaveText(
        'Unlock'
    );
    await pin.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(pin).toBeHidden();
    await expect(
        page.locator('app-portal-inline-player .player-shell__title')
    ).toContainText(first.title);
    await expect
        .poll(() =>
            video.evaluate(
                (element: HTMLVideoElement, path) => ({
                    sameEpisode:
                        element.currentSrc !== '' &&
                        new URL(element.currentSrc).pathname === path,
                    paused: element.paused,
                    ended: element.ended,
                    atEnd:
                        Math.abs(element.currentTime - element.duration) < 0.1,
                }),
                clipPath(first)
            )
        )
        .toEqual({ sameEpisode: true, paused: true, ended: true, atEnd: true });
});

async function reopenCatalog(page: Page, sourcesLabel: string): Promise<void> {
    await openWorkspaceSection(page, sourcesLabel);
    await sourceRowByTitle(page, SYNTHETIC_M3U_RESOURCE_PATH.slice(1)).click();
    await waitForM3uCatalog(page);
}

async function openSeries(page: Page, section: string): Promise<void> {
    await openWorkspaceSection(page, section);
    await page
        .locator('app-grid-list mat-card')
        .filter({ hasText: SERIES })
        .click();
}

function episodeRow(page: Page, episode: Episode): Locator {
    return page.locator('app-season-container app-episode-item').filter({
        has: page.getByRole('heading', {
            name: episode.title,
            exact: true,
        }),
    });
}

function inlineVideo(page: Page): Locator {
    return page.locator('app-portal-inline-player video');
}

async function closePlayer(page: Page): Promise<void> {
    await page
        .getByRole('button', { name: 'Close player', exact: true })
        .click();
    await expect(inlineVideo(page)).toHaveCount(0);
}

async function expectPlaying(video: Locator, episode: Episode): Promise<void> {
    await expect
        .poll(() =>
            video.evaluate(
                (element: HTMLVideoElement, path) =>
                    element.currentSrc !== '' &&
                    new URL(element.currentSrc).pathname === path &&
                    !element.paused &&
                    !element.seeking &&
                    element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                    element.currentTime > 0,
                clipPath(episode)
            )
        )
        .toBe(true);
}

async function capturePlaybackStart(
    page: Page,
    episode: Episode,
    action: Locator
): Promise<number> {
    const attribute = 'data-e2e-playback-start';
    await page.evaluate(
        ({ attribute, path }) => {
            const root = document.documentElement;
            root.removeAttribute(attribute);
            const recordStart = (event: Event) => {
                const video = event.target;
                if (
                    video instanceof HTMLVideoElement &&
                    video.closest('app-portal-inline-player') &&
                    video.currentSrc &&
                    new URL(video.currentSrc).pathname === path
                ) {
                    root.setAttribute(attribute, String(video.currentTime));
                    document.removeEventListener('playing', recordStart, true);
                }
            };
            document.addEventListener('playing', recordStart, true);
        },
        { attribute, path: clipPath(episode) }
    );
    await action.click();
    const root = page.locator('html');
    await expect(root).toHaveAttribute(attribute, /^\d/);
    return Number(await root.getAttribute(attribute));
}

async function pauseAndSeek(video: Locator, seconds: number): Promise<void> {
    await video.evaluate(async (element: HTMLVideoElement, position) => {
        element.pause();
        const seeked = new Promise<void>((resolve) =>
            element.addEventListener('seeked', () => resolve(), { once: true })
        );
        element.currentTime = position;
        await seeked;
    }, seconds);
}

async function play(video: Locator): Promise<void> {
    await video.evaluate((element: HTMLVideoElement) => element.play());
}

function findVp8Chunk(webp: Buffer): Buffer {
    // Chromium may wrap the lossy frame in VP8X with an ALPH chunk.
    for (let offset = 12; offset + 8 <= webp.length;) {
        const size = webp.readUInt32LE(offset + 4);
        if (webp.toString('ascii', offset, offset + 4) === 'VP8 ') {
            return webp.subarray(offset + 8, offset + 8 + size);
        }
        offset += 8 + size + (size % 2);
    }
    throw new Error('Expected the canvas to encode a lossy WebP frame');
}

async function makeWebm(page: Page, color: string): Promise<Buffer> {
    const webp = Buffer.from(
        await page.evaluate((fill) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 16;
            const context = canvas.getContext('2d')!;
            context.fillStyle = fill;
            context.fillRect(0, 0, 16, 16);
            return canvas.toDataURL('image/webp', 0.8).split(',')[1];
        }, color),
        'base64'
    );

    const frame = findVp8Chunk(webp);
    const frameMs = 250;

    // The lossy WebP payload is a VP8 keyframe that can be repeated in WebM.
    const blocks = Array.from(
        { length: (CLIP_SECONDS * 1000) / frameMs },
        (_, index) => {
            const blockHeader = Buffer.from([0x81, 0, 0, 0x80]);
            blockHeader.writeInt16BE(index * frameMs, 1);
            return ebml('a3', blockHeader, frame);
        }
    );
    const timecodeScale = Buffer.from([0x0f, 0x42, 0x40]);
    const duration = Buffer.alloc(8);
    duration.writeDoubleBE(CLIP_SECONDS * 1000);
    const frameDuration = Buffer.alloc(4);
    frameDuration.writeUInt32BE(frameMs * 1_000_000);

    // Element IDs follow WebM's EBML schema; timestamps use millisecond ticks.
    const header = ebml(
        '1a45dfa3',
        ebml('4286', 1),
        ebml('42f7', 1),
        ebml('42f2', 4),
        ebml('42f3', 8),
        ebml('4282', 'webm'),
        ebml('4287', 2),
        ebml('4285', 2)
    );
    const info = ebml(
        '1549a966',
        ebml('2ad7b1', timecodeScale),
        ebml('4489', duration),
        ebml('4d80', 'Synthetic fixture'),
        ebml('5741', 'Synthetic fixture')
    );
    const tracks = ebml(
        '1654ae6b',
        ebml(
            'ae',
            ebml('d7', 1),
            ebml('73c5', 1),
            ebml('83', 1),
            ebml('86', 'V_VP8'),
            ebml('23e383', frameDuration),
            ebml('e0', ebml('b0', 16), ebml('ba', 16))
        )
    );
    const cluster = ebml('1f43b675', ebml('e7', 0), ...blocks);
    const clusterOffset = Buffer.alloc(4);
    clusterOffset.writeUInt32BE(info.length + tracks.length);
    const cues = ebml(
        '1c53bb6b',
        ebml(
            'bb',
            ebml('b3', 0),
            ebml('b7', ebml('f7', 1), ebml('f1', clusterOffset))
        )
    );
    return Buffer.concat([
        header,
        ebml('18538067', info, tracks, cluster, cues),
    ]);
}

function ebml(id: string, ...parts: (Buffer | number | string)[]): Buffer {
    const payload = Buffer.concat(
        parts.map((part) => {
            if (typeof part === 'number') return Buffer.from([part]);
            if (typeof part === 'string') return Buffer.from(part);
            return part;
        })
    );
    const size = Buffer.alloc(4);
    size.writeUInt32BE(0x10000000 + payload.length);
    return Buffer.concat([Buffer.from(id, 'hex'), size, payload]);
}
