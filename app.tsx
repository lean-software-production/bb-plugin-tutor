// bb-plugin-tutor frontend entry: registers every Tutor surface. The screens
// live in app/ui/ and their logic in app/model/ (see docs/tutor/IMPLEMENTATION.md,
// "Frontend surfaces").
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DIRECTIVE_NAMES, NAV_PANEL_PATH, SLOT_IDS } from "./shared/constants.ts";
import { CoursePage } from "./app/ui/CoursePage.tsx";
import { LessonCardDirective, ProgressCardDirective, TermDirective } from "./app/ui/Directives.tsx";
import { ContinueSection, CourseAccessory } from "./app/ui/Home.tsx";
import { CourseOutline } from "./app/ui/Outline.tsx";
import { RuleTab } from "./app/ui/RuleTab.tsx";
import { SimpleNavigation } from "./app/ui/SimpleNavigation.tsx";
import { withWobbleDefs } from "./app/ui/sketch/index.ts";
import { mountActivityReporter } from "./app/activity.ts";
import "./app/sketchbook.css";
import "./app/styles/atoms.css";
import "./app/styles/outline.css";
import "./app/styles/lesson.css";
import "./app/styles/pages.css";
import "./app/styles/chat.css";
import "./app/styles/panels.css";
import "./app/styles/nav.css";
import "./app/styles/motion.css";

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
    component: withWobbleDefs(CourseOutline),
  });
  app.slots.navPanel({
    id: SLOT_IDS.navPanel,
    title: "Course",
    icon: "FileText",
    path: NAV_PANEL_PATH,
    component: withWobbleDefs(CoursePage),
    experimental_sidebarAccessory: withWobbleDefs(CourseAccessory),
  });
  app.slots.messageDirective({ id: DIRECTIVE_NAMES.lesson, component: withWobbleDefs(LessonCardDirective) });
  app.slots.messageDirective({ id: DIRECTIVE_NAMES.progress, component: withWobbleDefs(ProgressCardDirective) });
  app.slots.messageDirective({ id: DIRECTIVE_NAMES.term, component: withWobbleDefs(TermDirective) });
  app.slots.homepageSection({
    id: SLOT_IDS.homepageSection,
    title: "Continue your course",
    component: withWobbleDefs(ContinueSection),
  });
  app.slots.threadPanelAction({
    id: SLOT_IDS.ruleTab,
    title: "Rule",
    icon: "FileText",
    layout: "flush",
    component: withWobbleDefs(RuleTab),
    run: ({ openPanel }) => {
      openPanel({ title: "Rule" });
    },
  });
});
