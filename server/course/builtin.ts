// Where Tutor's own course (Homework 0) ships. Path installs run the plugin's
// TypeScript sources in place, so this module's URL locates the folder.
import { fileURLToPath } from "node:url";

export const BUILTIN_COURSE_ROOT = fileURLToPath(new URL("./builtin/", import.meta.url)).replace(/\/$/, "");
