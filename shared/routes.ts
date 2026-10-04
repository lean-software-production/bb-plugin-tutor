// Sub-routes of the single navPanel at /plugins/tutor/course/<subPath>.
// The outline works out the active lesson from this route, because BB passes
// activeThreadId as null on plugin pages. Lesson ids repeat across courses,
// so a lesson's route names its course too.
//
//   ""                          home: redirects to the current lesson, or to welcome
//   "welcome"                   first run: confirm or pick the workspace (screen 8)
//   "start/<course>/003"        start page, or the lesson's coach thread once it has one
//   "complete/<course>/003"     between lessons (screen 7)
//
// A route from before courses ("start/003") still parses, with no course: the
// frontend resolves it to the built-in course for Lesson 0, else to the only
// other course (app/model/course-route.ts).
const LESSON_ID = /^\d{3}$/;

export type TutorRoute =
  | { kind: "home" }
  | { kind: "welcome" }
  | { kind: "start"; courseId: string | null; lessonId: string }
  | { kind: "complete"; courseId: string | null; lessonId: string };

function decoded(text: string): string | null {
  try {
    const value = decodeURIComponent(text);
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/** Unknown or malformed sub-paths are treated as home. */
export function parseRoute(subPath: string): TutorRoute {
  const [head = "", first = "", second, ...rest] = subPath.replace(/^\/+|\/+$/g, "").split("/");
  if (head === "welcome" && first === "" && second === undefined) return { kind: "welcome" };
  if ((head !== "start" && head !== "complete") || rest.length > 0) return { kind: "home" };
  if (second === undefined) return LESSON_ID.test(first) ? { kind: head, courseId: null, lessonId: first } : { kind: "home" };
  const courseId = decoded(first);
  return courseId !== null && LESSON_ID.test(second) ? { kind: head, courseId, lessonId: second } : { kind: "home" };
}

export function formatRoute(route: TutorRoute): string {
  switch (route.kind) {
    case "home":
      return "";
    case "welcome":
      return "welcome";
    case "start":
    case "complete":
      return route.courseId === null
        ? `${route.kind}/${route.lessonId}`
        : `${route.kind}/${encodeURIComponent(route.courseId)}/${route.lessonId}`;
  }
}
