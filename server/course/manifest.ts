// What a course is made of before any lesson is read: course.yaml when the
// course has one, otherwise what ledger.ts works out from the ledger table.
import { resolve } from "node:path";
import { z } from "zod";
import { lessonIdSchema } from "../../shared/model.ts";
import { CourseLoadError } from "../../shared/ports.ts";
import { isInside } from "../paths.ts";
import { readYaml } from "./yaml-file.ts";

export interface LessonEntry {
  id: string;
  title: string;
  set: string | null;
  /** Absolute. */
  dir: string;
}

export interface CourseManifest {
  id: string;
  title: string;
  description: string | null;
  /** Absolute; the file named by `coach`, or null when there is none. */
  coachPath: string | null;
  /** Absolute; the file named by `lexicon`, or null when there is none. */
  lexiconPath: string | null;
  lessons: LessonEntry[];
}

const text = z
  .string({ error: (issue) => (issue.input === undefined ? "is missing" : "should be text") })
  .trim()
  .min(1, "should not be empty");

const courseYamlSchema = z.object({
  id: text,
  title: text,
  description: z.string().optional(),
  coach: text.optional(),
  lexicon: text.optional(),
  lessons: z
    .array(z.object({ id: lessonIdSchema, title: text, set: z.string().optional(), dir: text }))
    .min(1, "should list at least one lesson"),
});

/**
 * Parses course.yaml. Paths in it are relative to `root` and may not leave it
 * as written; load-course.ts checks where symbolic links lead.
 * Every scalar is read as a string, so ids keep their leading zeros.
 */
export function parseCourseYaml(source: string, root: string, displayPath: string): CourseManifest {
  const { data, lineOf } = readYaml(source, displayPath, "failsafe");
  const parsed = courseYamlSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path ?? [];
    const field = path.length > 0 ? `${path.map(String).join(".")} ` : "";
    throw new CourseLoadError(
      `Could not read ${displayPath}, line ${lineOf(path)}: ${field}${issue?.message ?? "is not valid"}`,
    );
  }
  const course = parsed.data;
  const inside = (value: string, path: PropertyKey[]): string => {
    const absolute = resolve(root, value);
    if (!isInside(root, absolute)) {
      throw new CourseLoadError(
        `Could not read ${displayPath}, line ${lineOf(path)}: ${value} is outside the course folder.`,
      );
    }
    return absolute;
  };
  return {
    id: course.id,
    title: course.title,
    description: course.description?.trim() || null,
    coachPath: course.coach === undefined ? null : inside(course.coach, ["coach"]),
    lexiconPath: course.lexicon === undefined ? null : inside(course.lexicon, ["lexicon"]),
    lessons: course.lessons.map((lesson, index) => ({
      id: lesson.id,
      title: lesson.title,
      set: lesson.set?.trim() || null,
      dir: inside(lesson.dir, ["lessons", index, "dir"]),
    })),
  };
}
