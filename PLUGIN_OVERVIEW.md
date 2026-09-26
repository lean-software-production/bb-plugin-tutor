Turn a course codespace's BB into a coached course.

## What you get

- **A course outline** in the sidebar: every lesson, and under the one you are on its coach
  thread, its side chats and its Rules. A Rule takes you to where the coach started it.
- **A coach thread per lesson** in BB's own thread view. It opens with the lesson card, each Rule
  starts at a Rule card with its Examples as annotated Gherkin, and side questions go to BB side
  chats beside it.
- **Progress with evidence**: the coach works one Gherkin Rule at a time and records which Examples
  hold, with evidence, in your own repo.

## How it works

The course is a git repo of lesson specs (Gherkin feature files plus prose). Your progress lives
in your factory repo, in `ITERATION` and `spec/PROGRESS.yaml`, so it survives the codespace
and still works if you carry on with a coding agent outside BB. The plugin never creates projects
and never edits the course.

## Installing

- **In a course Codespace**, the `tutor` devcontainer Feature
  ([devcontainer-features](https://github.com/lean-software-production/devcontainer-features/tree/main/src/tutor))
  installs a pinned release of this plugin and sets up everything else: the course checkout, the
  factory project, the outline in the sidebar and the paper theme.
- **In any other BB**, install it with
  `bb plugin install git:https://github.com/lean-software-production/bb-plugin-tutor@v0.1.0`.
  There is then no Feature config, so point the `coursePath` setting at a course checkout (or
  keep the course at `/workspaces/tutorial`), register your factory repo as a BB project, and
  confirm it on the first-run page. Until Tutor finds a course, it says where it looked.

Source, releases and developer docs:
[lean-software-production/bb-plugin-tutor](https://github.com/lean-software-production/bb-plugin-tutor).
