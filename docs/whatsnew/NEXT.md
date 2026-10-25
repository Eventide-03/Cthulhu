# What's new since 1.0.8

Hand-written notes for the next release. The release workflow uses the bullets
below as the "Changes" section of the GitHub release and the post-update page
(`docs/whatsnew/<version>/`) — but only while the heading's "since" version is
the previous tag, so a stale file after a release is ignored and the commit
list is used instead. Rewrite the heading and the bullets for each release.

- **Netflix and other DRM sites now play.** Cthulhu has always asked Mozilla for its media plugins under its own version number instead of Firefox's, so the server sent none: Widevine never installed, and Netflix, Disney+ and the like sat on "installing components needed to play the audio or video on this page" before calling the browser unsupported. It now asks as the Firefox it is built on, so Widevine downloads by itself right after this update (if Netflix still says it is installing components, give it a minute and reload). H.264 for video calls (OpenH264) arrives the same way.
- **Security: built on Firefox ESR 153.5.1** (was 153.5.0), with Mozilla's latest fixes for that line.
