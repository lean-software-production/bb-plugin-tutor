import { resolveCurrent } from "../../shared/derive.ts";
import { fixtureBinding, fixtureCourse, fixtureStudent } from "../../shared/fixtures.ts";
import type { Course, StudentState } from "../../shared/model.ts";
import type { Binding } from "../../shared/rpc.ts";
import type { World } from "../../server/coach/world.ts";

export function makeWorld(
  student: StudentState = fixtureStudent,
  binding: Binding = fixtureBinding,
  course: Course = fixtureCourse,
): World {
  const effective = binding.status === "bound" ? student : { iteration: null, progress: null, problems: [] };
  return {
    coursePath: course.root,
    course,
    courseError: null,
    binding,
    factoryHostId: binding.status === "bound" ? "host_1" : null,
    student: effective,
    pointer: resolveCurrent(course, effective),
    factoryHint: null,
  };
}
