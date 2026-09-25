// Adopting a homework's spec, exactly as the course's coach-me does it:
// spec/ holds only the homework's README.md, FACTORY.md and features/ (plus
// Tutor's own ITERATION and PROGRESS.yaml), and a sample seed is copied into
// seeds/ unless it is already there.
import { access, copyFile, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FACTORY_FILES } from "../../shared/constants.ts";
import { slugify } from "../../shared/keys.ts";
import type { Homework } from "../../shared/model.ts";

const KEPT_IN_SPEC = new Set([basename(FACTORY_FILES.iteration), basename(FACTORY_FILES.progress)]);
const SPEC_FILES = ["README.md", "FACTORY.md"];
const FEATURES_DIR = "features";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The seed's file name: its `#` title slugified ("# Tetris" → tetris.md), as coach-me names 001's. */
export function seedFileName(seed: string, homeworkId: string): string {
  const title = /^#\s+(.+)$/m.exec(seed)?.[1]?.trim();
  return `${title === undefined ? `homework-${homeworkId}` : slugify(title)}.md`;
}

export interface SpecCopyResult {
  /** Paths written, relative to the factory root. */
  written: string[];
  /** The seed's path relative to the factory root, or null when the homework has none. */
  seed: string | null;
  seedAlreadyThere: boolean;
}

export async function copyHomeworkSpec(factoryRoot: string, homework: Homework): Promise<SpecCopyResult> {
  const specDir = join(factoryRoot, FACTORY_FILES.specDir);
  await mkdir(specDir, { recursive: true });
  for (const entry of await readdir(specDir)) {
    if (!KEPT_IN_SPEC.has(entry)) await rm(join(specDir, entry), { recursive: true, force: true });
  }

  const written: string[] = [];
  for (const file of SPEC_FILES) {
    const source = join(homework.dir, file);
    if (!(await exists(source))) continue;
    await copyFile(source, join(specDir, file));
    written.push(`${FACTORY_FILES.specDir}/${file}`);
  }
  const features = join(homework.dir, FEATURES_DIR);
  if (await exists(features)) {
    await cp(features, join(specDir, FEATURES_DIR), { recursive: true });
    written.push(`${FACTORY_FILES.specDir}/${FEATURES_DIR}/`);
  }

  if (homework.seedSpec === null) return { written, seed: null, seedAlreadyThere: false };
  const seed = `${FACTORY_FILES.seedsDir}/${seedFileName(homework.seedSpec, homework.id)}`;
  const seedPath = join(factoryRoot, seed);
  if (await exists(seedPath)) return { written, seed, seedAlreadyThere: true };
  await mkdir(join(factoryRoot, FACTORY_FILES.seedsDir), { recursive: true });
  await writeFile(seedPath, homework.seedSpec, "utf8");
  return { written: [...written, seed], seed, seedAlreadyThere: false };
}
