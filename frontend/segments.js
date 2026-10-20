import { element, button, shown } from "./ui.js";
import { metadata, closeMetadata, metadataOpen } from "./diagnostics.js";
import { BrowseMemory, pageLabel, formatCount } from "./browse-state.js";

function table(headers, className) {
  const node = element("table", className);
  const head = element("thead"), row = element("tr"), body = element("tbody");
  for (const label of headers) { const cell = element("th", "", label); cell.scope = "col"; row.append(cell); }
  head.append(row); node.append(head, body);
  return { node, body };
}

function pager(data, noun, onPage) {
  const wrap = element("div", "browse-pager");
  const count = element("span", "browse-count", pageLabel(data, noun));
  count.setAttribute("role", "status");
  const singular = noun.endsWith("s") ? noun.slice(0, -1) : noun;
  const previous = button("‹", "quiet small", () => onPage(data.page - 1), `Previous ${singular} page`);
  const next = button("›", "quiet small", () => onPage(data.page + 1), `Next ${singular} page`);
  previous.disabled = data.page <= 0;
  next.disabled = (data.page + 1) * data.pageSize >= data.filtered;
  wrap.append(count, previous, next);
  return wrap;
}

export class SegmentBrowser {
  constructor(bridge, onError) {
    this.bridge = bridge; this.onError = onError; this.memory = new BrowseMemory();
    this.listRequest = 0; this.rangeRequest = 0;
    this.dialog = document.getElementById("range-inspector");
    this.rangeInput = document.getElementById("range-search");
    this.rangeScroll = document.getElementById("range-scroll");
    document.getElementById("close-ranges").addEventListener("click", () => this.close());
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    document.getElementById("previous-segment").addEventListener("click", () => this.moveSegment(-1));
    document.getElementById("next-segment").addEventListener("click", () => this.moveSegment(1));
    this.rangeInput.addEventListener("input", () => {
      const memory = this.rangeMemory(); memory.text = this.rangeInput.value; memory.page = 0; memory.scroll = 0;
      this.rangeRequest++; clearTimeout(this.rangeTimer);
      this.rangeTimer = setTimeout(() => this.loadRanges(), 120);
    });
    this.rangeScroll.addEventListener("scroll", () => { if (this.selected && !this.rangeLoading) this.rangeMemory().scroll = this.rangeScroll.scrollTop; });
    this.dialog.addEventListener("keydown", event => {
      if (metadataOpen()) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      const keys = ["j", "k", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Home") this.rangeScroll.scrollTop = 0;
      else if (event.key === "End") this.rangeScroll.scrollTop = this.rangeScroll.scrollHeight;
      else this.rangeScroll.scrollBy({ top: ["j", "ArrowDown", "PageDown"].includes(event.key) ? (event.key === "PageDown" ? this.rangeScroll.clientHeight * .85 : 40) : -(event.key === "PageUp" ? this.rangeScroll.clientHeight * .85 : 40) });
    });
  }
  reset(generation) { this.unmount(); this.memory.reset(generation); }
  unmount() {
    if (this.listScroll && this.ruleID) this.memory.rule(this.ruleID).scroll = this.listScroll.scrollTop;
    this.listRequest++; clearTimeout(this.listTimer); this.close(false); this.host = null;
  }
  get isOpen() { return this.dialog.open; }
  focus() { this.rangeScroll.focus({ preventScroll: true }); }
  rangeMemory() { return this.memory.range(this.ruleID, this.selected.key); }
  query(extra = {}) { return { generation: this.memory.generation, ruleId: this.ruleID, ...extra }; }
  mount(host, ruleID, totals) {
    this.host = host; this.ruleID = ruleID;
    const memory = this.memory.rule(ruleID);
    const toolbar = element("div", "segment-toolbar");
    toolbar.append(element("h3", "", `Segments · ${formatCount(totals.count)}`), element("span", "browse-count", `${formatCount(totals.ranges)} exported ranges`));
    this.listInput = element("input", "segment-search"); this.listInput.type = "search";
    this.listInput.placeholder = "Find segments…"; this.listInput.value = memory.text;
    this.listInput.setAttribute("aria-label", "Find segments by name or ID");
    toolbar.append(this.listInput);
    const grid = table(["Segment", "Ranges", "ID"], "segment-table");
    this.listBody = grid.body; this.listScroll = element("div", "segment-table-scroll"); this.listScroll.append(grid.node);
    this.listFooter = element("div");
    host.append(toolbar, this.listScroll, this.listFooter);
    this.listInput.addEventListener("input", () => {
      memory.text = this.listInput.value; memory.page = 0; memory.scroll = 0;
      this.listRequest++; clearTimeout(this.listTimer);
      this.listTimer = setTimeout(() => this.loadList(), 120);
    });
    this.listScroll.addEventListener("scroll", () => { memory.scroll = this.listScroll.scrollTop; });
    this.loadList();
  }
  async loadList() {
    const request = ++this.listRequest, host = this.host, ruleID = this.ruleID;
    if (!host?.isConnected) return;
    const memory = this.memory.rule(ruleID), text = memory.text;
    host.setAttribute("aria-busy", "true");
    try {
      const data = await this.bridge.segments(this.query({ text, page: memory.page }));
      if (request !== this.listRequest || host !== this.host || data.generation !== this.memory.generation) return;
      memory.page = data.page; this.listData = data;
      const rows = (data.rows || []).map((segment, index) => {
        const row = element("tr");
        const name = element("td");
        const choose = button(segment.name || "Unnamed segment", "segment-name", () => {
          this.returnFocus = choose;
          this.openSegment(segment, { text, position: data.page * data.pageSize + index, total: data.filtered, pageSize: data.pageSize });
        }, `Inspect ranges for ${segment.name || "unnamed segment"}`);
        choose.dataset.segmentKey = segment.key;
        choose.addEventListener("keydown", event => {
          if (!["ArrowDown", "ArrowUp", "j", "k"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault(); event.stopPropagation();
          const buttons = [...this.listBody.querySelectorAll("button")];
          buttons[Math.max(0, Math.min(buttons.length - 1, index + (["j", "ArrowDown"].includes(event.key) ? 1 : -1)))]?.focus();
        });
        name.append(choose);
        row.append(name, element("td", "range-count", formatCount(segment.rangeCount)), element("td", "browse-id", shown(segment.id || null)));
        return row;
      });
      if (!rows.length) { const row = element("tr"), cell = element("td", "muted", "No segments match this search."); cell.colSpan = 3; row.append(cell); rows.push(row); }
      this.listBody.replaceChildren(...rows);
      const focused = this.listFooter.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
      this.listFooter.replaceChildren(pager(data, "segments", page => { memory.page = page; memory.scroll = 0; this.loadList(); }));
      if (focused) ([...this.listFooter.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === focused && !button.disabled) || this.listInput).focus({ preventScroll: true });
      this.listScroll.scrollTop = memory.scroll;
    } catch (cause) { if (request === this.listRequest) this.onError(cause); }
    finally { if (request === this.listRequest && host === this.host) host.setAttribute("aria-busy", "false"); }
  }
  openSegment(segment, context) {
    closeMetadata(false);
    if (this.selected && this.dialog.open) this.rangeMemory().scroll = this.rangeScroll.scrollTop;
    const opening = !this.dialog.open;
    this.selected = segment; this.context = context;
    this.rangeRequest++; clearTimeout(this.rangeTimer);
    const memory = this.rangeMemory(); this.rangeInput.value = memory.text;
    document.getElementById("range-title").textContent = segment.name || "Unnamed segment";
    document.getElementById("range-segment-id").textContent = `ID ${shown(segment.id || null)}`;
    document.getElementById("range-segment-count").textContent = `${formatCount(segment.rangeCount)} exported ranges · Segment ${formatCount(context.position + 1)} of ${formatCount(context.total)}`;
    document.getElementById("previous-segment").disabled = context.position <= 0;
    document.getElementById("next-segment").disabled = context.position + 1 >= context.total;
    if (opening) { this.dialog.showModal(); this.rangeInput.focus({ preventScroll: true }); }
    this.loadRanges();
  }
  async moveSegment(delta) {
    if (!this.context) return;
    const context = { ...this.context, position: this.context.position + delta };
    if (context.position < 0 || context.position >= context.total) return;
    const request = ++this.rangeRequest;
    try {
      const page = await this.bridge.segments(this.query({ text: context.text, page: Math.floor(context.position / context.pageSize) }));
      if (request !== this.rangeRequest || !this.dialog.open || page.generation !== this.memory.generation) return;
      const selected = page.rows[context.position % page.pageSize];
      if (selected) this.openSegment(selected, context);
    } catch (cause) { if (request === this.rangeRequest) { this.rangeLoading = false; this.rangeScroll.setAttribute("aria-busy", "false"); this.onError(cause); } }
  }
  async loadRanges() {
    if (!this.selected || !this.dialog.open) return;
    const request = ++this.rangeRequest, segmentKey = this.selected.key, memory = this.rangeMemory();
    this.rangeLoading = true;
    this.rangeScroll.setAttribute("aria-busy", "true");
    try {
      const data = await this.bridge.ranges(this.query({ segmentKey, text: memory.text, page: memory.page }));
      if (request !== this.rangeRequest || !this.dialog.open || data.generation !== this.memory.generation) return;
      memory.page = data.page;
      const grid = table(["From", "To", "ID", ""], "range-table");
      for (const range of data.rows || []) {
        const row = element("tr"); row.dataset.rangeIndex = String(range.index);
        const id = (range.raw.attributes || []).find(attribute => !attribute.namespace && attribute.name.toUpperCase() === "ID");
        row.append(element("td", "range-address", shown(range.from)), element("td", "range-address", shown(range.to)), element("td", "browse-id", shown(id ? id.value : null)));
        const extra = element("td", "range-extra");
        const raw = range.raw;
        extra.append(metadata(`Range ${range.index + 1} · ${this.selected.name || "Unnamed segment"}`, raw, { compact: true }));
        row.append(extra); grid.body.append(row);
      }
      if (!data.rows?.length) { const row = element("tr"), cell = element("td", "muted", data.total ? "No exported ranges match this search." : "No ranges were included in this segment's export."); cell.colSpan = 4; row.append(cell); grid.body.append(row); }
      this.rangeScroll.replaceChildren(grid.node);
      const footer = document.getElementById("range-pager");
      const focused = footer.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
      footer.replaceChildren(pager(data, "ranges", page => { memory.page = page; memory.scroll = 0; this.loadRanges(); }));
      if (focused) ([...footer.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === focused && !button.disabled) || this.rangeScroll).focus({ preventScroll: true });
      document.getElementById("range-metadata").replaceChildren(metadata(this.selected.name || "Unnamed segment", data.metadata, { compact: true }));
      document.getElementById("range-notices").replaceChildren(...(data.metadata.externalExpressions || []).map(path => element("div", "external-notice", `External expression unavailable: ${path}`)));
      this.rangeScroll.scrollTop = memory.scroll;
    } catch (cause) { if (request === this.rangeRequest) this.onError(cause); }
    finally { if (request === this.rangeRequest) { this.rangeLoading = false; this.rangeScroll.setAttribute("aria-busy", "false"); } }
  }
  close(restore = true) {
    closeMetadata(false);
    if (this.selected && this.dialog.open) this.rangeMemory().scroll = this.rangeScroll.scrollTop;
    this.rangeRequest++; clearTimeout(this.rangeTimer);
    if (this.dialog.open) this.dialog.close();
    if (restore) {
      if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
      else document.getElementById("details").focus({ preventScroll: true });
    }
  }
}
