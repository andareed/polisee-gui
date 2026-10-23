const nameOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function indexNodes(nodes) {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const children = new Map();
  for (const node of nodes) {
    if (!children.has(node.parent)) children.set(node.parent, []);
    children.get(node.parent).push(node);
  }
  for (const [parent, siblings] of children) {
    if (byKey.get(parent)?.kind !== "folder") continue;
    // Folder contents are a browsing list; subrules retain first-match XML order.
    siblings.sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || nameOrder.compare(a.name || "", b.name || ""));
  }
  const ruleIDs = [];
  function visit(parent) {
    for (const node of children.get(parent) || []) {
      if (node.kind !== "folder") ruleIDs.push(node.id);
      visit(node.key);
    }
  }
  visit("");
  return { byKey, children, ruleIDs };
}

export function visibleKeys(nodes, ruleIDs) {
  const { byKey } = indexNodes(nodes);
  const visible = new Set();
  for (const id of ruleIDs) {
    let key = `rule:${id}`;
    const seen = new Set();
    while (key && byKey.has(key) && !seen.has(key)) {
      seen.add(key);
      visible.add(key);
      key = byKey.get(key).parent;
    }
  }
  return visible;
}
