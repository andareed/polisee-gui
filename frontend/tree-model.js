export function indexNodes(nodes) {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const children = new Map();
  for (const node of nodes) {
    if (!children.has(node.parent)) children.set(node.parent, []);
    children.get(node.parent).push(node);
  }
  return { byKey, children };
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
