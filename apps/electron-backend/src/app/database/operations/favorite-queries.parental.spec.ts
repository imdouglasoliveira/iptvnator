import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { setParentalLockActive } from '../parental-lock-state';
import { unlockedFavoriteCondition } from './favorite-queries';

const render = (query: SQL | undefined) =>
    query ? new SQLiteSyncDialect().sqlToQuery(query) : undefined;

describe('unlockedFavoriteCondition', () => {
    afterEach(() => setParentalLockActive(false));

    it('adds nothing while the lock is inactive', () => {
        expect(unlockedFavoriteCondition()).toBeUndefined();
    });

    it('keeps the locked-category filter for portal rows and lets M3U playlist rows through while active', () => {
        setParentalLockActive(true);

        const query = render(unlockedFavoriteCondition());

        expect(query?.sql).toContain('"categories"."locked"');
        expect(query?.sql).toContain(' or ');
        expect(query?.sql).toContain('"playlists"."type" in');
        expect(query?.params).toEqual(
            expect.arrayContaining(['m3u-file', 'm3u-text', 'm3u-url'])
        );
        expect(query?.params).not.toContain('xtream');
    });
});
