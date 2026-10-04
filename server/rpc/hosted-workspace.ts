// The hosted first run: the student's own machine (their Codespace) holds the
// workspace. Tutor offers that machine's checkout and, once the student
// confirms, creates the BB project for it (the only way a hosted student gets one).
import type { Sdk } from "../coach/threads.ts";
import type { WorkspaceAccess } from "../workspace/access.ts";
import type { WorkspaceOffer } from "../../shared/rpc.ts";

/** The student's machine: a connected, enrolled machine (never the server's own host). The newest wins. */
export async function studentMachine(sdk: Sdk): Promise<{ id: string; name: string } | null> {
  const hosts = await sdk.hosts.list();
  const enrolled = hosts.filter((h) => h.machineProviderId !== null && h.status === "connected");
  enrolled.sort((a, b) => b.createdAt - a.createdAt);
  const host = enrolled[0];
  return host === undefined ? null : { id: host.id, name: host.name };
}

export async function offerHostedWorkspace(sdk: Sdk, access: (hostId: string) => WorkspaceAccess, folder: string): Promise<WorkspaceOffer> {
  const machine = await studentMachine(sdk);
  if (machine === null) return { status: "no-machine" };
  const kinds = await access(machine.id).kinds([folder]);
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
