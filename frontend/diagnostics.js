import { element, button, shown } from "./ui.js";

let active = null;

// These controls keep their dimensions when hidden. Revealing exported fields
// never reflows a condition, action, or range row.
export function metadata(label, source, { compact = false, omit = [], labelText } = {}) {
  const control = button("", `element-diagnostics${compact ? " diagnostic-icon" : ""}`, event => {
    event.preventDefault(); event.stopPropagation();
    showMetadata(control, label, source);
  }, `Inspect exported fields for ${label}`);
  control.dataset.diagnosticOwner = label;
  control.setAttribute("aria-haspopup", "dialog");
  control.setAttribute("aria-expanded", "false");
  if (labelText !== undefined) {
    control.classList.add("diagnostic-label");
    control.textContent = labelText;
    control.disabled = !document.body.classList.contains("show-diagnostics");
    return control;
  }
  const preview = (source.attributes || []).filter(attribute => !omit.includes(attribute.name)).map(attribute => `${attribute.name} ${shown(attribute.value)}`);
  if (source.text?.trim()) preview.push(source.text);
  if (!preview.length) preview.push(...(source.children || []).map(child => child.name));
  if (!preview.length) preview.push(source.name || "Exported fields");
  if (!compact) control.append(element("span", "diagnostic-preview", preview.join(" · ")));
  control.append(element("span", "diagnostic-more", "⋯"));
  return control;
}

function exportedGroup(source) {
  const group = element("section", "context-fields");
  if (source.name) group.append(element("h4", "", source.name));
  const fields = element("dl", "context-field-list");
  function add(name, value) {
    const pair = element("div", "context-field");
    pair.append(element("dt", "", name), element("dd", "", shown(value)));
    fields.append(pair);
  }
  if (source.namespace) add("XML namespace", source.namespace);
  for (const attribute of source.attributes || []) add(attribute.namespace ? `{${attribute.namespace}}${attribute.name}` : attribute.name, attribute.value);
  if (source.text?.trim()) add("Text", source.text);
  for (const field of source.facts || []) add(field.name, field.value);
  for (const path of source.externalExpressions || []) add("External expression unavailable", path);
  if (fields.childNodes.length) group.append(fields);
  for (const note of source.notes || []) group.append(element("p", "context-note", note));
  for (const child of source.children || []) group.append(exportedGroup(child));
  if (group.childNodes.length === (source.name ? 1 : 0)) group.append(element("p", "context-note", "No additional fields exported."));
  return group;
}

export function metadataOpen() { return Boolean(active); }
export function closeMetadata(restore = true) {
  if (!active) return;
  const { dialog, anchor } = active;
  active = null;
  anchor.setAttribute("aria-expanded", "false");
  dialog.close(); dialog.remove();
  if (restore && anchor.isConnected && document.body.classList.contains("show-diagnostics")) anchor.focus({ preventScroll: true });
}

function showMetadata(anchor, label, source) {
  closeMetadata(false);
  const dialog = element("dialog", "context-popover");
  dialog.setAttribute("aria-label", `${label}: exported fields`);
  const header = element("div", "context-popover-heading");
  const heading = element("div");
  heading.append(element("h3", "", label), element("span", "context-note", "Exported fields"));
  const close = button("×", "icon-button", () => closeMetadata(), "Close exported fields");
  header.append(heading, close);
  const content = element("div", "context-popover-content");
  content.tabIndex = 0;
  content.append(exportedGroup(source));
  dialog.append(header, content);
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeMetadata(); });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMetadata();
  });
  document.body.append(dialog);
  active = { anchor, dialog };
  anchor.setAttribute("aria-expanded", "true");
  dialog.showModal();
  positionMetadata();
  close.focus({ preventScroll: true });
}

function positionMetadata() {
  if (!active) return;
  const { anchor, dialog } = active;
  if (!anchor.isConnected) { closeMetadata(false); return; }
  // Position beside the owning row, clamped to the zoomed viewport. The popover
  // is in the top layer, so clipped section panels and range tables cannot hide it.
  const zoom = Number(document.documentElement.style.zoom) || 1;
  const rect = anchor.getBoundingClientRect(), box = dialog.getBoundingClientRect();
  const left = Math.max(12, Math.min(rect.right - box.width, innerWidth - box.width - 12));
  const below = rect.bottom + 5;
  const top = Math.max(12, Math.min(below + box.height <= innerHeight - 12 ? below : rect.top - box.height - 5, innerHeight - box.height - 12));
  dialog.style.left = `${left / zoom}px`;
  dialog.style.top = `${top / zoom}px`;
}

export function setDiagnostics(visible) {
  if (!visible) closeMetadata();
  document.body.classList.toggle("show-diagnostics", visible);
  for (const label of document.querySelectorAll(".diagnostic-label")) label.disabled = !visible;
  for (const control of document.querySelectorAll("[data-diagnostics-toggle]")) control.setAttribute("aria-pressed", String(visible));
}

export function initDiagnostics() {
  for (const control of document.querySelectorAll("[data-diagnostics-toggle]")) control.addEventListener("click", () => setDiagnostics(!document.body.classList.contains("show-diagnostics")));
  setDiagnostics(true);
  window.addEventListener("resize", positionMetadata);
  new MutationObserver(positionMetadata).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
}
