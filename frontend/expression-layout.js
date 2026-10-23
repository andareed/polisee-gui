import { element } from "./ui.js";

// Paths come from polisee-lib; the frontend never reconstructs Boolean scope.
export function expressionAt(root, path = []) {
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0) return null;
    root = root?.children?.[index];
  }
  return root || null;
}

export function expressionLayout(lines, renderBody) {
  const view = element("div", "expression-layout");
  for (const line of lines || []) {
    const row = element("div", "expression-line");
    row.dataset.expressionKind = line.kind;
    const gutter = element("div", "expression-gutter");
    const prefix = line.prefix || "", continuation = line.continuation || "";
    gutter.style.width = `${Math.max([...prefix].length, [...continuation].length)}ch`;
    gutter.append(element("span", "expression-prefix", prefix));
    [...continuation].forEach((character, index) => {
      if (character !== "│") return;
      const rail = element("span", "expression-rail");
      rail.style.left = `${index + 0.5}ch`;
      rail.setAttribute("aria-hidden", "true");
      gutter.append(rail);
    });
    const body = element("div", "expression-content");
    body.append(renderBody(line));
    row.append(gutter, body);
    view.append(row);
  }
  return view;
}
