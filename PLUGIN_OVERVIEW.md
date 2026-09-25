Turn a course codespace's BB into a coached course.

## What you get

- **A course rail** in the sidebar: the homeworks, the Rules of the one you are on, and your
  conversations with the coach.
- **Lesson pages** where the homework's spec leads straight into the coach thread, with every
  Example of the Rule in focus shown as annotated Gherkin.
- **A coach per homework** that works one Gherkin Rule at a time and records which Examples hold,
  with evidence, in your own repo.

## How it works

The course is a git repo of homework specs (Gherkin feature files plus prose). Your progress lives
in your factory repo, in `spec/ITERATION` and `spec/PROGRESS.yaml`, so it survives the codespace
and still works if you carry on with a coding agent outside BB. The plugin never creates projects
and never edits the course.
