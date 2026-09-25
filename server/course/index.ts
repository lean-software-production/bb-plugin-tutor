// CONTENT's entry point: the backend imports only this file.
import type { CourseSource } from "../../shared/ports.ts";
import { loadCourse } from "./load-course.ts";

export function createCourseSource(): CourseSource {
  return { loadCourse };
}
