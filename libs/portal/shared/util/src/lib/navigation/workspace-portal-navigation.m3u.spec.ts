import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import { getUnifiedCollectionNavigation } from './workspace-portal-navigation';

const item = (
    overrides: Partial<UnifiedCollectionItem> = {}
): UnifiedCollectionItem =>
    ({
        uid: 'm3u::pl-1::http://h.example/movie/1.mkv',
        name: 'Sandline',
        contentType: 'movie',
        sourceType: 'm3u',
        playlistId: 'pl-1',
        playlistName: 'List',
        streamUrl: 'http://h.example/movie/1.mkv',
        ...overrides,
    }) as UnifiedCollectionItem;

describe('getUnifiedCollectionNavigation for M3U', () => {
    it.each([
        ['movie', ['vod', 'play']],
        ['series', ['series']],
        ['live', ['all']],
    ] as const)('opens a %s row in its own section', (contentType, section) => {
        // A film or an episode never lands in the full channel list: that
        // list is live-first and loses the section the viewer came from.
        expect(getUnifiedCollectionNavigation(item({ contentType }))).toEqual({
            link: ['/workspace', 'playlists', 'pl-1', ...section],
            state: {
                openM3uChannelUrl: 'http://h.example/movie/1.mkv',
            },
        });
    });

    it('names the exact row when the item knows its channel id', () => {
        // Two rows can share a stream URL; by URL alone the player opens
        // the first of them, whichever was clicked.
        expect(
            getUnifiedCollectionNavigation(item({ channelId: 'row-2' }))?.state
        ).toEqual({
            openM3uChannelUrl: 'http://h.example/movie/1.mkv',
            openM3uChannelId: 'row-2',
        });
    });

    it('refuses a row with no stream URL', () => {
        // Nothing to select on arrival, so navigating would strand the
        // viewer on an unrelated list.
        expect(
            getUnifiedCollectionNavigation(item({ streamUrl: undefined }))
        ).toBeNull();
        expect(
            getUnifiedCollectionNavigation(item({ streamUrl: '   ' }))
        ).toBeNull();
    });

    it('has no destination for a source kind it does not know', () => {
        // A row written by a newer build must not be mistaken for M3U just
        // because it carries a stream URL.
        expect(
            getUnifiedCollectionNavigation(
                item({ sourceType: 'future-source' as never })
            )
        ).toBeNull();
    });
});
