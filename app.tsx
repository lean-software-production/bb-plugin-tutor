// bb-plugin-tutor frontend entry: registers every Tutor surface. The screens
// live in app/ui/ and their logic in app/model/ (see docs/tutor/IMPLEMENTATION.md,
// "Frontend surfaces").
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DIRECTIVE_NAMES, NAV_PANEL_PATH, SLOT_IDS } from "./shared/constants.ts";
import { CoursePage } from "./app/ui/CoursePage.tsx";
import { LessonCardDirective, ProgressCardDirective, TermDirective } from "./app/ui/Directives.tsx";
import { ContinueSection, CourseAccessory } from "./app/ui/Home.tsx";
import { CourseRail } from "./app/ui/Rail.tsx";
import { RuleTab } from "./app/ui/RuleTab.tsx";
import { SimpleNavigation } from "./app/ui/SimpleNavigation.tsx";
import { mountActivityReporter } from "./app/activity.ts";
import "./app/paper.css";
import "./app/styles/rail.css";
import "./app/styles/lesson.css";
import "./app/styles/pages.css";
import "./app/styles/chat.css";
import "./app/styles/panels.css";
import "./app/styles/nav.css";

export default definePluginApp((app) => {
  // Reports the student's activity so the Codespace is not idle-stopped under them.
  app.contentScripts.register({ id: SLOT_IDS.activity, mount: mountActivityReporter });
  app.slots.experimental_sidebarNavigation({
    id: SLOT_IDS.sidebarNavigation,
    title: "Course navigation",
    description: "BB's navigation without the Plugins and Skills rows (Tutor's simpleNavigation setting).",
    component: SimpleNavigation,
  });
  app.slots.experimental_threadList({
    id: SLOT_IDS.threadList,
    title: "Course outline",
    description: "The course as one tree: each lesson, its coach thread and side chats, and the Rules your coach works through.",
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
  app.slots.messageDirective({ id: DIRECTIVE_NAMES.lesson, component: LessonCardDirective });
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
