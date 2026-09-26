/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Child side of tab-audio sharing. One actor per top-level document; each one
 * can play either end of a session.
 *
 * SINK (the tab doing the screen share, e.g. discord.com in a tab). Wraps that
 * page's navigator.mediaDevices.getDisplayMedia. The wrapper calls the real one
 * first, so Firefox's own share picker and its whole security model are
 * untouched -- then, if the page asked for audio, it asks the parent for a tab
 * to take audio from and adds that track to the stream before resolving. The
 * page gets one MediaStream with video and audio, which is exactly the shape
 * Chromium hands its callers, so a site written for Chromium's "share tab
 * audio" needs no idea we exist.
 *
 * SOURCE (the tab being listened to). Captures EVERYTHING that tab is playing
 * with getUserMedia({audio: {mediaSource: "audioCapture"}}) -- media elements,
 * Web Audio and MediaStreams all mix into one track (see
 * HTMLMediaElement::AudioCaptureTrackChange, AudioDestinationNode and
 * MediaStreamWindowCapturer in the engine). That capture leaves local playback
 * alone (the engine asks for it with AudioOutputConfig::Needed), so the tab is
 * still audible to you while it is being shared.
 *
 * WHY THE TWO ENDS TALK OVER A PEER CONNECTION. Gecko's tab audio capture is
 * real but it lives entirely inside ONE MediaTrackGraph, and a graph belongs to
 * one content process. Under Fission the tab you want to share and the tab
 * doing the sharing are in different processes (measured: they are), so the
 * captured track cannot simply be handed over. A loopback RTCPeerConnection is
 * the one transport that already exists in both processes and already knows how
 * to move live audio between them. It costs an Opus round trip -- some CPU and
 * tens of milliseconds -- which is the price of doing this without an engine
 * patch. Doing it properly means a new cross-process audio source in C++;
 * see README.md.
 *
 * ICE is not trickled. Both ends wait for gathering to finish and hand over one
 * complete SDP, because the signalling here is three actor messages through the
 * parent, not a real signalling channel, and a single exchange is far less code
 * than a candidate relay for a connection that never leaves this machine. */

const PREF_ENABLED = "cthulhu.tabaudio.enabled";
const TRACK_TIMEOUT_MS = 10000;

export class CthulhuTabAudioChild extends JSWindowActorChild {
  #session = null; // { role, pc, stream } -- one at a time, either end

  handleEvent(event) {
    // DOMDocElementInserted: the wrapper has to be in place before the page's
    // own scripts run, or a site that takes a reference to getDisplayMedia at
    // load time would keep the unwrapped one. This is the event Firefox's own
    // early actors use (see ActorManagerParent) -- DOMWindowCreated is too
    // early to be useful here: it fires while the window global is still being
    // set up, before the actor has any listeners attached, so it never arrives.
    if (event.type === "DOMDocElementInserted") {
      this.#installWrapper();
    }
  }

  didDestroy() {
    this.#teardown();
  }

  async receiveMessage(msg) {
    switch (msg.name) {
      case "TabAudio:StartSource":
        return this.#startSource();
      case "TabAudio:SourceAnswer":
        return this.#sourceAnswer(msg.data);
      case "TabAudio:Stop":
        this.#teardown();
        return undefined;
      case "TabAudio:IsAudible":
        // Asked of every candidate tab when the picker is built. The actor is
        // the only thing that can see Web Audio: a tab playing through it has
        // no media element and no soundPlaying flag on its tab.
        return this.#isAudible();
      default:
        return undefined;
    }
  }

  /* ------------------------------- the sink ------------------------------- */

  #installWrapper() {
    if (!Services.prefs.getBoolPref(PREF_ENABLED, true)) {
      return;
    }
    // Top-level documents only. A frame cannot screen-share on its own behalf,
    // and wrapping every iframe would be a lot of work for nothing.
    if (this.browsingContext !== this.browsingContext.top) {
      return;
    }
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    let media;
    try {
      // Waived, not the Xray: a property defined on the Xray is an expando only
      // chrome can see, and the page would go on calling the original.
      media = Cu.waiveXrays(win).navigator.mediaDevices;
    } catch (e) {
      return;
    }
    // navigator.mediaDevices is [SecureContext] -- undefined on http, where
    // getDisplayMedia could not have been called anyway.
    if (!media || typeof media.getDisplayMedia !== "function") {
      return;
    }
    const real = media.getDisplayMedia;
    const wrapped = (constraints) =>
      new (Cu.waiveXrays(win).Promise)((resolve, reject) => {
        this.#withTabAudio(win, media, real, constraints).then(resolve, reject);
      });
    try {
      Cu.exportFunction(wrapped, media, { defineAs: "getDisplayMedia" });
    } catch (e) {
      console.error("[Cthulhu:tab-audio] could not wrap getDisplayMedia:", e);
    }
  }

  async #withTabAudio(win, media, real, constraints) {
    // Firefox's own picker runs first and unchanged. If the user declines it,
    // this rejects with the page's own error and we never get as far as audio.
    const stream = await real.call(media, constraints);
    if (!this.#wantsAudio(constraints)) {
      return stream;
    }
    try {
      const offer = await this.sendQuery("TabAudio:Want", {});
      if (offer && offer.sdp) {
        const track = await this.#startSink(win, offer);
        stream.addTrack(track);
        this.#stopWithShare(stream, track);
      }
    } catch (e) {
      // Audio is a bonus on top of a share that already succeeded. Losing it
      // must never turn into a failed screen share.
      console.error("[Cthulhu:tab-audio] attaching tab audio failed:", e);
      this.#teardown();
    }
    return stream;
  }

  #wantsAudio(constraints) {
    // Default false, matching the spec's DisplayMediaStreamConstraints. A site
    // that never asks for audio gets none and is never prompted -- flip
    // cthulhu.tabaudio.always_offer for the ones that forgot to ask because no
    // Firefox has ever answered.
    try {
      if (Services.prefs.getBoolPref("cthulhu.tabaudio.always_offer", false)) {
        return true;
      }
      const a = constraints && constraints.audio;
      return a === true || (!!a && typeof a === "object");
    } catch (e) {
      return false;
    }
  }

  async #startSink(win, offer) {
    this.#teardown();
    const pc = new win.RTCPeerConnection({ iceServers: [] });
    this.#session = { role: "sink", pc, stream: null };
    const track = new Promise((resolve, reject) => {
      pc.addEventListener("track", (e) => resolve(e.track), { once: true });
      win.setTimeout(() => reject(new Error("no track after " + TRACK_TIMEOUT_MS + "ms")), TRACK_TIMEOUT_MS);
    });
    await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.#iceComplete(pc, win);
    await this.sendQuery("TabAudio:Answer", { sessionId: offer.sessionId, sdp: pc.localDescription.sdp });
    return track;
  }

  /* Stop capturing when the share stops. The page ends a share by stopping the
   * video track (or the browser does it for them from the sharing indicator),
   * and nothing would otherwise tell the other tab to stop feeding us. */
  #stopWithShare(stream, audioTrack) {
    const stop = () => {
      try { audioTrack.stop(); } catch (e) {}
      this.#teardown();
      try { this.sendAsyncMessage("TabAudio:Ended", {}); } catch (e) {}
    };
    for (const t of stream.getVideoTracks()) {
      t.addEventListener("ended", stop, { once: true });
    }
    audioTrack.addEventListener("ended", stop, { once: true });
  }

  /* ------------------------------ the source ------------------------------ */

  async #startSource() {
    this.#teardown();
    const win = this.contentWindow;
    if (!win) {
      return null;
    }
    // Privileged caller, so this does not prompt the page it is capturing
    // (MediaManager: askPermission = !privileged, and a chrome caller is
    // CallerType::System). The tab keeps playing out loud regardless.
    const stream = await win.navigator.mediaDevices.getUserMedia({
      audio: { mediaSource: "audioCapture" },
    });
    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) { t.stop(); }
      return null;
    }
    const pc = new win.RTCPeerConnection({ iceServers: [] });
    pc.addTrack(track, stream);
    await pc.setLocalDescription(await pc.createOffer());
    await this.#iceComplete(pc, win);
    this.#session = { role: "source", pc, stream };
    return { offer: pc.localDescription.sdp };
  }

  async #sourceAnswer(data) {
    const s = this.#session;
    if (!s || s.role !== "source" || !data || !data.sdp) {
      return undefined;
    }
    await s.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    return undefined;
  }

  #isAudible() {
    const win = this.contentWindow;
    if (!win) {
      return false;
    }
    try {
      const doc = win.document;
      for (const el of doc.querySelectorAll("audio, video")) {
        if (!el.paused && !el.muted && el.volume > 0) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  /* ------------------------------- plumbing ------------------------------- */

  /* One complete SDP rather than trickled candidates -- see the note up top.
   * Capped, because a gathering state that never completes would otherwise hang
   * the share the caller is waiting on; a loopback connection only ever needs
   * its host candidates, which arrive at once. */
  #iceComplete(pc, win) {
    if (pc.iceGatheringState === "complete") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", done);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", done);
      win.setTimeout(resolve, 3000);
    });
  }

  #teardown() {
    const s = this.#session;
    this.#session = null;
    if (!s) {
      return;
    }
    // The gUM stream last: stopping it is what un-captures the window, and the
    // engine only drops the capture track once every track on it is stopped.
    try { s.pc.close(); } catch (e) {}
    if (s.stream) {
      for (const t of s.stream.getTracks()) {
        try { t.stop(); } catch (e) {}
      }
    }
  }
}
