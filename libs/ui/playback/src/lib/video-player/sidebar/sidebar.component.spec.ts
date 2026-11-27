import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { Channel } from '@iptvnator/shared/interfaces';
import { ChannelListContainerComponent } from '@iptvnator/ui/components';
import { SidebarComponent } from './sidebar.component';

@Component({ selector: 'app-channel-list-container', template: '' })
class ChannelListContainerStubComponent {
    readonly channelList = input<Channel[]>([]);
    readonly managementChannels = input<Channel[] | null>(null);
    readonly emptyHint = input<string | null>(null);
    readonly channelsLoading = input(false);
    readonly activeView = input<string>('all');
    readonly recentItems = input<unknown[]>([]);
    readonly sidebarWidth = input<number | null>(null);
    readonly sidebarWidthRequested = output<number>();
    readonly sidebarWidthRequestEnded = output<number>();
    readonly sidebarToggleRequested = output<void>();
    readonly selectedGroupChange = output<string | null>();
}

const channel = (id: string) =>
    ({
        id,
        name: `Kanal ${id}`,
        url: `http://h.example/live/${id}.ts`,
    }) as unknown as Channel;

describe('SidebarComponent', () => {
    const activePlaylist = signal<{ recentlyViewed?: unknown[] } | null>(null);
    const priority = signal<{ playlistId: string; channels: Channel[] } | null>(null);
    let fixture: ComponentFixture<SidebarComponent>;

    const list = () =>
        fixture.debugElement.query(
            By.directive(ChannelListContainerStubComponent)
        ).componentInstance as ChannelListContainerStubComponent;

    beforeEach(() => {
        activePlaylist.set(null);
        priority.set(null);
        TestBed.configureTestingModule({
            imports: [SidebarComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist, resolvedPlaylistId: () => 'synthetic' },
                },
                { provide: Store, useValue: { selectSignal: () => priority } },
            ],
        }).overrideComponent(SidebarComponent, {
            remove: { imports: [ChannelListContainerComponent] },
            add: { imports: [ChannelListContainerStubComponent] },
        });
        fixture = TestBed.createComponent(SidebarComponent);
    });

    it('hands the list no management rows, hint or recents by default', () => {
        fixture.detectChanges();

        expect(list().channelList()).toEqual([]);
        expect(list().managementChannels()).toBeNull();
        expect(list().emptyHint()).toBeNull();
        expect(list().recentItems()).toEqual([]);
    });

    it('passes the split list, the full playlist and the empty hint through', () => {
        const live = [channel('1')];
        const all = [channel('1'), channel('2')];
        const recentlyViewed = [{ url: 'http://h.example/live/1.ts' }];
        activePlaylist.set({ recentlyViewed });
        fixture.componentRef.setInput('channels', live);
        fixture.componentRef.setInput('managementChannels', all);
        fixture.componentRef.setInput('emptyHint', 'Only films here');
        fixture.componentRef.setInput('activeView', 'groups');
        fixture.detectChanges();

        expect(list().channelList()).toBe(live);
        expect(list().managementChannels()).toBe(all);
        expect(list().emptyHint()).toBe('Only films here');
        expect(list().activeView()).toBe('groups');
        expect(list().recentItems()).toBe(recentlyViewed);
    });

    it('re-emits what the list asks for', () => {
        fixture.detectChanges();
        const requested: number[] = [];
        const ended: number[] = [];
        const groups: (string | null)[] = [];
        let toggles = 0;
        const sidebar = fixture.componentInstance;
        sidebar.sidebarWidthRequested.subscribe((w) => requested.push(w));
        sidebar.sidebarWidthRequestEnded.subscribe((w) => ended.push(w));
        sidebar.selectedGroupChange.subscribe((g) => groups.push(g));
        sidebar.sidebarToggleRequested.subscribe(() => toggles++);

        list().sidebarWidthRequested.emit(320);
        list().sidebarWidthRequestEnded.emit(340);
        list().selectedGroupChange.emit('Ulusal');
        list().sidebarToggleRequested.emit();

        expect(requested).toEqual([320]);
        expect(ended).toEqual([340]);
        expect(groups).toEqual(['Ulusal']);
        expect(toggles).toBe(1);
    });

    it('shows only the preview with groups busy and keeps the same channel list for the document', () => {
        const favorites = [channel('1'), channel('2'), channel('3')];
        const full = [...favorites, channel('4')];
        fixture.componentRef.setInput('channels', full);
        fixture.componentRef.setInput('channelsLoading', true);
        fixture.detectChanges();
        const instance = list();
        expect(instance.channelsLoading()).toBe(true);

        priority.set({ playlistId: 'synthetic', channels: favorites });
        fixture.detectChanges();
        expect(list().channelList()).toBe(favorites);
        expect(list().channelsLoading()).toBe(false);
        expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();

        fixture.componentRef.setInput('channelsLoading', false);
        priority.set(null);
        fixture.detectChanges();
        expect(list()).toBe(instance);
        expect(list().channelList()).toBe(full);
        expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).toBeNull();
    });
});
