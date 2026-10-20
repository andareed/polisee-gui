import assert from "node:assert/strict";
import test from "node:test";
import { BrowseMemory, pageLabel } from "./browse-state.js";
import { groupMatches } from "./group-picker.js";

test("segment browsing remembers each policy and segment, and clears replaced documents", () => {
  const memory = new BrowseMemory(); memory.reset(1);
  Object.assign(memory.rule("policy"), { text: "Office", page: 3, scroll: 42 });
  Object.assign(memory.range("policy", "0"), { text: "range-id", page: 8, scroll: 120 });
  memory.range("policy", "1").page = 2;
  memory.range("other-policy", "0").page = 5;
  memory.reset(1);
  assert.deepEqual(memory.range("policy", "0"), { text: "range-id", page: 8, scroll: 120 });
  assert.equal(memory.rule("policy").page, 3);
  assert.equal(memory.range("policy", "1").page, 2);
  assert.equal(memory.range("other-policy", "0").page, 5);
  memory.reset(2);
  assert.deepEqual(memory.range("policy", "0"), { text: "", page: 0, scroll: 0 });
  assert.equal(memory.rule("policy").page, 0);
});

test("page counts distinguish filtered results and complete exports", () => {
  assert.equal(pageLabel({ page: 1, pageSize: 25, filtered: 42, total: 1000 }, "ranges"), "26–42 of 42 ranges · 1,000 total");
  assert.equal(pageLabel({ page: 0, pageSize: 8, filtered: 0, total: 50 }, "segments"), "0–0 of 0 segments · 50 total");
});

test("group suggestions match names and typed IDs without replacing labels or exceeding the visible limit", () => {
  const options = Array.from({ length: 50 }, (_, id) => ({ name: `Office ${id}`, id: `group-${id}` }));
  assert.equal(groupMatches(options, "").rows.length, 12);
  assert.equal(groupMatches(options, "").total, 50);
  assert.deepEqual(groupMatches(options, "group-49").rows, [{ name: "Office 49", id: "group-49" }]);
  assert.equal(groupMatches(options, "office").total, 50);
  assert.equal(groupMatches(options, "missing").total, 0);
  assert.equal(options[49].name, "Office 49");
});
