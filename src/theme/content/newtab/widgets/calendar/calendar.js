/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Calendar widget (utility). Built around a Google Calendar shared between two
 * people: it lists what's on today, lets either person quick-create and tick
 * off items, and filters by who created what.
 *
 *   - Mine / Theirs / Both      filtered on the event's creator (see cthIsMine)
 *   - + button                  quick-create task / deadline / event / project
 *   - checkbox + x on each row  mark done (non-destructively) or delete
 *   - polls every 5-15 min      so a phone edit lands here on its own
 *
 * Auth/API live in gcal.js next door (OAuth + PKCE + loopback redirect). The
 * widget loader only auto-loads `widgets/<id>/<id>.js`, so this file pulls its
 * sibling in itself.
 *
 * DONE-STATE lives in the event's `extendedProperties.shared` rather than in
 * the title, so ticking something off doesn't mangle the text the other person
 * sees in their own Google Calendar. `shared` (not `private`) so both people
 * see the same state -- private properties are per-copy.
 *
 * The month grid is drawn locally from the system clock, so it still works
 * (just without event dots) before you connect anything. */
const CTH_GCAL_READY = (function () {
  if (window.CthulhuGCal) return Promise.resolve(window.CthulhuGCal);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "chrome://cthulhu/content/newtab/widgets/calendar/gcal.js";
    s.onload = () => resolve(window.CthulhuGCal);
    s.onerror = () => reject(new Error("could not load gcal.js"));
    document.head.appendChild(s);
  });
})();

const CTH_DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];
const CTH_MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
/* Kinds are just a tag we stamp on the event; Google has no notion of them, so
 * anything created elsewhere simply shows no badge. */
const CTH_KINDS = [
  { id: "task", label: "Task" },
  { id: "deadline", label: "Deadline" },
  { id: "event", label: "Event" },
  { id: "project", label: "Project" },
];
const CTH_MODES = ["both", "me", "them"];

/* --- date helpers. All local-time: an all-day event's `date` is a bare
 * YYYY-MM-DD with no zone, so parsing it with `new Date(str)` would treat it as
 * UTC and slide it a day for anyone west of Greenwich. Build from components. */
function cthYmd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/** RFC3339 *without* a zone suffix -- paired with an explicit timeZone field so
 *  Google interprets it as local wall-clock time, not UTC. */
function cthLocalIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return cthYmd(d) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":00";
}
function cthParseDateOnly(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function cthEventStart(ev) {
  if (ev.start && ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start && ev.start.date) return cthParseDateOnly(ev.start.date);
  return null;
}
function cthIsAllDay(ev) {
  return !!(ev.start && ev.start.date && !ev.start.dateTime);
}
/** Every local day an event touches, as YYYY-MM-DD keys (for the month dots). */
function cthEventDays(ev) {
  const start = cthEventStart(ev);
  if (!start) return [];
  let end;
  if (cthIsAllDay(ev)) {
    // all-day `end.date` is EXCLUSIVE per the API
    end = ev.end && ev.end.date ? cthParseDateOnly(ev.end.date) : new Date(start);
    end.setDate(end.getDate() - 1);
  } else {
    end = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(start);
  }
  const days = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // Guard against a malformed end before start, which would spin forever.
  if (last < cur) return [cthYmd(cur)];
  while (cur <= last && days.length < 400) {
    days.push(cthYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
function cthTimeLabel(ev) {
  if (cthIsAllDay(ev)) return "All day";
  const d = cthEventStart(ev);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function cthShared(ev) {
  return (ev.extendedProperties && ev.extendedProperties.shared) || {};
}
function cthIsDone(ev) {
  return cthShared(ev).cthulhuDone === "1";
}
function cthKindOf(ev) {
  const id = cthShared(ev).cthulhuKind;
  return CTH_KINDS.find((k) => k.id === id) || null;
}
/** Whose is it? Google marks the authenticated user's own events with
 *  creator.self; fall back to comparing addresses for anything that omits it. */
function cthIsMine(ev, myEmail) {
  const c = ev.creator || {};
  if (c.self === true) return true;
  if (myEmail && c.email) return c.email.toLowerCase() === myEmail.toLowerCase();
  return false;
}

CthulhuWidgets.register({
  id: "calendar",
  category: "utility",
  name: "Calendar",
  defaultSize: { w: 4, h: 3 },
  defaultConfig: {
    calendarId: "primary",
    mode: "both",
    theirLabel: "Theirs",
    showCompleted: false,
    pollMinutes: 5,
  },
  css: `
    .cw-cal { display:flex; flex-direction:column; height:100%; gap:6px; overflow:hidden; }
    .cw-cal-head { display:flex; align-items:center; gap:6px; flex:none; }
    .cw-cal-when { display:flex; flex-direction:column; min-width:0; margin-inline-end:auto; }
    .cw-cal-date { font-family:var(--font-pixel); font-size:1em; color:var(--fg); line-height:1.1; }
    .cw-cal-dow { font-size:.72em; color:var(--fg-muted); }
    .cw-cal-hbtn {
      flex:none; border:1px solid var(--border); background:var(--surface); color:var(--fg);
      border-radius:5px; cursor:pointer; font-family:var(--font-pixel); font-size:10px;
      padding:3px 6px; line-height:1;
    }
    .cw-cal-hbtn:hover { border-color:var(--accent); }
    .cw-cal-hbtn.mode { color:var(--accent); }

    .cw-cal-list { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:3px; }
    .cw-cal-ev { display:flex; gap:6px; align-items:center; font-size:.82em; }
    .cw-cal-ev-time { color:var(--accent); flex:none; font-variant-numeric:tabular-nums; min-width:5.2em; }
    .cw-cal-badge {
      flex:none; font-size:.75em; padding:1px 4px; border-radius:3px;
      border:1px solid var(--border); color:var(--fg-muted);
    }
    .cw-cal-ev-title { color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
    .cw-cal-ev.done .cw-cal-ev-title { text-decoration:line-through; color:var(--fg-muted); }
    .cw-cal-ev-who { flex:none; font-size:.7em; color:var(--fg-muted); }
    .cw-cal-rbtn {
      flex:none; border:none; background:transparent; cursor:pointer; padding:0 2px;
      color:var(--fg-muted); font-size:1em; line-height:1;
    }
    .cw-cal-rbtn:hover { color:var(--accent); }
    .cw-cal-rbtn.del:hover { color:var(--notify); }
    .cw-cal-rbtn.confirm { color:var(--notify); font-size:.75em; }

    .cw-cal-msg { color:var(--fg-muted); font-size:.82em; line-height:1.4; }
    .cw-cal-msg b { color:var(--fg); font-weight:normal; }
    .cw-cal-err { color:var(--notify); font-size:.78em; line-height:1.4; word-break:break-word; }

    /* Month popover + create modal are body-appended so a small tile can't clip them. */
    .cw-cal-pop {
      position:fixed; z-index:2147483600; width:230px; padding:10px;
      background:var(--bg-elevated); border:1px solid var(--border); border-radius:10px;
      box-shadow:0 10px 30px rgba(0,0,0,.5); font-family:var(--font-pixel);
    }
    .cw-cal-pop-title { font-size:12px; color:var(--fg); text-align:center; margin-bottom:8px; }
    .cw-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
    .cw-cal-cell { position:relative; aspect-ratio:1; display:flex; align-items:center; justify-content:center;
                   font-size:10px; color:var(--fg); border-radius:4px; }
    .cw-cal-cell.dow { color:var(--fg-muted); font-size:9px; }
    .cw-cal-cell.blank { visibility:hidden; }
    .cw-cal-cell.today { background:var(--accent); color:var(--fg-on-accent); }
    .cw-cal-cell.has-ev::after {
      content:""; position:absolute; bottom:2px; left:50%; transform:translateX(-50%);
      width:3px; height:3px; border-radius:50%; background:var(--accent);
    }
    .cw-cal-cell.today.has-ev::after { background:var(--fg-on-accent); }

    .cw-cal-modal {
      position:fixed; inset:0; z-index:2147483610; display:flex;
      align-items:center; justify-content:center; background:rgba(0,0,0,.5);
    }
    .cw-cal-form {
      width:300px; max-width:calc(100vw - 40px); max-height:calc(100vh - 40px); overflow-y:auto;
      box-sizing:border-box; display:flex; flex-direction:column; gap:9px; padding:16px;
      background:var(--bg-elevated); border:1px solid var(--border); border-radius:12px;
      box-shadow:0 10px 30px rgba(0,0,0,.5); font-family:var(--font-pixel);
    }
    .cw-cal-form h3 { margin:0; font-size:14px; color:var(--fg); }
    .cw-cal-form label { display:flex; align-items:center; gap:6px; color:var(--fg); font-size:12px; }
    .cw-cal-form input[type="text"], .cw-cal-form input[type="date"],
    .cw-cal-form input[type="time"], .cw-cal-form select, .cw-cal-form textarea {
      flex:1; min-width:0; box-sizing:border-box; padding:5px 7px; background:var(--bg);
      border:1px solid var(--border); border-radius:4px; color:var(--fg);
      font-family:var(--font-pixel); font-size:12px; outline:none;
    }
    .cw-cal-form input:focus, .cw-cal-form select:focus, .cw-cal-form textarea:focus { border-color:var(--accent); }
    .cw-cal-form-actions { display:flex; gap:8px; }
    .cw-cal-form-err { color:var(--notify); font-size:11px; }
  `,

  render(el, ctx) {
    /* NOTE: about:cthulhu runs with the system principal, and assigning
     * innerHTML there goes through Gecko's chrome-fragment sanitizer, which
     * DROPS interactive elements -- <button>, <input> and <select> are all
     * silently removed (verified live: they simply don't appear in the
     * resulting tree, no error). So only inert structure goes through
     * innerHTML; every control below is built with createElement, which is
     * unaffected. Same reason the config panels are assembled node by node. */
    el.innerHTML =
      '<div class="cw-cal">' +
        '<div class="cw-cal-head">' +
          '<span class="cw-cal-when">' +
            '<span class="cw-cal-date"></span><span class="cw-cal-dow"></span>' +
          "</span>" +
        "</div>" +
        '<div class="cw-cal-list"><div class="cw-cal-msg">Loading…</div></div>' +
      "</div>";

    const now = new Date();
    el.querySelector(".cw-cal-date").textContent =
      CTH_MONTH_NAMES[now.getMonth()].slice(0, 3) + " " + now.getDate();
    el.querySelector(".cw-cal-dow").textContent =
      now.toLocaleDateString([], { weekday: "long" });

    const list = el.querySelector(".cw-cal-list");
    const head = el.querySelector(".cw-cal-head");
    const mkHeadBtn = (cls, text, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cw-cal-hbtn " + cls;
      b.textContent = text;
      b.title = title;
      head.appendChild(b);
      return b;
    };
    const modeBtn = mkHeadBtn("mode", "", "Whose items to show");
    const refreshBtn = mkHeadBtn("refresh", "⟳", "Refresh now");
    const addBtn = mkHeadBtn("add", "+", "New item");

    let disposed = false;
    let pop = null;
    let hideTimer = null;
    let modal = null;
    let dayCounts = Object.create(null);
    let myEmail = null;
    let lastEvents = [];

    const removePop = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (pop) { pop.remove(); pop = null; }
    };
    const removeModal = () => { if (modal) { modal.remove(); modal = null; } };
    ctx.onCleanup(() => { disposed = true; removePop(); removeModal(); });

    const msg = (html) => { list.innerHTML = '<div class="cw-cal-msg">' + html + "</div>"; };
    const err = (text) => { list.innerHTML = '<div class="cw-cal-err">' + ctx.esc(text) + "</div>"; };

    const modeLabel = () => {
      const m = ctx.config.mode || "both";
      if (m === "me") return "Mine";
      if (m === "them") return ctx.config.theirLabel || "Theirs";
      return "Both";
    };
    modeBtn.textContent = modeLabel();
    modeBtn.addEventListener("click", () => {
      const i = CTH_MODES.indexOf(ctx.config.mode || "both");
      ctx.saveConfig(
        { ...ctx.config, mode: CTH_MODES[(i + 1) % CTH_MODES.length] },
        { refresh: true }
      );
    });

    function applyMode(events) {
      const mode = ctx.config.mode || "both";
      let out = events;
      if (mode === "me") out = events.filter((ev) => cthIsMine(ev, myEmail));
      else if (mode === "them") out = events.filter((ev) => !cthIsMine(ev, myEmail));
      if (!ctx.config.showCompleted) out = out.filter((ev) => !cthIsDone(ev));
      return out;
    }

    /* --- month popover on hover --- */
    function buildPopover() {
      const d = new Date();
      const year = d.getFullYear();
      const month = d.getMonth();
      const todayKey = cthYmd(d);
      const first = new Date(year, month, 1).getDay();
      const daysIn = new Date(year, month + 1, 0).getDate();

      const node = document.createElement("div");
      node.className = "cw-cal-pop";
      const title = document.createElement("div");
      title.className = "cw-cal-pop-title";
      title.textContent = CTH_MONTH_NAMES[month] + " " + year + " · " + modeLabel();
      node.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "cw-cal-grid";
      for (const dn of CTH_DAY_NAMES) {
        const c = document.createElement("div");
        c.className = "cw-cal-cell dow";
        c.textContent = dn;
        grid.appendChild(c);
      }
      for (let i = 0; i < first; i++) {
        const c = document.createElement("div");
        c.className = "cw-cal-cell blank";
        grid.appendChild(c);
      }
      for (let day = 1; day <= daysIn; day++) {
        const key = cthYmd(new Date(year, month, day));
        const c = document.createElement("div");
        c.className = "cw-cal-cell" +
          (key === todayKey ? " today" : "") +
          (dayCounts[key] ? " has-ev" : "");
        c.textContent = String(day);
        if (dayCounts[key]) {
          c.title = dayCounts[key] + (dayCounts[key] === 1 ? " item" : " items");
        }
        grid.appendChild(c);
      }
      node.appendChild(grid);
      return node;
    }
    function showPopover() {
      if (disposed || modal) return; // don't stack a popover under the create form
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (pop) return;
      pop = buildPopover();
      document.body.appendChild(pop);
      const r = el.getBoundingClientRect();
      const pr = pop.getBoundingClientRect();
      let left = r.left;
      let top = r.bottom + 6;
      if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
      if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
      pop.style.left = Math.max(8, left) + "px";
      pop.style.top = Math.max(8, top) + "px";
      pop.addEventListener("mouseenter", () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      });
      pop.addEventListener("mouseleave", scheduleHide);
    }
    function scheduleHide() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(removePop, 160); // grace period crossing tile -> popover
    }
    el.addEventListener("mouseenter", showPopover);
    el.addEventListener("mouseleave", scheduleHide);

    /* --- today's list --- */
    function renderToday() {
      const todayKey = cthYmd(new Date());
      const todays = applyMode(lastEvents.filter((ev) => cthEventDays(ev).includes(todayKey)));
      // Finished items sink to the bottom; otherwise keep the API's start order.
      todays.sort((a, b) => (cthIsDone(a) ? 1 : 0) - (cthIsDone(b) ? 1 : 0));

      if (!todays.length) {
        msg(ctx.config.mode === "both"
          ? "Nothing today."
          : "Nothing today for <b>" + ctx.esc(modeLabel()) + "</b>.");
        return;
      }
      list.innerHTML = "";
      for (const ev of todays) list.appendChild(renderRow(ev));
    }

    function renderRow(ev) {
      const row = document.createElement("div");
      row.className = "cw-cal-ev" + (cthIsDone(ev) ? " done" : "");

      const t = document.createElement("span");
      t.className = "cw-cal-ev-time";
      t.textContent = cthTimeLabel(ev);
      row.appendChild(t);

      const kind = cthKindOf(ev);
      if (kind) {
        const b = document.createElement("span");
        b.className = "cw-cal-badge";
        b.textContent = kind.label;
        row.appendChild(b);
      }

      const s = document.createElement("span");
      s.className = "cw-cal-ev-title";
      s.textContent = ev.summary || "(no title)";
      s.title = (ev.summary || "") + (ev.description ? "\n\n" + ev.description : "");
      row.appendChild(s);

      // Only worth showing whose it is when both are on screen together.
      if ((ctx.config.mode || "both") === "both") {
        const who = document.createElement("span");
        who.className = "cw-cal-ev-who";
        who.textContent = cthIsMine(ev, myEmail) ? "me" : "them";
        row.appendChild(who);
      }

      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "cw-cal-rbtn";
      doneBtn.textContent = cthIsDone(ev) ? "↺" : "✓";
      doneBtn.title = cthIsDone(ev) ? "Mark not done" : "Mark done";
      doneBtn.addEventListener("click", () => toggleDone(ev, doneBtn));
      row.appendChild(doneBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "cw-cal-rbtn del";
      delBtn.textContent = "×";
      delBtn.title = "Delete";
      // Deleting is irreversible on Google's side, so require a second click
      // rather than nuking an event on a stray tap.
      let armed = false;
      let armTimer = null;
      delBtn.addEventListener("click", () => {
        if (!armed) {
          armed = true;
          delBtn.classList.add("confirm");
          delBtn.textContent = "sure?";
          armTimer = setTimeout(() => {
            armed = false;
            delBtn.classList.remove("confirm");
            delBtn.textContent = "×";
          }, 3000);
          return;
        }
        if (armTimer) clearTimeout(armTimer);
        removeEvent(ev, delBtn);
      });
      row.appendChild(delBtn);
      return row;
    }

    /* --- mutations --- */
    async function withGCal(fn, onErr) {
      try {
        const GCal = await CTH_GCAL_READY;
        return await fn(GCal);
      } catch (e) {
        if (!disposed) (onErr || err)(e.message);
        return null;
      }
    }
    function toggleDone(ev, btn) {
      const next = cthIsDone(ev) ? "0" : "1";
      btn.disabled = true;
      withGCal(async (GCal) => {
        await GCal.patchEvent(ctx.config.calendarId || "primary", ev.id, {
          extendedProperties: { shared: { cthulhuDone: next } },
        });
        await load();
      }).finally(() => { if (!disposed) btn.disabled = false; });
    }
    function removeEvent(ev, btn) {
      btn.disabled = true;
      withGCal(async (GCal) => {
        await GCal.deleteEvent(ctx.config.calendarId || "primary", ev.id);
        await load();
      }).finally(() => { if (!disposed) btn.disabled = false; });
    }

    /* --- quick-create --- */
    addBtn.addEventListener("click", () => openCreate());
    refreshBtn.addEventListener("click", () => { msg("Refreshing…"); load(); });

    function openCreate() {
      if (modal) return;
      removePop();
      modal = document.createElement("div");
      modal.className = "cw-cal-modal";
      const form = document.createElement("div");
      form.className = "cw-cal-form";
      modal.appendChild(form);

      const h = document.createElement("h3");
      h.textContent = "New item";
      form.appendChild(h);

      const mkRow = (labelText, control) => {
        const l = document.createElement("label");
        l.textContent = labelText;
        l.appendChild(control);
        form.appendChild(l);
        return control;
      };

      const title = document.createElement("input");
      title.type = "text";
      title.placeholder = "What is it?";
      mkRow("Title", title);

      const kind = document.createElement("select");
      for (const k of CTH_KINDS) {
        const o = document.createElement("option");
        o.value = k.id; o.textContent = k.label;
        kind.appendChild(o);
      }
      mkRow("Kind", kind);

      const date = document.createElement("input");
      date.type = "date";
      date.value = cthYmd(new Date());
      mkRow("Date", date);

      const allDayBox = document.createElement("input");
      allDayBox.type = "checkbox";
      allDayBox.checked = true;
      const allDayRow = document.createElement("label");
      allDayRow.appendChild(allDayBox);
      allDayRow.appendChild(document.createTextNode(" All day"));
      form.appendChild(allDayRow);

      const time = document.createElement("input");
      time.type = "time";
      time.value = "09:00";
      const timeRow = mkRow("Time", time).closest("label");

      const dur = document.createElement("select");
      for (const [v, label] of [[30, "30 min"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"]]) {
        const o = document.createElement("option");
        o.value = String(v); o.textContent = label;
        dur.appendChild(o);
      }
      dur.value = "60";
      const durRow = mkRow("Duration", dur).closest("label");

      const notes = document.createElement("textarea");
      notes.rows = 2;
      notes.placeholder = "Optional";
      mkRow("Notes", notes);

      const syncTimeRows = () => {
        const show = !allDayBox.checked;
        timeRow.style.display = show ? "" : "none";
        durRow.style.display = show ? "" : "none";
      };
      allDayBox.addEventListener("change", syncTimeRows);
      syncTimeRows();

      const errLine = document.createElement("div");
      errLine.className = "cw-cal-form-err";
      form.appendChild(errLine);

      const actions = document.createElement("div");
      actions.className = "cw-cal-form-actions";
      const create = document.createElement("button");
      create.type = "button"; create.className = "cw-cfg-save"; create.textContent = "Create";
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "cw-cfg-save"; cancel.textContent = "Cancel";
      cancel.style.background = "var(--surface)";
      cancel.style.color = "var(--fg)";
      actions.appendChild(create); actions.appendChild(cancel);
      form.appendChild(actions);

      cancel.addEventListener("click", removeModal);
      modal.addEventListener("click", (e) => { if (e.target === modal) removeModal(); });
      form.addEventListener("keydown", (e) => {
        if (e.key === "Escape") removeModal();
        if (e.key === "Enter" && e.target === title) create.click();
      });

      create.addEventListener("click", async () => {
        const text = title.value.trim();
        if (!text) { errLine.textContent = "Give it a title."; title.focus(); return; }
        if (!date.value) { errLine.textContent = "Pick a date."; return; }
        create.disabled = true;
        errLine.textContent = "";
        const body = cthBuildEventBody({
          summary: text,
          kind: kind.value,
          date: date.value,
          allDay: allDayBox.checked,
          time: time.value,
          durationMin: parseInt(dur.value, 10),
          notes: notes.value.trim(),
        });
        const ok = await withGCal(
          async (GCal) => {
            await GCal.createEvent(ctx.config.calendarId || "primary", body);
            return true;
          },
          (m) => { errLine.textContent = m; }
        );
        create.disabled = false;
        if (ok) { removeModal(); await load(); }
      });

      document.body.appendChild(modal);
      title.focus();
    }

    /* --- data --- */
    async function load() {
      if (disposed) return;
      let GCal;
      try {
        GCal = await CTH_GCAL_READY;
      } catch (e) {
        if (!disposed) err("Calendar auth module failed to load: " + e.message);
        return;
      }
      if (disposed) return;

      const auth = await GCal.getAuth();
      if (disposed) return;
      if (!auth.clientId) {
        msg("Open <b>⚙</b> to add your Google OAuth client ID and connect.");
        return;
      }
      if (!(await GCal.isConnected())) {
        if (!disposed) msg("Open <b>⚙</b> and choose <b>Connect</b> to link Google Calendar.");
        return;
      }

      try {
        if (!myEmail) myEmail = await GCal.getMyEmail();
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        lastEvents = await GCal.listEvents(ctx.config.calendarId || "primary", from, to);
        if (disposed) return;
        // Month dots follow the same mode filter as the list.
        dayCounts = Object.create(null);
        for (const ev of applyMode(lastEvents)) {
          for (const key of cthEventDays(ev)) dayCounts[key] = (dayCounts[key] || 0) + 1;
        }
        renderToday();
        if (pop) { removePop(); showPopover(); }
      } catch (e) {
        if (!disposed) err(e.message);
      }
    }

    load();
    // Clamped: the whole point is catching phone edits, and an interval longer
    // than ~15 min stops feeling live.
    const mins = Math.min(15, Math.max(5, Number(ctx.config.pollMinutes) || 5));
    const iv = setInterval(load, mins * 60 * 1000);
    ctx.onCleanup(() => clearInterval(iv));
  },

  configUI(panel, ctx) {
    const status = document.createElement("div");
    status.className = "cw-cal-msg";
    status.textContent = "Checking…";
    panel.appendChild(status);

    const help = document.createElement("div");
    help.className = "cw-cal-msg";
    help.innerHTML =
      "Needs an OAuth client from your own Google Cloud project " +
      "(<b>Desktop app</b>), with the <b>Google Calendar API</b> enabled. " +
      "See this widget's README for the full walkthrough.";
    panel.appendChild(help);

    const idRow = document.createElement("label");
    idRow.textContent = "Client ID";
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.placeholder = "xxxxx.apps.googleusercontent.com";
    idRow.appendChild(idInput);
    panel.appendChild(idRow);

    const secRow = document.createElement("label");
    secRow.textContent = "Client secret";
    const secInput = document.createElement("input");
    secInput.type = "password";
    secInput.placeholder = "from the same Desktop app client";
    secRow.appendChild(secInput);
    panel.appendChild(secRow);

    const calRow = document.createElement("label");
    calRow.textContent = "Calendar";
    const calSelect = document.createElement("select");
    const primaryOpt = document.createElement("option");
    primaryOpt.value = "primary";
    primaryOpt.textContent = "Primary";
    calSelect.appendChild(primaryOpt);
    calSelect.value = ctx.config.calendarId || "primary";
    calRow.appendChild(calSelect);
    panel.appendChild(calRow);

    const modeRow = document.createElement("label");
    modeRow.textContent = "Show";
    const modeSelect = document.createElement("select");
    for (const [v, label] of [["both", "Both"], ["me", "Mine only"], ["them", "Theirs only"]]) {
      const o = document.createElement("option");
      o.value = v; o.textContent = label;
      modeSelect.appendChild(o);
    }
    modeSelect.value = ctx.config.mode || "both";
    modeRow.appendChild(modeSelect);
    panel.appendChild(modeRow);

    const labelRow = document.createElement("label");
    labelRow.textContent = "Their label";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Theirs";
    labelInput.value = ctx.config.theirLabel || "";
    labelRow.appendChild(labelInput);
    panel.appendChild(labelRow);

    const pollRow = document.createElement("label");
    pollRow.textContent = "Refresh every";
    const pollSelect = document.createElement("select");
    for (const v of [5, 10, 15]) {
      const o = document.createElement("option");
      o.value = String(v); o.textContent = v + " minutes";
      pollSelect.appendChild(o);
    }
    pollSelect.value = String(ctx.config.pollMinutes || 5);
    pollRow.appendChild(pollSelect);
    panel.appendChild(pollRow);

    const doneRow = document.createElement("label");
    const doneBox = document.createElement("input");
    doneBox.type = "checkbox";
    doneBox.checked = !!ctx.config.showCompleted;
    doneRow.appendChild(doneBox);
    doneRow.appendChild(document.createTextNode(" Show completed items"));
    panel.appendChild(doneRow);

    const save = (patch) => ctx.saveConfig({ ...ctx.config, ...patch }, { refresh: true });
    calSelect.addEventListener("change", () => save({ calendarId: calSelect.value }));
    modeSelect.addEventListener("change", () => save({ mode: modeSelect.value }));
    labelInput.addEventListener("change", () => save({ theirLabel: labelInput.value.trim() || "Theirs" }));
    pollSelect.addEventListener("change", () => save({ pollMinutes: parseInt(pollSelect.value, 10) }));
    doneBox.addEventListener("change", () => save({ showCompleted: doneBox.checked }));

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex; gap:8px; flex-wrap:wrap;";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "cw-cfg-save"; saveBtn.textContent = "Save client";
    const connectBtn = document.createElement("button");
    connectBtn.type = "button"; connectBtn.className = "cw-cfg-save"; connectBtn.textContent = "Connect";
    actions.appendChild(saveBtn); actions.appendChild(connectBtn);
    panel.appendChild(actions);

    (async () => {
      let GCal;
      try {
        GCal = await CTH_GCAL_READY;
      } catch (e) {
        status.textContent = "Auth module failed to load: " + e.message;
        return;
      }
      const auth = await GCal.getAuth();
      idInput.value = auth.clientId || "";
      secInput.value = auth.clientSecret || "";

      async function paint() {
        const connected = await GCal.isConnected();
        status.innerHTML = connected ? "Status: <b>connected</b>" : "Status: <b>not connected</b>";
        connectBtn.textContent = connected ? "Disconnect" : "Connect";
        if (!connected) return;
        try {
          const cals = await GCal.listCalendars();
          const current = ctx.config.calendarId || "primary";
          calSelect.innerHTML = "";
          for (const c of cals) {
            const o = document.createElement("option");
            o.value = c.primary ? "primary" : c.id;
            o.textContent = c.summary + (c.primary ? " (primary)" : "") + (c.canWrite ? "" : " — read only");
            calSelect.appendChild(o);
          }
          if (![...calSelect.options].some((o) => o.value === current)) {
            const o = document.createElement("option");
            o.value = current; o.textContent = current;
            calSelect.appendChild(o);
          }
          calSelect.value = current;
          const chosen = cals.find((c) => (c.primary ? "primary" : c.id) === current);
          if (chosen && !chosen.canWrite) {
            status.innerHTML += " — <b>read-only calendar</b>, so create/complete/delete will fail. " +
              "Ask the owner for “Make changes to events”.";
          }
        } catch (e) {
          status.innerHTML = "Status: <b>connected</b>, but listing calendars failed: " + ctx.esc(e.message);
        }
      }
      await paint();

      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saved";
        await GCal.setClient(idInput.value.trim(), secInput.value.trim());
        setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = "Save client"; }, 1200);
        await paint();
        ctx.refresh();
      });

      connectBtn.addEventListener("click", async () => {
        if (await GCal.isConnected()) {
          await GCal.disconnect();
          await paint();
          ctx.refresh();
          return;
        }
        await GCal.setClient(idInput.value.trim(), secInput.value.trim());
        connectBtn.disabled = true;
        connectBtn.textContent = "Waiting for Google…";
        status.innerHTML = "A Google sign-in tab has opened. Approve access there.";
        try {
          await GCal.connect();
          status.innerHTML = "Status: <b>connected</b>";
          ctx.refresh();
        } catch (e) {
          status.innerHTML = "Could not connect: " + ctx.esc(e.message);
        } finally {
          connectBtn.disabled = false;
          await paint();
        }
      });
    })();
  },
});

/** Build the Calendar API event body for a quick-created item.
 *  Exposed at module scope so it can be unit-checked without a live account. */
function cthBuildEventBody(o) {
  const body = {
    summary: o.summary,
    extendedProperties: { shared: { cthulhuKind: o.kind, cthulhuDone: "0" } },
  };
  if (o.notes) body.description = o.notes;
  const [y, m, d] = o.date.split("-").map(Number);
  if (o.allDay) {
    // all-day `end.date` is EXCLUSIVE, so a single-day item ends the next day.
    const next = new Date(y, m - 1, d + 1);
    body.start = { date: o.date };
    body.end = { date: cthYmd(next) };
  } else {
    const [hh, mm] = (o.time || "09:00").split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm);
    const end = new Date(start.getTime() + (o.durationMin || 60) * 60000);
    // Wall-clock strings + an explicit zone: sending a UTC "Z" time here would
    // shift the item for anyone not on UTC.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    body.start = { dateTime: cthLocalIso(start), timeZone: tz };
    body.end = { dateTime: cthLocalIso(end), timeZone: tz };
  }
  return body;
}
