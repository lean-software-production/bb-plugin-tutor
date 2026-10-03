// Course files travel from the server to the student's machine as a bundle:
// a flat list of relative paths, each a file (base64 contents, executable
// bit) or a symbolic link (its target text). The server no longer touches
// the workspace itself (spec: "The plugin split"), so everything it sends
// must be validated before the host writes a byte of it.
import { z } from "zod";

export const bundleEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1), executable: z.boolean(), base64: z.string() }),
  z.object({ kind: z.literal("symlink"), path: z.string().min(1), target: z.string().min(1) }),
]);
export const bundleSchema = z.object({ entries: z.array(bundleEntrySchema).max(20_000) });
export type Bundle = z.infer<typeof bundleSchema>;
export type BundleEntry = z.infer<typeof bundleEntrySchema>;

/** Under the 32 MiB host-call limit, with room for the envelope around it. */
export const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;

/** Null when `path` is a safe relative path (no leading "/", no "..", no empty or "." segment, no NUL); else why not. */
export function unsafePath(path: string): string | null {
  if (path === "") return "the path is empty";
  if (path.includes("\0")) return `${path} contains a NUL byte`;
  if (path.startsWith("/")) return `${path} is absolute`;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "") return `${path} has an empty segment`;
    if (segment === ".") return `${path} has a "." segment`;
    if (segment === "..") return `${path} has a ".." segment`;
  }
  return null;
}

/** Null when a link at `path` pointing at `target` stays inside the bundle's root; else why not. Absolute targets are refused. */
export function escapingLink(path: string, target: string): string | null {
  if (target.startsWith("/")) return `${path} links to the absolute path ${target}`;
  if (target.includes("\0")) return `${path} links to a target containing a NUL byte`;
  // Resolve the link relative to the folder it sits in, inside a notional
  // root, and check the result never climbs above that root.
  const fromDir = path.split("/").slice(0, -1);
  const stack = [...fromDir];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return `${path} links to ${target}, which escapes the bundle`;
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return null;
}

/** The JSON length, which is what crosses the wire. */
export function bundleBytes(bundle: Bundle): number {
  return Buffer.byteLength(JSON.stringify(bundle), "utf8");
}
