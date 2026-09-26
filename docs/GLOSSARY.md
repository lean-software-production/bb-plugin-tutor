# Tutor glossary

What each Tutor term means and which name to use. The UI, the docs, the coach skill and the code
should all use these names. Where a course's own files keep an older word, the term says so.

- **Course outline** — The tree in BB's sidebar that shows the whole course. Each lesson is a
  top-level row. Under a lesson sit its BB threads: the coach thread and its side chats. Under
  the coach thread sit the lesson's Rules, grouped by Feature, and each Rule links to its
  section. The project's other threads are listed below the outline. Say "outline" when the
  context is clear. It replaces "rail", "course rail" and "conversations tray".

- **Course** — A Git repo of lessons that the Tutor engine can run, described by its
  `course.yaml`. The first course is `lean-software-production/tutorial`. The engine holds no
  lesson content of its own, except the built-in Lesson 0.

- **Tutor** — The course engine. It comes in two parts: the BB plugin `bb-plugin-tutor`, and the
  devcontainer feature `tutor`, which installs and configures that plugin in a course Codespace.

- **Lesson** — One step of a course: a folder `docs/iterations/NNN-*/` holding its README,
  `FACTORY.md` and Gherkin `.feature` files. Lessons are numbered `000`, `001`, and so on.
  Lesson 0 is built into the Tutor and teaches the interface. A lesson is *done*, *current* or
  *ahead*. Say "lesson" in the UI, the docs and the coach's messages. It replaces "homework".
  "Iteration" survives only where the course and the starter already use it: `docs/iterations/`,
  the factory's `ITERATION` file, the starter's `fetch-iteration` skill, and the
  `tutor_adopt_iteration` / `tutor_complete_iteration` tools. The course repo's own README and the
  starter's `coach-me` skill say "homework".

- **Feature** — A Gherkin `Feature:` in a lesson's `.feature` file: a group of Rules. The
  outline shows each one as a small label above its Rules. It's unrelated to devcontainer features
  such as `bb` and `tutor`. Where both could be meant, say "Gherkin Feature" or "devcontainer
  feature".

- **Rule** — A Gherkin `Rule:` and the unit of "you are here": the coach works through one Rule
  at a time. A Rule is *passing* (all its Examples hold), *not yet* (at least one Example doesn't
  hold yet) or *pending* (nothing recorded).

- **Example** — A Gherkin `Example:` (or `Scenario:`) under a Rule. It's the checklist item the
  student's factory must satisfy. Its status is *pending*, *not yet*, *passing* or *skipped*. The
  coach records a status only with evidence.

- **Focus** — The Rule the coach is working on now, drawn as ● in the outline. The coach moves the
  focus with `tutor_focus_rule`, and the student can redirect it with "Work on this Rule next". It
  replaces "cursor".

- **Coach** — The coding agent (Claude Code, Codex or Pi) running the Tutor skill. It coaches the
  student through a lesson, one Rule at a time.

- **Coach thread** — The one BB thread per lesson where the coaching happens. It lives in the
  student's factory project and opens in BB's own thread view.

- **Side chat** — A private branch of the coach thread for a question that shouldn't derail the
  lesson. It's BB's built-in side chat: a hidden fork of the coach thread, opened as a "Side chat"
  tab in the thread's right-hand panel. The Tutor's "Ask a side question" button creates one about
  a Rule. BB's own "Reply in side chat" creates one about a message. Both appear in the outline
  under their lesson. It replaces "side thread". "Ask a side question" stays as the button text
  because it names the action. The coach's tool is `tutor_side_chat`.

- **Section** — The part of the coach thread that covers one Rule. It starts at that Rule's Rule
  card, and clicking the Rule in the outline jumps there. A Rule has no section until the coach
  reaches it, so the outline greys it out.

- **Lesson card** — The card that opens the coach thread: the lesson's title and summary, plus
  all its Rules with live status. The coach writes it as the `::tutor-lesson` directive at the top
  of its first reply.

- **Rule card** — The annotated Gherkin card for one Rule, with its Examples and live status. The
  coach posts it when it moves the focus to a Rule, and it starts that Rule's section. It's the
  `focus` kind of the `::tutor-progress` directive.

- **Progress card** — A card the coach posts in the chat when something changes: an Example
  passes, a Rule passes, an Example isn't there yet, or the lesson is complete. It's the
  `::tutor-progress` directive.

- **Start page** — The Tutor page for a lesson that hasn't been started. It shows the lesson
  and its "Start with your coach" button. Once the coach thread exists, links to the lesson
  open the coach thread instead. It replaces the "lesson page", which used to embed the coach
  chat below the lesson.

- **Factory** — The folder where the student builds their software factory, registered as a BB
  project. In the capstone starter it is `tetris/.factory` in the student's fork of
  `capstone-project-starter`: the fork is the repo, and the factory's parent, `tetris/`, is the
  codebase the factory builds, with the sample seed in `tetris/seeds/`. The factory holds
  `ITERATION`, `spec/` and the fetched `stand-ins/`. The coach threads live in it, and so does the
  progress file. Its BB project is the *factory project* (the `factoryProject` setting).

- **Progress file** — `spec/PROGRESS.yaml` in the factory: each Example's status, its evidence
  and its history. It belongs to the student, so it travels with their repo.

- **Evidence** — What the coach must record before it marks an Example: the command it ran and
  what that command showed. Marking is the coach's judgement, but never without evidence.

- **Carry-over** — When the student starts the next lesson, an Example whose text is unchanged
  (same hash) keeps its passing status instead of resetting to pending.

- **New / reworded** — The badge on a Feature, Rule or Example that's new or reworded compared
  with the previous lesson. It replaces "novelty".

- **Term** — A course word with a pop-up definition in the chat, written as the `::term{id="…"}`
  directive and defined in the course's lexicon (`lexicon.yaml`). The lexicon is the students'
  glossary. This file is the glossary for people building the Tutor.

- **Other threads** — The factory project's threads that don't belong to the course, listed below
  the course outline.

- **Words we don't use** — "rail", "course rail", "tray" and "conversations tray" (say course
  outline); "day chips" and "days strip" (gone: lessons are outline rows); "cursor" (say focus);
  "side thread", or "side question" for the thing itself (say side chat); "main thread" (say coach
  thread); "homework" and "iteration" in the UI (say lesson); "lesson page" (say start page).
