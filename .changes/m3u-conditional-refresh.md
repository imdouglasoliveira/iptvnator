---
type: perf
area: playlists
---

M3U playlist refreshes now skip re-parsing and saving when the remote list has not changed, showing a "Playlist unchanged" notification instead, and back off retries after network failures.
