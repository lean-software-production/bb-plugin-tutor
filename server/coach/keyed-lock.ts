// An in-process async mutex per key. One BB server process runs the plugin,
// so this is enough to serialise read-modify-write of the student's files and
// find-or-spawn of a coach thread.
export interface KeyedLock {
  /** Runs `task` once every earlier task for `key` has settled; tasks for other keys run freely. */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task, task);
      const tail = result.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
