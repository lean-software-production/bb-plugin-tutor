// The workspace: always a BB project id (the workspaceProject setting, or an
// older Tutor's factoryProject), whose default local source is the student's
// repo on that source's machine, probed through WorkspaceAccess.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Workspace } from "../../shared/rpc.ts";
import { followedKind } from "../../layouts/types.ts";
import { WorkspaceUnreachableError, type WorkspaceAccess } from "./access.ts";
import { codeOf } from "./machine-access.ts";

export type Sdk = BbPluginApi["sdk"];
export type ProjectWithSources = Awaited<ReturnType<Sdk["projects"]["get"]>>;

/** The workspace access for a machine. */
export type AccessFor = (hostId: string) => WorkspaceAccess;

/** Whether anything is at `path`, following symbolic links (a dangling one is nothing), asked through `access`. */
export async function pathExists(access: WorkspaceAccess, path: string): Promise<boolean> {
  return (await followedKind(access, path)) !== "none";
}

export function defaultSource(project: ProjectWithSources) {
  return project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
}

export interface ResolvedWorkspace {
  workspace: Workspace;
  /** The machine holding the workspace folder; null without a workspace. Coach threads run there. */
  hostId: string | null;
}

/**
 * The project id to resolve: `workspaceProject` wins; an older Tutor's
 * `factoryProject` is still read when there is no `workspaceProject`; an
 * empty value of either is the same as absent.
 */
export function workspaceSetting(values: { workspaceProject?: string; factoryProject?: string }): string | undefined {
  if (values.workspaceProject !== undefined && values.workspaceProject !== "") return values.workspaceProject;
  if (values.factoryProject !== undefined && values.factoryProject !== "") return values.factoryProject;
  return undefined;
}

export async function resolveWorkspace(sdk: Sdk, projectId: string | undefined, accessFor: AccessFor): Promise<ResolvedWorkspace> {
  if (projectId === undefined || projectId === "") return { workspace: { status: "unset" }, hostId: null };
  const missing: ResolvedWorkspace = { workspace: { status: "missing", projectId }, hostId: null };
  let project: ProjectWithSources;
  try {
    project = await sdk.projects.get({ projectId });
  } catch {
    return missing;
  }
  const source = defaultSource(project);
  if (source === undefined) return missing;
  const unreachable: ResolvedWorkspace = { workspace: { status: "unreachable", projectId, projectName: project.name }, hostId: null };
  // A machine BB has no connection to can't be asked anything: no probing. A machine BB no
  // longer has (host_not_found) took the folder with it; any other failure to ask says nothing about the folder.
  const connected = await sdk.hosts.get({ hostId: source.hostId }).then(
    (machine) => (machine.status === "connected" ? "yes" : "no"),
    (cause: unknown) => (codeOf(cause) === "host_not_found" ? "gone" : "no"),
  );
  if (connected === "gone") return missing;
  if (connected === "no") return unreachable;
  try {
    if (!(await pathExists(accessFor(source.hostId), source.path))) return missing;
  } catch (cause) {
    if (cause instanceof WorkspaceUnreachableError) return unreachable;
    throw cause;
  }
  return {
    workspace: { status: "found", projectId, projectName: project.name, root: source.path },
    hostId: source.hostId,
  };
}
