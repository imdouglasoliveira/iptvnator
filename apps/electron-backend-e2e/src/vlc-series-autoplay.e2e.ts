import { join } from 'node:path';
import {
    closeElectronApp,
    expect,
    goToDashboard,
    importM3uPlaylistFromNativeDialog,
    launchElectronApp,
    type LaunchedElectronApp,
    openSettings,
    openSettingsSection,
    openWorkspaceSection,
    saveSettings,
    test,
    waitForM3uCatalog,
    writeTemporaryM3uFile,
} from './electron-test-fixtures';

interface VlcFixture {
    spawnUrls: string[];
    commands: string[];
    stopped: boolean;
}

const episodeUrl = (label: string) => `https://media.example.test/${label}.mp4`;

async function installSyntheticVlc(
    app: LaunchedElectronApp,
    playerPath: string
) {
    await app.electronApp.evaluate((_, playerPath) => {
        const childProcess = process.getBuiltinModule('child_process');
        const { EventEmitter } = process.getBuiltinModule('events');
        const { createServer } = process.getBuiltinModule('net');
        const spawn = childProcess.spawn;
        const fixture: VlcFixture = {
            spawnUrls: [],
            commands: [],
            stopped: false,
        };
        Reflect.set(globalThis, '__vlcSeriesFixture', fixture);

        childProcess.spawn = ((
            command: string,
            args: readonly string[] = [],
            options?: import('node:child_process').SpawnOptions
        ) => {
            if (command !== playerPath)
                return Reflect.apply(spawn, childProcess, [
                    command,
                    args,
                    options,
                ]);
            const portArg = args.find((arg) => arg.startsWith('--rc-host='));
            const url = args.find((arg) =>
                arg.startsWith('https://media.example.test/')
            );
            if (!portArg || !url)
                throw new Error('Missing synthetic VLC launch arguments');
            fixture.spawnUrls.push(url);

            let replaced = false;
            const server = createServer((socket) => {
                socket.on('data', (chunk) => {
                    const command = chunk.toString().trim();
                    fixture.commands.push(command);
                    if (command.startsWith('add ')) {
                        replaced = true;
                        fixture.stopped = false;
                    }
                    const stopped = fixture.stopped;
                    if (command === 'get_time')
                        socket.write(
                            stopped ? '> 0' : replaced ? '> 10' : '> 115'
                        );
                    else if (command === 'get_length')
                        socket.write(stopped ? '> 0' : '> 120');
                    else if (command === 'status')
                        socket.write(
                            stopped
                                ? '( state stopped ) >'
                                : '( state playing ) >'
                        );
                    else if (command === 'quit') {
                        socket.end('> ');
                        proc.kill();
                    } else socket.write('> ');
                });
            });
            const proc = Object.assign(new EventEmitter(), {
                exitCode: null as number | null,
                signalCode: null,
                killed: false,
                stdout: null,
                stderr: null,
                unref: () => undefined,
                kill: () => {
                    proc.killed = true;
                    proc.exitCode = 0;
                    server.close();
                    proc.emit('exit', 0);
                    return true;
                },
            });
            server.listen(Number(portArg.split(':').pop()), '127.0.0.1', () =>
                proc.emit('spawn')
            );
            return proc;
        }) as typeof spawn;
    }, playerPath);
}

function readVlc(app: LaunchedElectronApp): Promise<VlcFixture> {
    return app.electronApp.evaluate(
        () => Reflect.get(globalThis, '__vlcSeriesFixture') as VlcFixture
    );
}

async function finishInput(app: LaunchedElectronApp): Promise<void> {
    await app.electronApp.evaluate(() => {
        const fixture = Reflect.get(
            globalThis,
            '__vlcSeriesFixture'
        ) as VlcFixture;
        fixture.stopped = true;
    });
}

test('@electron @playback M3U series advance in the same VLC window', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    const page = app.mainWindow;
    try {
        const playerPath = join(dataDir, 'synthetic-vlc');
        await installSyntheticVlc(app, playerPath);
        await openSettings(page);
        await openSettingsSection(page, 'playback');
        await page.getByTestId('select-video-player').click();
        await page.getByTestId('vlc').click();
        await page.locator('#vlcPlayerPath').fill(playerPath);
        await saveSettings(page);
        await page.evaluate(() =>
            window.electron.updateSettings({
                vlcReuseInstance: false,
                seriesAutoplay: true,
            })
        );
        await goToDashboard(page);

        const playlist = writeTemporaryM3uFile(
            dataDir,
            'synthetic-series.m3u',
            [
                {
                    name: 'Synthetic Live',
                    url: 'https://media.example.test/live.m3u8',
                },
                ...['S01E01', 'S01E02'].map((label) => ({
                    name: `Synthetic Show ${label}`,
                    url: episodeUrl(label),
                    groupTitle: 'Synthetic Shows',
                })),
            ]
        );
        await importM3uPlaylistFromNativeDialog(app, playlist);
        await waitForM3uCatalog(page);
        const playlistRoute = new URL(page.url()).pathname.match(
            /\/workspace\/playlists\/([^/]+)\/all$/
        );
        if (!playlistRoute) throw new Error('Expected the M3U catalog route');
        const playlistId = decodeURIComponent(playlistRoute[1]);
        await openWorkspaceSection(page, 'Series');
        await page
            .locator('app-grid-list mat-card')
            .filter({ hasText: 'Synthetic Show' })
            .click();
        await page
            .locator(
                'app-season-container .episode-card, app-season-container .episode-list-item'
            )
            .first()
            .click();

        const rows = () =>
            page.evaluate(
                (id) => window.electron.dbGetAllPlaybackPositions(id),
                playlistId
            );
        await expect
            .poll(rows)
            .toEqual([
                expect.objectContaining({
                    episodeNumber: 1,
                    positionSeconds: 115,
                    durationSeconds: 120,
                }),
            ]);
        expect(
            (await readVlc(app)).commands.filter((command) =>
                command.startsWith('add ')
            )
        ).toEqual([]);
        await finishInput(app);

        await expect
            .poll(async () => {
                const { commands, spawnUrls } = await readVlc(app);
                return {
                    spawnUrls,
                    changes: commands.filter(
                        (command) =>
                            command === 'clear' || command.startsWith('add ')
                    ),
                };
            })
            .toEqual({
                spawnUrls: [episodeUrl('S01E01')],
                changes: [
                    'clear',
                    expect.stringContaining(`add ${episodeUrl('S01E02')} `),
                ],
            });
        await expect
            .poll(rows)
            .toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        episodeNumber: 1,
                        positionSeconds: 120,
                        durationSeconds: 120,
                    }),
                    expect.objectContaining({
                        episodeNumber: 2,
                        positionSeconds: 10,
                        durationSeconds: 120,
                    }),
                ])
            );
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @playback stopping a live channel does not advance VLC', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);
    try {
        const playerPath = join(dataDir, 'synthetic-vlc');
        await installSyntheticVlc(app, playerPath);
        const live = 'https://media.example.test/live.m3u8';
        await app.mainWindow.evaluate(
            async ({ playerPath, live }) => {
                Reflect.set(window, '__vlcEndedCount', 0);
                window.electron.onExternalPlaybackEnded?.(() => {
                    Reflect.set(
                        window,
                        '__vlcEndedCount',
                        Number(Reflect.get(window, '__vlcEndedCount')) + 1
                    );
                });
                await window.electron.setVlcPlayerPath(playerPath);
                await window.electron.updateSettings({
                    vlcReuseInstance: true,
                });
                await window.electron.openInVlc(
                    'https://media.example.test/initial.m3u8',
                    'Initial live channel',
                    '',
                    undefined
                );
                await window.electron.openInVlc(
                    live,
                    'Synthetic live channel',
                    '',
                    undefined
                );
            },
            { playerPath, live }
        );
        const adds = async () =>
            (await readVlc(app)).commands.filter((command) =>
                command.startsWith('add ')
            );
        expect(await adds()).toEqual([expect.stringContaining(`add ${live} `)]);
        await finishInput(app);
        const stoppedAt = Date.now();
        await expect
            .poll(() => Date.now() - stoppedAt, { timeout: 10_000 })
            .toBeGreaterThan(5_500);
        expect(await adds()).toEqual([expect.stringContaining(`add ${live} `)]);
        expect(
            await app.mainWindow.evaluate(() =>
                Reflect.get(window, '__vlcEndedCount')
            )
        ).toBe(0);
    } finally {
        await closeElectronApp(app);
    }
});
