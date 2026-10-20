export class BrowseMemory {
  constructor() { this.generation = null; this.rules = new Map(); }
  reset(generation) {
    if (generation === this.generation) return;
    this.generation = generation;
    this.rules.clear();
  }
  rule(id) {
    if (!this.rules.has(id)) this.rules.set(id, { text: "", page: 0, scroll: 0, ranges: new Map() });
    return this.rules.get(id);
  }
  range(ruleID, segmentKey) {
    const rule = this.rule(ruleID);
    if (!rule.ranges.has(segmentKey)) rule.ranges.set(segmentKey, { text: "", page: 0, scroll: 0 });
    return rule.ranges.get(segmentKey);
  }
}

export function pageLabel(data, noun) {
  const start = data.filtered ? data.page * data.pageSize + 1 : 0;
  const end = Math.min((data.page + 1) * data.pageSize, data.filtered);
  return `${formatCount(start)}–${formatCount(end)} of ${formatCount(data.filtered)} ${noun}${data.filtered !== data.total ? ` · ${formatCount(data.total)} total` : ""}`;
}

// Some native WebKit locale configurations omit thousands separators.
export function formatCount(value) { return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
