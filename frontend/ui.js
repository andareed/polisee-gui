export function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function button(text, className, action, title) {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  if (title) { node.title = title; node.setAttribute("aria-label", title); }
  return node;
}

export function shown(value) { return value == null ? "—" : value === "" ? '""' : String(value); }

export function rawElement(node) {
  const wrap = element("div", "exported-fields");
  wrap.append(element("span", "exported-tag", node.namespace ? `{${node.namespace}}${node.name}` : node.name));
  for (const attribute of node.attributes || []) {
    const pair = element("span", "exported-pair");
    pair.append(element("span", "exported-key", attribute.namespace ? `{${attribute.namespace}}${attribute.name}` : attribute.name), element("span", "", shown(attribute.value)));
    wrap.append(pair);
  }
  if (node.text?.trim()) wrap.append(element("span", "", node.text));
  for (const path of node.externalExpressions || []) wrap.append(element("div", "external-notice", `External expression unavailable: ${path}`));
  for (const child of node.children || []) wrap.append(rawElement(child));
  return wrap;
}
