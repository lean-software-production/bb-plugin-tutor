// bb-plugin-tutor frontend entry: registers every Tutor surface. The screens
// live in app/ui/ and their logic in app/model/ (see docs/tutor/IMPLEMENTATION.md,
// "Frontend surfaces").
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DIRECTIVE_NAMES, NAV_PANEL_PATH, SLOT_IDS } from "./shared/constants.ts";
import { CoursePage } from "./app/ui/CoursePage.tsx";
import { ProgressCardDirective, TermDirective } from "./app/ui/Directives.tsx";
import { ContinueSection, CourseAccessory } from "./app/ui/Home.tsx";
import { CourseRail } from "./app/ui/Rail.tsx";
import { RuleTab } from "./app/ui/RuleTab.tsx";
import "./app/paper.css";
import "./app/styles/rail.css";
import "./app/styles/lesson.css";
import "./app/styles/pages.css";
import "./app/styles/chat.css";
import "./app/styles/panels.css";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: SLOT_IDS.threadList,
    title: "Course rail",
    description: "The course: homeworks, the Rules of the current one, and your conversations.",
    component: CourseRail,
  });
  app.slots.navPanel({
    id: SLOT_IDS.navPanel,
    title: "Course",
    icon: "FileText",
    path: NAV_PANEL_PATH,
    component: CoursePage,
    experimental_sidebarAccessory: CourseAccessory,
  });
  app.slots.messageDirective({ id: DIRECTIVE_NAMES.progress, component: ProgressCardDirective });
  app.slots.messageDirective({ id: DIRECTIVE_NAMES.term, component: TermDirective });
  app.slots.homepageSection({
    id: SLOT_IDS.homepageSection,
    title: "Continue your course",
    component: ContinueSection,
  });
  app.slots.threadPanelAction({
    id: SLOT_IDS.ruleTab,
    title: "Rule",
    icon: "FileText",
    layout: "flush",
    component: RuleTab,
    run: ({ openPanel }) => {
      openPanel({ title: "Rule" });
    },
  });
});
