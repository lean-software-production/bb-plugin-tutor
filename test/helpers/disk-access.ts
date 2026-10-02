// A WorkspaceAccess over this machine's disk, for tests: what the machine's host entry does, without BB.
// Its body lives in server/workspace/local-access.ts until Task 8 moves it here.
export { createLocalAccess as createDiskAccess } from "../../server/workspace/local-access.ts";
