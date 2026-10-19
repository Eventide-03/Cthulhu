# What's new since 1.0.7

Hand-written notes for the next release. The release workflow uses the bullets
below as the "Changes" section of the GitHub release and the post-update page
(`docs/whatsnew/<version>/`) — but only while the heading's "since" version is
the previous tag, so a stale file after a release is ignored and the commit
list is used instead. Rewrite the heading and the bullets for each release.

- **macOS: Apple Silicon only from this release.** Intel Macs are no longer built; they stay on 1.0.7 and will not be offered this update.
- **Security: built on Firefox ESR 153.5** (was 153.0), bringing in every security fix Mozilla has shipped for that line since.
- **Share a tab's audio on a call**: when a site screen-shares and asks for audio, Cthulhu now asks which open tab's sound to send and mixes it into the stream — so a film or a track actually reaches the other end, which no Firefox has managed. You still hear the tab yourself, and you pick the tab by hand every time. Web pages gain nothing from this: only Cthulhu's own code can capture a tab's audio. Turn it off with `cthulhu.tabaudio.enabled`.
- **A Clear Downloads button** in the downloads panel, next to "Show All Downloads". Firefox could only do this from the panel's right-click menu, where it is called "Clear Preview Panel" — so the list just kept growing.
- **The pointer gets out of the way of a film**: it now fades after a few seconds of stillness over a playing video and returns the moment you move. The cursor theme had been overriding every site's own attempt to do this, so it never happened on YouTube, Netflix or anywhere else.
- **Sharper site icons**: quick links and folder entries now show the largest icon a site publishes instead of its 16- or 32-pixel `favicon.ico`, so tiles like Reddit and YouTube are no longer blocky. Still the site itself first and no third party by default — see PRIVACY.md.
- **The player shows the song, not the playlist**: on players that run a whole queue on one timeline, the time and the progress bar used to add each track to the last — a four-minute song read "15:23 / 15:50" by the fourth one. The card now tracks where each song starts and shows that song's own time, and seeking still lands where you drop it.
- **Player volume**: changing the volume on the page (YouTube Music's own slider, say) now sticks, instead of being pushed back to whatever the player's slider last set.
- **Docked player**: a narrow column no longer squashes the buttons.
- **macOS**: the app is signed ad-hoc at build time, so the microphone permission sticks across launches.
