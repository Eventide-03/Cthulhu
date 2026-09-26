# What's new since 1.0.7

Hand-written notes for the next release. The release workflow uses the bullets
below as the "Changes" section of the GitHub release and the post-update page
(`docs/whatsnew/<version>/`) — but only while the heading's "since" version is
the previous tag, so a stale file after a release is ignored and the commit
list is used instead. Rewrite the heading and the bullets for each release.

- **Sharper site icons**: quick links and folder entries now show the largest icon a site publishes instead of its 16- or 32-pixel `favicon.ico`, so tiles like Reddit and YouTube are no longer blocky. Still the site itself first and no third party by default — see PRIVACY.md.
- **Player volume**: changing the volume on the page (YouTube Music's own slider, say) now sticks, instead of being pushed back to whatever the player's slider last set.
- **Docked player**: a narrow column no longer squashes the buttons.
- **macOS**: the app is signed ad-hoc at build time, so the microphone permission sticks across launches.
