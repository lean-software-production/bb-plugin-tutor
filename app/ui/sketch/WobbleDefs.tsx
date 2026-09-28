// Mounts the kit's shared <svg> defs (wobble filters, arrowhead) once per
// document. Every Tutor root renders <WobbleDefs/>: the kit pieces point at
// url(#tutor-sk-…), which only resolves while the defs are in the page.
import { useLayoutEffect } from "react";
import { DEFS_HTML, DEFS_ID } from "../../sketch/defs.ts";
import { createDefsMount, domDefsHost } from "../../sketch/defs-mount.ts";

let mount: ReturnType<typeof createDefsMount> | undefined;

export function WobbleDefs() {
  useLayoutEffect(() => {
    mount ??= createDefsMount(domDefsHost(document, DEFS_ID, DEFS_HTML));
    return mount.acquire();
  }, []);
  return null;
}
