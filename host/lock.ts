// An in-process async mutex per key, on the student's machine: BB's host
// daemon runs one worker for the plugin there, so this serialises adoptions of
// one workspace (keyed on its real path). Same semantics as the server's
// server/coach/keyed-lock.ts, which the host entry does not import.
export interface HostLock {
  /** Runs `work` once every earlier task for `key` has settled; tasks for other keys run freely. */
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export function createHostLock(): HostLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(work, work);
      const tail = result.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
