"""End-to-end check of tab-audio sharing (src/theme/content/modules/tab-audio).

    cd engine && ./mach python ../tools/tab-audio-test.py

WHAT IS NOT COVERED, and why. The last hop -- Firefox's own screen capture --
cannot be driven from a script on macOS: the fake media engine only knows
Camera and Microphone (MediaEngineFake::EnumerateDevices), and the real one
needs a Screen Recording grant that arrives as a system dialog. So the picker,
the broker, the capture and the cross-process transport are all exercised for
real here, and the single line that adds our track to Firefox's stream is not.
Check that by hand: grant Screen Recording to the build, share a tab in a call.

Everything else is the shipped code. In particular the permission prompt is
left at its shipped setting, so "capturing a tab prompts nobody" is a real
result and not an artefact of a test pref.
"""
import os, sys, time, json, base64, struct, math, tempfile, subprocess
from marionette_driver.marionette import Marionette

BIN = os.path.join(os.getcwd(), "obj-aarch64-apple-darwin25.5.0", "dist", "Cthulhu.app", "Contents", "MacOS", "Cthulhu")
# The child actor has to be a real file in the bundle for the sandboxed content
# process to load it (tools/dev-actors.sh explains); `build faster` puts the
# symlink back, so it runs here every time.
subprocess.run([os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev-actors.sh")], check=False)

rate, secs = 44100, 40
frames = b"".join(struct.pack("<h", int(14000 * math.sin(2*math.pi*440*i/rate))) for i in range(rate*secs))
wav = (b"RIFF" + struct.pack("<I", 36+len(frames)) + b"WAVEfmt " + struct.pack("<IHHIIHH",16,1,1,rate,rate*2,2,16)
       + b"data" + struct.pack("<I", len(frames)) + frames)
WAV = "data:audio/wav;base64," + base64.b64encode(wav).decode()

m = Marionette(bin=BIN, gecko_log="-", prefs={"marionette.log.level": "Error",
        # mirror:once, so startup-only. macOS's SCContentSharingPicker is a system
        # dialog nothing here can answer, and an unanswered one leaves the share
        # pending forever; the older CoreGraphics path refuses outright instead,
        # which is the failure this suite wants to watch us handle.
        "media.getdisplaymedia.screencapturekit.enabled": False,
        "media.getdisplaymedia.screencapturekit.picker.enabled": False},
               app_args=["-remote-allow-system-access", "-profile", tempfile.mkdtemp(prefix="cthulhu-tabaudio-")])
m.start_session()
fails = []
def check(label, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + label + ("  " + str(extra) if extra != "" else ""))
    if not ok: fails.append(label)
def chrome(js, *a):
    m.set_context("chrome"); return m.execute_script(js, script_args=a)
def page(js, *a):
    m.set_context("content"); return m.execute_script("const w = window.wrappedJSObject || window; " + js, script_args=a)
def sysjs(js, *a):
    """Marionette's system-principal sandbox: shares the page's globals, so it
    stands in for the actor's own view of the content window."""
    m.set_context("content"); return m.execute_script(js, script_args=a, sandbox="system", new_sandbox=False)
def poll(fn, want, tries=40, gap=0.5):
    v = None
    for _ in range(tries):
        v = fn()
        if want(v): return v
        time.sleep(gap)
    return v

try:
    chrome("""
      const p = Services.prefs;
      p.setIntPref('media.autoplay.default', 0);
      p.setIntPref('media.autoplay.blocking_policy', 0);
      // A loopback connection only ever needs its host candidates; mDNS
      // obfuscation just slows the handshake down here.
      p.setBoolPref('media.peerconnection.ice.obfuscate_host_addresses', false);
      p.setBoolPref('media.peerconnection.ice.loopback', true);
    """)
    print("=====TAB AUDIO=====")
    check("the module loaded into the browser window",
          bool(chrome("return !!window.CthulhuTabAudio && typeof window.CthulhuTabAudio.pick === 'function';")))
    prefs = chrome("return [Services.prefs.getBoolPref('cthulhu.tabaudio.enabled'),"
                   " Services.prefs.getBoolPref('media.getusermedia.audio.capture.enabled'),"
                   " Services.prefs.getBoolPref('media.navigator.permission.disabled', false)];")
    check("shipped prefs are on, and the permission prompt is NOT disabled for this run",
          prefs == [True, True, False], prefs)

    # --- the source tab: something playing, on a secure origin (getUserMedia
    #     rejects an insecure one before it ever looks at the media source)
    m.set_context("content")
    m.navigate("https://example.com/")
    time.sleep(2)
    SRC = m.current_window_handle
    m.execute_script("""
      document.title = 'The Movie';
      const a = document.createElement('audio');
      a.id = 'a'; a.loop = true; a.autoplay = true; a.src = arguments[0];
      document.body.appendChild(a); a.play().catch(() => {});
    """, script_args=[WAV])
    time.sleep(2)
    check("the source tab is playing", m.execute_script("return !document.getElementById('a').paused;"))

    # --- the sink tab: a DIFFERENT site, so Fission gives it its own process
    m.execute_script("window.open('https://example.org/', '_blank');")
    time.sleep(3)
    SINK = [h for h in m.window_handles if h != SRC][0]
    m.switch_to_window(SINK)
    pids = chrome("return gBrowser.tabs.map(t => t.linkedBrowser.browsingContext.currentWindowGlobal.domProcess.osPid);")
    check("source and sink are in different content processes (the case that matters)",
          len(set(pids)) == len(pids), pids)

    # --- the wrapper is in place on the page
    m.switch_to_window(SINK)
    # Not a toString() check: Cu.exportFunction hands the page a function that
    # is itself native, so the wrapper reads as "[native code]" too. What gives
    # it away is that it sits on the instance, shadowing MediaDevices.prototype.
    wrapped = page("""
      const md = w.navigator.mediaDevices;
      return Object.prototype.hasOwnProperty.call(md, 'getDisplayMedia')
             && md.getDisplayMedia !== w.MediaDevices.prototype.getDisplayMedia;
    """)
    check("getDisplayMedia is wrapped in the page, shadowing the native one", wrapped is True, wrapped)

    # --- a failed share still fails with the page's own error, and asks nothing
    #     (Firefox's screen capture cannot be granted from a script, so this is
    #     the real failure path, not a simulated one)
    m.set_context("content")
    # Through a real click: getDisplayMedia demands transient activation, and
    # without one it fails on that instead of on the thing under test.
    page("""
      w.__r = null;
      const b = w.document.createElement('button');
      b.id = 'share'; b.textContent = 'share';
      b.addEventListener('click', () => {
        w.navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(
          s => { w.__r = { ok: true }; }, e => { w.__r = { ok: false, name: e.name }; });
      });
      w.document.body.appendChild(b);
      return true;
    """)
    from marionette_driver.by import By
    # Standing "no" for screen sharing, rather than a doorhanger nothing here
    # can answer: the refusal is what this checks, and it must arrive the same
    # way either way.
    chrome("Services.prefs.setIntPref('permissions.default.screen', 2);")
    m.set_context("content")   # chrome() above moved it; find_element needs the page
    m.find_element(By.ID, "share").click()
    r = poll(lambda: page("return w.__r ? JSON.stringify(w.__r) : null;"), lambda v: v is not None, 20)
    chrome("Services.prefs.clearUserPref('permissions.default.screen');")
    r = json.loads(r) if r else None
    check("a share the user declines rejects with the page's own error, not ours",
          bool(r) and r.get("ok") is False and r.get("name") == "NotAllowedError", r)
    check("and no tab-audio picker was shown for a share that never happened",
          chrome("return !document.getElementById('cthulhu-tabaudio-picker');"))

    # --- the picker itself
    chrome("""
      window.__pick = 'pending';
      window.CthulhuTabAudio.pick({ requester: gBrowser.selectedBrowser })
        .then(t => { window.__pick = t ? t.label : 'null'; });
    """)
    time.sleep(1.5)
    ui = chrome("""
      const p = document.getElementById('cthulhu-tabaudio-picker');
      if (!p) return null;
      return { rows: [...p.querySelectorAll('.cthulhu-tabaudio-row')].map(r => ({
                 label: r.querySelector('.cthulhu-tabaudio-label').textContent,
                 playing: r.classList.contains('playing') })),
               decline: !!p.querySelector('.cthulhu-tabaudio-decline') };
    """)
    check("the picker opens and offers a way to share without audio", bool(ui) and ui["decline"], ui)
    check("it lists the other tab and not the one asking",
          bool(ui) and [x["label"] for x in ui["rows"]] == ["The Movie"], ui and ui["rows"])
    check("it marks the tab that is actually making noise, and puts it first",
          bool(ui) and ui["rows"] and ui["rows"][0]["playing"] is True, ui and ui["rows"])
    chrome("document.getElementById('cthulhu-tabaudio-picker').querySelector('.cthulhu-tabaudio-row').click();")
    picked = poll(lambda: chrome("return window.__pick;"), lambda v: v != "pending", 20)
    check("choosing a row resolves with that tab", picked == "The Movie", picked)

    chrome("""
      window.__pick2 = 'pending';
      window.CthulhuTabAudio.pick({ requester: gBrowser.selectedBrowser }).then(t => { window.__pick2 = t ? t.label : 'null'; });
    """)
    time.sleep(1.2)
    chrome("document.getElementById('cthulhu-tabaudio-picker').querySelector('.cthulhu-tabaudio-decline').click();")
    p2 = poll(lambda: chrome("return window.__pick2;"), lambda v: v != "pending", 20)
    check("'share without audio' resolves with nothing, so the share goes on silent", p2 == "null", p2)

    # --- broker + capture + transport, through the real actors.
    #     The picker is answered for us here; it has its own checks above.
    chrome("""
      window.CthulhuTabAudio.pick = async () => gBrowser.tabs.find(t => t.label === 'The Movie');
    """)
    m.switch_to_window(SINK)
    sysjs(r"""
      window.__s = { state: "start" };
      (async () => {
        try {
          const actor = window.windowGlobalChild.getActor("CthulhuTabAudio");
          // Exactly what the wrapper asks for: the parent picks a tab, starts
          // the source's capture and hands back its offer.
          const offer = await actor.sendQuery("TabAudio:Want", {});
          if (!offer || !offer.sdp) { window.__s.state = "no-offer"; return; }
          window.__s.hasAudioLine = /\nm=audio /.test(offer.sdp);
          const pc = window.__s.pc = new window.RTCPeerConnection({ iceServers: [] });
          const got = new Promise(res => pc.addEventListener("track", e => res(e.track), { once: true }));
          await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
          await pc.setLocalDescription(await pc.createAnswer());
          await new Promise(r => { if (pc.iceGatheringState === "complete") return r();
            pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && r()); });
          await actor.sendQuery("TabAudio:Answer", { sessionId: offer.sessionId, sdp: pc.localDescription.sdp });
          const track = await got;
          const ac = new window.AudioContext();
          const an = ac.createAnalyser(); an.fftSize = 2048;
          ac.createMediaStreamSource(new window.MediaStream([track])).connect(an);
          const buf = new Float32Array(an.fftSize);
          window.__s.rms = () => { an.getFloatTimeDomainData(buf); let x = 0; for (const v of buf) x += v*v; return Math.sqrt(x/buf.length); };
          window.__s.state = "receiving";
        } catch (e) { window.__s.state = "ERR " + e.name + ": " + e.message; }
      })();
    """)
    st = poll(lambda: sysjs("return window.__s.state;"), lambda v: v != "start", 40)
    check("the broker picked a tab, captured it and handed back an offer", st == "receiving", st)
    check("the offer carries an audio track", sysjs("return !!window.__s.hasAudioLine;") is True)
    best = 0.0
    for _ in range(24):
        v = sysjs("return window.__s.rms ? window.__s.rms() : -1;")
        best = max(best, v or 0)
        if best > 0.02: break
        time.sleep(0.5)
    check("the sink process is hearing the source tab's real audio", best > 0.02, "peak rms %.4f" % best)

    # --- the two things a user would notice going wrong
    m.switch_to_window(SRC)
    m.set_context("content")
    loc = m.execute_script("const a = document.getElementById('a'); return { paused: a.paused, t: a.currentTime };")
    check("the captured tab is STILL audible locally (AudioOutputConfig::Needed)",
          loc["paused"] is False and loc["t"] > 2, loc)
    npr = chrome("return document.querySelectorAll('.popup-notification-panel[panelopen]').length"
                 " + (PopupNotifications.getNotification('webRTC-shareDevices') ? 1 : 0)"
                 " + (PopupNotifications.getNotification('webRTC-shareScreen') ? 1 : 0);")
    check("capturing it asked the page for nothing (chrome caller => askPermission false)", npr == 0, npr)

    # --- teardown releases the capture
    m.switch_to_window(SINK)
    sysjs("window.windowGlobalChild.getActor('CthulhuTabAudio').sendAsyncMessage('TabAudio:Ended', {}); return true;")
    time.sleep(1.5)
    m.switch_to_window(SRC)
    m.set_context("content")
    after = m.execute_script("const a = document.getElementById('a'); return { paused: a.paused, t: a.currentTime };")
    check("ending the share leaves the tab playing normally", after["paused"] is False and after["t"] > loc["t"], after)

    print("RESULT:", "ALL PASS" if not fails else "FAILED: " + ", ".join(fails))
    sys.exit(1 if fails else 0)
finally:
    try: m.quit()
    except Exception: pass
