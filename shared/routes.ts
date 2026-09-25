// Sub-routes of the single navPanel at /plugins/tutor/course/<subPath>.
// The rail works out the active lesson from this route, because BB passes
// activeThreadId as null on plugin pages.
//
//   ""                 home: redirects to the current lesson, or to welcome
//   "welcome"          first run: confirm or pick the factory project (screen 8)
//   "start/003"        start page, or the lesson's coach thread once it has one
//   "complete/003"     between lessons (screen 7)
const LESSON_ID = /^\d{3}$/;

export type TutorRoute =
  | { kind: "home" }
  | { kind: "welcome" }
  | { kind: "start"; lessonId: string }
  | { kind: "complete"; lessonId: string };

/** Unknown or malformed sub-paths are treated as home. */
export function parseRoute(subPath: string): TutorRoute {
  const [head = "", id = "", ...rest] = subPath.replace(/^\/+|\/+$/g, "").split("/");
  if (head === "welcome" && id === "" && rest.length === 0) return { kind: "welcome" };
  if ((head === "start" || head === "complete") && LESSON_ID.test(id) && rest.length === 0) {
    return { kind: head, lessonId: id };
  }
  return { kind: "home" };
}

export function formatRoute(route: TutorRoute): string {
  switch (route.kind) {
    case "home":
      return "";
    case "welcome":
      return "welcome";
    case "start":
    case "complete":
      return `${route.kind}/${route.lessonId}`;
  }
}
