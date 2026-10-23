// Runs only in the visible native --smoke window, whose preferences are volatile.
// Measure actual layout: changing a percentage label alone must not pass.
export async function verifyZoom(readSavedZoom) {
  const out = document.getElementById("zoom-out");
  const label = document.getElementById("zoom-level");
  const into = document.getElementById("zoom-in");
  const sample = document.querySelector(".brand-mark");
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const assert = (valid, message) => { if (!valid) throw new Error(message); };
  assert(out && label && into && sample, "Zoom controls are missing from the native frontend");
  label.click();
  await frame();
  const baseline = sample.getBoundingClientRect().width;
  assert(baseline > 0, "The native frontend has no visible layout");

  async function expect(scale, action) {
    action();
    await frame();
    assert(label.textContent === `${Math.round(scale * 100)}%`, `Zoom label did not change to ${scale}`);
    for (const control of [out, label, into]) {
      const rect = control.getBoundingClientRect();
      assert(rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1, "Zoom controls are outside the visible window");
    }
    const footer = document.querySelector(".app-footer").getBoundingClientRect();
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    const workspace = document.querySelector(".workspace").getBoundingClientRect();
    const toolbar = document.querySelector(".detail-toolbar").getBoundingClientRect();
    const tools = document.querySelector(".detail-tools").getBoundingClientRect();
    const breadcrumb = document.getElementById("breadcrumb").getBoundingClientRect();
    assert(tools.left >= toolbar.left - 1 && tools.right <= toolbar.right + 1 && tools.bottom <= toolbar.bottom + 1,
      `Zoom ${scale} policy controls extend outside the toolbar`);
    assert(toolbar.bottom <= breadcrumb.top + 1, `Zoom ${scale} toolbar overlaps the breadcrumb`);
    assert(Math.abs(footer.bottom - window.innerHeight) <= 2,
      `Zoom ${scale} footer bottom ${footer.bottom} does not fill viewport height ${window.innerHeight}`);
    assert(Math.abs(shell.top) <= 1 && Math.abs(shell.bottom - window.innerHeight) <= 2,
      `Zoom ${scale} app shell does not fit the viewport: ${shell.top}–${shell.bottom}`);
    assert(workspace.height > 0 && Math.abs(workspace.bottom - footer.top) <= 2,
      `Zoom ${scale} workspace does not reach the footer`);
    const width = sample.getBoundingClientRect().width;
    assert(Math.abs(width / baseline - scale) < 0.03, `Zoom ${scale} did not resize the UI: width ${width}, baseline ${baseline}`);
    const deadline = Date.now() + 3000;
    while (Math.abs(await readSavedZoom() - scale) > 0.001) {
      assert(Date.now() < deadline, `Zoom ${scale} was not saved through Go`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  await expect(1.1, () => into.click());
  await expect(1, () => out.click());
  await expect(0.9, () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true, cancelable: true })));
  await expect(1, () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true, cancelable: true })));
  await expect(1.1, () => window.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, ctrlKey: true, cancelable: true })));
  await expect(1, () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", ctrlKey: true, cancelable: true })));
  await expect(0.5, () => { for (let i = 0; i < 12; i++) out.click(); });
  assert(out.disabled, "Zoom out is not disabled at its lower bound");
  for (const scale of [0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]) {
    await expect(scale, () => into.click());
  }
  assert(into.disabled, "Zoom in is not disabled at its upper bound");
  for (const scale of [1.75, 1.5, 1.25, 1.1, 1]) {
    await expect(scale, () => out.click());
  }
  await expect(1, () => label.click());
}

// Check compact reading flow, contextual field ownership, and stable geometry
// when diagnostics are toggled in the native WebView.
export async function verifyDetails() {
  const panel = document.getElementById("details");
  const assert = (valid, message) => { if (!valid) throw new Error(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const find = id => panel.querySelector(`[data-section="${id}"]`);
  const filterToggle = document.getElementById("filter-toggle");
  assert(getComputedStyle(filterToggle).display !== "none", "Filters are inaccessible at this window width");
  panel.focus();
  const filterKey = (key, shiftKey = false) => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  filterKey("/");
  assert(!document.getElementById("filter-panel").hidden, "/ does not open the filter panel");
  for (const id of ["property-search", "group-search", "action-search", "action-value-search"]) {
    filterKey("Tab"); await frame();
    const input = document.getElementById(id), box = input.getBoundingClientRect(), sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    assert(document.activeElement === input && box.height > 0 && box.top >= sidebar.top - 1 && box.bottom <= sidebar.bottom + 1, `Filter ${id} cannot be reached inside the sidebar at ${innerWidth}px`);
  }
  filterKey("Tab", true);
  assert(document.activeElement.id === "action-search", "Shift+Tab does not return to the previous filter");
  filterKey("Escape");
  assert(document.getElementById("filter-panel").hidden, "Escape does not close the filter panel");
  function verifyPanelFrames() {
    const reference = panel.querySelector('[data-section="main-rule"]');
    const frame = getComputedStyle(reference);
    const heading = getComputedStyle(reference.querySelector("summary"));
    for (const section of panel.querySelectorAll(":scope > [data-section]")) {
      assert(section.tagName === "DETAILS", "A detail section does not use the shared collapsible panel");
      const style = getComputedStyle(section);
      const summary = getComputedStyle(section.querySelector("summary"));
      for (const property of ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderColor", "borderRadius", "backgroundColor", "marginBottom"]) {
        assert(style[property] === frame[property], `Panel ${section.dataset.section} has an inconsistent ${property}`);
      }
      for (const property of ["backgroundColor", "padding", "color", "fontSize", "fontWeight"]) {
        assert(summary[property] === heading[property], `Panel ${section.dataset.section} has an inconsistent header ${property}`);
      }
    }
  }
  verifyPanelFrames();
  const primary = [...panel.querySelectorAll(":scope > .rule-section")];
  assert(primary.map(node => node.dataset.section).join(",") === "scope,main-rule,sub-rules,actions,timers,attributes", "Policy sections are outside their intended reading order");
  assert(find("attributes").open && find("attributes").querySelectorAll("tbody tr").length === 5, "Exported rule attributes are not visible at the bottom of policy details");
  assert([...find("attributes").querySelectorAll("tbody tr")].some(row => row.querySelector("th").textContent === "APP_VERSION" && row.querySelector("td").textContent === "1.0"), "An exported rule attribute was renamed or omitted");
  const identity = panel.querySelector(".rule-header .policy-identity");
  assert(identity?.textContent === "ID office" && parseFloat(getComputedStyle(identity).fontSize) < 11, "Policy ID is not available as secondary information");
  assert(![...panel.querySelectorAll(".rule-header button")].some(button => button.textContent === "Copy ID"), "Copy ID is prominent in the header");
  assert(panel.querySelector(".rule-description")?.textContent === "Synthetic rule", "Description is not beside the policy title");
  assert(find("scope").textContent.includes("Office devices") && find("scope").textContent.includes("192.0.2.0/24"), "Readable scope values were lost");
  assert(!find("scope").textContent.includes("GROUP_IN_FILTER") && find("scope").querySelector(".inline-identifier")?.textContent.includes("staff"), "Scope IDs are not visible as secondary information");
  assert(!find("sub-rules").open, "Sub-rule previews crowd the initial view");
  const scope = find("scope");
  const scopeStyle = getComputedStyle(scope);
  // Compactness describes the contents; the shared panel adds two border pixels.
  const scopeHeight = scope.getBoundingClientRect().height -
    parseFloat(scopeStyle.borderTopWidth) - parseFloat(scopeStyle.borderBottomWidth);
  const scopeRows = [...scope.querySelectorAll(".setting-item")];
  assert(scopeRows.length === 3 && scopeRows.every(row => row.getBoundingClientRect().height <= 26),
    "Scope values no longer occupy compact single rows");
  assert(scopeHeight <= 120, "Three scope values take more than a compact content box: " + scopeHeight + "px");
  const action = find("actions").querySelector(".action-block");
  const parameter = action.querySelector(".detail-fact");
  assert(action.querySelector(".action-title")?.textContent === "Send notification", "Action title is not readable");
  assert(Math.abs(parameter.querySelector("dt").getBoundingClientRect().top - parameter.querySelector("dd").getBoundingClientRect().top) < 4, "Action labels and values are not condensed onto the same line");
  assert(action.querySelector(".action-schedule") && !action.querySelector(".action-parameters .action-schedule"), "Schedule is mixed into the action parameters");
  const identifier = find("actions").querySelector(".inline-identifier");
  assert(find("actions").textContent.includes("Guest devices") && identifier?.textContent.includes("guest"), "Action target IDs are not visible beside their names");
  assert(parseFloat(getComputedStyle(identifier).fontSize) < parseFloat(getComputedStyle(identifier.closest(".setting-value")).fontSize), "Action IDs have the same visual importance as names");
  assert(find("actions").getBoundingClientRect().height <= 140, `Two actions take more than a compact section: ${find("actions").getBoundingClientRect().height}px at ${innerWidth}px; content ${action.querySelector(".action-content").getBoundingClientRect().width}px`);
  const body = find("actions").querySelector(".section-body");
  const originalActions = [...body.children];
  body.replaceChildren(...Array.from({ length: 5 }, (_, index) => originalActions[index % originalActions.length].cloneNode(true)));
  assert(find("actions").getBoundingClientRect().height <= 300, "Five actions require excessive vertical space");
  body.replaceChildren(...originalActions);
  assert(find("timers").querySelectorAll(".timing-row").length === 2 && find("timers").querySelector(".timing-value")?.textContent === "3600", "Timer settings lost their compact presentation");
  assert(find("timers").getBoundingClientRect().height <= 110, "Timer rows take excessive vertical space");
  assert(!panel.querySelector(".diagnostic-table, [data-section=diagnostics]"), "A catch-all diagnostics panel remains");
  const toggle = document.getElementById("diagnostics-toggle");
  assert(toggle?.getAttribute("aria-pressed") === "true", "The contextual diagnostics toggle is missing");
  document.getElementById("expand-sections").click();
  await frame();
  assert(primary.every(node => node.open), "Expand all stopped opening detail sections");
  const measured = [panel, ...primary, ...panel.querySelectorAll(".condition, .condition-filter, .action-block, .timing-row, .setting-item")];
  const heights = measured.map(node => node.getBoundingClientRect().height);
  const scroll = panel.scrollTop;
  toggle.click();
  await frame();
  assert(getComputedStyle(panel.querySelector(".element-diagnostics")).visibility === "hidden", "Diagnostics did not hide");
  const filterDiagnostics = find("main-rule").querySelector(".condition-filter > .element-diagnostics");
  assert(filterDiagnostics.textContent.includes("FILTER_ID first") && getComputedStyle(filterDiagnostics).visibility === "hidden", "Filter ID is not controlled by diagnostics");
  assert(!find("main-rule").querySelector(".condition-filter > .inline-identifier"), "Filter ID remains visible outside diagnostics");
  assert(getComputedStyle(find("attributes").querySelector("table")).visibility === "visible", "Hiding diagnostics hides the attributes section");
  assert(measured.every((node, index) => Math.abs(node.getBoundingClientRect().height - heights[index]) < 1), "Hiding diagnostics changes row heights");
  assert(getComputedStyle(identity).visibility === "visible" && getComputedStyle(identifier).visibility === "visible", "Hiding diagnostics hides identifiers");
  toggle.click();
  await frame();
  assert(measured.every((node, index) => Math.abs(node.getBoundingClientRect().height - heights[index]) < 1) && Math.abs(panel.scrollTop - scroll) < 1, "Toggling diagnostics changes row heights or scroll position");
  async function inspect(control, expected, absent = []) {
    assert(control, `Missing contextual fields for ${expected[0]}`);
    control.focus({ preventScroll: true }); control.click();
    await frame();
    const popup = document.querySelector(".context-popover[open]");
    assert(popup && expected.every(value => popup.textContent.includes(value)) && absent.every(value => !popup.textContent.includes(value)), `Exported fields have the wrong owner: ${expected.join(", ")}`);
    if (expected.includes("PLUGIN_NAME")) assert(popup.querySelector(".context-field dt").textContent === "PLUGIN_NAME", "Plugin name is not the first diagnostic field");
    assert(popup.contains(document.activeElement), "Exported fields did not take keyboard focus");
    if (expected.includes("APP_VERSION")) {
      for (const key of ["+", "-"]) {
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true }));
        await frame();
        const bounds = popup.getBoundingClientRect();
        assert(bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1, "Zoom moves contextual fields outside the viewport");
      }
    }
    const rect = popup.getBoundingClientRect();
    assert(rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1, "Contextual fields extend outside the window");
    popup.dispatchEvent(new Event("cancel", { cancelable: true }));
    assert(!document.querySelector(".context-popover") && document.activeElement === control, "Closing local fields did not restore focus to the owner");
  }
  await inspect(panel.querySelector('.rule-header [data-diagnostic-owner]'), ["APP_VERSION", "office"], ["FILTER_ID"]);
  const firstCondition = find("main-rule").querySelector(".condition");
  const firstExpression = firstCondition.closest(".expression-line");
  assert(firstExpression?.querySelector(".expression-prefix").textContent.includes("┌"), "Nested OR conditions lost their shared scope bracket");
  assert(firstExpression.querySelector(".expression-rail"), "Scope rail does not continue through condition details");
  assert(!find("main-rule").textContent.includes("( GROUP )"), "Redundant group rows are still displayed");
  const gutter = firstExpression.querySelector(".expression-gutter").getBoundingClientRect();
  assert(firstCondition.getBoundingClientRect().left >= gutter.right - 1, "Expression prefix overlaps its condition");
  assert(firstCondition.querySelector(".diagnostic-preview")?.textContent.startsWith("PLUGIN_NAME Inventory"), "Plugin name is not first alongside its condition");
  await inspect(firstCondition.querySelector(".context-line .element-diagnostics"), ["FIELD_NAME", "device.os", "PLUGIN_NAME", "LEFT_PARENTHESIS", "LOGIC"], ["FILTER_ID"]);
  await inspect(firstCondition.querySelector(".condition-filter > .element-diagnostics"), ["FILTER_ID", "first", "CASE_SENSITIVE"], ["PLUGIN_NAME"]);
  await inspect(action.querySelector(".action-heading .element-diagnostics"), ["SEND_NOTIFICATION", "DISABLED"], ["recipient"]);
  await inspect(action.querySelector(".detail-fact dt .element-diagnostics"), ["recipient", "ops@example.test"], ["Synthetic test message"]);
  await inspect(find("timers").querySelector(".timing-title .element-diagnostics"), ["INACTIVITY_TTL", "3600"]);
  find("sub-rules").open = false;
  await frame();
  document.querySelector('[data-condition-view="text"]').click();
  const textConditions = find("main-rule").querySelector(".logic-text");
  assert(textConditions && textConditions.textContent.includes('= "Example OS"') && textConditions.textContent.includes("AND NOT") && textConditions.textContent.includes("\n"), "Readable infix text conditions stopped rendering");
  document.querySelector('[data-condition-view="visual"]').click();
  assert(find("main-rule").querySelector(".condition-title"), "Visual conditions stopped rendering");
  async function select(id, name) {
    document.querySelector(`[data-key="rule:${id}"]`).click();
    const deadline = Date.now() + 3000;
    while (panel.querySelector("h2")?.textContent !== name) {
      assert(Date.now() < deadline, `Could not inspect ${name}`);
      await frame();
    }
  }
  await select("child", "Guest access");
  assert(find("main-rule").querySelector(".external-notice")?.textContent.includes("unavailable"), "Unavailable expressions are hidden in diagnostics");
  assert(find("timers").textContent.includes("Admission resolve delay"), "Admission timing is no longer in the main view");
  verifyPanelFrames();
  assert(!find("scope").open && !find("actions").open, "Empty sections should start folded inside the shared panel frame");
  find("scope").querySelector("summary").click();
  await frame();
  assert(find("scope").open, "An empty section cannot be expanded");
  find("scope").querySelector("summary").click();
  await frame();
  await select("office", "Office access");
  panel.scrollTop = 0;
}
