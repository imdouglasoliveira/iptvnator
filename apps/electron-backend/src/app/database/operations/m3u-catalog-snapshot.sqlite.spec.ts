import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

it('persists snapshots for all writers and repairs obsolete snapshots on read', () => {
    const output = execFileSync(
        createRequire(__filename)('electron'),
        [
            '--import',
            'tsx',
            resolve(__dirname, 'testing/m3u-catalog-snapshot.sqlite.ts'),
        ],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 25_000,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                IPTVNATOR_DISABLE_M3U_CATALOG_SNAPSHOT: '0',
                IPTVNATOR_DISABLE_M3U_PRIORITY_OPEN: '1',
                TSX_TSCONFIG_PATH: resolve('tsconfig.base.json'),
            },
        }
    );
    expect(output.trim().endsWith('snapshots verified')).toBe(true);
}, 30_000);
