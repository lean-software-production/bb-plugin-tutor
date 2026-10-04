// CONTENT's entry point: the backend imports only this file.
import type { CourseSource } from "../../shared/ports.ts";
import { loadBuiltinCourse, loadCourse } from "./load-course.ts";

export function createCourseSource(): CourseSource {
  return { loadCourse, loadBuiltin: loadBuiltinCourse };
}
