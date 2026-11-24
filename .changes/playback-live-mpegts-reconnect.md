---
type: fix
area: playback
---

Live MPEG-TS channels now reconnect on their own when the connection drops, instead of showing a decode error, and only report "Connection interrupted" after three failed attempts.
