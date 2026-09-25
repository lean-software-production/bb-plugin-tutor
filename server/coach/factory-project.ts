// The factory project: always a BB project id (the factoryProject setting),
// whose default local source is the factory repo on this machine.
import { access } from "node:fs/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FactoryProject } from "../../shared/rpc.ts";

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

export interface Factory {
  factoryProject: FactoryProject;
  /** The machine holding the factory folder; null without a factory project. Coach threads run there. */
  hostId: string | null;
}

export async function resolveFactory(sdk: Sdk, projectId: string | undefined): Promise<Factory> {
  if (projectId === undefined || projectId === "") return { factoryProject: { status: "unset" }, hostId: null };
  const missing: Factory = { factoryProject: { status: "missing", projectId }, hostId: null };
  let project: ProjectWithSources;
  try {
    project = await sdk.projects.get({ projectId });
  } catch {
    return missing;
  }
  const source = defaultSource(project);
  if (source === undefined || !(await pathExists(source.path))) return missing;
  return {
    factoryProject: { status: "found", projectId, projectName: project.name, root: source.path },
    hostId: source.hostId,
  };
}
