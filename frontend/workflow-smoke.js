// Fabricated data only. Imported by the native smoke check and local visual QA.
export function browseFixture(segments = 24, ranges = 1200) {
  const parts = ['<POLICY_FOLDER ID="f" NAME="Fabricated policies"><RULE ID="bulk" NAME="Segment browsing" DESCRIPTION="Fabricated policy for large range collections.">',
    '<GROUP_IN_FILTER><GROUP ID="staff-1" NAME="Office devices"/><GROUP ID="staff-2" NAME="Office devices"/><GROUP ID="id-only"/></GROUP_IN_FILTER>',
    '<EXPRESSION EXPR_TYPE="SIMPLE"><CONDITION FIELD_NAME="device.os" LABEL="Operating system"><FILTER TYPE="equals"><VALUE VALUE="Example OS"/></FILTER></CONDITION></EXPRESSION>',
    '<ACTION NAME="ADD_TO_GROUP"><PARAM NAME="group-name" VALUE="id:media-1;name:Media devices"/><PARAM NAME="group" VALUE="raw-id-only"/></ACTION>'];
  for (let segment = 0; segment < segments; segment++) {
    parts.push(`<SEGMENT NAME="Segment ${String(segment).padStart(2, "0")}" ID="segment-${segment}" NOTE="&lt;literal&gt;"><RANGES LABEL="Original wrapper">`);
    for (let row = 0; row < ranges; row++) parts.push(`<RANGE ID="range-${segment}-${row}" FROM="10.${segment}.${Math.floor(row / 254)}.${row % 254}" TO="10.${segment}.${Math.floor(row / 254)}.${row % 254 + 1}"${row === 0 ? ' CUSTOM="&lt;img src=x&gt;"' : ""}/>`);
    parts.push("</RANGES></SEGMENT>");
  }
  parts.push('<INNER_RULE ID="child" NAME="Guest access"><GROUP_IN_FILTER><GROUP ID="staff-2" NAME="Office devices"/></GROUP_IN_FILTER></INNER_RULE></RULE></POLICY_FOLDER>');
  return parts.join("");
}

export async function verifyWorkflow(restoreDemo) {
  const $ = id => document.getElementById(id);
  const assert = (valid, message) => { if (!valid) throw new Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  async function until(check, message) {
    const deadline = Date.now() + 8000;
    while (!check()) { assert(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 15)); }
    await frame();
  }
  const key = (value, modifiers = {}) => {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers });
    (document.activeElement || document).dispatchEvent(event);
    return event;
  };
  const input = (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); };
  async function importXML(text, expected) {
    const transfer = new DataTransfer(); transfer.items.add(new File([text], "fabricated-smoke.xml", { type: "application/xml" }));
    $("file-input").files = transfer.files; $("file-input").dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => $("details").querySelector("h2")?.textContent === expected, `Could not load ${expected}`);
  }
  async function policy(id, name) {
    document.querySelector(`#tree [data-key="rule:${id}"]`).click();
    await until(() => $("details").querySelector("h2")?.textContent === name, `Could not inspect ${name}`);
  }
  function pageButton(host, label) { return [...host.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === label); }
  await importXML(`<POLICY_FOLDER ID="ordering" NAME="Ordering examples"><POLICIES>
    <POLICY><RULE ID="second" NAME="1.1.02 Device discovery"><RULE_CHAIN><INNER_RULE ID="z" NAME="Z step"/><INNER_RULE ID="a" NAME="A step"/></RULE_CHAIN></RULE></POLICY>
    <POLICY><RULE ID="tenth" NAME="1.1.10 Extended discovery"/></POLICY>
    <POLICY><RULE ID="first" NAME="1.1.01 Network discovery"/></POLICY>
  </POLICIES></POLICY_FOLDER>`, "1.1.02 Device discovery");
  const policyOrder = () => [...$("tree").querySelectorAll('.tree-row[data-key^="rule:"]')].map(row => row.dataset.key).join(",");
  assert(policyOrder() === "rule:first,rule:second,rule:z,rule:a,rule:tenth", "Policy names are not in numeric order or subrule order changed");
  input($("text-search"), "discovery");
  await until(() => $("search-status").textContent === "3 matching rules" && $("details").querySelector("h2")?.textContent === "1.1.01 Network discovery", "Search did not select the first displayed match");
  $("next-result").click();
  await until(() => $("details").querySelector("h2")?.textContent === "1.1.02 Device discovery", "Next result does not follow displayed policy order");
  $("next-result").click();
  await until(() => $("details").querySelector("h2")?.textContent === "1.1.10 Extended discovery", "Numeric result ordering failed");
  $("previous-result").click();
  await until(() => $("details").querySelector("h2")?.textContent === "1.1.02 Device discovery", "Previous result does not follow displayed policy order");

  const fixture = browseFixture();
  await importXML(fixture, "Segment browsing");
  await until(() => document.querySelectorAll(".segment-table tbody tr button").length === 8, "Segment overview is not limited to eight rows");
  assert(!$("details").textContent.includes("range-23-1199"), "Unopened ranges were sent into the policy DOM");

  $("details").focus(); key("/");
  assert(document.activeElement === $("text-search") && !$("filter-panel").hidden, "/ does not reveal the combined filters");
  for (const id of ["property-search", "group-search", "action-search", "action-value-search", "text-search"]) {
    key("Tab");
    assert(document.activeElement === $(id) && $(id).value === "", `Tab cannot reach ${id} without accepting a suggestion`);
    const selected = document.querySelector('#tree [aria-selected="true"]')?.dataset.key;
    assert(["h", "j", "k", "l"].every(value => !key(value).defaultPrevented) && document.activeElement === $(id) && document.querySelector('#tree [aria-selected="true"]')?.dataset.key === selected, `Vim navigation intercepts typing in ${id}`);
  }
  key("Tab"); key("Tab");
  input($("group-search"), "Office");
  const options = [...$("group-options").querySelectorAll('[role="option"]')];
  assert(options.length === 2 && options.every(node => node.querySelector(".group-option-name").textContent === "Office devices"), "Group picker is mixing names, standalone IDs or encoded values");
  assert(options[0].textContent.includes("staff-1") && options[1].textContent.includes("staff-2"), "Same-name groups cannot be distinguished");
  key("ArrowDown"); key("Enter");
  await until(() => $("filter-chips").textContent.includes("Office devices") && $("filter-chips").textContent.includes("staff-1"), "Keyboard group selection was not applied");
  input($("group-search"), "raw-id-only");
  await until(() => $("filter-chips").textContent.includes("raw-id-only") && $("search-status").textContent === "1 matching rule" && $("details").querySelector("h2")?.textContent === "Segment browsing", "Typed group IDs stopped matching");
  $("clear-search").click();
  await until(() => $("search-status").textContent === "All policies", "Could not clear group filter");
  key("h", { altKey: true }); key("/"); key("Tab");
  input($("property-search"), "device.os"); key("Tab");
  input($("group-search"), "staff-1"); key("Tab");
  input($("action-search"), "ADD_TO_GROUP"); key("Tab");
  input($("action-value-search"), "Media devices"); key("Enter");
  await until(() => $("search-status").textContent === "1 matching rule" && document.activeElement?.dataset.key === "rule:bulk", "Combined filters cannot be applied using /, Tab and Enter");
  $("clear-search").click();
  await until(() => $("search-status").textContent === "All policies", "Could not clear combined filters");
  key("h", { altKey: true });
  assert(document.activeElement?.dataset.key === "rule:bulk", "Alt+H does not focus the selected policy");
  key("j");
  await until(() => $("details").querySelector("h2")?.textContent === "Guest access", "j did not navigate down the tree");
  key("k");
  await until(() => $("details").querySelector("h2")?.textContent === "Segment browsing", "k did not navigate up the tree");
  key("ArrowDown");
  await until(() => $("details").querySelector("h2")?.textContent === "Guest access", "Tree keyboard navigation stopped working");
  key("l");
  assert(document.activeElement?.dataset.key === "rule:child" && !document.querySelector(".context-popover"), "l on a leaf opened details or an inspector");
  key("l", { altKey: true });
  assert($("details").contains(document.activeElement) || document.activeElement === $("details"), "Alt+L does not focus details");
  assert(key("j").defaultPrevented && key("k").defaultPrevented, "j/k do not navigate the focused details pane");
  assert(document.querySelector('#tree [aria-selected="true"]').dataset.key === "rule:child", "Detail navigation changed policy selection");
  key("h", { altKey: true }); key("ArrowUp");
  await until(() => $("details").querySelector("h2")?.textContent === "Segment browsing", "Could not navigate back to the bulk policy");
  await until(() => document.querySelectorAll(".segment-table tbody tr button").length === 8, "Segment overview did not return");
  key("l", { altKey: true }); key("]");
  assert(document.activeElement?.parentElement.dataset.section === "scope", "Section jump does not focus the first heading");
  key("ArrowLeft"); assert(!document.activeElement.parentElement.open, "Left arrow did not collapse the focused section");
  key("ArrowRight"); assert(document.activeElement.parentElement.open, "Right arrow did not expand the focused section");
  key("h"); assert(!document.activeElement.parentElement.open, "h did not collapse the focused section");
  key("l"); assert(document.activeElement.parentElement.open && !document.querySelector(".context-popover"), "l did not expand the focused section");
  assert(!key("Enter").defaultPrevented && !key(" ").defaultPrevented && !key("Tab").defaultPrevented, "Details intercept native activation or Tab traversal");
  document.querySelector('[data-section="scope"]').open = true;
  await frame();
  $("details").focus({ preventScroll: true }); const endEvent = key("End");
  try {
    await until(() => Math.abs($("details").scrollTop - ($("details").scrollHeight - $("details").clientHeight)) <= 2, "Details cannot be scrolled to their end with the keyboard");
  } catch (cause) {
    throw new Error(`${cause.message}; focus=${document.activeElement?.id}; handled=${endEvent.defaultPrevented}; scroll=${$("details").scrollTop}; maximum=${$("details").scrollHeight - $("details").clientHeight}`);
  }
  key("Home");
  await until(() => $("details").scrollTop < 1, "Home does not return to the start of details");

  input(document.querySelector(".segment-search"), "Segment 1");
  await until(() => document.querySelector(".segment-overview .browse-pager")?.textContent.includes("of 10 segments"), "Segment name filtering failed");
  pageButton(document.querySelector(".segment-overview"), "Next segment page").click();
  await until(() => document.querySelectorAll(".segment-table tbody tr button").length === 2, "Segment paging did not limit the last page");
  const scope = document.querySelector('[data-section="scope"]'), height = scope.getBoundingClientRect().height;
  document.querySelector('.segment-table button[data-segment-key="18"]').click();
  await until(() => $("range-inspector").open && $("range-scroll").querySelectorAll("tr[data-range-index]").length === 25, "Range inspector is not limited to 25 rows");
  assert($("range-title").textContent === "Segment 18" && $("range-segment-id").textContent.includes("segment-18") && $("range-segment-count").textContent.includes("1,200"), "Inspector header is missing identity or counts");
  assert(scope.getBoundingClientRect().height === height, "Opening ranges expanded the policy page");
  assert(!key("j").defaultPrevented && !key("k").defaultPrevented && document.activeElement === $("range-search"), "Vim navigation intercepts typing in the range filter");
  $("range-scroll").focus();
  assert(key("j").defaultPrevented && key("k").defaultPrevented, "j/k do not navigate the range inspector");
  assert($("range-scroll").textContent.includes("range-18-0") && !$("range-scroll").textContent.includes("range-18-1199"), "Range pages are unbounded or IDs are hidden");
  pageButton($("range-pager"), "Next range page").click();
  await until(() => $("range-scroll").querySelector('tr[data-range-index="25"]'), "Range paging did not advance");
  $("range-scroll").scrollTop = 80; await frame();
  const scroll = $("range-scroll").scrollTop;
  $("next-segment").click();
  await until(() => $("range-title").textContent === "Segment 19" && $("range-scroll").querySelector('tr[data-range-index="0"]'), "Could not switch segments");
  $("previous-segment").click();
  await until(() => $("range-title").textContent === "Segment 18" && $("range-scroll").querySelector('tr[data-range-index="25"]'), "Range page was not remembered");
  assert(Math.abs($("range-scroll").scrollTop - scroll) <= 1, "Range scroll position was not remembered");
  input($("range-search"), "range-18-1199");
  await until(() => $("range-scroll").querySelectorAll("tr[data-range-index]").length === 1 && $("range-scroll").querySelector('tr[data-range-index="1199"]'), "Range ID search failed");
  assert($("range-pager").textContent.includes("1 ranges") && $("range-pager").textContent.includes("1,200 total"), "Filtered and total range counts are not distinguished");
  input($("range-search"), "");
  await until(() => $("range-scroll").querySelector('tr[data-range-index="0"]'), "Could not reset the range search");
  const rangeRow = $("range-scroll").querySelector("tr[data-range-index]"), rowHeight = rangeRow.getBoundingClientRect().height;
  const rangeToggle = $("range-inspector").querySelector("[data-diagnostics-toggle]");
  rangeToggle.click();
  assert(rangeToggle.getAttribute("aria-pressed") === "false" && getComputedStyle(rangeRow.querySelector(".element-diagnostics")).visibility === "hidden", "Inspector diagnostics do not follow the shared toggle");
  assert(rangeRow.getBoundingClientRect().height === rowHeight, "Hiding range fields changes row heights");
  rangeToggle.click();
  assert(rangeRow.getBoundingClientRect().height === rowHeight, "Revealing range fields expands the table");
  $("range-scroll").querySelector(".range-extra button").click();
  const fields = document.querySelector(".context-popover[open]");
  assert(fields?.textContent.includes("<img src=x>") && !fields.querySelector("img") && !$("range-scroll").querySelector(".range-raw"), "Exported range fields are lost, unsafe or expanding the table");
  fields.dispatchEvent(new Event("cancel", { cancelable: true }));
  assert($("range-inspector").open && document.activeElement === rangeRow.querySelector(".element-diagnostics"), "Closing range fields does not retain inspector context");
  $("range-metadata").querySelector("button").click();
  assert(document.querySelector(".context-popover")?.textContent.includes("<literal>"), "Segment fields are not accessible beside the segment heading");
  document.querySelector(".context-popover").dispatchEvent(new Event("cancel", { cancelable: true }));
  const rect = $("range-inspector").getBoundingClientRect();
  assert(rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, "Inspector extends outside the native window");
  $("range-inspector").dispatchEvent(new Event("cancel", { cancelable: true }));
  assert(!$("range-inspector").open && document.activeElement?.dataset.segmentKey === "18", "Closing the inspector does not restore segment focus");
  await policy("child", "Guest access"); await policy("bulk", "Segment browsing");
  await until(() => document.querySelectorAll(".segment-table tbody tr button").length === 2, "Segment overview page was not remembered per policy");
  assert(document.querySelector(".segment-search").value === "Segment 1", "Segment filter was not remembered");

  // A replaced document must invalidate browsing memory even when IDs repeat.
  const oldHost = document.querySelector(".segment-overview");
  await importXML(fixture, "Segment browsing");
  await until(() => document.querySelector(".segment-overview") !== oldHost && document.querySelectorAll(".segment-table tbody tr button").length === 8, "Reload did not reset document-specific browsing state");
  assert(document.querySelector(".segment-search").value === "", "A replaced document inherited old segment filters");

  await importXML(`<POLICY_FOLDER ID="fields-folder" NAME="Field examples" CUSTOM="folder value"><RULE ID="fields" NAME="Field ownership" DESCRIPTION="" CACHE_TTL="60" xmlns:x="urn:fixture" x:NOTE="&lt;img src=x&gt;">
    <EXPRESSION ID="expression-fields" EXPR_TYPE="AND"><CONDITION FIELD_NAME="device.os"><FILTER TYPE="equals"><VALUE VALUE="Example OS"/></FILTER></CONDITION></EXPRESSION>
    <ACTION ID="action-fields" NAME="ADD_TO_GROUP"><PARAM NAME="group-name" VALUE="" MARKER="empty target"/><PARAM ID="parameter-fields" NAME="group-name" VALUE="id:42;name:Office devices" MARKER="named target"/></ACTION>
    <INACTIVITY_TTL USE_DEFAULT="true" VALUE="0" CUSTOM="default timer"/>
    <FUTURE xmlns:x="urn:fixture" x:NOTE="&lt;img src=x&gt;" EMPTY=""><TEXT>  Exported
text  </TEXT></FUTURE>
  </RULE></POLICY_FOLDER>`, "Field ownership");
  const attributes = $("details").lastElementChild;
  const attributeValues = new Map([...attributes.querySelectorAll("tbody tr")].map(row => [row.querySelector("th").textContent, row.querySelector("td").textContent]));
  assert(attributes.dataset.section === "attributes" && attributes.open, "Rule attributes are not visible at the bottom of the policy");
  assert(attributeValues.get("DESCRIPTION") === '\"\"' && attributeValues.get("CACHE_TTL") === "60", "Empty or unfamiliar rule attributes were omitted");
  assert(attributeValues.get("{urn:fixture}NOTE") === "<img src=x>" && !attributes.querySelector("img"), "Namespaced rule attributes were lost or interpreted as markup");
  function localFields(control) {
    control.click();
    const popup = document.querySelector(".context-popover[open]");
    assert(popup, "Contextual fields did not open");
    return popup;
  }
  function closeFields(popup) { popup.dispatchEvent(new Event("cancel", { cancelable: true })); }
  const primaryParameter = $("details").querySelector(".primary-fact");
  assert(primaryParameter.textContent.includes("parameter-fields"), "Parameter IDs are not visible beside the value");
  $("diagnostics-toggle").click();
  const expressionID = [...$("details").querySelectorAll(".expression-content .inline-identifier")].find(node => node.textContent.includes("expression-fields"));
  assert(expressionID?.textContent.includes("expression-fields") && getComputedStyle(expressionID).visibility === "visible", "Expression IDs disappear with diagnostics hidden");
  $("diagnostics-toggle").click();
  let popup = localFields(primaryParameter.querySelector(".element-diagnostics"));
  assert(popup.textContent.includes("named target") && !popup.textContent.includes("empty target"), "Reordering parameters associates raw fields with the wrong parameter");
  closeFields(popup);
  popup = localFields($("details").querySelector(".secondary-fact .element-diagnostics"));
  assert(popup.textContent.includes("empty target") && [...popup.querySelectorAll(".context-field")].some(field => field.querySelector("dt").textContent === "VALUE" && field.querySelector("dd").textContent === '\"\"'), "An explicit empty parameter value was lost");
  closeFields(popup);
  const defaults = $("details").querySelector('[data-section="timers"]'), defaultHeight = defaults.getBoundingClientRect().height;
  assert(!defaults.open, "Default-only timings are no longer condensed");
  popup = localFields(defaults.querySelector(".element-diagnostics"));
  assert(popup.textContent.includes("INACTIVITY_TTL") && popup.textContent.includes("default timer"), "Default timing fields are unavailable alongside timings");
  closeFields(popup);
  assert(!defaults.open && defaults.getBoundingClientRect().height === defaultHeight, "Inspecting a default timer expands the policy layout");
  popup = localFields($("details").querySelector(".rule-header .element-diagnostics"));
  assert(popup.textContent.includes("{urn:fixture}NOTE") && popup.textContent.includes("<img src=x>") && !popup.querySelector("img"), "Namespaced extension fields were lost or interpreted as markup");
  assert([...popup.querySelectorAll("dd")].some(value => value.textContent === "  Exported\ntext  "), "Multiline exported text was changed");
  closeFields(popup);
  document.querySelector('#tree [data-key="folder:fields-folder"]').click();
  await until(() => $("details").querySelector("h2")?.textContent === "Field examples", "Folder fields cannot be reached");
  popup = localFields($("details").querySelector(".rule-header .element-diagnostics"));
  assert(popup.textContent.includes("folder value") && !$("details").querySelector('[data-section="folder-diagnostics"]'), "Folder fields still use a catch-all diagnostics section");
  closeFields(popup);

  const stateActions = '<ACTION NAME="DEFAULT_ACTION"/><ACTION NAME="ENABLED_ACTION" DISABLED="false"/><ACTION NAME="DISABLED_ACTION" DISABLED="true"/>';
  await importXML(`<POLICY_FOLDER ID="action-states"><RULE ID="action-off" NAME="Disabled rule" ENABLED="false">${stateActions}
    <INNER_RULE ID="action-inherited" NAME="Disabled by parent" ENABLED="true">${stateActions}</INNER_RULE></RULE>
    <RULE ID="action-on" NAME="Enabled rule" ENABLED="true">${stateActions}</RULE></POLICY_FOLDER>`, "Disabled rule");
  for (const [id, name, ruleStatus] of [["action-off", "Disabled rule", "● Disabled"], ["action-inherited", "Disabled by parent", "● Disabled by parent"], ["action-on", "Enabled rule", "● Enabled"]]) {
    await policy(id, name);
    assert($("details").querySelector(".rule-header .badge").textContent === ruleStatus, "Rule status changed while separating action status");
    for (let toggle = 0; toggle < 2; toggle++) {
      const badges = [...$("details").querySelectorAll('[data-section="actions"] .action-heading .badge')];
      assert(badges.map(badge => badge.textContent).join(",") === "Enabled,Enabled,Disabled", "Actions inherited their rule's status");
      assert(badges.every(badge => getComputedStyle(badge).visibility === "visible"), "Action status disappears with diagnostics hidden");
      assert(!$("details").querySelector('[data-section="actions"]').textContent.includes("Inactive"), "Actions still show inherited inactivity");
      $("diagnostics-toggle").click();
      await frame();
    }
  }
  await restoreDemo();
  await until(() => $("details").querySelector("h2")?.textContent === "Office access", "Could not restore the demo after workflow checks");
  $("filter-panel").hidden = true; $("filter-toggle").setAttribute("aria-expanded", "false");
  $("details").scrollTop = 0;
}
