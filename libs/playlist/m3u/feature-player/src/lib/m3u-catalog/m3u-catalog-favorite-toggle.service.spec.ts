import { TestBed } from '@angular/core/testing';
import {
    DatabaseService,
    NotificationService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { M3uCatalogFavoriteToggleService } from './m3u-catalog-favorite-toggle.service';

const REQUEST = {
    playlistId: 'pl-1',
    type: 'series' as const,
    stableId: 42,
    title: 'Hollow',
    posterUrl: 'http://img.example/hollow.jpg',
    backdropUrl: null,
};

describe('M3uCatalogFavoriteToggleService', () => {
    const getIds = jest.fn();
    const setFavorite = jest.fn();
    const error = jest.fn();
    let supported = true;

    function create(): M3uCatalogFavoriteToggleService {
        TestBed.configureTestingModule({
            providers: [
                M3uCatalogFavoriteToggleService,
                {
                    provide: DatabaseService,
                    useValue: {
                        getM3uCatalogFavoriteIds: getIds,
                        setM3uCatalogFavorite: setFavorite,
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsM3uCatalogFavorites() {
                            return supported;
                        },
                    },
                },
                { provide: NotificationService, useValue: { error } },
            ],
        });
        return TestBed.inject(M3uCatalogFavoriteToggleService);
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        getIds.mockReset().mockResolvedValue([]);
        setFavorite.mockReset().mockResolvedValue({ favoriteId: 1 });
        error.mockReset();
        supported = true;
    });

    it('reads the heart state from the favorite ids of the type', async () => {
        getIds.mockResolvedValue([7, 42]);
        const service = create();

        await service.load('pl-1', 'series', 42);

        expect(getIds).toHaveBeenCalledWith({
            playlistId: 'pl-1',
            type: 'series',
        });
        expect(service.active()).toBe(true);
    });

    it('alternates between saving and removing the entry', async () => {
        const service = create();
        await service.load('pl-1', 'series', 42);

        await service.toggle(REQUEST);
        expect(service.active()).toBe(true);
        expect(setFavorite).toHaveBeenLastCalledWith({
            ...REQUEST,
            favorite: true,
        });

        await service.toggle(REQUEST);
        expect(service.active()).toBe(false);
        expect(setFavorite).toHaveBeenLastCalledWith({
            ...REQUEST,
            favorite: false,
        });
    });

    it('puts the icon back and notifies when the write fails', async () => {
        setFavorite.mockRejectedValue(new Error('boom'));
        const service = create();

        await service.toggle(REQUEST);

        expect(service.active()).toBe(false);
        expect(error).toHaveBeenCalledWith('PORTALS.FAVORITE_SAVE_FAILED');
    });

    it('does not read ids when the bridge is missing', async () => {
        supported = false;
        const service = create();

        await service.load('pl-1', 'series', 42);

        expect(getIds).not.toHaveBeenCalled();
        expect(service.supported).toBe(false);
        expect(service.active()).toBe(false);
    });
});
