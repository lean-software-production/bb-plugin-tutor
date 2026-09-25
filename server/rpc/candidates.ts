// First run: which BB projects look like the student's factory repo. Tutor
// suggests and the student confirms; it never creates a project.
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { COURSE_FILES, FACTORY_FILES } from "../../shared/constants.ts";
import type { CandidateProject } from "../../shared/rpc.ts";
import { parseIteration } from "../progress/iteration.ts";
import { defaultSourcePath, pathExists, type ProjectWithSources } from "../coach/binding.ts";

type Sdk = BbPluginApi["sdk"];

export interface ProjectProbe {
  projectId: string;
  name: string;
  root: string | null;
  rootExists: boolean;
  /** spec/ITERATION's text, or null when it is absent. */
  iterationText: string | null;
  /** AGENTS.md's text, or null when it is absent. */
  agentsText: string | null;
}

interface CandidateContext {
  coursePath: string;
  /** File name of the course's coach file, which a coach-me-made AGENTS.md names. */
  coachFileName: string;
}

export function describeCandidate(probe: ProjectProbe, context: CandidateContext): CandidateProject {
  const base = { projectId: probe.projectId, name: probe.name, root: probe.root };
  if (probe.root === null || !probe.rootExists) return { ...base, qualifies: false, detail: "no folder on this machine" };
  if (resolve(probe.root) === resolve(context.coursePath)) return { ...base, qualifies: false, detail: "the course itself" };
  if (probe.iterationText !== null) {
    const parsed = parseIteration(probe.iterationText);
    const state = "state" in parsed ? `${parsed.state.iteration} ${parsed.state.status}` : "unreadable";
    return { ...base, qualifies: true, detail: `spec/ITERATION · ${state}` };
  }
  if (probe.agentsText?.includes(context.coachFileName) === true) {
    return { ...base, qualifies: true, detail: "AGENTS.md points at the course" };
  }
  return { ...base, qualifies: false, detail: "no spec/ITERATION" };
}

/** The hinted folder first, then projects that look like a factory, then by name. */
export function rankCandidates(candidates: readonly CandidateProject[], hint: string | null): CandidateProject[] {
  const hinted = (candidate: CandidateProject) =>
    hint !== null && candidate.root !== null && resolve(candidate.root) === resolve(hint) ? 0 : 1;
  return [...candidates].sort(
    (a, b) => hinted(a) - hinted(b) || Number(b.qualifies) - Number(a.qualifies) || a.name.localeCompare(b.name),
  );
}

async function readOptional(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}

async function probe(project: ProjectWithSources): Promise<ProjectProbe> {
  const root = defaultSourcePath(project);
  const rootExists = root !== null && (await pathExists(root));
  return {
    projectId: project.id,
    name: project.name,
    root,
    rootExists,
    iterationText: rootExists ? await readOptional(join(root, FACTORY_FILES.iteration)) : null,
    agentsText: rootExists ? await readOptional(join(root, FACTORY_FILES.agents)) : null,
  };
}

export async function listCandidates(
  sdk: Sdk,
  coursePath: string,
  coachPath: string | null,
  factoryHint: string | null,
): Promise<CandidateProject[]> {
  const projects = await sdk.projects.list({ includePersonal: false });
  const context: CandidateContext = {
    coursePath,
    coachFileName: basename(coachPath ?? COURSE_FILES.defaultCoach),
  };
  const probes = await Promise.all(projects.filter((project) => project.kind === "standard").map(probe));
  return rankCandidates(
    probes.map((entry) => describeCandidate(entry, context)),
    factoryHint,
  );
}
