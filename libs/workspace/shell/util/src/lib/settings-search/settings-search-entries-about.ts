import { SettingsSearchEntry } from './settings-search.types';

export const ABOUT_SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
    {
        id: 'version',
        section: 'about',
        labelKey: 'SETTINGS.VERSION',
        descriptionKey: 'SETTINGS.VERSION_DESCRIPTION',
        keywords: ['version', 'build', 'commit'],
    },
    {
        id: 'app-update',
        section: 'about',
        labelKey: 'SETTINGS.APP_UPDATE_TITLE',
        descriptionKey: 'SETTINGS.APP_UPDATE_DESCRIPTION',
        keywords: ['update', 'upgrade', 'release', 'download', 'install'],
        requires: ['desktop'],
        fallbackId: 'version',
    },
    {
        id: 'app-update-check-on-startup',
        section: 'about',
        labelKey: 'SETTINGS.APP_UPDATE_CHECK_ON_STARTUP',
        descriptionKey: 'SETTINGS.APP_UPDATE_CHECK_ON_STARTUP_DESCRIPTION',
        keywords: ['update', 'startup', 'launch', 'automatic'],
        requires: ['desktop'],
        fallbackId: 'version',
    },
    {
        id: 'app-update-channel',
        section: 'about',
        labelKey: 'SETTINGS.APP_UPDATE_CHANNEL',
        descriptionKey: 'SETTINGS.APP_UPDATE_CHANNEL_DESCRIPTION',
        keywords: ['update', 'nightly', 'stable', 'channel', 'prerelease'],
        requires: ['desktop'],
        fallbackId: 'version',
    },
    {
        id: 'tmdb-credits',
        section: 'about',
        labelKey: 'SETTINGS.TMDB_CREDITS',
        descriptionKey: 'SETTINGS.TMDB_ATTRIBUTION',
        keywords: ['tmdb', 'credits', 'attribution'],
    },
    {
        id: 'community',
        section: 'about',
        labelKey: 'SETTINGS.COMMUNITY',
        descriptionKey: 'SETTINGS.COMMUNITY_DESCRIPTION',
        keywords: ['github', 'telegram', 'help', 'feedback', 'bug'],
    },
    {
        id: 'support',
        section: 'about',
        labelKey: 'SETTINGS.SUPPORT_TITLE',
        descriptionKey: 'SETTINGS.SUPPORT_DESCRIPTION',
        keywords: ['donate', 'sponsor', 'support'],
    },
];
