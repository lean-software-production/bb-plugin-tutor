import { test } from "node:test";
import assert from "node:assert/strict";
import { QUERY_KEYS, staleKeys } from "./app-state.ts";
import { createQueryCache, errorMessage } from "./query-cache.ts";
import { createStore } from "./store.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a store notifies only on change and stops after unsubscribe", () => {
  const store = createStore("a");
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  store.set("a");
  store.set("b");
  assert.equal(store.get(), "b");
  assert.equal(calls, 1);
  off();
  store.set("c");
  assert.equal(calls, 1);
});

test("the cache shares one request per key and settles to ready", async () => {
  const cache = createQueryCache();
  let fetches = 0;
  const gate = deferred<number>();
  const fetcher = () => {
    fetches += 1;
    return gate.promise;
  };
  let notified = 0;
  cache.subscribe("overview", () => {
    notified += 1;
  });
  cache.ensure("overview", fetcher);
  cache.ensure("overview", fetcher);
  assert.equal(cache.peek("overview").status, "loading");
  assert.equal(fetches, 1);
  gate.resolve(42);
  await tick();
  assert.deepEqual(cache.peek("overview"), { status: "ready", data: 42, error: null });
  assert.equal(notified, 1);
  cache.ensure("overview", fetcher);
  assert.equal(fetches, 1, "a fresh entry is not refetched");
});

test("invalidate refetches watched keys, keeps old data on error, and never loses a mid-flight signal", async () => {
  const cache = createQueryCache();
  const answers = [deferred<string>(), deferred<string>(), deferred<string>()];
  let call = 0;
  const fetcher = () => answers[call++]!.promise;
  const off = cache.subscribe("lesson:002", () => undefined);
  cache.ensure("lesson:002", fetcher);
  answers[0]!.resolve("v1");
  await tick();

  cache.invalidate((key) => key.startsWith("lesson:"));
  assert.equal(call, 2);
  cache.invalidate();
  assert.equal(call, 2, "a signal during a fetch waits for it");
  answers[1]!.reject(new Error("Backend restarting."));
  await tick();
  assert.equal(call, 3, "the waiting signal refetches once the first answer lands");
  assert.deepEqual(cache.peek("lesson:002"), { status: "error", data: "v1", error: "Backend restarting." });
  answers[2]!.resolve("v2");
  await tick();
  assert.equal(cache.peek("lesson:002").data, "v2");

  off();
  cache.invalidate();
  assert.equal(call, 3, "unwatched keys wait until someone reads them again");
  cache.ensure("lesson:002", () => Promise.resolve("v3"));
  await tick();
  assert.equal(cache.peek("lesson:002").data, "v3");
});

test("a remount revalidates cached data in the background, but mounts moments apart share one answer", async () => {
  let clock = 1_000;
  const cache = createQueryCache({ now: () => clock });
  const answers = [deferred<string>(), deferred<string>()];
  let call = 0;
  const fetcher = () => answers[call++]!.promise;
  cache.ensure("lesson:002", fetcher);
  answers[0]!.resolve("before the edit");
  await tick();

  clock += 500;
  cache.ensure("lesson:002", fetcher);
  assert.equal(call, 1, "surfaces mounting together do not refetch");

  clock += 10_000;
  cache.ensure("lesson:002", fetcher);
  assert.equal(call, 2, "a page mounted later picks up changes made outside BB");
  assert.deepEqual(
    cache.peek("lesson:002"),
    { status: "ready", data: "before the edit", error: null },
    "the old answer stays on screen while it revalidates",
  );
  answers[1]!.resolve("after the edit");
  await tick();
  assert.equal(cache.peek("lesson:002").data, "after the edit");
});

test("an error is never cached: the next mount retries at once", async () => {
  const clock = 1_000;
  const cache = createQueryCache({ now: () => clock });
  const answers = [deferred<string>(), deferred<string>()];
  let call = 0;
  const fetcher = () => answers[call++]!.promise;
  cache.subscribe("overview", () => undefined);
  cache.ensure("overview", fetcher);
  answers[0]!.reject(new Error("Backend restarting."));
  await tick();
  assert.equal(call, 1, "a failure does not retry by itself");
  assert.equal(cache.peek("overview").status, "error");

  cache.ensure("overview", fetcher);
  assert.equal(call, 2, "remounting retries even inside the sharing window");
  answers[1]!.resolve("recovered");
  await tick();
  assert.deepEqual(cache.peek("overview"), { status: "ready", data: "recovered", error: null });
});

test("error messages are always readable", () => {
  assert.equal(errorMessage(new Error("No factory project is set up yet.")), "No factory project is set up yet.");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage({}), "Something went wrong.");
  assert.equal(errorMessage(new Error("  ")), "Something went wrong.");
});

test("a change signal refreshes everything but the lexicon, unless the course changed", () => {
  const progress = staleKeys({ reason: "progress", homeworkId: "002" });
  assert.equal(progress(QUERY_KEYS.overview), true);
  assert.equal(progress(QUERY_KEYS.lessonDetail("002")), true);
  assert.equal(progress(QUERY_KEYS.lexicon), false);
  assert.equal(staleKeys({ reason: "course", homeworkId: null })(QUERY_KEYS.lexicon), true);
  assert.equal(staleKeys("garbage")(QUERY_KEYS.lexicon), true);
});
