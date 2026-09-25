import { resolveCurrent } from "../../shared/derive.ts";
import { fixtureFactoryProject, fixtureCourse, fixtureStudent } from "../../shared/fixtures.ts";
import type { Course, StudentState } from "../../shared/model.ts";
import type { FactoryProject } from "../../shared/rpc.ts";
import type { World } from "../../server/coach/world.ts";

export function makeWorld(
  student: StudentState = fixtureStudent,
  factoryProject: FactoryProject = fixtureFactoryProject,
  course: Course = fixtureCourse,
): World {
  const effective = factoryProject.status === "found" ? student : { iteration: null, progress: null, problems: [] };
  return {
    coursePath: course.root,
    course,
    courseError: null,
    factoryProject,
    factoryHostId: factoryProject.status === "found" ? "host_1" : null,
    student: effective,
    pointer: resolveCurrent(course, effective),
    factoryHint: null,
  };
}
