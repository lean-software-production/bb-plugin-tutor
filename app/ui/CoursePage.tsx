// The one navPanel ("Course"), routed by sub-path (shared/routes.ts, plus a
// lesson's Rule: model/course-route.ts). It also publishes the route so the
// outline can tell which lesson is on screen, because BB passes the outline
// activeThreadId: null on plugin pages.
import { useEffect } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { formatRoute } from "../../shared/routes.ts";
import { useCourseNavigate, useLiveRefresh, useOverview } from "../hooks.ts";
import { parseCoursePath } from "../model/course-route.ts";
import { homeDecision } from "../model/home.ts";
import { routeStore } from "../state/app-state.ts";
import { ErrorNotice, Loading, PaperPage } from "./common.tsx";
import { CompletionPage } from "./CompletionPage.tsx";
import { StartPage } from "./StartPage.tsx";
import { WelcomePage } from "./WelcomePage.tsx";

export function CoursePage({ subPath }: PluginNavPanelProps) {
  useLiveRefresh();
  const { route, ruleKey } = parseCoursePath(subPath);
  useEffect(() => {
    routeStore.set(route);
    return () => routeStore.set(null);
    // The route is a fresh object each render; its sub-path is its identity.
  }, [subPath]);

  switch (route.kind) {
    case "home":
      return <CourseHome />;
    case "welcome":
      return <WelcomePage />;
    case "start":
      return <StartPage key={route.lessonId} lessonId={route.lessonId} ruleKey={ruleKey} />;
    case "complete":
      return <CompletionPage key={route.lessonId} lessonId={route.lessonId} />;
  }
}

function CourseHome() {
  const overview = useOverview();
  const goCourse = useCourseNavigate();
  const decision = overview.data === null ? null : homeDecision(overview.data);
  const target = decision?.kind === "redirect" ? decision.route : null;
  const targetPath = target === null ? null : formatRoute(target);
  useEffect(() => {
    if (target !== null) goCourse(target, { replace: true });
    // Redirect once per destination, not once per render.
  }, [targetPath, goCourse]);

  if (overview.status === "error" && overview.data === null) {
    return (
      <PaperPage>
        <ErrorNotice message={overview.error} />
      </PaperPage>
    );
  }
  if (decision?.kind === "error") {
    return (
      <PaperPage>
        <p className="tp-eyebrow">Tutor</p>
        <h1 className="tp-h1">The course could not be loaded</h1>
        <ErrorNotice message={decision.message} />
        <p className="tp-prose">
          Tutor reads the course from the <code>coursePath</code> setting, then <code>TUTOR_COURSE_PATH</code>, then the
          tutor feature's config, then <code>/workspaces/tutorial</code>. Check that the course is checked out there, or set
          the path under Settings → Plugins → Tutor.
        </p>
      </PaperPage>
    );
  }
  return (
    <PaperPage>
      <Loading label="Opening your course…" />
    </PaperPage>
  );
}
