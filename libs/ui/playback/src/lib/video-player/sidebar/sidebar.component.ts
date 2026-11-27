import {
    Component,
    computed,
    inject,
    input,
    output,
    ChangeDetectionStrategy,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { selectPriorityChannels } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    ChannelListContainerComponent,
    ChannelListLoadingStateComponent,
} from '@iptvnator/ui/components';

@Component({
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ChannelListContainerComponent, ChannelListLoadingStateComponent],
    styles: [
        ':host { display: flex; flex-direction: column; }',
        'app-channel-list-container { flex: 1; min-height: 0; }',
    ],
})
export class SidebarComponent {
    readonly channels = input<Channel[]>([]);
    /** Every row, when `channels` is only part of the playlist; see the list's input. */
    readonly managementChannels = input<Channel[] | null>(null);
    /** Translated line for the list's empty state; see the list's input. */
    readonly emptyHint = input<string | null>(null);
    readonly channelsLoading = input(false);
    readonly activeView = input<string>('all');
    readonly sidebarWidth = input<number | null>(null);
    readonly sidebarWidthRequested = output<number>();
    readonly sidebarWidthRequestEnded = output<number>();
    readonly sidebarToggleRequested = output<void>();
    /** Groups view only: the group whose channels are currently listed. */
    readonly selectedGroupChange = output<string | null>();

    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly priorityChannels = inject(Store).selectSignal(
        selectPriorityChannels
    );
    readonly preview = computed(() => {
        const view = this.activeView();
        if (!this.channelsLoading() || (view !== 'all' && view !== 'groups'))
            return undefined;
        const priority = this.priorityChannels();
        return priority?.playlistId === this.playlistContext.resolvedPlaylistId()
            ? priority?.channels
            : undefined;
    });

    readonly activePlaylist = this.playlistContext.activePlaylist;

    onSidebarWidthRequested(width: number): void {
        this.sidebarWidthRequested.emit(width);
    }

    onSidebarWidthRequestEnded(width: number): void {
        this.sidebarWidthRequestEnded.emit(width);
    }
}
