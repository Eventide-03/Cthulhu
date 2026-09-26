# tab-audio — share a tab's sound with a screen share

Firefox's `getDisplayMedia` **ignores the audio constraint outright**
([`MediaDevices.cpp`][gdm] never reads `constraints.audio`), so sharing a film
in a Firefox tab has always been silent. This module fills that in, in chrome
JS, without an engine patch — what Chromium calls *share tab audio*.

When a page screen-shares and asks for audio, a picker asks **which open tab's**
audio to send; that tab's whole output is mixed into the stream the page gets.

## Why it looks like this

**Gecko already captures a tab's audio.** `MediaSourceEnum::AudioCapture` mixes
every media element, Web Audio graph and MediaStream in a window into one track
(`HTMLMediaElement::AudioCaptureTrackChange`, `AudioDestinationNode`,
`MediaStreamWindowCapturer`). It asks for it with `AudioOutputConfig::Needed`,
which is why **the tab stays audible to you** while it is captured.

**But only inside one process.** That mixing happens in a `MediaTrackGraph`, and
a graph belongs to one content process. Under Fission the tab you want to share
and the tab doing the sharing are in different processes — measured, not
assumed — so the track cannot simply be handed across.

**Hence the loopback peer connection.** An `RTCPeerConnection` between the two
tabs is the one transport that already exists in both processes and already
knows how to carry live audio between them. It costs an Opus round trip: some
CPU, tens of milliseconds. That is the price of doing this without touching the
engine.

**Why not capture it from macOS instead.** It cannot be done. Gecko force-enables
AudioIPC whenever the content sandbox is on (`CubebUtils.cpp`), and the **parent**
process hosts the audio server — so Core Audio sees the whole browser as a
single audio process (verified with `kAudioHardwarePropertyProcessObjectList`
against a running build: one entry, the parent's pid, none of its 14 children).
Neither ScreenCaptureKit's app filter nor a Core Audio process tap can separate
one tab from another, and tapping the app would capture the sharing tab's own
output straight back into the call. It would also be macOS-only.

## Shape

| file | runs in | does |
| --- | --- | --- |
| `tab-audio.js` | each browser window | the picker (`window.CthulhuTabAudio.pick`), and brings the actors up |
| `TabAudioShare.sys.mjs` | parent, once per process | registers the actor pair |
| `CthulhuTabAudioParent.sys.mjs` | parent | the broker: picks a tab, starts the source, relays SDP |
| `CthulhuTabAudioChild.sys.mjs` | each content process | both ends — wraps `getDisplayMedia` (sink), captures the window (source) |

A session is three messages: `TabAudio:Want` → `TabAudio:Answer` →
`TabAudio:Ended`. ICE is not trickled; both ends gather fully and exchange one
complete SDP, because the signalling is three actor hops for a connection that
never leaves the machine.

`DOMDocElementInserted` is what installs the wrapper — it has to beat the page's
own scripts, and it is the earliest event an actor actually receives.
`DOMWindowCreated` fires before the actor has listeners at all, so nothing
arrives (measured; no actor in the tree uses it either).

## The consent posture

Handing a page the audio of a **different** tab is more than the screen share it
rides along with — the page never sees that tab otherwise. So: Firefox's own
dialog runs first and unchanged, the tab question is a separate explicit step,
the choice is never inferred, never remembered and never defaulted to yes, and
a page that does not ask for audio is never offered any. A page cannot request
a particular tab, see the list, or tell whether you were asked.

Capturing the source tab raises no prompt on it, because the caller is chrome
(`askPermission = !privileged`, and chrome is `CallerType::System`) — a
doorhanger on someone else's tab would be noise, not consent.

## Prefs

| pref | default | effect |
| --- | --- | --- |
| `cthulhu.tabaudio.enabled` | `true` | off → screen sharing is silent, as in stock Firefox |
| `cthulhu.tabaudio.always_offer` | `false` | on → offer the audio step even when the page did not ask |
| `media.getusermedia.audio.capture.enabled` | `true` | **required**; stock Firefox ships `false` — see the tradeoff in `PRIVACY.md` |

## Known limits, and what to do about them

- **The Opus hop.** Doing this properly means a cross-process audio source in
  C++ (new IPDL transport + a `MediaEngineSource`), which removes the re-encode
  and would let the audio ride Firefox's own sharing indicators. Weeks of work
  and a patch to rebase on every ESR uplift — worth it only if the hop is
  audible in practice.
- **The audio-capture pref is a blunt instrument.** One line in the engine would
  let it through for `CallerType::System` and leave it off for web content.
  That is the right next patch, and it is small.
- **Video is still a window or a screen.** Sharing a *tab's* video needs
  `MediaSourceEnum::Browser`, which `MediaManager.cpp` downgrades away for any
  non-privileged caller. Audio is per-tab; video is not, yet.
- **Not covered by the tests.** `tools/tab-audio-test.py` exercises the picker,
  the broker, the capture and the cross-process transport for real. It cannot
  exercise Firefox's own screen capture — the fake media engine only knows
  Camera and Microphone, and the real one needs a macOS Screen Recording grant
  that arrives as a system dialog. Check that hop by hand.

[gdm]: https://github.com/Eventide-03/Cthulhu/blob/main/engine/dom/media/MediaDevices.cpp
