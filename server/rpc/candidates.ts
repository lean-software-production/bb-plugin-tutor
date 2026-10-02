// First run: which BB projects look like the student's repo. Tutor suggests
// and the student confirms; it never creates a project. A capstone-project-
// starter clone qualifies by its layout (tetris/.factory, factory/, or the
// coach-me skill); a folder that is a factory itself, as before, by its
// ITERATION or an AGENTS.md naming the coach.
import { lstat, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { COURSE_FILES, FACTORY_FILES, STARTER_COACH_SKILL, STARTER_LAYOUT } from "../../shared/constants.ts";
import type { CandidateProject } from "../../shared/rpc.ts";
import { overlaps } from "../paths.ts";
import { ITERATION_FILES, parseIteration } from "../progress/iteration.ts";
import { defaultSourcePath, pathExists, type ProjectWithSources } from "../workspace/workspace-project.ts";

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
  /**
   * Set when the folder is a starter clone: which factory folder it holds
   * (factory/ wins, as in layout.ts), or null with only the coach-me skill.
   * `iterationText` is then the factory's ITERATION.
   */
  starter?: { factory: string | null };
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
  if (probe.starter !== undefined) {
    const where = probe.starter.factory === null ? "no factory folder yet" : `factory in ${probe.starter.factory}`;
    const iteration = probe.iterationText === null ? "" : ` · ${iterationDetail(probe.iterationText)}`;
    return { ...base, qualifies: true, detail: `starter clone · ${where}${iteration}` };
  }
  if (probe.iterationText !== null) {
    return { ...base, qualifies: true, detail: iterationDetail(probe.iterationText) };
  }
  if (probe.agentsText?.includes(context.coachName) === true) {
    return { ...base, qualifies: true, detail: "AGENTS.md points at the course" };
  }
  return { ...base, qualifies: false, detail: `no ${FACTORY_FILES.iteration}` };
}

function iterationDetail(text: string): string {
  const parsed = parseIteration(text, FACTORY_FILES.iteration);
  const state = "state" in parsed ? `${parsed.state.iteration} ${parsed.state.status}` : "unreadable";
  return `${FACTORY_FILES.iteration} · ${state}`;
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

async function isFolder(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isDirectory() === true;
}

/** Whether `root` is a starter clone, and which factory folder it holds. */
async function starterOf(root: string): Promise<{ factory: string | null } | undefined> {
  for (const folder of [STARTER_LAYOUT.lateFactory, STARTER_LAYOUT.earlyFactory]) {
    if (await isFolder(join(root, folder))) return { factory: folder === STARTER_LAYOUT.lateFactory ? `${folder}/` : folder };
  }
  return (await pathExists(join(root, STARTER_COACH_SKILL))) ? { factory: null } : undefined;
}

async function probe(project: ProjectWithSources): Promise<ProjectProbe> {
  const root = defaultSourcePath(project);
  const rootExists = root !== null && (await pathExists(root));
  const base = { projectId: project.id, name: project.name, root, rootExists };
  if (root === null || !rootExists) return { ...base, iterationText: null, agentsText: null };
  const starter = await starterOf(root);
  if (starter !== undefined) {
    const factory = starter.factory === null ? null : join(root, starter.factory);
    return { ...base, iterationText: factory === null ? null : await readIterationText(factory), agentsText: null, starter };
  }
  return { ...base, iterationText: await readIterationText(root), agentsText: await readOptional(join(root, FACTORY_FILES.agents)) };
}

export async function listCandidates(
  sdk: Sdk,
  coursePath: string,
  coachPath: string | null,
  projectHint: string | null,
): Promise<CandidateProject[]> {
  const projects = await sdk.projects.list({ includePersonal: false });
  const coachFile = basename(coachPath ?? COURSE_FILES.defaultCoach);
  const context: CandidateContext = { coursePath, coachName: basename(coachFile, extname(coachFile)) };
  const probes = await Promise.all(projects.filter((project) => project.kind === "standard").map(probe));
  return rankCandidates(
    probes.map((entry) => describeCandidate(entry, context)),
    projectHint,
  );
}
