/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Minigame widget -- see README.md next to this file for the design and the
 * art slots. Everything drawn is a placeholder; everything that decides
 * behaviour is data in assets/. The tile is one <canvas> under a small bar.
 *
 * Save game = this instance's config. Needs drain by REAL elapsed time from the
 * saved timestamp, so closing the browser does not pause the world.
 *
 * Controls are createElement -- innerHTML drops <button> here (README). The
 * canvas is in the grid's drag-cancel list (newtab.js) so clicking the world
 * does not pick the tile up; the bar above it is the grab handle. */
(function () {
  "use strict";
  const NEEDS = ["fullness", "energy", "mood"];
  const SAVE_EVERY_MS = 30 * 1000;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function freshSave(manifest) {
    return {
      born: Date.now(), lastTick: Date.now(),
      name: (manifest.companion && manifest.companion.name) || "Sprout",
      stats: { fullness: 80, energy: 80, mood: 80 },
      pos: { x: manifest.spawn.x, y: manifest.spawn.y },
      story: { seen: [], flags: [] },
    };
  }
  function loadImage(url) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image " + url)); i.src = url; });
  }
  async function loadJson(url) { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status + " " + url); return r.json(); }

  /** Aseprite sheet -> { img, frames:[{x,y,w,h,ms}], tags:{name:[from,to]} } */
  async function loadSheet(jsonUrl) {
    const data = await loadJson(jsonUrl);
    const dir = jsonUrl.slice(0, jsonUrl.lastIndexOf("/") + 1);
    const img = await loadImage(dir + (data.meta.image || "player.png"));
    const list = Array.isArray(data.frames) ? data.frames : Object.values(data.frames);
    const frames = list.map((f) => ({ x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h, ms: f.duration || 100 }));
    const tags = {};
    for (const t of (data.meta.frameTags || [])) tags[t.name] = [t.from, t.to];
    if (!tags.idle) tags.idle = [0, Math.max(0, frames.length - 1)];
    if (!tags.walk) tags.walk = tags.idle;
    return { img, frames, tags };
  }

  CthulhuWidgets.register({
    id: "game",
    category: "play",
    name: "Minigame",
    defaultSize: { w: 4, h: 3 },
    defaultConfig: { save: null },
    css: `
      .cw-game { display:flex; flex-direction:column; height:100%; gap:4px; }
      .cw-game-bar { display:flex; align-items:center; gap:8px; flex:none; cursor:grab; padding-bottom:3px;
        border-bottom:1px solid var(--border); font-size:.78em; }
      .cw-game-name { color:var(--fg); }
      .cw-game-day { color:var(--fg-muted); }
      .cw-game-needs { display:flex; gap:6px; margin-inline-start:auto; }
      .cw-game-need { display:flex; flex-direction:column; gap:2px; width:44px; }
      .cw-game-need span { font-size:.8em; color:var(--fg-muted); line-height:1; }
      .cw-game-need i { display:block; height:4px; background:var(--surface-hover); border-radius:2px; overflow:hidden; }
      .cw-game-need i b { display:block; height:100%; background:var(--accent); width:50%; }
      .cw-game-need.low i b { background:var(--notify); }
      .cw-game-act { flex:none; border:1px solid var(--border); background:var(--surface); color:var(--fg);
        border-radius:5px; cursor:pointer; font-family:var(--font-pixel); font-size:10px; padding:3px 6px; line-height:1; }
      .cw-game-act:hover { border-color:var(--accent); }
      .cw-game-stage { position:relative; flex:1; min-height:0; }
      .cw-game-canvas { width:100%; height:100%; display:block; image-rendering:pixelated; background:var(--bg);
        border-radius:4px; outline:none; cursor:crosshair; }
      .cw-game-canvas:focus { box-shadow:0 0 0 1px var(--accent) inset; }
      .cw-game-dialog { position:absolute; left:6px; right:6px; bottom:6px; padding:8px 10px;
        background:color-mix(in srgb, var(--bg-elevated) 92%, transparent); border:1px solid var(--accent);
        border-radius:6px; font-size:.82em; color:var(--fg); display:flex; gap:8px; align-items:flex-end; }
      .cw-game-dialog .t { flex:1; line-height:1.4; }
      .cw-game-dialog .t b { display:block; color:var(--accent); font-weight:normal; font-size:.85em; margin-bottom:2px; }
      .cw-game-msg { position:absolute; inset:0; display:grid; place-items:center; color:var(--fg-muted); font-size:.85em; }
    `,
    render(el, ctx) {
      const root = document.createElement("div"); root.className = "cw-game";
      const bar = document.createElement("div"); bar.className = "cw-game-bar"; bar.title = "Drag to move the tile";
      const nameEl = document.createElement("span"); nameEl.className = "cw-game-name";
      const dayEl = document.createElement("span"); dayEl.className = "cw-game-day";
      const needsEl = document.createElement("span"); needsEl.className = "cw-game-needs";
      bar.appendChild(nameEl); bar.appendChild(dayEl); bar.appendChild(needsEl);
      const acts = {};
      for (const [id, label] of [["feed", "Feed"], ["play", "Play"], ["rest", "Rest"]]) {
        const b = document.createElement("button"); b.type = "button"; b.className = "cw-game-act"; b.textContent = label;
        bar.appendChild(b); acts[id] = b;
      }
      const stage = document.createElement("div"); stage.className = "cw-game-stage";
      const canvas = document.createElement("canvas"); canvas.className = "cw-game-canvas"; canvas.tabIndex = 0;
      const msg = document.createElement("div"); msg.className = "cw-game-msg"; msg.textContent = "Loading world…";
      stage.appendChild(canvas); stage.appendChild(msg);
      root.appendChild(bar); root.appendChild(stage); el.appendChild(root);

      const needBars = {};
      for (const n of NEEDS) {
        const w = document.createElement("span"); w.className = "cw-game-need";
        const lab = document.createElement("span"); lab.textContent = n;
        const track = document.createElement("i"); const fill = document.createElement("b"); track.appendChild(fill);
        w.appendChild(lab); w.appendChild(track); needsEl.appendChild(w);
        needBars[n] = { w, fill };
      }

      let disposed = false, raf = 0, saveTimer = 0;
      const keys = new Set();
      ctx.onCleanup(() => { disposed = true; cancelAnimationFrame(raf); clearInterval(saveTimer); persist(); });

      let manifest, bg, sheet, story, save;
      const g2 = canvas.getContext("2d");
      // live state not worth saving every frame
      const st = { target: null, dir: 1, anim: "idle", frame: 0, frameT: 0, bounce: 0, dialog: null };

      const persist = () => { if (save) ctx.saveConfig({ ...ctx.config, save }); };
      const dayOf = () => Math.floor((Date.now() - save.born) / 86400000);

      function tickNeeds() {
        const now = Date.now(), hours = Math.max(0, (now - save.lastTick) / 3600000);
        save.lastTick = now;
        const d = manifest.decayPerHour || {};
        for (const n of NEEDS) save.stats[n] = clamp((save.stats[n] ?? 80) - (d[n] || 3) * hours, 0, 100);
      }
      function paintBar() {
        nameEl.textContent = save.name;
        dayEl.textContent = "day " + (dayOf() + 1);
        for (const n of NEEDS) {
          const v = Math.round(save.stats[n]);
          needBars[n].fill.style.width = v + "%";
          needBars[n].w.classList.toggle("low", v < 25);
          needBars[n].w.title = n + " " + v;
        }
      }
      function act(kind) {
        const s = save.stats;
        if (kind === "feed") { s.fullness = clamp(s.fullness + 30, 0, 100); s.mood = clamp(s.mood + 5, 0, 100); }
        if (kind === "play") { s.mood = clamp(s.mood + 25, 0, 100); s.energy = clamp(s.energy - 10, 0, 100); s.fullness = clamp(s.fullness - 5, 0, 100); }
        if (kind === "rest") { s.energy = clamp(s.energy + 35, 0, 100); }
        st.bounce = 2; // two little hops -- placeholder feedback until per-action tags exist
        paintBar(); persist();
      }
      acts.feed.addEventListener("click", () => act("feed"));
      acts.play.addEventListener("click", () => act("play"));
      acts.rest.addEventListener("click", () => act("rest"));

      /* ---- story ---- */
      function nextChapter() {
        const day = dayOf(), flags = save.story.flags, seen = save.story.seen;
        for (const ch of (story.chapters || [])) {
          if (seen.includes(ch.id)) continue;
          const w = ch.when || {};
          if (w.day != null && day < w.day) continue;
          if (w.flag && !flags.includes(w.flag)) continue;
          return ch;
        }
        return null;
      }
      function showChapter(ch) {
        st.dialog = { ch, i: 0 };
        renderDialog();
      }
      function renderDialog() {
        let box = stage.querySelector(".cw-game-dialog");
        if (!st.dialog) { if (box) box.remove(); return; }
        if (!box) {
          box = document.createElement("div"); box.className = "cw-game-dialog";
          const t = document.createElement("div"); t.className = "t";
          const b = document.createElement("button"); b.type = "button"; b.className = "cw-game-act"; b.textContent = "▸";
          b.addEventListener("click", () => {
            st.dialog.i++;
            if (st.dialog.i >= st.dialog.ch.lines.length) {
              const ch = st.dialog.ch;
              if (!save.story.seen.includes(ch.id)) save.story.seen.push(ch.id);
              for (const f of (ch.sets || [])) if (!save.story.flags.includes(f)) save.story.flags.push(f);
              st.dialog = null; persist();
              const n = nextChapter(); if (n) showChapter(n); else renderDialog();
              return;
            }
            renderDialog();
          });
          box.appendChild(t); box.appendChild(b); stage.appendChild(box);
        }
        const t = box.querySelector(".t"); t.innerHTML = "";
        const title = document.createElement("b"); title.textContent = st.dialog.ch.title || ""; t.appendChild(title);
        t.appendChild(document.createTextNode(st.dialog.ch.lines[st.dialog.i] || ""));
      }

      /* ---- input ---- */
      const view = { scale: 1, ox: 0, oy: 0 };
      function fit() {
        const r = stage.getBoundingClientRect();
        const W = Math.max(1, Math.floor(r.width)), H = Math.max(1, Math.floor(r.height));
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        view.scale = Math.max(1, Math.floor(Math.min(W / bg.width, H / bg.height)));
        view.ox = Math.floor((W - bg.width * view.scale) / 2);
        view.oy = Math.floor((H - bg.height * view.scale) / 2);
      }
      const ro = new ResizeObserver(() => { if (bg) fit(); });
      ro.observe(stage); ctx.onCleanup(() => ro.disconnect());

      canvas.addEventListener("pointerdown", (e) => {
        canvas.focus();
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left - view.ox) / view.scale, y = (e.clientY - r.top - view.oy) / view.scale;
        const wa = manifest.walkable;
        st.target = { x: clamp(x, wa.x, wa.x + wa.w), y: clamp(y, wa.y, wa.y + wa.h) };
      });
      const onKey = (down) => (e) => {
        const k = e.key.toLowerCase();
        if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
          e.preventDefault(); if (down) keys.add(k); else keys.delete(k); st.target = null;
        }
      };
      canvas.addEventListener("keydown", onKey(true));
      canvas.addEventListener("keyup", onKey(false));
      canvas.addEventListener("blur", () => keys.clear());

      /* ---- loop ---- */
      let last = 0;
      function step(now) {
        if (disposed) return;
        raf = requestAnimationFrame(step);
        const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
        const p = save.pos, wa = manifest.walkable, speed = manifest.speed || 36;
        let vx = 0, vy = 0;
        if (keys.size) {
          if (keys.has("arrowleft") || keys.has("a")) vx -= 1;
          if (keys.has("arrowright") || keys.has("d")) vx += 1;
          if (keys.has("arrowup") || keys.has("w")) vy -= 1;
          if (keys.has("arrowdown") || keys.has("s")) vy += 1;
        } else if (st.target) {
          const dx = st.target.x - p.x, dy = st.target.y - p.y, dist = Math.hypot(dx, dy);
          if (dist < 1) st.target = null; else { vx = dx / dist; vy = dy / dist; }
        }
        const moving = vx || vy;
        if (moving) {
          const len = Math.hypot(vx, vy) || 1;
          p.x = clamp(p.x + (vx / len) * speed * dt, wa.x, wa.x + wa.w);
          p.y = clamp(p.y + (vy / len) * speed * dt, wa.y, wa.y + wa.h);
          if (vx) st.dir = vx < 0 ? -1 : 1;
        }
        // animation: pick a tag, advance by the frame's own duration
        const want = moving ? "walk" : "idle";
        if (want !== st.anim) { st.anim = want; st.frame = sheet.tags[want][0]; st.frameT = 0; }
        const [from, to] = sheet.tags[st.anim];
        st.frameT += dt * 1000;
        if (st.frameT >= sheet.frames[st.frame].ms) { st.frameT = 0; st.frame = st.frame + 1 > to ? from : st.frame + 1; }
        if (st.bounce > 0) st.bounce = Math.max(0, st.bounce - dt * 3);

        // draw
        const s = view.scale;
        g2.imageSmoothingEnabled = false;
        g2.clearRect(0, 0, canvas.width, canvas.height);
        g2.drawImage(bg, view.ox, view.oy, bg.width * s, bg.height * s);
        const f = sheet.frames[st.frame];
        const hop = st.bounce > 0 ? Math.round(Math.abs(Math.sin(st.bounce * Math.PI * 2)) * 4) : 0;
        const dx = view.ox + Math.round(p.x - f.w / 2) * s, dy = view.oy + Math.round(p.y - f.h - hop) * s;
        g2.save();
        if (st.dir < 0) { g2.translate(dx + f.w * s, dy); g2.scale(-1, 1); g2.drawImage(sheet.img, f.x, f.y, f.w, f.h, 0, 0, f.w * s, f.h * s); }
        else g2.drawImage(sheet.img, f.x, f.y, f.w, f.h, dx, dy, f.w * s, f.h * s);
        g2.restore();
      }

      /* ---- boot ---- */
      (async () => {
        try {
          manifest = await loadJson(ctx.assetUrl("game.json"));
          [bg, sheet, story] = await Promise.all([
            loadImage(ctx.assetUrl(manifest.background || "landscape.png")),
            loadSheet(ctx.assetUrl(manifest.player || "player.json")),
            loadJson(ctx.assetUrl(manifest.story || "story.json")).catch(() => ({ chapters: [] })),
          ]);
          if (disposed) return;
          save = (ctx.config && ctx.config.save) || freshSave(manifest);
          save.story = save.story || { seen: [], flags: [] };
          save.pos = save.pos || { ...manifest.spawn };
          tickNeeds(); paintBar(); persist();
          msg.remove(); fit();
          saveTimer = setInterval(() => { tickNeeds(); paintBar(); persist(); }, SAVE_EVERY_MS);
          raf = requestAnimationFrame(step);
          const ch = nextChapter(); if (ch) showChapter(ch);
        } catch (e) {
          console.warn("[Cthulhu:game]", e.message);
          msg.textContent = "World failed to load: " + e.message;
        }
      })();
    },
    configUI(panel, ctx) {
      const save = ctx.config && ctx.config.save;
      panel.appendChild(ctx.ui.textRow("Companion name", (save && save.name) || "", (v) => {
        if (!save) return; save.name = v.trim() || "Sprout"; ctx.saveConfig({ ...ctx.config, save }, { refresh: true });
      }));
      const note = document.createElement("div"); note.className = "cw-ui-note";
      note.textContent = save ? "Day " + (Math.floor((Date.now() - save.born) / 86400000) + 1) + " · chapters seen: " + (save.story.seen.length) : "No save yet.";
      panel.appendChild(note);
      panel.appendChild(ctx.ui.button("Start over", () => { ctx.saveConfig({ ...ctx.config, save: null }, { refresh: true }); ctx.closeConfig(); }));
    },
  });
})();
