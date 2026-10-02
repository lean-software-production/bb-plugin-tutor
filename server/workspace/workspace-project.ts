// The workspace: always a BB project id (the workspaceProject setting, or an
// older Tutor's factoryProject), whose default local source is the student's
// repo on this machine.
import { access } from "node:fs/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Workspace } from "../../shared/rpc.ts";

type Sdk = BbPluginApi["sdk"];
export type ProjectWithSources = Awaited<ReturnType<Sdk["projects"]["get"]>>;

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultSource(project: ProjectWithSources) {
  return project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
}

export function defaultSourcePath(project: ProjectWithSources): string | null {
  return defaultSource(project)?.path ?? null;
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

export async function resolveWorkspace(sdk: Sdk, projectId: string | undefined): Promise<ResolvedWorkspace> {
  if (projectId === undefined || projectId === "") return { workspace: { status: "unset" }, hostId: null };
  const missing: ResolvedWorkspace = { workspace: { status: "missing", projectId }, hostId: null };
  let project: ProjectWithSources;
  try {
    project = await sdk.projects.get({ projectId });
  } catch {
    return missing;
  }
  const source = defaultSource(project);
  if (source === undefined || !(await pathExists(source.path))) return missing;
  return {
    workspace: { status: "found", projectId, projectName: project.name, root: source.path },
    hostId: source.hostId,
  };
}
