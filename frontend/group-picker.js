import { element } from "./ui.js";

export function groupMatches(options, text, limit = 12) {
  const term = text.trim().toLowerCase();
  const matches = options.filter(option => `${option.name} ${option.id}`.toLowerCase().includes(term));
  return { rows: matches.slice(0, limit), total: matches.length };
}

export class GroupPicker {
  constructor(input, list, options, onChoose) {
    this.input = input; this.list = list; this.options = options; this.onChoose = onChoose;
    this.active = -1; this.rows = [];
    input.addEventListener("focus", () => this.open());
    input.addEventListener("input", () => this.open());
    input.addEventListener("blur", () => this.close());
    input.addEventListener("keydown", event => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (!this.isOpen) this.open();
        if (!this.rows.length) return;
        this.active = event.key === "ArrowDown" ? Math.min(this.rows.length - 1, this.active + 1) : this.active <= 0 ? this.rows.length - 1 : this.active - 1;
        this.paintActive();
      } else if (event.key === "Enter" && this.isOpen && this.active >= 0) {
        event.preventDefault(); event.stopPropagation(); this.choose(this.rows[this.active]);
      } else if (event.key === "Escape" && this.isOpen) {
        event.preventDefault(); event.stopPropagation(); this.close();
      } else if (event.key === "Enter") this.close();
    });
  }
  get isOpen() { return !this.list.hidden; }
  open() {
    const matches = groupMatches(this.options(), this.input.value);
    this.rows = matches.rows; this.active = -1;
    this.list.replaceChildren(...this.rows.map((option, index) => {
      const row = element("div", "group-option");
      row.id = `group-option-${index}`; row.setAttribute("role", "option"); row.setAttribute("aria-selected", "false");
      row.append(element("span", "group-option-name", option.name));
      if (option.id) row.append(element("span", "browse-id", `ID ${option.id}`));
      row.addEventListener("mousedown", event => event.preventDefault());
      row.addEventListener("click", () => this.choose(option));
      return row;
    }));
    const note = matches.total ? `${this.rows.length} of ${matches.total} groups${matches.total > this.rows.length ? " · Type to narrow" : ""}` : "No named groups match. You can still type an ID.";
    const count = element("div", "group-option-count", note); count.setAttribute("role", "status");
    this.list.append(count); this.list.hidden = false;
    this.input.setAttribute("aria-expanded", "true"); this.input.removeAttribute("aria-activedescendant");
  }
  paintActive() {
    for (const [index, row] of [...this.list.querySelectorAll('[role="option"]')].entries()) {
      row.setAttribute("aria-selected", String(index === this.active));
      if (index === this.active) { this.input.setAttribute("aria-activedescendant", row.id); row.scrollIntoView({ block: "nearest" }); }
    }
  }
  choose(option) { this.input.value = option.name; this.close(); this.onChoose(option); }
  close() { this.list.hidden = true; this.active = -1; this.input.setAttribute("aria-expanded", "false"); this.input.removeAttribute("aria-activedescendant"); }
}
