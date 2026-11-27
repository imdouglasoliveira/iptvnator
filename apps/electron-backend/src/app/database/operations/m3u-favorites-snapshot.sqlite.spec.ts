import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

it('opens from a small SQLite snapshot and keeps it current after toggles and document writes', () => {
    const output = execFileSync(
        createRequire(__filename)('electron'),
        ['--import', 'tsx', resolve(__dirname, 'testing/m3u-favorites-snapshot.sqlite.ts')],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 25_000,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN: '0',
                IPTVNATOR_DISABLE_M3U_CATALOG_SNAPSHOT: '1',
                IPTVNATOR_DISABLE_M3U_ACTIVITY_PARTIAL_WRITE: '0',
                TSX_TSCONFIG_PATH: resolve('tsconfig.base.json'),
            },
        }
    );
    expect(output.trim()).toBe('favorites verified');
}, 30_000);
