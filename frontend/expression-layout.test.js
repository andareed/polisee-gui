import test from "node:test";
import assert from "node:assert/strict";
import { expressionAt, expressionLayout } from "./expression-layout.js";

test("library source paths resolve the original condition and wrapper context", () => {
  const leaf = { condition: { field: "demo.value" } };
  const root = { children: [{ children: [leaf] }] };
  assert.equal(expressionAt(root, [0, 0]), leaf);
  assert.equal(expressionAt(root, []), root);
  for (const path of [[99], [0, -1], [0, 0.5], [0, 0, 0]]) assert.equal(expressionAt(root, path), null);
});

test("native scope prefixes and continuation rails survive multi-line condition bodies", t => {
  const original = globalThis.document;
  globalThis.document = { createElement(tag) {
    return { tag, children: [], style: {}, dataset: {}, attributes: {},
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attributes[name] = value; } };
  } };
  t.after(() => { globalThis.document = original; });
  const body = { textContent: '<literal policy value>\nadditional filter details' };
  const view = expressionLayout([
    { kind: "condition", prefix: "OR  ┌ ", continuation: "    │ " },
    { kind: "condition", prefix: "    └ NOT ", continuation: "          " },
  ], () => body);
  assert.equal(view.children.length, 2);
  const [first, last] = view.children;
  const [gutter, content] = first.children;
  assert.equal(gutter.children[0].textContent, "OR  ┌ ");
  assert.equal(gutter.children[1].style.left, "4.5ch");
  assert.equal(gutter.children[1].attributes["aria-hidden"], "true");
  assert.equal(content.children[0], body);
  assert.equal(last.children[0].children[0].textContent, "    └ NOT ");
  assert.equal(last.children[0].children.length, 1, "closed scope must not continue its rail");
});
