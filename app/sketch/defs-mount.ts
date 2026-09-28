// The kit's filters and marker live in one <svg> per document. Every Tutor
// root renders <WobbleDefs/>; the first to mount adds the defs and the last
// to unmount takes them away (app/ui/sketch/WobbleDefs.tsx).

export interface DefsHost {
  add(): void;
  remove(): void;
}

/** Counts users of the defs. `acquire` returns this user's release, which counts once. */
export function createDefsMount(host: DefsHost): { acquire(): () => void } {
  let users = 0;
  return {
    acquire() {
      if (users++ === 0) host.add();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--users === 0) host.remove();
      };
    },
  };
}

/** The part of `document` the host uses. */
export interface DefsDocument {
  getElementById(id: string): { remove(): void } | null;
  body: { insertAdjacentHTML(position: "afterbegin", html: string): void };
}

/**
 * Puts the defs at the top of the body, as the kit's own script does: a
 * zero-size, absolutely placed <svg>, never display:none (Firefox drops
 * filters inside display:none). Defs already on the page (put there by
 * someone else) are used and left alone.
 */
export function domDefsHost(doc: DefsDocument, id: string, html: string): DefsHost {
  let owned = false;
  return {
    add() {
      if (doc.getElementById(id)) return;
      doc.body.insertAdjacentHTML("afterbegin", html);
      owned = true;
    },
    remove() {
      if (owned) doc.getElementById(id)?.remove();
      owned = false;
    },
  };
}
