import assert from "node:assert/strict";
import test from "node:test";
import { indexNodes, visibleKeys } from "./tree-model.js";

const nodes = [
  { key: "folder:same", id: "same", parent: "", kind: "folder" },
  { key: "rule:same", id: "same", parent: "folder:same", kind: "policy" },
  { key: "rule:child", id: "child", parent: "rule:same", kind: "subpolicy" },
  { key: "rule:other", id: "other", parent: "folder:same", kind: "policy" },
];

test("matching subpolicies retain their ancestors and keep ID namespaces distinct", () => {
  assert.deepEqual([...visibleKeys(nodes, ["child"])], ["rule:child", "rule:same", "folder:same"]);
  const { byKey, children } = indexNodes(nodes);
  assert.equal(byKey.get("folder:same").kind, "folder");
  assert.equal(byKey.get("rule:same").kind, "policy");
  assert.deepEqual(children.get("folder:same").map(n => n.id), ["same", "other"]);
});

test("unknown or empty match sets reveal no unrelated nodes", () => {
  assert.equal(visibleKeys(nodes, []).size, 0);
  assert.equal(visibleKeys(nodes, ["missing"]).size, 0);
});
