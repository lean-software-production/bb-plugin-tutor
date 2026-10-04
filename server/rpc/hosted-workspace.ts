// The hosted workspace: the student's own machine (their Codespace) holds it.
// Tutor offers that machine's checkout and, once the student confirms, makes
// (or reuses) the project for it: on the first run, and again when the
// workspace's machine is gone and the student has a new Codespace (a rebuild
// or a fresh one enrols as a new machine).
import type { Sdk } from "../coach/threads.ts";
import { WorkspaceUnreachableError, type WorkspaceAccess } from "../workspace/access.ts";
import type { WorkspaceOffer } from "../../shared/rpc.ts";

/**
 * The student's machine: the newest connected host. A student server is a
 * bare bb-server with no machine of its own (never a co-located daemon), so
 * every connected host is the student's Codespace — enrolled the same way a
 * real Codespace is, over `bb-app host-daemon join`, which leaves
 * machineProviderId null (there is no installed machine provider involved).
 * Do not filter on machineProviderId.
 */
export async function studentMachine(sdk: Sdk): Promise<{ id: string; name: string } | null> {
  const hosts = await sdk.hosts.list();
  const connected = hosts.filter((h) => h.status === "connected");
  connected.sort((a, b) => b.createdAt - a.createdAt);
  const host = connected[0];
  return host === undefined ? null : { id: host.id, name: host.name };
}

/**
 * The student's machine's checkout of `folder`, to make the workspace.
 * `workspaceHostId` is the machine the current workspace's project is on, if
 * any: offering that one again would change nothing, so it counts as no machine
 * (the page then says the Codespace is asleep). So does a machine that turns
 * out to be offline when asked.
 */
export async function offerHostedWorkspace(
  sdk: Sdk,
  access: (hostId: string) => WorkspaceAccess,
  folder: string,
  workspaceHostId: string | null = null,
): Promise<WorkspaceOffer> {
  const machine = await studentMachine(sdk);
  if (machine === null || machine.id === workspaceHostId) return { status: "no-machine" };
  let kinds: Awaited<ReturnType<WorkspaceAccess["kinds"]>>;
  try {
    kinds = await access(machine.id).kinds([folder]);
  } catch (cause) {
    if (cause instanceof WorkspaceUnreachableError) return { status: "no-machine" };
    throw cause;
  }
  if (kinds[folder] !== "folder") return { status: "no-folder", folder, machineName: machine.name };
  return { status: "offer", hostId: machine.id, machineName: machine.name, folder };
}

/** The project whose default source is `folder` on `hostId`, created when there is none. */
export async function findOrCreateProject(sdk: Sdk, hostId: string, folder: string): Promise<string> {
  const projects = await sdk.projects.list({ includePersonal: false });
  const existing = projects.find((p) => p.kind === "standard" && p.sources.some((s) => s.isDefault && s.hostId === hostId && s.path === folder));
  if (existing !== undefined) return existing.id;
  const name = folder.split("/").filter(Boolean).pop() ?? "workspace";
  const created = await sdk.projects.create({ name, source: { hostId, path: folder, type: "local_path" } });
  return created.id;
}
