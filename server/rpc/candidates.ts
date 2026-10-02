// First run: which BB projects look like the student's repo. Tutor suggests
// and the student confirms; it never creates a project. A capstone-project-
// starter clone qualifies by its layout (tetris/.factory, factory/, or the
// coach-me skill); a folder that is a factory itself, as before, by its
// ITERATION or an AGENTS.md naming the coach. Each project's folder is probed
// through the WorkspaceAccess of the machine holding it.
import { basename, extname, join, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ITERATION_FILES, parseIteration } from "../../layouts/progress/iteration.ts";
import { COURSE_FILES, FACTORY_FILES, STARTER_COACH_SKILL, STARTER_LAYOUT } from "../../shared/constants.ts";
import type { CandidateProject } from "../../shared/rpc.ts";
import { overlaps } from "../paths.ts";
import type { WorkspaceAccess } from "../workspace/access.ts";
import { defaultSource, pathExists, type AccessFor, type ProjectWithSources } from "../workspace/workspace-project.ts";

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
   * (factory/ wins, as in layouts/capstone-factory/detect.ts), or null with only the coach-me skill.
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

async function readOptional(access: WorkspaceAccess, path: string): Promise<string | null> {
  return access.read(path).then(
    (file) => file?.text ?? null,
    () => null,
  );
}

async function readIterationText(access: WorkspaceAccess, root: string): Promise<string | null> {
  for (const file of ITERATION_FILES) {
    const text = await readOptional(access, join(root, file));
    if (text !== null) return text;
  }
  return null;
}

/** Whether `root` is a starter clone, and which factory folder it holds. */
async function starterOf(access: WorkspaceAccess, root: string): Promise<{ factory: string | null } | undefined> {
  const folders = [STARTER_LAYOUT.lateFactory, STARTER_LAYOUT.earlyFactory];
  const skill = join(root, STARTER_COACH_SKILL);
  const kinds = await access.kinds([...folders.map((folder) => join(root, folder)), skill]);
  for (const folder of folders) {
    if (kinds[join(root, folder)] === "folder") return { factory: folder === STARTER_LAYOUT.lateFactory ? `${folder}/` : folder };
  }
  const skillKind = kinds[skill] ?? "none";
  const hasSkill = skillKind === "link" ? await pathExists(access, skill) : skillKind !== "none";
  return hasSkill ? { factory: null } : undefined;
}

async function probe(project: ProjectWithSources, accessFor: AccessFor): Promise<ProjectProbe> {
  const source = defaultSource(project);
  const root = source?.path ?? null;
  const access = source === undefined ? null : accessFor(source.hostId);
  const rootExists = root !== null && access !== null && (await pathExists(access, root));
  const base = { projectId: project.id, name: project.name, root, rootExists };
  if (root === null || access === null || !rootExists) return { ...base, iterationText: null, agentsText: null };
  const starter = await starterOf(access, root);
  if (starter !== undefined) {
    const factory = starter.factory === null ? null : join(root, starter.factory);
    return { ...base, iterationText: factory === null ? null : await readIterationText(access, factory), agentsText: null, starter };
  }
  return {
    ...base,
    iterationText: await readIterationText(access, root),
    agentsText: await readOptional(access, join(root, FACTORY_FILES.agents)),
  };
}

export async function listCandidates(
  sdk: Sdk,
  accessFor: AccessFor,
  coursePath: string,
  coachPath: string | null,
  projectHint: string | null,
): Promise<CandidateProject[]> {
  const projects = await sdk.projects.list({ includePersonal: false });
  const coachFile = basename(coachPath ?? COURSE_FILES.defaultCoach);
  const context: CandidateContext = { coursePath, coachName: basename(coachFile, extname(coachFile)) };
  const probes = await Promise.all(projects.filter((project) => project.kind === "standard").map((project) => probe(project, accessFor)));
  return rankCandidates(
    probes.map((entry) => describeCandidate(entry, context)),
    projectHint,
  );
}
