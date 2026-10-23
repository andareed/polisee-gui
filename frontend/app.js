import { initZoom } from "./zoom.js";
import { bridge } from "./bridge.js";
import { indexNodes, visibleKeys } from "./tree-model.js";
import { element, button, shown } from "./ui.js";
import { SegmentBrowser } from "./segments.js";
import { GroupPicker } from "./group-picker.js";
import { metadata, initDiagnostics, closeMetadata, metadataOpen } from "./diagnostics.js";
import { expressionAt, expressionLayout } from "./expression-layout.js";

const $ = id => document.getElementById(id);
const state = { document: null, byKey: new Map(), children: new Map(), expanded: new Set(),
  pins: new Set(), selectedKey: "", ruleOrder: [], matches: [], rows: [], visible: null, sections: new Map(), query: {}, detailRequest: 0, searchRequest: 0 };
const fields = { text: "text-search", property: "property-search", group: "group-search", action: "action-search", actionValue: "action-value-search" };
let searchTimer;
let preferenceQueue = Promise.resolve();
let latestDetail = null;
let conditionMode = "visual";
let preferences = {};
let canRemember = false;
let groupChoice = null;
let lastDetailFocus = null;
const segmentBrowser = new SegmentBrowser(bridge, error);
const groupPicker = new GroupPicker($("group-search"), $("group-options"), () => state.document?.groupSuggestions || [], option => {
  groupChoice = option; clearTimeout(searchTimer); refreshSearch().then(focusTree);
});
initDiagnostics();
function persistSelection(generation, id) {
  preferenceQueue = preferenceQueue.then(() => bridge.select(generation, id)).catch(cause => error(cause));
}
function showRememberState() {
  $("remember-policy").checked = Boolean(preferences.remember);
  $("remember-policy").disabled = !bridge.isDesktop() || (!canRemember && !preferences.remember);
  $("remember-status").textContent = !bridge.isDesktop() ? "Browser preview: choose a file each session; native paths cannot be reopened." : preferences.remember ? (canRemember ? "Native path and selected rule remembered; XML stays on disk." : "Saved native policy will reopen; uncheck to forget it.") : "Open a native policy file to opt in. Disabling clears its saved path and selection.";
}
function populateActionValues() {
  const term = $("action-search").value.trim().toLowerCase();
  const values = term ? Object.entries(state.document?.actionSuggestions || {}).filter(([name]) => name.toLowerCase().includes(term)).flatMap(([, values]) => values) : state.document?.actionValues || [];
  $("value-options").replaceChildren(...[...new Set(values)].sort().map(value => { const option = element("option"); option.value = value; return option; }));
}

function status(message) { $("status-message").textContent = message; }
function error(cause) {
  $("error-message").textContent = cause?.message || String(cause);
  $("error-banner").hidden = false;
  status("The request could not be completed");
}
function activeFilters() { return Object.values(state.query).some(value => String(value).trim()); }
function titleCase(value) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }

async function installDocument(payload) {
  const result = payload.document || payload;
  if (state.document && result.generation < state.document.generation) return;
  if (payload.preferences) preferences = payload.preferences;
  canRemember = Boolean(payload.canRemember);
  showRememberState();
  latestDetail = null;
  groupChoice = null; groupPicker.close(); segmentBrowser.reset(result.generation);
  state.document = result;
  state.detailRequest++;
  state.searchRequest++;
  const index = indexNodes(result.nodes || []);
  state.byKey = index.byKey;
  state.children = index.children;
  state.ruleOrder = index.ruleIDs;
  state.expanded = new Set((result.nodes || []).filter(n => n.kind === "folder" || n.kind === "policy").map(n => n.key));
  state.pins = new Set([...state.pins].filter(id => state.byKey.has(`rule:${id}`)));
  state.query = {};
  for (const id of Object.values(fields)) $(id).value = "";
  state.matches = state.ruleOrder;
  state.visible = null;
  $("document-name").textContent = result.name;
  $("document-counts").textContent = `${result.folderCount} folders  ·  ${result.policyCount} policies  ·  ${result.ruleCount} rules`;
  $("source-status").textContent = result.diagnostics?.length ? `${result.diagnostics.length} export note${result.diagnostics.length === 1 ? "" : "s"}` : "Local policy definitions";
  $("error-banner").hidden = true;
  for (const [id, values] of [["property-options", result.properties], ["action-options", result.actions], ["value-options", result.actionValues]]) {
    $(id).replaceChildren(...(values || []).map(value => { const option = element("option"); option.value = value; return option; }));
  }
  populateActionValues();
  renderFilterChips();
  renderTree();
  if (result.initialId) { revealAncestors(`rule:${result.initialId}`); await selectNode(`rule:${result.initialId}`); }
  else renderEmpty("This export contains folders but no policy rules.");
  status("Policy definitions loaded");
  if (payload.warning) error(payload.warning);
  if ($("details").querySelector(".rule-header")) bridge.ready(async () => installDocument(await bridge.demo()));
}

async function openPolicy() {
  if ($("open-button").disabled) return;
  $("open-button").disabled = true;
  try {
    if (bridge.isDesktop()) {
      const result = await bridge.open();
      if (result) await installDocument(result);
    } else $("file-input").click();
  } catch (cause) { error(cause); }
  finally { $("open-button").disabled = false; }
}

async function refreshSearch(selectFirst = true) {
  if (!state.document) return;
  const request = ++state.searchRequest;
  state.query = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, $(id).value.trim()]));
  if (groupChoice?.id && groupChoice.name === $("group-search").value) state.query.group = groupChoice.id;
  renderFilterChips();
  try {
    const result = await bridge.search(state.query);
    if (request !== state.searchRequest || result.generation !== state.document.generation) return;
    const matchedIDs = new Set((result.matches || []).map(match => match.ruleId));
    state.matches = state.ruleOrder.filter(id => matchedIDs.has(id));
    state.visible = activeFilters() ? visibleKeys(state.document.nodes, state.matches) : null;
    renderTree();
    if (!state.matches.length && activeFilters()) renderEmpty("No policies match these filters. Try a broader search or clear the filters.");
    else if (selectFirst && activeFilters()) await selectNode(`rule:${state.matches[0]}`);
    else if (!state.byKey.has(state.selectedKey) || (state.visible && !state.visible.has(state.selectedKey))) {
      if (state.matches[0]) await selectNode(`rule:${state.matches[0]}`);
    }
    else if (!activeFilters() && state.selectedKey) await selectNode(state.selectedKey);
  } catch (cause) { if (request === state.searchRequest) error(cause); }
}

function renderFilterChips() {
  const names = { text: "Text", property: "Property", group: "Group", action: "Action", actionValue: "Action value" };
  const chips = [];
  let advanced = 0;
  for (const [key, value] of Object.entries(state.query)) {
    if (!value) continue;
    if (key !== "text") advanced++;
    const display = key === "group" && groupChoice?.id === value ? groupChoice.name : value;
    const chip = button(`${names[key]}: ${display}`, "filter-chip", () => { $(fields[key]).value = ""; if (key === "group") groupChoice = null; refreshSearch(); }, `Remove ${names[key].toLowerCase()} filter: ${display}${key === "group" && groupChoice?.id === value ? ` (ID ${value})` : ""}`);
    if (key === "group" && groupChoice?.id === value) chip.append(element("span", "filter-chip-id", `ID ${value}`));
    chip.append(element("span", "", "×"));
    chips.push(chip);
  }
  $("filter-chips").replaceChildren(...chips);
  $("filter-count").textContent = advanced ? `(${advanced})` : "";
}

function treeRow(node, depth, alias = false) {
  const row = element("div", "tree-row");
  row.dataset.key = node.key;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(depth + 1));
  row.setAttribute("aria-label", node.name);
  row.setAttribute("aria-selected", String(state.selectedKey === node.key));
  row.tabIndex = state.selectedKey === node.key ? 0 : -1;
  row.style.paddingLeft = `${8 + depth * 17}px`;
  if (node.key === state.selectedKey) row.classList.add("selected");
  if (activeFilters() && state.matches.includes(node.id) && node.kind !== "folder") row.classList.add("direct-match");
  const children = state.children.get(node.key) || [];
  const expanded = state.visible !== null || state.expanded.has(node.key);
  if (children.length) row.setAttribute("aria-expanded", String(expanded));
  const toggle = button(children.length ? expanded ? "▾" : "▸" : "", "tree-toggle", event => { event.stopPropagation(); toggleNode(node.key); }, expanded ? "Collapse branch" : "Expand branch");
  toggle.tabIndex = -1;
  if (!children.length) toggle.disabled = true;
  row.append(toggle, element("span", `tree-marker ${node.kind === "folder" ? "folder" : node.enabled ? "enabled" : "disabled"}`), element("span", "tree-name", node.name));
  if (activeFilters()) {
    const context = element("span", "match-context", state.matches.includes(node.id) && node.kind !== "folder" ? "Match" : "Results below");
    row.append(context);
  }
  if (node.kind !== "folder") {
    const pinned = state.pins.has(node.id);
    const pin = button(pinned ? "★" : "☆", `tree-pin${pinned ? " pinned" : ""}`, event => { event.stopPropagation(); togglePin(node.id); }, pinned ? "Unpin policy" : "Pin policy");
    pin.tabIndex = -1;
    row.append(pin);
  }
  row.addEventListener("click", () => {
    if (alias) revealAncestors(node.key);
    selectNode(node.key, true);
  });
  return row;
}

function renderTree() {
  const focusedKey = document.activeElement?.closest(".tree-row")?.dataset.key;
  state.rows = [];
  const fragment = document.createDocumentFragment();
  function visit(parent, depth) {
    for (const node of state.children.get(parent) || []) {
      if (state.visible && !state.visible.has(node.key)) continue;
      state.rows.push(node.key);
      fragment.append(treeRow(node, depth));
      if (state.visible || state.expanded.has(node.key)) visit(node.key, depth + 1);
    }
  }
  visit("", 0);
  $("tree").replaceChildren(fragment);
  const pins = document.createDocumentFragment();
  if (state.pins.size && !activeFilters()) {
    pins.append(element("div", "pin-label", "PINNED"));
    for (const id of state.pins) if (state.byKey.has(`rule:${id}`)) pins.append(treeRow(state.byKey.get(`rule:${id}`), 0, true));
    pins.append(element("div", "pin-divider"));
  }
  $("pins").replaceChildren(pins);
  $("tree-count").textContent = String(state.document?.ruleCount || 0);
  $("search-status").textContent = activeFilters() ? `${state.matches.length} matching rule${state.matches.length === 1 ? "" : "s"}` : "All policies";
  $("clear-search").hidden = !activeFilters();
  $("empty-tree").hidden = state.rows.length > 0;
  $("previous-result").disabled = !activeFilters() || !state.matches.length;
  $("next-result").disabled = !activeFilters() || !state.matches.length;
  if (focusedKey) [...$("tree").querySelectorAll(".tree-row"), ...$("pins").querySelectorAll(".tree-row")].find(row => row.dataset.key === focusedKey)?.focus({ preventScroll: true });
}

function revealAncestors(key) {
  let node = state.byKey.get(key);
  while (node?.parent) { state.expanded.add(node.parent); node = state.byKey.get(node.parent); }
}
function toggleNode(key) { if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key); renderTree(); }
function togglePin(id) {
  if (state.pins.has(id)) state.pins.delete(id); else state.pins.add(id);
  renderTree();
  const control = $("detail-pin");
  if (control && state.selectedKey === `rule:${id}`) control.textContent = state.pins.has(id) ? "★ Pinned" : "☆ Pin policy";
  status(state.pins.has(id) ? "Policy pinned" : "Policy unpinned");
}

async function selectNode(key, focus = false) {
  const node = state.byKey.get(key);
  if (!node) return;
  closeMetadata(false);
  state.selectedKey = key;
  segmentBrowser.unmount();
  latestDetail = null;
  const request = ++state.detailRequest;
  renderTree();
  if (focus) {
    const row = [...$("tree").querySelectorAll("[data-key]")].find(row => row.dataset.key === key);
    row?.focus(); row?.scrollIntoView({ block: "nearest" });
  }
  if (node.kind === "folder") { renderFolder(node); return; }
  persistSelection(state.document.generation, node.id);
  try {
    const result = await bridge.rule(node.id);
    if (request !== state.detailRequest || result.generation !== state.document.generation) return;
    latestDetail = result;
    renderRule(result);
    const position = state.matches.indexOf(node.id);
    status(activeFilters() && position >= 0 ? `Result ${position + 1} of ${state.matches.length}` : "Ready");
  } catch (cause) { if (request === state.detailRequest) error(cause); }
}

function section(id, title, count, content, initiallyOpen = true, stateKey = id) {
  const wrap = element("details", "rule-section");
  wrap.dataset.section = id;
  wrap.dataset.sectionState = stateKey;
  wrap.open = state.sections.has(stateKey) ? state.sections.get(stateKey) : initiallyOpen;
  const summary = element("summary", "", title);
  if (count) summary.append(element("span", "section-count", count));
  const body = element("div", "section-body");
  body.append(...content);
  wrap.append(summary, body);
  wrap.addEventListener("toggle", () => state.sections.set(stateKey, wrap.open));
  return wrap;
}
function empty(text) { return element("div", "muted", text); }
function attributesInline(attributes) {
  return (attributes || []).map(attribute => {
    const pair = element("span", "attribute-pair");
    const label = ["FIELD_NAME", "FILED_NAME", "COMP_FIELD_NAME"].includes(attribute.name) ? state.document?.fieldLabels?.[attribute.value] : null;
    pair.append(element("span", "attribute-name", attribute.name), element("span", "attribute-value", label || (attribute.value === "" ? '""' : attribute.value)));
    return pair;
  });
}
function isIdentifier(attribute) { return /(^|[_-])(ID|GUID|UUID)$/i.test(attribute.name); }
function isVisibleIdentifier(attribute) { return isIdentifier(attribute) && attribute.name.toUpperCase() !== "FILTER_ID"; }
function identifiers(attributes) { return (attributes || []).filter(isVisibleIdentifier).map(attribute => inlineIdentifier(factLabel(attribute.name), attribute.value)); }
function xmlElement(node) {
  const row = element("div", "element");
  row.append(element("span", "element-tag", node.name), ...attributesInline((node.attributes || []).filter(attribute => !isIdentifier(attribute))), ...identifiers(node.attributes), metadata(node.name, node, { compact: true }));
  if (node.text?.trim()) row.append(element("div", "element-text", node.text));
  row.append(...(node.externalExpressions || []).map(externalNotice));
  if (node.children?.length) {
    const children = element("div", "element-children");
    children.append(...node.children.map(child => xmlElement(child))); row.append(children);
  }
  return row;
}
function externalNotice(path) { return element("div", "external-notice", `External expression unavailable: ${path}`); }
function conditionView(logic, expression, layout) {
  if (conditionMode === "text" && logic) return element("pre", "logic-text", logic.text);
  if (!expression) return empty("No condition expression is present for this rule.");
  return expressionLayout(layout, line => {
    const source = expressionAt(expression, line.sourcePath);
    const sourceLogic = expressionAt(logic, line.sourcePath);
    const contexts = (line.contextPaths || []).map(path => expressionAt(expression, path)).filter(Boolean);
    if (!source) return empty("Expression unavailable.");
    if (line.kind === "condition") return conditionDetail(sourceLogic, source, contexts);
    const body = element("div", "expression-operator");
    const heading = element("div", "context-line");
    heading.append(element("span", "", line.text), ...identifiers(source.attributes),
      metadata(line.text, expressionMetadata(source, contexts), { compact: true }));
    body.append(heading);
    if (line.kind === "expression") body.append(...(source.externalExpressions || []).map(externalNotice), ...(source.extensions || []).map(xmlElement));
    return body;
  });
}
function expressionMetadata(expression, contexts = []) {
  return { name: "EXPRESSION", attributes: expression.attributes, children: [...(expression.extensions || []),
    ...contexts.map(context => ({ name: "EXPRESSION", attributes: context.attributes, children: context.extensions, externalExpressions: context.externalExpressions }))], externalExpressions: expression.externalExpressions };
}
function conditionDetail(logic, expression, contexts) {
  const condition = element("div", "condition");
  const raw = expression?.condition || {};
  const heading = element("div", "context-line");
  const title = element("div", "condition-title", logic.label);
  title.append(...identifiers(raw.attributes), ...identifiers(expression.attributes), ...contexts.flatMap(context => identifiers(context.attributes)));
  const source = { name: "CONDITION", attributes: raw.attributes, children: [...(raw.extensions || [])], notes: logic.notice ? [logic.notice] : [] };
  if (expression?.attributes?.length || expression?.extensions?.length || contexts.length) source.children.push(expressionMetadata(expression, contexts));
  heading.append(title, metadata(logic.label, source, { omit: ["LABEL", "FIELD_NAME", "FILED_NAME", ...(raw.attributes || []).filter(isVisibleIdentifier).map(attribute => attribute.name)] }));
  condition.append(heading);
  if (logic.unknown) condition.append(element("div", "unknown-note", logic.unknown));
  for (const filter of logic.filters || []) {
    const row = element("div", "condition-filter");
    const type = (filter.attributes || []).find(a => a.name === "TYPE")?.value || "filter";
    row.append(element("span", "filter-operator", type));
    if (filter.text?.trim()) row.append(element("span", "element-text", filter.text));
    for (const operand of filter.operands || []) row.append(xmlElement(operand));
    row.append(metadata(`${logic.label} · ${type} filter`, { name: "FILTER", attributes: filter.attributes, text: filter.text }, { compact: !(filter.attributes || []).some(attribute => attribute.name !== "TYPE"), omit: ["TYPE"] }));
    condition.append(row);
  }
  condition.append(...(logic.external || []).map(externalNotice));
  condition.append(...(logic.extensions || []).map(node => xmlElement(node)));
  return condition;
}
function conditionCount(logic) { return logic ? (logic.label ? 1 : 0) + (logic.children || []).reduce((sum, child) => sum + conditionCount(child), 0) : 0; }
function enabledBadge(rule) { return element("span", `badge ${rule.effectiveEnabled ? "enabled" : "disabled"}`, rule.effectiveEnabled ? "● Enabled" : rule.enabled ? "● Disabled by parent" : "● Disabled"); }

const detailLabels = { GROUP_IN_FILTER: "Groups", GROUP: "Group", SEGMENT: "Segment", SUBNET: "Subnet", RANGE: "Address range", EXCEPTION: "Exception", INACTIVITY_TTL: "Inactivity timeout", ADMISSION_RESOLVE_DELAY: "Admission resolve delay", MATCH_TIMING: "When matched", UNMATCH_TIMING: "When unmatched" };
// Flatten presentation wrappers into inline values. Original fields stay
// accessible from the element that owns them.
function readableValue(node, showIdentifiers = false) {
  const wrap = element("span", "setting-value");
  const attributes = node.attributes || [];
  const attribute = name => attributes.find(item => item.name.toUpperCase() === name)?.value;
  const kind = node.name.toUpperCase();
  const used = new Set();
  function display(text, keys = []) {
    wrap.append(element("span", "setting-content", text === "" ? '\"\"' : text));
    for (const key of keys) used.add(key);
  }
  const name = attribute("NAME");
  if (name !== undefined) display(kind === "EXCEPTION" ? state.document?.fieldLabels?.[name] || name : name, ["NAME"]);
  if (kind === "SUBNET" && attribute("ADDRESS") !== undefined) {
    display(attribute("ADDRESS") + (attribute("PREFIX") !== undefined ? "/" + attribute("PREFIX") : ""), ["ADDRESS", "PREFIX"]);
  }
  if (kind === "RANGE" && attribute("FROM") !== undefined && attribute("TO") !== undefined) {
    display(attribute("FROM") + " – " + attribute("TO"), ["FROM", "TO"]);
  }
  for (const item of attributes) {
    if (used.has(item.name.toUpperCase()) || (isIdentifier(item) && !showIdentifiers)) continue;
    const pair = element("span", "setting-pair");
    if (isIdentifier(item)) pair.classList.add("inline-identifier");
    if (item.name.toUpperCase() !== "VALUE") pair.append(element("span", "setting-key", isIdentifier(item) ? factLabel(item.name) : titleCase(item.name)));
    const label = ["FIELD_NAME", "FILED_NAME", "COMP_FIELD_NAME"].includes(item.name) ? state.document?.fieldLabels?.[item.value] : null;
    pair.append(element("span", "", label || (item.value === "" ? '\"\"' : item.value)));
    wrap.append(pair);
  }
  if (node.text?.trim()) display(node.text);
  for (const child of node.children || []) {
    const branch = element("span", "setting-branch");
    if (!(kind === "GROUP_IN_FILTER" && child.name === "GROUP")) branch.append(element("span", "setting-key", detailLabels[child.name] || titleCase(child.name)));
    branch.append(readableValue(child, showIdentifiers));
    branch.append(metadata(factLabel(child.name), child, { compact: true }));
    wrap.append(branch);
  }
  wrap.append(...(node.externalExpressions || []).map(externalNotice));
  if (!wrap.childNodes.length) wrap.append(empty(["GROUP", "SEGMENT"].includes(kind) ? "Unnamed " + kind.toLowerCase() : "No value exported"));
  return wrap;
}
function readableElement(node) {
  const row = element("div", "setting-item");
  const label = element("span", "setting-label", detailLabels[node.name] || titleCase(node.name));
  label.replaceChildren(metadata(factLabel(node.name), node, { labelText: label.textContent }));
  row.append(label, readableValue(node, true));
  return row;
}
function absentSection(id, title, message = "None exported") {
  return section(id, title, message, [empty(message)], false, `${id}:empty`);
}
function usesDefaultTiming(node) {
  const value = (node.attributes || []).find(item => item.name.toUpperCase() === "USE_DEFAULT")?.value;
  return !node.externalExpressions?.length && ["true", "1", "yes"].includes(value?.trim().toLowerCase());
}
function factLabel(name) {
  const labels = { START_CLASS: "Start", OCCURENCE: "Occurrence", ONSTART: "On start", USE_DEFAULT: "Use defaults" };
  return detailLabels[name.toUpperCase()] || labels[name.toUpperCase()] || name.toLowerCase().replace(/[_-]+/g, " ").replace(/^\w/, c => c.toUpperCase()).replace(/\b(id|guid|uuid)\b/gi, value => value.toUpperCase());
}
function displayFactValue(value) {
  return value === "true" ? "Yes" : value === "false" ? "No" : value === "" ? "Not set" : value;
}
function fact(label, content, secondary = false) {
  const field = element("div", `detail-fact${secondary ? " secondary-fact" : ""}`);
  const value = element("dd", "fact-value");
  value.append(typeof content === "string" ? document.createTextNode(displayFactValue(content)) : content);
  field.append(element("dt", "fact-label", label), value);
  return field;
}
function metric(value, unit) {
  const content = element("span", "metric");
  content.append(element("span", "metric-number", displayFactValue(value)));
  if (unit !== undefined) content.append(document.createTextNode(" "), element("span", "metric-unit", unit));
  return content;
}
function inlineIdentifier(label, value) {
  const content = element("span", "inline-identifier");
  content.append(element("span", "identifier-label", label), element("span", "identifier-value", value === "" ? '""' : value));
  return content;
}
function leafFact(node) {
  if (node.children?.length || node.externalExpressions?.length || node.text?.trim()) return null;
  const attributes = (node.attributes || []).filter(attribute => !isIdentifier(attribute));
  const values = attributes.filter(attribute => attribute.name.toUpperCase() !== "UNIT");
  if (values.length !== 1) return null;
  const value = values[0];
  const unit = attributes.find(attribute => attribute.name.toUpperCase() === "UNIT");
  const name = value.name.toUpperCase();
  const label = factLabel(node.name) + (["VALUE", "CLASS"].includes(name) ? "" : " · " + factLabel(value.name));
  const content = metric(value.value, unit?.value);
  for (const attribute of (node.attributes || []).filter(isIdentifier)) content.append(inlineIdentifier(factLabel(attribute.name), attribute.value));
  const field = fact(label, content);
  field.querySelector("dt").replaceChildren(metadata(label, node, { labelText: label }));
  return field;
}
// Lay out the exported structure without inferring units or schedule behavior.
function exportedFields(node, omitted = []) {
  const fields = element("dl", "detail-fields");
  for (const attribute of node.attributes || []) {
    if (omitted.includes(attribute.name.toUpperCase())) continue;
    fields.append(fact(factLabel(attribute.name), attribute.value, isIdentifier(attribute) || attribute.name.toUpperCase() === "USE_DEFAULT"));
  }
  if (node.text?.trim()) fields.append(fact("Value", node.text));
  for (const child of node.children || []) {
    const leaf = leafFact(child);
    if (leaf) { fields.append(leaf); continue; }
    const group = fact(factLabel(child.name), exportedFields(child));
    group.classList.add("detail-group");
    group.querySelector("dt").classList.add("detail-group-label");
    fields.append(group);
  }
  for (const path of node.externalExpressions || []) fields.append(externalNotice(path));
  if (!fields.childNodes.length) fields.append(empty("No settings exported"));
  return fields;
}
function actionBlock(action, raw) {
  const block = element("div", "action-block");
  const heading = element("div", "action-heading");
  heading.append(element("h3", "action-title", action.label || "Unnamed action"));
  heading.append(metadata(action.label || "Unnamed action", { name: "ACTION", attributes: raw?.attributes, children: raw?.extensions }, { compact: true }));
  heading.append(element("span", `badge ${action.disabled ? "disabled" : "enabled"}`, action.disabled ? "Disabled" : "Enabled"));
  const content = element("div", "action-content");
  const parameters = element("dl", "action-parameters detail-fields");
  for (const parameter of action.parameters || []) {
    const value = element("span", "action-value");
    if (parameter.value !== "" || !parameter.children?.length) value.append(element("span", "", displayFactValue(parameter.value)));
    if (parameter.referenceId) value.append(inlineIdentifier("ID", parameter.referenceId));
    const original = raw?.parameters?.[parameter.sourceIndex];
    value.append(...identifiers(original?.attributes));
    for (const child of parameter.children || []) value.append(readableValue(child, true));
    const field = fact(parameter.label, value, parameter.secondary);
    if (original) field.querySelector("dt").replaceChildren(metadata(`${action.label} · ${parameter.label}`, { name: "PARAM", attributes: original.attributes, text: original.text, children: original.children }, { labelText: parameter.label }));
    if (parameter.primary) field.classList.add("primary-fact");
    parameters.append(field);
  }
  for (const attribute of action.identifiers || []) parameters.append(fact(factLabel(attribute.name), attribute.value, true));
  parameters.querySelector(".secondary-fact")?.classList.add("metadata-start");
  if (parameters.childNodes.length) content.append(parameters);
  for (const schedule of action.schedules || []) {
    const row = element("div", "action-schedule");
    const label = element("div", "schedule-label");
    label.append(metadata(`${action.label} · Schedule`, schedule, { labelText: "Schedule" }));
    row.append(label, exportedFields(schedule));
    content.append(row);
  }
  block.append(heading, content);
  return block;
}
function timingRow(timer) {
  const row = element("div", "timing-row");
  const title = element("span", "timing-title");
  title.append(metadata(factLabel(timer.name), timer, { labelText: factLabel(timer.name) }));
  row.append(title);
  const content = element("div", "timing-content");
  const value = (timer.attributes || []).find(attribute => attribute.name.toUpperCase() === "VALUE");
  const unit = (timer.attributes || []).find(attribute => attribute.name.toUpperCase() === "UNIT");
  if (value) {
    const primary = element("div", "timing-value");
    primary.append(metric(value.value, unit?.value));
    content.append(primary);
  }
  const fields = exportedFields(timer, value ? ["VALUE", "UNIT"] : []);
  fields.querySelector(".secondary-fact")?.classList.add("metadata-start");
  if (fields.querySelector(".detail-fact, .detail-group, .external-notice")) content.append(fields);
  else if (!value) content.append(empty("No settings exported"));
  row.append(content);
  return row;
}
function ruleMetadata(rule) {
  const attributes = [...(rule.attributes || [])];
  if (!attributes.some(attribute => attribute.name === "ID" && !attribute.namespace)) attributes.unshift({ name: "ID", value: rule.id });
  const facts = [];
  if (rule.parentId) facts.push({ name: "Parent rule ID", value: rule.parentId });
  else if (rule.parent) facts.push({ name: "Parent node", value: rule.parent });
  if (rule.enabledSpecified) facts.push({ name: "Declared enabled", value: rule.enabled });
  if (rule.effectiveEnabled !== undefined) facts.push({ name: "Effective enabled", value: rule.effectiveEnabled });
  const notes = rule.kind === "folder" ? [] : (state.document?.diagnostics || []).filter(note => note.ruleId === rule.id).map(note => note.message);
  return { name: rule.kind === "folder" ? "POLICY_FOLDER" : "RULE", attributes, facts, children: rule.extensions, externalExpressions: rule.externalExpressions, notes };
}
function policyIdentity(rule) {
  return button(`ID ${rule.id}`, "policy-identity inline-identifier", () => copyID(rule.id), "Copy policy ID");
}
function renderRule(detail) {
  closeMetadata(false);
  segmentBrowser.unmount();
  const view = detail.view;
  const rule = view.rule;
  const crumb = detail.breadcrumb.map((node, i) => {
    const fragment = document.createDocumentFragment();
    if (i) fragment.append(element("span", "", "/"));
    fragment.append(i === detail.breadcrumb.length - 1 ? element("span", "", node.name) : button(node.name, "", () => selectNode(`${node.kind}:${node.id}`)));
    return fragment;
  });
  $("breadcrumb").replaceChildren(...crumb);
  const header = element("div", "rule-header");
  const titles = element("div", "rule-titles");
  const title = element("div", "rule-title-line");
  title.append(element("h2", "", rule.name || "Unnamed policy"), enabledBadge(rule), policyIdentity(rule), metadata(rule.name || "Unnamed policy", ruleMetadata(rule), { compact: true }));
  titles.append(title);
  if (rule.description) titles.append(element("p", "rule-description", rule.description));
  const actions = element("div", "rule-header-actions");
  const pin = button(state.pins.has(rule.id) ? "★ Pinned" : "☆ Pin policy", "quiet small", () => togglePin(rule.id));
  pin.id = "detail-pin";
  actions.append(pin); header.append(titles, actions);

  const scope = (rule.scope || []).map(readableElement);
  const segmentHost = view.segments?.count ? element("div", "segment-overview") : null;
  if (segmentHost) scope.push(segmentHost);
  const sections = [scope.length ? section("scope", "Scope & Filters", "", scope) : absentSection("scope", "Scope & Filters")];
  const logicContent = [...(rule.externalExpressions || []).map(externalNotice), conditionView(view.logic, rule.expression, view.layout)];
  const count = conditionCount(view.logic);
  sections.push(section("main-rule", "Conditions", count ? `${count} condition${count === 1 ? "" : "s"}` : "", logicContent));
  const subrules = [];
  function appendSubrules(children, depth) {
    for (const child of children || []) {
      const block = element("div", "subrule");
      const heading = element("div", "subrule-heading");
      heading.append(button(`${depth ? "↳ " : ""}${child.rule.name}`, "", () => { revealAncestors(`rule:${child.rule.id}`); selectNode(`rule:${child.rule.id}`); }), enabledBadge(child.rule));
      heading.append(policyIdentity(child.rule), metadata(child.rule.name, ruleMetadata(child.rule), { compact: true }));
      block.append(heading);
      block.append(...(child.rule.externalExpressions || []).map(externalNotice), conditionView(child.logic, child.rule.expression, child.layout));
      subrules.push(block);
      appendSubrules(child.children, depth + 1);
    }
  }
  appendSubrules(view.children, 0);
  if (subrules.length) sections.push(section("sub-rules", "Sub Rules", `${subrules.length} rules`, subrules, false));
  const actionRows = (view.actions || []).map((action, index) => actionBlock(action, rule.actions?.[index]));
  sections.push(actionRows.length ? section("actions", "Actions", `${actionRows.length} action${actionRows.length === 1 ? "" : "s"}`, actionRows) : absentSection("actions", "Actions"));
  const timers = (rule.timers || []).filter(timer => !usesDefaultTiming(timer));
  if (timers.length) {
    const grid = element("div", "timing-grid");
    grid.append(...timers.map(timingRow));
    sections.push(section("timers", "Timers & Admissions", "", [grid]));
  }
  else if (rule.timers?.length) sections.push(absentSection("timers", "Timers & Admissions", "Using defaults"));
  const defaults = (rule.timers || []).filter(usesDefaultTiming);
  if (defaults.length) sections.find(node => node.dataset.section === "timers").querySelector("summary").append(metadata("Default timers and admissions", { name: "Default timing", children: defaults }));
  if (rule.attributes?.length) {
    const table = element("table", "raw-attributes");
    const body = element("tbody");
    for (const attribute of rule.attributes) {
      const row = element("tr");
      const name = element("th", "", attribute.namespace ? `{${attribute.namespace}}${attribute.name}` : attribute.name);
      name.scope = "row";
      row.append(name, element("td", "", shown(attribute.value)));
      body.append(row);
    }
    table.append(body);
    sections.push(section("attributes", "Attributes", `${rule.attributes.length} attribute${rule.attributes.length === 1 ? "" : "s"}`, [table]));
  }
  $("details").replaceChildren(header, ...sections);
  if (segmentHost) segmentBrowser.mount(segmentHost, rule.id, view.segments);
  $("details").scrollTop = 0;
}

function renderFolder(node) {
  closeMetadata(false);
  segmentBrowser.unmount();
  const header = element("div", "rule-header");
  const title = element("div", "rule-title-line");
  title.append(element("h2", "", node.name), policyIdentity(node), metadata(node.name, ruleMetadata(node), { compact: true }));
  header.append(title);
  const contents = (state.children.get(node.key) || []).map(child => button(child.name, "quiet", () => { state.expanded.add(node.key); selectNode(child.key); }));
  $("breadcrumb").replaceChildren(element("span", "", "Policy folder"));
  $("details").replaceChildren(header, section("contents", "Contents", `${contents.length} items`, contents.length ? contents : [empty("This folder is empty.")]));
}
function renderEmpty(message) { segmentBrowser.unmount(); latestDetail = null; state.detailRequest++; $("breadcrumb").replaceChildren(); $("details").replaceChildren(element("div", "empty-detail", message)); }
async function copyID(id) { try { await bridge.copy(id); status("Policy ID copied"); } catch (cause) { error(cause); } }
function clearSearch() { groupChoice = null; groupPicker.close(); for (const id of Object.values(fields)) $(id).value = ""; populateActionValues(); clearTimeout(searchTimer); refreshSearch(false); }
function jumpResult(delta) {
  if (!state.matches.length) return;
  const current = state.byKey.get(state.selectedKey)?.id;
  const index = state.matches.indexOf(current);
  const next = (index + delta + state.matches.length) % state.matches.length;
  const key = `rule:${state.matches[next]}`;
  revealAncestors(key); selectNode(key, true);
}

$("open-button").addEventListener("click", openPolicy);
$("file-input").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 64 * 1024 * 1024) throw new Error("Policy export exceeds 64 MiB."); status("Loading policy definitions…"); await installDocument(await bridge.import(file.name, await file.text())); }
  catch (cause) { error(cause); }
  event.target.value = "";
});
$("search-form").addEventListener("submit", event => { event.preventDefault(); clearTimeout(searchTimer); refreshSearch(); });
for (const id of Object.values(fields)) $(id).addEventListener("input", () => { if (id === "group-search") groupChoice = null; if (id === "action-search") populateActionValues(); clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshSearch(), 140); });
$("filter-toggle").addEventListener("click", () => {
  const open = $("filter-panel").hidden;
  setFiltersOpen(open);
  if (open) focusFilter("property-search");
});
$("clear-search").addEventListener("click", clearSearch); $("reset-search").addEventListener("click", clearSearch);
$("previous-result").addEventListener("click", () => jumpResult(-1)); $("next-result").addEventListener("click", () => jumpResult(1));
$("expand-all").addEventListener("click", () => { state.expanded = new Set(state.byKey.keys()); renderTree(); });
$("collapse-all").addEventListener("click", () => { state.expanded.clear(); renderTree(); });
for (const [id, open] of [["expand-sections", true], ["collapse-sections", false]]) $(id).addEventListener("click", () => {
  for (const node of $("details").querySelectorAll(":scope > .rule-section")) {
    node.open = open;
    state.sections.set(node.dataset.sectionState, open);
  }
});
$("help-button").addEventListener("click", () => $("help-dialog").showModal()); $("close-help").addEventListener("click", () => $("help-dialog").close());
$("dismiss-error").addEventListener("click", () => { $("error-banner").hidden = true; });

function focusTree() {
  const row = [...$("tree").querySelectorAll(".tree-row")].find(row => row.dataset.key === state.selectedKey);
  (row || $("tree-scroll")).focus({ preventScroll: true });
  row?.scrollIntoView({ block: "nearest" });
}
function focusDetails() {
  if (segmentBrowser.isOpen) { segmentBrowser.focus(); return; }
  (lastDetailFocus?.isConnected && $("details").contains(lastDetailFocus) ? lastDetailFocus : $("details")).focus({ preventScroll: true });
}
function setFiltersOpen(open) {
  $("filter-panel").hidden = !open;
  $("filter-toggle").setAttribute("aria-expanded", String(open));
  if (!open) groupPicker.close();
}
function focusFilter(id) {
  segmentBrowser.close(false);
  setFiltersOpen(true);
  $(id).focus(); $(id).select();
  $(id).scrollIntoView({ block: "nearest" });
}
document.addEventListener("focusin", event => { if ($("details").contains(event.target)) lastDetailFocus = event.target; });

document.addEventListener("keydown", event => {
  if (event.defaultPrevented || event.isComposing || $("help-dialog").open || metadataOpen()) return;
  const target = document.activeElement;
  const editing = /INPUT|TEXTAREA|SELECT/.test(target?.tagName || "") || target?.isContentEditable;
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "h") { event.preventDefault(); segmentBrowser.close(false); groupPicker.close(); focusTree(); return; }
    if (key === "l") { event.preventDefault(); groupPicker.close(); focusDetails(); return; }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); openPolicy(); return; }
  if (segmentBrowser.isOpen) return; // The modal inspector owns its navigation.
  if (event.key === "Escape") { event.preventDefault(); setFiltersOpen(false); focusTree(); return; }
  const filterFields = Object.values(fields);
  const filterIndex = filterFields.indexOf(target?.id);
  if (filterIndex >= 0) {
    if (event.key === "Tab") {
      event.preventDefault();
      focusFilter(filterFields[(filterIndex + (event.shiftKey ? filterFields.length - 1 : 1)) % filterFields.length]);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") { event.preventDefault(); clearSearch(); return; }
    if (event.key === "Enter") {
      event.preventDefault(); groupPicker.close(); clearTimeout(searchTimer); refreshSearch().then(focusTree); return;
    }
  }
  if (editing) return;
  const node = state.byKey.get(state.selectedKey);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !window.getSelection()?.toString() && node?.kind !== "folder") { event.preventDefault(); if (node) copyID(node.id); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "/") { event.preventDefault(); focusFilter("text-search"); return; }
  if (event.key === "?") { event.preventDefault(); $("help-dialog").showModal(); return; }
  if (event.key === "n" || event.key === "N") { event.preventDefault(); jumpResult(event.key === "N" ? -1 : 1); return; }
  if (event.key.toLowerCase() === "p" && node?.kind !== "folder") { event.preventDefault(); if (node) togglePin(node.id); return; }
  if (target?.closest(".detail-panel")) {
    const panel = $("details"), summary = target.closest("summary");
    if (["[", "]"].includes(event.key)) {
      event.preventDefault();
      const summaries = [...panel.querySelectorAll(":scope > .rule-section > summary")];
      const index = summaries.indexOf(summary);
      const next = index < 0 ? (event.key === "]" ? 0 : summaries.length - 1) : Math.max(0, Math.min(summaries.length - 1, index + (event.key === "]" ? 1 : -1)));
      summaries[next]?.focus({ preventScroll: true }); summaries[next]?.scrollIntoView({ block: "nearest" }); return;
    }
    if (["j", "k", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home") panel.scrollTop = 0;
      else if (event.key === "End") panel.scrollTop = panel.scrollHeight;
      else panel.scrollBy({ top: ["j", "ArrowDown", "PageDown"].includes(event.key) ? (event.key === "PageDown" ? panel.clientHeight * .85 : 45) : -(event.key === "PageUp" ? panel.clientHeight * .85 : 45) });
      return;
    }
    if (summary && ["h", "l", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); summary.parentElement.open = ["l", "ArrowRight"].includes(event.key); }
    return; // Enter, Space and Tab retain their native control behavior.
  }
  if (!target?.closest(".tree-scroll")) return;
  if (target.closest("button") && ["Enter", " "].includes(event.key)) return;
  if (["j", "k", "ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault(); const delta = ["j", "ArrowDown"].includes(event.key) ? 1 : -1;
    const next = Math.max(0, Math.min(state.rows.length - 1, state.rows.indexOf(state.selectedKey) + delta));
    if (state.rows[next]) selectNode(state.rows[next], true); return;
  }
  if (["h", "l", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key) && node) {
    event.preventDefault(); const children = state.children.get(node.key) || [];
    if (event.key === "Enter") { focusDetails(); return; }
    if (["h", "ArrowLeft"].includes(event.key)) {
      if (state.expanded.has(node.key) && children.length) { state.expanded.delete(node.key); renderTree(); }
      else if (node.parent) selectNode(node.parent, true);
    } else if (children.length) {
      if (!state.expanded.has(node.key)) { state.expanded.add(node.key); renderTree(); }
      else selectNode(children[0].key, true);
    }
  }
});

$("remember-policy").addEventListener("change", async () => {
  const enabled = $("remember-policy").checked;
  $("remember-policy").disabled = true;
  try {
    await preferenceQueue;
    preferences = await bridge.remember(enabled);
  } catch (cause) { error(cause); }
  showRememberState();
});
for (const control of document.querySelectorAll("[data-condition-view]")) control.addEventListener("click", () => {
  conditionMode = control.dataset.conditionView;
  for (const item of document.querySelectorAll("[data-condition-view]")) item.setAttribute("aria-pressed", String(item.dataset.conditionView === conditionMode));
  if (latestDetail) renderRule(latestDetail);
});
async function initializeUpdates() {
  if (!bridge.isDesktop()) { $("build-info").textContent = "Browser preview · dev"; return; }
  try {
    const info = await bridge.buildInfo();
    $("build-info").textContent = info.enabled ? `Version ${info.version} · checking GitHub releases` : `Version ${info.version} · update checks disabled`;
    const release = await bridge.checkUpdate();
    if (info.enabled) $("build-info").textContent = `Version ${info.version} · GitHub release notifications enabled`;
    if (!release) return;
    $("update-message").textContent = `Polisee ${release.version} is available. You’re running ${info.version}.`;
    $("update-banner").hidden = false;
    $("update-release").addEventListener("click", async () => { try { await bridge.openRelease(release.url); } catch (cause) { error(cause); } });
    $("update-dismiss").addEventListener("click", async () => {
      $("update-banner").hidden = true;
      try { await bridge.dismissUpdate(release.version); } catch { /* Advisory only. */ }
    });
  } catch { /* Update availability never blocks offline policy use. */ }
}
try {
  const startup = await bridge.initialize();
  let zoom = startup.preferences?.zoom || 1;
  if (!bridge.isDesktop()) { try { zoom = localStorage.getItem("polisee.prototype.zoom") || 1; } catch { /* Session zoom still works. */ } }
  initZoom({ initial: zoom, save: async value => {
    if (bridge.isDesktop()) await bridge.zoom(value);
    else { try { localStorage.setItem("polisee.prototype.zoom", String(value)); } catch { /* Session zoom still works. */ } }
  }, onError: cause => error(cause) });
  await installDocument(startup);
} catch (cause) { error(cause); }
void initializeUpdates();
