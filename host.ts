// bb-plugin-tutor host entry: what the server half asks of the student's
// machine, run there by BB's host daemon. Declared as `bb.host` in package.json.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./host/contract.ts";
import { inspect } from "./host/inspect.ts";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    inspect: (input) => inspect(input),
    // adoptLesson: Task 10; seedWorkspace: Task 11
  },
});
