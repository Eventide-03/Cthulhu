/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Pet widget (aesthetic, animated). Shows a looping pixel pet -- either a
 * specific one you pick, or "Random", which re-rolls on every render: a new
 * tab, a home-page refresh, or a click on the tile.
 *
 * ART SLOTS: every pet is one entry in assets/pets.json plus its PNG frames in
 * assets/. Adding a pet never means editing this file:
 *
 *   { "id": "cat", "name": "Cat", "frames": ["cat.png"] }
 *
 *   frames      one or more PNGs, each a single frame at NATIVE pixel size.
 *               Frames can be any size -- 16x24, 32x32, 56x62, 64x64 all ship
 *               today. The widget scales each pet up by an INTEGER factor to
 *               fill the tile (pixelated, so it stays crisp); never pre-scale.
 *   mode        omitted: a single frame plays a gentle idle bob; several frames
 *               play in order at `fps`.
 *               "glitch": frames play in a RANDOM order, reshuffled every pass,
 *               with a pixel of jitter -- and the pet's name flickers into
 *               gibberish wherever it is shown (tile label and the picker).
 *   action      "feature-request": the sprite becomes a real button that opens
 *               the feature-request form (rishi-request.js, loaded on demand).
 *   hint        tooltip for an actionable pet.
 *   unique      only ONE tile per page may show this pet. A second tile asked
 *               for it says so instead; Random never rolls it while another
 *               tile has it. (Rishi: "there can only be one Rishi at a time".)
 *   moodPref    a pref whose text is shown in a bubble ABOVE the sprite,
 *               followed live. Rishi's is the local cache of a value the RELAY
 *               holds (see "shared state" below), so both browsers show it.
 *   variantPref a pref naming one of `variants`, followed live: when set, the
 *               pet is drawn with that variant's frames and name. Rishi's
 *               "tea" variant is assets/tea.png -- the admin panel's "Switch
 *               to Tea". LOCAL to the machine, on purpose: it is not sent to
 *               or read from the relay.
 *
 * SHARED STATE: the MOOD of a pet with moodPref lives on the relay
 * (relay/worker.js, GET /rishi). Any page with such a pet polls it every
 * minute (and on becoming visible) and writes the result into the pref; every
 * tile follows the pref, so the update reaches all open tabs at once. The
 * admin panel writes the pref directly (this machine updates instantly) AND
 * PUTs to the relay with the owner's token (the other browser picks it up on
 * its next poll). Without a token, the panel changes this machine only and
 * says so. No secret is in this file or the binary.
 *
 * A relay value is applied only when it is NEW: the relay stamps every write
 * with updatedAt, this profile remembers the last stamp it applied, and a
 * poll that returns the same stamp changes nothing. Without that rule the
 * poll would "correct" a locally set mood back to the relay's copy within a
 * minute (it did, in testing: a re-render re-pulled and undid the change), and
 * a relay nobody has ever written to (updatedAt 0) would blank everything.
 *
 * Everything lives inside this closure: widget scripts are plain <script>
 * elements sharing ONE global scope (see widgets.js loadWidgetScripts), so a
 * top-level name here would collide with any other widget using the same one.
 */
(function () {
  "use strict";

  const ASSET_BASE = "chrome://cthulhu/content/newtab/widgets/pet/";
  const MAX_SCALE = 8;
  const MOOD_MAX = 60;
  const UNIQUE_MSG = "There can only be one Rishi at a time";

  const prefs = () => (typeof Services !== "undefined" && Services.prefs) || null;
  function getPref(name, d) {
    try { return prefs().getStringPref(name, d); } catch (e) { return d; }
  }
  function setPref(name, v) {
    try { prefs().setStringPref(name, v); return true; } catch (e) { return false; }
  }
  /** Watch a string pref; returns stop(). Used so a mood set in the admin panel
   *  appears immediately, in every open tab, without a reload. */
  function watchPref(name, fn) {
    const P = prefs();
    if (!P) return () => {};
    const obs = { observe() { fn(getPref(name, "")); } };
    try { P.addObserver(name, obs); } catch (e) { return () => {}; }
    return () => { try { P.removeObserver(name, obs); } catch (e) {} };
  }

  /* ------------------------------------------------------------------------
   * Shared state: the relay holds { mood, variant }; the prefs cache it.
   * ---------------------------------------------------------------------- */
  const RELAY_PREF = "cthulhu.relay.url";
  const RELAY_PATH = "/rishi";
  const SYNCED_PREF = "cthulhu.pet.rishi.syncedAt"; // last relay updatedAt applied here
  const POLL_MS = 60 * 1000;
  const MIN_PULL_GAP_MS = 15 * 1000;
  const relayUrl = () => getPref(RELAY_PREF, "").trim().replace(/\/+$/, "");

  const shared = {
    timer: 0,
    watchers: 0,       // tiles that want the poll running
    lastAt: 0,
    lastError: "",
    prefs: null,       // { moodPref, variantPref } of the pet being polled
    async pull() {
      const base = relayUrl();
      if (!base || !shared.prefs) return;
      try {
        const resp = await fetch(base + RELAY_PATH, { headers: { "x-cthulhu-client": "1" } });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.ok === false) throw new Error(data.error || "HTTP " + resp.status);
        shared.lastAt = Date.now();
        shared.lastError = "";
        // Apply only a NEW relay write (see the header). A relay never written
        // to reports updatedAt 0 and is left alone entirely.
        const stamp = Number(data.updatedAt) || 0;
        if (!stamp || String(stamp) === getPref(SYNCED_PREF, "")) return;
        // Only touch a pref that actually changed: each write pings every
        // observer in every tab. The mood only -- Rishi/Tea is per machine.
        const mood = String(data.mood == null ? "" : data.mood).slice(0, MOOD_MAX);
        if (getPref(shared.prefs.moodPref, "") !== mood) setPref(shared.prefs.moodPref, mood);
        setPref(SYNCED_PREF, String(stamp));
      } catch (e) {
        // A relay that predates /rishi answers 405; a machine offline answers
        // nothing. Either way the cached prefs stand and nothing is shown --
        // the poll is a background nicety, not a feature the tile waits on.
        shared.lastError = e.message;
      }
    },
    start(petPrefs) {
      shared.prefs = petPrefs;
      shared.watchers++;
      if (shared.timer) return;
      // A tile re-render restarts this; don't hit the relay for every one.
      if (Date.now() - shared.lastAt > MIN_PULL_GAP_MS) shared.pull();
      shared.timer = setInterval(() => { if (!document.hidden) shared.pull(); }, POLL_MS);
      document.addEventListener("visibilitychange", shared.onVisible);
    },
    stop() {
      shared.watchers = Math.max(0, shared.watchers - 1);
      if (shared.watchers) return;
      clearInterval(shared.timer);
      shared.timer = 0;
      document.removeEventListener("visibilitychange", shared.onVisible);
    },
    onVisible() {
      if (!document.hidden && Date.now() - shared.lastAt > MIN_PULL_GAP_MS) shared.pull();
    },
    /** Force the next pull to apply whatever the relay holds (after our own
     *  write, so the stamp we just created is recorded here too). */
    resync() { shared.lastAt = 0; return shared.pull(); },
  };

  /* ------------------------------------------------------------------------
   * Glitch text: "KIY" <-> gibberish.
   *
   * Deliberately NOT English: a pinch of Greek, Cyrillic, Hebrew, katakana,
   * runes and block glyphs, plus the real letters so they surface mid-flicker.
   * The real name shows on ~40% of ticks so it stays readable as a whole.
   * ---------------------------------------------------------------------- */
  const JUMBLE =
    "KIYΨΩΔΘΞΣΦЖЗДЯЩאבגדשツシソヨ▓▒░█▚▞▌▐∴∵≋≈ᚠᚢᚦᚨᚱᚲᛉ¥§¶†‡ʬʭ";
  function jumble(len) {
    let s = "";
    for (let i = 0; i < len; i++) {
      s += JUMBLE[Math.floor(Math.random() * JUMBLE.length)];
    }
    return s;
  }
  /** Flicker `el`'s text until it leaves the DOM or stop() is called. */
  function glitchText(el, real, everyMs) {
    let timer = setInterval(() => {
      if (!el.isConnected) { stop(); return; }
      el.textContent = Math.random() < 0.4 ? real : jumble(3 + Math.floor(Math.random() * 4));
    }, everyMs || 70);
    function stop() {
      if (timer) { clearInterval(timer); timer = null; el.textContent = real; }
    }
    return stop;
  }

  /* ------------------------------------------------------------------------
   * Sizing: integer scale so the pet fills the stage without blurring.
   * ---------------------------------------------------------------------- */
  function fitInto(img, stage) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!w || !h || !sw || !sh) return;
    const s = Math.max(1, Math.min(MAX_SCALE, Math.floor(Math.min(sw / w, sh / h))));
    img.style.width = w * s + "px";
    img.style.height = h * s + "px";
    img.dataset.scale = String(s);
  }

  /* ------------------------------------------------------------------------
   * Frame playback. Returns stop().
   * ---------------------------------------------------------------------- */
  function playOrdered(img, urls, fps) {
    if (urls.length < 2) return () => {};
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % urls.length;
      img.src = urls[i];
    }, 1000 / (fps || 8));
    return () => clearInterval(timer);
  }
  /** Random order, reshuffled every full pass (so every frame appears once per
   *  pass and the same frame never shows twice in a row), with jitter. */
  function playGlitch(img, urls, fps) {
    let order = [];
    let i = 0;
    let last = -1;
    const reshuffle = () => {
      order = urls.map((_, k) => k);
      for (let k = order.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [order[k], order[j]] = [order[j], order[k]];
      }
      if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1], order[0]];
      i = 0;
    };
    reshuffle();
    const timer = setInterval(() => {
      if (i >= order.length) reshuffle();
      last = order[i++];
      img.src = urls[last];
      const jx = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const jy = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      img.style.setProperty("--cw-pet-jx", jx + "px");
      img.style.setProperty("--cw-pet-jy", jy + "px");
    }, 1000 / (fps || 11));
    return () => clearInterval(timer);
  }

  /* ------------------------------------------------------------------------
   * The feature-request form (Rishi's action). Loaded on first use only.
   * ---------------------------------------------------------------------- */
  let rishiModule = null;
  function openRishiRequest() {
    if (!rishiModule) {
      rishiModule = new Promise((resolve, reject) => {
        if (window.CthulhuRishiRequest) { resolve(window.CthulhuRishiRequest); return; }
        const s = document.createElement("script");
        s.src = ASSET_BASE + "rishi-request.js";
        s.onload = () => resolve(window.CthulhuRishiRequest);
        s.onerror = () => reject(new Error("could not load rishi-request.js"));
        document.head.appendChild(s);
      });
    }
    return rishiModule
      .then((m) => m.open())
      .catch((e) => {
        rishiModule = null; // let a later click retry the load
        console.error("[Cthulhu:pet] feature request:", e);
      });
  }

  /* ------------------------------------------------------------------------
   * Manifest (cached: several tiles can share it).
   * ---------------------------------------------------------------------- */
  let petsCache = null;
  function loadPets(ctx) {
    if (petsCache) return Promise.resolve(petsCache);
    return fetch(ctx.assetUrl("pets.json"))
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((list) => {
        const pets = (Array.isArray(list) ? list : [])
          .map((p) => (typeof p === "string" ? { id: p, name: p, frames: [p + ".png"] } : p))
          .filter((p) => p && p.id)
          .map((p) => ({ ...p, frames: (p.frames && p.frames.length) ? p.frames : [p.id + ".png"] }));
        petsCache = pets;
        return pets;
      });
  }
  /** The pet as it should be drawn right now: its variant's name and frames
   *  when the variant pref names one, else itself. */
  function effective(pet) {
    if (!pet.variantPref || !pet.variants) return pet;
    const v = pet.variants[getPref(pet.variantPref, "")];
    if (!v) return pet;
    return { ...pet, name: v.name || pet.name, frames: (v.frames && v.frames.length) ? v.frames : pet.frames,
      fps: v.fps || pet.fps, mode: v.mode || pet.mode, variant: getPref(pet.variantPref, "") };
  }

  /* ------------------------------------------------------------------------
   * Uniqueness: at most one tile per page shows a `unique` pet.
   *
   * The holder is the grid ITEM, found from the widget body, so a re-render of
   * the same tile (config change, refresh) keeps its claim rather than
   * contesting it. Home and new-tab are different documents, so each page
   * gets its own one -- "one on the homepage, one on the tab board".
   * ---------------------------------------------------------------------- */
  const holders = new Map(); // pet id -> grid item element
  const tileOf = (el) => (el.closest && el.closest(".grid-stack-item")) || el;
  function heldElsewhere(petId, tile) {
    const h = holders.get(petId);
    if (!h) return false;
    if (h === tile) return false;
    if (!h.isConnected) { holders.delete(petId); return false; }
    return true;
  }
  function claim(petId, tile) { holders.set(petId, tile); }
  function release(petId, tile) { if (holders.get(petId) === tile) holders.delete(petId); }

  function choose(pets, wanted, tile) {
    if (wanted && wanted !== "random") {
      const found = pets.find((p) => p.id === wanted);
      if (found) return found;
      // Configured pet no longer in the manifest -- fall back to random rather
      // than rendering nothing.
    }
    // Random never deals a unique pet that another tile is already showing.
    const pool = pets.filter((p) => !(p.unique && heldElsewhere(p.id, tile)));
    const from = pool.length ? pool : pets;
    return from[Math.floor(Math.random() * from.length)];
  }

  /* ------------------------------------------------------------------------
   * Admin section: Rishi's mood, and Rishi-or-Tea.
   *
   * Registered here rather than in admin.js so the control ships beside the
   * thing it controls -- admin.js never needs editing to gain a section. It is
   * a no-op if the admin panel isn't present.
   *
   * Writes the prefs (this machine, instantly) and PUTs to the relay with the
   * owner's token (the other browser, on its next poll). Without a token it
   * says so and stays local.
   * ---------------------------------------------------------------------- */
  const MOOD_PREF = "cthulhu.pet.rishi.mood";
  const VARIANT_PREF = "cthulhu.pet.rishi.variant";
  const MOOD_PRESETS = [
    "building something",
    "deep in the code",
    "out of coffee",
    "shipping it",
    "back soon",
    "do not perceive me",
  ];
  if (window.CthulhuAdmin) {
    window.CthulhuAdmin.register({
      id: "rishi-mood",
      title: "Rishi",
      note: "The mood shows above Rishi in both browsers when the relay token is set. Tea is this machine only.",
      render(body, ctx) {
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = String(MOOD_MAX);
        input.placeholder = "What is Rishi up to?";
        input.setAttribute("aria-label", "Rishi's mood");
        input.value = getPref(MOOD_PREF, "");
        body.appendChild(input);

        const chips = document.createElement("div");
        chips.className = "cw-ui-choice";
        body.appendChild(chips);
        const buttons = [];
        // Highlight whichever preset IS the current mood, so a stale focus ring
        // on the last one clicked can't imply a mood that is no longer set.
        const paint = (v) => {
          for (const b of buttons) b.classList.toggle("on", b.textContent === v);
        };

        const status = document.createElement("div");
        status.className = "cthulhu-admin-note";

        // The mood: pref first (instant here), relay second (the other
        // browser). The status line says which of the two happened.
        async function commit(patch) {
          if ("mood" in patch) { input.value = patch.mood; ctx.setPref(MOOD_PREF, patch.mood); paint(patch.mood); }
          const relay = ctx.relay || (window.CthulhuAdmin && window.CthulhuAdmin.relay);
          if (!relay || !relay.url()) { status.textContent = "Saved here only: no relay configured."; return; }
          if (!relay.token()) { status.textContent = "Saved here only. Set the admin token (Relay, above) to share it with the other browser."; return; }
          status.textContent = "Sharing…";
          try {
            await relay.put(RELAY_PATH, patch);
            status.textContent = "Shared. The other browser picks it up within a minute.";
            shared.resync();
          } catch (e) {
            status.textContent = "Saved here, but the relay refused: " + e.message;
          }
        }
        for (const m of MOOD_PRESETS) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cw-ui-choice-btn";
          b.textContent = m;
          b.addEventListener("click", (e) => { e.stopPropagation(); commit({ mood: m }); });
          buttons.push(b);
          chips.appendChild(b);
        }
        paint(input.value);
        input.addEventListener("input", () => paint(input.value));

        const actions = document.createElement("div");
        actions.style.cssText = "display:flex; gap:8px; flex-wrap:wrap;";
        const setBtn = document.createElement("button");
        setBtn.type = "button";
        setBtn.className = "cw-cfg-save";
        setBtn.textContent = "Set";
        setBtn.addEventListener("click", (e) => { e.stopPropagation(); commit({ mood: input.value.trim() }); });
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "cw-cfg-save";
        clearBtn.style.background = "var(--surface)";
        clearBtn.style.color = "var(--fg)";
        clearBtn.textContent = "Clear";
        clearBtn.addEventListener("click", (e) => { e.stopPropagation(); commit({ mood: "" }); });
        actions.appendChild(setBtn);
        actions.appendChild(clearBtn);
        body.appendChild(actions);

        // Rishi <-> Tea. One button that says what it will do next. LOCAL:
        // this writes the pref and nothing else -- it never reaches the relay.
        const teaBtn = document.createElement("button");
        teaBtn.type = "button";
        teaBtn.className = "cw-ui-btn cw-pet-teabtn";
        const paintVariant = () => {
          const tea = getPref(VARIANT_PREF, "") === "tea";
          teaBtn.textContent = tea ? "Switch back to Rishi" : "Switch to Tea";
          teaBtn.dataset.variant = tea ? "tea" : "";
        };
        paintVariant();
        teaBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          ctx.setPref(VARIANT_PREF, getPref(VARIANT_PREF, "") === "tea" ? "" : "tea");
          paintVariant();
          status.textContent = "Switched here only -- Tea is per machine.";
        });
        body.appendChild(teaBtn);
        body.appendChild(status);

        // Enter commits, so the panel can be driven from the keyboard alone.
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit({ mood: input.value.trim() }); }
        });
      },
    });
  }

  CthulhuWidgets.register({
    id: "pet",
    category: "aesthetic",
    name: "Pet",
    defaultSize: { w: 2, h: 2 },
    defaultConfig: { pet: "random", showName: true },
    css: `
      .cw-pet { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:6px; }
      .cw-pet-stage { display:flex; align-items:center; justify-content:center; min-height:0; flex:1; width:100%; }
      .cw-pet-img { image-rendering:pixelated; display:block; transform-origin:50% 100%; }
      .cw-pet-img.idle { animation: cw-pet-idle 2.4s ease-in-out infinite; }
      .cw-pet-img.glitch { transform: translate(var(--cw-pet-jx, 0px), var(--cw-pet-jy, 0px)); }
      @keyframes cw-pet-idle {
        0%, 100% { transform: translateY(0) scale(1, 1); }
        50%      { transform: translateY(-3px) scale(1.03, 0.97); }
      }
      /* An actionable pet is wrapped in a REAL button: GridStack does not
       * start a tile drag from a button (it is in the draggable cancel list),
       * so a plain click listener works -- unlike the rest of the tile, where
       * clicks have to be inferred from a drag that went nowhere. */
      .cw-pet-hit { background:none; border:none; padding:0; margin:0; cursor:pointer; display:block; border-radius:8px; }
      .cw-pet-hit:hover .cw-pet-img { filter: drop-shadow(0 0 6px var(--accent)); }
      .cw-pet-hit:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
      /* Mood bubble, above the sprite. Speech-bubble tail via a rotated
         square so it needs no extra art. */
      .cw-pet-mood {
        position:relative; align-self:center; max-width:100%; margin-bottom:2px;
        padding:4px 8px; border-radius:8px; background:var(--bg-elevated);
        border:1px solid var(--border); color:var(--fg); font-family:var(--font-pixel);
        font-size:.82em; line-height:1.3; text-align:center; overflow-wrap:anywhere;
      }
      .cw-pet-mood::after {
        content:""; position:absolute; left:50%; bottom:-4px; width:6px; height:6px;
        background:var(--bg-elevated); border-right:1px solid var(--border);
        border-bottom:1px solid var(--border); transform:translateX(-50%) rotate(45deg);
      }
      .cw-pet-mood:empty { display:none; }
      .cw-pet-name { color:var(--fg-muted); font-size:.85em; text-align:center; font-family:var(--font-pixel);
                     min-height:1.2em; font-variant-ligatures:none; }
      .cw-pet-empty { color:var(--fg-muted); font-size:.85em; text-align:center; padding:8px; }
      .cw-pet-only { color:var(--fg-muted); font-size:.85em; text-align:center; padding:8px; line-height:1.4; }

      /* Picker in the gear panel. A LIST OF BUTTONS, not a <select>.
       *
       * A native <select> puts its menu in a chrome-level popup that this page
       * only reaches through the ContentSelectDropdown actor pair. That round
       * trip is what stopped a pick from ever landing -- the popup opened, the
       * chosen value never came back as a change event, so the pet stayed on
       * Random. Plain buttons are a plain DOM click, and they let KIY's name
       * flicker where you can actually see it: in the list itself, rather than
       * only inside a popup that has to be held open. */
      .cw-pet-list { display:flex; flex-direction:column; gap:4px; }
      .cw-pet-row { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:5px 6px;
        border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg);
        font-family:var(--font-pixel); font-size:.85em; cursor:pointer; }
      .cw-pet-row:hover { border-color:var(--accent); }
      .cw-pet-row.on { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, var(--surface)); }
      .cw-pet-row.taken { opacity:.55; }
      .cw-pet-row img { flex:none; width:22px; height:22px; object-fit:contain; image-rendering:pixelated; }
      .cw-pet-row .dot { flex:none; width:22px; height:22px; border-radius:5px; background:var(--bg-elevated);
        border:1px solid var(--border); }
      .cw-pet-rowname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-variant-ligatures:none; }
      .cw-pet-rowtag { flex:none; color:var(--fg-muted); font-size:.85em; }
      .cw-pet-note { color:var(--fg-muted); font-size:.78em; }
    `,

    render(el, ctx) {
      el.innerHTML =
        '<div class="cw-pet">' +
          '<div class="cw-pet-mood"></div>' +
          '<div class="cw-pet-stage"></div>' +
          '<div class="cw-pet-name"></div>' +
        "</div>";
      const stage = el.querySelector(".cw-pet-stage");
      const nameEl = el.querySelector(".cw-pet-name");
      const moodEl = el.querySelector(".cw-pet-mood");
      const tile = tileOf(el);

      // The manifest fetch and the image load are async, so this render can be
      // torn down (widget removed, or re-rendered by a config change) while
      // they're in flight. Track that and bail rather than animating a
      // detached element or leaking a running timer past cleanup.
      let disposed = false;
      const stops = [];
      ctx.onCleanup(() => {
        disposed = true;
        for (const s of stops) { try { s(); } catch (e) {} }
      });

      (async () => {
        let pets;
        try {
          pets = await loadPets(ctx);
        } catch (e) {
          console.warn("[Cthulhu:pet] pets.json:", e.message);
          pets = [];
        }
        if (disposed) return;
        if (!pets.length) {
          el.querySelector(".cw-pet").innerHTML =
            '<div class="cw-pet-empty">No pets found in assets/pets.json</div>';
          return;
        }

        const base = choose(pets, ctx.config && ctx.config.pet, tile);

        // A unique pet already on another tile of this page: say so, do not
        // draw a second one. (Random never picks one, so this is the case of
        // a tile deliberately set to it -- or two such tiles restored from a
        // layout saved before the rule existed.)
        if (base.unique) {
          if (heldElsewhere(base.id, tile)) {
            const only = document.createElement("div");
            only.className = "cw-pet-only";
            only.dataset.pet = base.id;
            only.textContent = UNIQUE_MSG;
            stage.appendChild(only);
            return;
          }
          claim(base.id, tile);
          stops.push(() => release(base.id, tile));
        }

        const pet = effective(base);
        const name = pet.name || pet.id;
        const glitch = pet.mode === "glitch";
        const urls = pet.frames.map((f) => ctx.assetUrl(f));

        // Follow the variant pref live: Tea <-> Rishi is a full redraw.
        if (base.variantPref) {
          let current = getPref(base.variantPref, "");
          stops.push(watchPref(base.variantPref, (v) => {
            if (!disposed && v !== current) { current = v; ctx.refresh(); }
          }));
        }

        // Label. A glitch pet's name never sits still.
        if (ctx.config && ctx.config.showName === false) {
          nameEl.textContent = "";
        } else if (glitch) {
          nameEl.textContent = name;
          stops.push(glitchText(nameEl, name));
        } else {
          nameEl.textContent = name;
        }

        // Mood bubble, for a pet that has one. Follows the pref live; the
        // pref itself follows the relay (see the header), so setting it in
        // either browser's admin panel reaches every open tab of both.
        if (base.moodPref) {
          const paintMood = (v) => { moodEl.textContent = (v || "").slice(0, MOOD_MAX); };
          paintMood(getPref(base.moodPref, ""));
          stops.push(watchPref(base.moodPref, paintMood));
          shared.start({ moodPref: base.moodPref });
          stops.push(() => shared.stop());
        }

        // Sprite.
        const img = document.createElement("img");
        img.className = "cw-pet-img " + (glitch ? "glitch" : "idle");
        img.alt = name;
        img.draggable = false;
        img.dataset.pet = base.id;
        if (pet.variant) img.dataset.variant = pet.variant;
        img.decoding = "async";

        let host = img;
        if (pet.action === "feature-request") {
          const hit = document.createElement("button");
          hit.type = "button";
          hit.className = "cw-pet-hit";
          hit.title = pet.hint || "Send a feature request";
          hit.setAttribute("aria-label", hit.title);
          hit.appendChild(img);
          // Don't let the press bubble to GridStack as the start of a tile drag.
          hit.addEventListener("pointerdown", (e) => e.stopPropagation());
          hit.addEventListener("click", (e) => { e.stopPropagation(); openRishiRequest(); });
          host = hit;
        }

        img.addEventListener("load", () => { if (!disposed) fitInto(img, stage); }, { once: true });
        img.src = urls[0];
        stage.appendChild(host);

        // Re-fit when the tile is resized. All frames of one pet share a size,
        // so fitting once per resize (not per frame) is enough.
        if (typeof ResizeObserver === "function") {
          const ro = new ResizeObserver(() => { if (!disposed) fitInto(img, stage); });
          ro.observe(stage);
          stops.push(() => ro.disconnect());
        }

        if (urls.length > 1) {
          // Decode every frame up front so the swap never flashes a blank.
          for (const u of urls) { const pre = new Image(); pre.src = u; }
          stops.push(glitch ? playGlitch(img, urls, pet.fps) : playOrdered(img, urls, pet.fps));
        }
      })();
    },

    /* Clicking the tile re-rolls, but only in Random mode -- if you deliberately
     * picked a pet, a stray click shouldn't silently swap it out. (Whole-tile
     * clicks arrive here rather than via a click listener; see widgets/README.md
     * -- GridStack swallows the native click on a grabbable tile. Rishi's own
     * button is exempt: it is a real button and handles its own click.) */
    onClick(ctx) {
      if (!ctx.config || ctx.config.pet === "random") ctx.refresh();
    },

    configUI(panel, ctx) {
      const cfg = ctx.config || {};
      // The tile this panel belongs to, for the uniqueness check: its own
      // claim must not count against it.
      const modalTile = (() => {
        const items = [...document.querySelectorAll("#grid .grid-stack-item")];
        return items.find((it) => it._cthulhu && it._cthulhu.config === ctx.config) || null;
      })();

      const list = document.createElement("div");
      list.className = "cw-pet-list";
      panel.appendChild(list);

      const hint = document.createElement("div");
      hint.className = "cw-pet-note";
      panel.appendChild(hint);

      const nameRow = document.createElement("label");
      const nameBox = document.createElement("input");
      nameBox.type = "checkbox";
      nameBox.checked = cfg.showName !== false;
      nameRow.appendChild(nameBox);
      nameRow.appendChild(document.createTextNode(" Show pet name"));
      panel.appendChild(nameRow);
      nameBox.addEventListener("change", () => {
        ctx.saveConfig({ ...ctx.config, showName: nameBox.checked }, { refresh: true });
      });

      loadPets(ctx).then((pets) => {
        const opts = [{ id: "random", name: "Random (new pet each tab)" }, ...pets];
        const rows = [];
        const paint = () => {
          const cur = (ctx.config && ctx.config.pet) || "random";
          for (const r of rows) {
            r.el.classList.toggle("on", r.id === cur);
            const taken = !!(r.pet && r.pet.unique && heldElsewhere(r.pet.id, modalTile));
            r.el.classList.toggle("taken", taken);
            r.tag.textContent = taken ? "on another tile" : "";
          }
          const p = pets.find((x) => x.id === cur);
          hint.textContent = p && p.hint ? p.hint : "";
        };
        for (const o of opts) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "cw-pet-row";
          row.setAttribute("data-pet", o.id);

          const shown = o.frames ? effective(o) : o;
          if (shown.frames && shown.frames.length) {
            const img = document.createElement("img");
            img.alt = "";
            img.draggable = false;
            img.src = ctx.assetUrl(shown.frames[0]);
            row.appendChild(img);
          } else {
            const dot = document.createElement("span");
            dot.className = "dot";
            row.appendChild(dot);
          }

          const label = document.createElement("span");
          label.className = "cw-pet-rowname";
          label.textContent = shown.name || o.id;
          row.appendChild(label);
          const tag = document.createElement("span");
          tag.className = "cw-pet-rowtag";
          row.appendChild(tag);
          // KIY's name is restless wherever it appears -- and here it is on
          // screen the whole time the panel is open. The timer stops itself
          // when the panel closes and the node leaves the document.
          if (o.mode === "glitch") glitchText(label, o.name || o.id, 80);

          row.addEventListener("click", (e) => {
            e.stopPropagation();
            if (o.unique && heldElsewhere(o.id, modalTile)) {
              try { ctx.ui.toast(UNIQUE_MSG); } catch (err) {}
              paint();
              return;
            }
            ctx.saveConfig({ ...ctx.config, pet: o.id }, { refresh: true });
            paint();
          });
          rows.push({ id: o.id, el: row, tag, pet: o.frames ? o : null });
          list.appendChild(row);
        }
        paint();
      }).catch((e) => {
        const err = document.createElement("div");
        err.className = "cw-pet-empty";
        err.textContent = "Could not load pets.json: " + e.message;
        panel.appendChild(err);
      });
    },
  });
})();
