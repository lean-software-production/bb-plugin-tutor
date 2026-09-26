// First run: which BB projects look like the student's factory repo. Tutor
// suggests and the student confirms; it never creates a project.
import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { COURSE_FILES, FACTORY_FILES } from "../../shared/constants.ts";
import type { CandidateProject } from "../../shared/rpc.ts";
import { overlaps } from "../paths.ts";
import { ITERATION_FILES, parseIteration } from "../progress/iteration.ts";
import { defaultSourcePath, pathExists, type ProjectWithSources } from "../coach/factory-project.ts";

type Sdk = BbPluginApi["sdk"];

export interface ProjectProbe {
  projectId: string;
  name: string;
  root: string | null;
  rootExists: boolean;
  /** ITERATION's text (the root file, else the legacy spec/ITERATION), or null when both are absent. */
  iterationText: string | null;
  /** AGENTS.md's text, or null when it is absent. */
  agentsText: string | null;
}

interface CandidateContext {
  coursePath: string;
  /**
   * The coach file's name without its extension, which a coach-me-made
   * AGENTS.md names: "coach-me" matches both coach-me.md and the starter's
   * **coach-me** skill.
   */
  coachName: string;
}

export function describeCandidate(probe: ProjectProbe, context: CandidateContext): CandidateProject {
  const base = { projectId: probe.projectId, name: probe.name, root: probe.root };
  if (probe.root === null || !probe.rootExists) return { ...base, qualifies: false, detail: "no folder on this machine" };
  if (resolve(probe.root) === resolve(context.coursePath)) return { ...base, qualifies: false, detail: "the course itself" };
  if (overlaps(probe.root, context.coursePath)) return { ...base, qualifies: false, detail: "shares a folder with the course" };
  if (probe.iterationText !== null) {
    const parsed = parseIteration(probe.iterationText, FACTORY_FILES.iteration);
    const state = "state" in parsed ? `${parsed.state.iteration} ${parsed.state.status}` : "unreadable";
    return { ...base, qualifies: true, detail: `${FACTORY_FILES.iteration} · ${state}` };
  }
  if (probe.agentsText?.includes(context.coachName) === true) {
    return { ...base, qualifies: true, detail: "AGENTS.md points at the course" };
  }
  return { ...base, qualifies: false, detail: `no ${FACTORY_FILES.iteration}` };
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

async function readIterationText(root: string): Promise<string | null> {
  for (const file of ITERATION_FILES) {
    const text = await readOptional(join(root, file));
    if (text !== null) return text;
  }
  return null;
}

async function probe(project: ProjectWithSources): Promise<ProjectProbe> {
  const root = defaultSourcePath(project);
  const rootExists = root !== null && (await pathExists(root));
  return {
    projectId: project.id,
    name: project.name,
    root,
    rootExists,
    iterationText: rootExists ? await readIterationText(root) : null,
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
  const coachFile = basename(coachPath ?? COURSE_FILES.defaultCoach);
  const context: CandidateContext = { coursePath, coachName: basename(coachFile, extname(coachFile)) };
  const probes = await Promise.all(projects.filter((project) => project.kind === "standard").map(probe));
  return rankCandidates(
    probes.map((entry) => describeCandidate(entry, context)),
    factoryHint,
  );
}
