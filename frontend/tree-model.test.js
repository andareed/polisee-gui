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

test("folder contents use numeric name order while subrules keep source order", () => {
  const input = [
    { key: "folder:root", id: "root", parent: "", kind: "folder", name: "Policies" },
    { key: "folder:ten", id: "ten", parent: "folder:root", kind: "folder", name: "Folder 10" },
    { key: "folder:two", id: "two", parent: "folder:root", kind: "folder", name: "Folder 2" },
    { key: "rule:second", id: "second", parent: "folder:root", kind: "policy", name: "1.1.02 Device discovery" },
    { key: "rule:z", id: "z", parent: "rule:second", kind: "subpolicy", name: "Z step" },
    { key: "rule:a", id: "a", parent: "rule:second", kind: "subpolicy", name: "A step" },
    { key: "rule:tenth", id: "tenth", parent: "folder:root", kind: "policy", name: "1.1.10 Extended discovery" },
    { key: "rule:first", id: "first", parent: "folder:root", kind: "policy", name: "1.1.01 Network discovery" },
    { key: "rule:two", id: "two", parent: "folder:two", kind: "policy", name: "Nested policy" },
  ];
  const original = structuredClone(input);
  const { children, ruleIDs } = indexNodes(input);
  assert.deepEqual(children.get("folder:root").map(n => n.id), ["two", "ten", "first", "second", "tenth"]);
  assert.deepEqual(children.get("rule:second").map(n => n.id), ["z", "a"]);
  assert.deepEqual(ruleIDs, ["two", "first", "second", "z", "a", "tenth"]);
  assert.deepEqual(input, original);
});

test("equivalent names retain source order", () => {
  const input = [nodes[0],
    { key: "rule:one", id: "one", parent: "folder:same", kind: "policy", name: "Policy 02" },
    { key: "rule:two", id: "two", parent: "folder:same", kind: "policy", name: "policy 2" },
  ];
  assert.deepEqual(indexNodes(input).ruleIDs, ["one", "two"]);
});
