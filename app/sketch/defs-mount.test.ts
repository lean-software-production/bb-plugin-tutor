import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefsMount, domDefsHost, type DefsHost } from "./defs-mount.ts";

function recordingHost() {
  const calls: string[] = [];
  const host: DefsHost = { add: () => calls.push("add"), remove: () => calls.push("remove") };
  return { calls, host };
}

test("the first user adds the defs and the last one to leave removes them", () => {
  const { calls, host } = recordingHost();
  const mount = createDefsMount(host);
  const first = mount.acquire();
  const second = mount.acquire();
  assert.deepEqual(calls, ["add"]);
  first();
  assert.deepEqual(calls, ["add"]);
  second();
  assert.deepEqual(calls, ["add", "remove"]);
  mount.acquire();
  assert.deepEqual(calls, ["add", "remove", "add"]);
});

test("releasing twice counts once, so a stray cleanup cannot pull the defs from another user", () => {
  const { calls, host } = recordingHost();
  const mount = createDefsMount(host);
  const first = mount.acquire();
  mount.acquire();
  first();
  first();
  assert.deepEqual(calls, ["add"]);
});

/** Just enough of a document for domDefsHost. */
function fakeDocument() {
  const nodes = new Map<string, { remove(): void }>();
  const inserted: string[] = [];
  const doc = {
    getElementById: (id: string) => nodes.get(id) ?? null,
    body: {
      insertAdjacentHTML(position: string, html: string) {
        inserted.push(`${position}:${html}`);
        const id = /id="([^"]+)"/.exec(html)?.[1] ?? "";
        nodes.set(id, { remove: () => nodes.delete(id) });
      },
    },
  };
  return { doc, nodes, inserted };
}

test("the DOM host puts the defs at the top of the body and takes them away again", () => {
  const { doc, nodes, inserted } = fakeDocument();
  const host = domDefsHost(doc, "d", '<svg id="d"></svg>');
  host.add();
  assert.deepEqual(inserted, ['afterbegin:<svg id="d"></svg>']);
  assert.ok(nodes.has("d"));
  host.remove();
  assert.ok(!nodes.has("d"));
});

test("the DOM host leaves alone defs it did not put there", () => {
  const { doc, nodes, inserted } = fakeDocument();
  doc.body.insertAdjacentHTML("afterbegin", '<svg id="d"></svg>');
  const host = domDefsHost(doc, "d", '<svg id="d"></svg>');
  host.add();
  host.remove();
  assert.equal(inserted.length, 1);
  assert.ok(nodes.has("d"));
});
