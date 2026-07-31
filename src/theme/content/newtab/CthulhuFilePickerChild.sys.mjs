/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Child side of the file-picker actor (runs in each content frame). Intercepts
 * clicks on <input type=file> and shows the Cthulhu picker: recent files, paste
 * image from clipboard, and "Show all files…" (the native OS picker / Finder).
 * All picker DOM/objects are built in the CONTENT scope via this.contentWindow. */

export class CthulhuFilePickerChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type !== "click") return;
    let input;
    try { input = event.target && event.target.closest && event.target.closest('input[type="file"]'); }
    catch (e) { return; }
    if (!input || input.__cthulhuBypass) return;
    let href = "";
    try { href = this.contentWindow.location.href; } catch (e) {}
    if (href.startsWith("about:cthulhu") || href.startsWith("chrome:") || href.startsWith("about:")) return;
    event.preventDefault();
    event.stopPropagation();
    this.openPicker(input);
  }

  openPicker(input) {
    const win = this.contentWindow;
    const doc = this.document;
    if (doc.querySelector(".cthulhu-fp")) return;
    const S = (el, css) => { el.setAttribute("style", css); return el; };

    const overlay = S(doc.createElement("div"), "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font-family:system-ui,-apple-system,sans-serif;");
    overlay.className = "cthulhu-fp";
    const panel = S(doc.createElement("div"), "width:380px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;padding:18px;background:#242424;color:#e8e8e8;border:1px solid rgba(255,255,255,.14);border-radius:12px;display:flex;flex-direction:column;gap:12px;");
    overlay.appendChild(panel);
    const h = S(doc.createElement("h3"), "margin:0;font-size:15px;"); h.textContent = "Upload a file"; panel.appendChild(h);
    const recWrap = doc.createElement("div"); panel.appendChild(recWrap);

    const mkBtn = (txt, muted) => {
      const b = S(doc.createElement("button"), "padding:10px 12px;background:#1f1f1f;color:" + (muted ? "#9a9a9a" : "#e8e8e8") + ";border:1px solid rgba(255,255,255,.14);border-radius:8px;cursor:pointer;text-align:left;font-size:13px;");
      b.textContent = txt; return b;
    };
    const paste = mkBtn("Paste image from clipboard");
    const showAll = mkBtn("Show all files…");
    const cancel = mkBtn("Cancel", true);

    paste.addEventListener("click", async () => {
      const f = await this.clipboardFile();
      if (f) this.inject(input, f, overlay);
      else { paste.textContent = "No image in clipboard"; win.setTimeout(() => { paste.textContent = "Paste image from clipboard"; }, 1500); }
    });
    showAll.addEventListener("click", () => {
      overlay.remove();
      // capture whatever the native dialog returns into Recent
      const onChange = () => { const f = input.files && input.files[0]; if (f) this.rememberFile(f); };
      input.addEventListener("change", onChange, { once: true });
      input.__cthulhuBypass = true;
      try { input.click(); } catch (e) {}
      win.setTimeout(() => { input.__cthulhuBypass = false; }, 100);
    });
    cancel.addEventListener("click", () => overlay.remove());

    const actions = S(doc.createElement("div"), "display:flex;flex-direction:column;gap:8px;");
    actions.appendChild(paste); actions.appendChild(showAll); actions.appendChild(cancel);
    panel.appendChild(actions);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    doc.documentElement.appendChild(overlay);

    this.sendQuery("getRecents").then((list) => {
      if (!list || !list.length || !overlay.isConnected) return;
      const label = S(doc.createElement("div"), "color:#9a9a9a;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;");
      label.textContent = "Recent";
      const grid = S(doc.createElement("div"), "display:flex;flex-wrap:wrap;gap:8px;");
      for (const r of list) {
        const chip = S(doc.createElement("button"), "display:flex;align-items:center;gap:6px;padding:6px 8px;background:#1f1f1f;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#e8e8e8;cursor:pointer;font-size:12px;max-width:100%;");
        if (r.type && r.type.startsWith("image/")) {
          const img = S(doc.createElement("img"), "width:24px;height:24px;object-fit:cover;border-radius:4px;flex:none;"); img.src = r.dataUrl; chip.appendChild(img);
        }
        const nm = S(doc.createElement("span"), "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;"); nm.textContent = r.name || "file"; chip.appendChild(nm);
        chip.addEventListener("click", async () => { const f = await this.recentToFile(r); this.inject(input, f, overlay); });
        grid.appendChild(chip);
      }
      recWrap.appendChild(label); recWrap.appendChild(grid);
    }).catch(() => {});
  }

  inject(input, file, overlay) {
    if (overlay) overlay.remove();
    if (!file) return;
    const win = this.contentWindow;
    try {
      const dt = new win.DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    } catch (e) { /* leave the input untouched on failure */ }
    // NOTE: clipboard pastes are NOT remembered (the clipboard only ever holds
    // one thing; it lives behind the "Paste" button). Only real files chosen via
    // "Show all files…" are added to Recent (see rememberFile).
  }

  // remember a real file the user picked from the native dialog
  rememberFile(file) {
    if (!file || file.size > 4_000_000) return; // only files small enough to re-store
    this.fileToDataUrl(file).then((d) => {
      if (d) this.sendAsyncMessage("addRecent", { name: file.name, type: file.type, dataUrl: d });
    });
  }
  async recentToFile(r) {
    const win = this.contentWindow;
    try {
      const blob = await win.fetch(r.dataUrl).then((res) => res.blob());
      return new win.File([blob], r.name || "file", { type: r.type || blob.type || "" });
    } catch (e) { return null; }
  }

  async clipboardFile() {
    const win = this.contentWindow;
    try {
      const items = await win.navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) return new win.File([await it.getType(type)], "clipboard.png", { type });
      }
    } catch (e) {}
    return null;
  }
  fileToDataUrl(file) {
    const win = this.contentWindow;
    return new Promise((res) => { const fr = new win.FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(file); });
  }
}
