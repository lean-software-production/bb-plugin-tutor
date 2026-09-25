// First run (mockup 8): confirm the detected factory project (8A) or explain
// how to create one (8B). The plugin never creates the project itself.
import { useEffect, useState } from "react";
import type { Binding, CandidateProject } from "../../shared/rpc.ts";
import { refreshAll, useAction, useCourseNavigate, useOverview, useQuery, useStore, useTutorRpc } from "../hooks.ts";
import { homeDecision } from "../model/home.ts";
import { welcomeView } from "../model/welcome.ts";
import { QUERY_KEYS, queryCache, railMountedStore } from "../state/app-state.ts";
import { ErrorNotice, Loading, Notice, PaperPage } from "./common.tsx";

const COURSE_METHOD =
  "Each homework is a spec written in Gherkin; your coach works through it with you, one rule at a time, in the repo where your factory lives.";

export function WelcomePage() {
  const rpc = useTutorRpc();
  const overview = useOverview();
  const candidates = useQuery(QUERY_KEYS.candidates, () => rpc.call("listCandidateProjects", null));
  const railMounted = useStore(railMountedStore);
  const course = overview.data?.course ?? null;

  return (
    <PaperPage roomy>
      <p className="tp-eyebrow">Welcome</p>
      <h1 className="tp-h1">{course?.title ?? "Your course"}</h1>
      {candidates.data === null || overview.data === null ? (
        candidates.status === "error" || overview.status === "error" ? (
          <ErrorNotice message={candidates.error ?? overview.error} />
        ) : (
          <Loading label="Looking for your factory project…" />
        )
      ) : (
        <Picker
          candidates={candidates.data.projects}
          binding={overview.data.binding}
          description={course?.description ?? null}
        />
      )}
      {railMounted ? null : (
        <p className="tp-tip">
          Tip: turn on the course rail under <b>Settings → Appearance → Sidebar</b>, and pick <b>Course rail</b>.
        </p>
      )}
    </PaperPage>
  );
}

function Picker({
  candidates,
  binding,
  description,
}: {
  candidates: readonly CandidateProject[];
  binding: Binding;
  description: string | null;
}) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const view = welcomeView(candidates, binding);
  const [selected, setSelected] = useState<string | null>(view.preselected);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setSelected((current) => current ?? view.preselected), [view.preselected]);
  const confirm = useAction(async () => {
    if (selected === null) return;
    await rpc.call("confirmFactory", { projectId: selected });
    // Decide from a fresh overview: the cached one still says "unbound".
    const decision = homeDecision(await rpc.call("getOverview", null));
    refreshAll();
    goCourse(decision.kind === "redirect" ? decision.route : { kind: "home" }, { replace: true });
  });

  const listed = view.mode === "confirm" && !showAll ? view.detected : [...view.detected, ...view.others];
  return (
    <>
      {view.missingProjectId === null ? null : (
        <Notice>The factory project you chose before has gone, or has no local checkout. Pick it again or choose another.</Notice>
      )}
      <p className="tp-dek">
        {view.mode === "confirm"
          ? `${description === null ? "" : `${description} `}${COURSE_METHOD}`
          : "Your coach needs a factory repo to work in, and none of this codespace's projects has one yet."}
      </p>
      {view.mode === "setup" ? (
        <div className="tp-howto">
          <p className="tp-section-label">Set one up</p>
          <ol>
            <li>
              Open a terminal in the course checkout (usually <code>/workspaces/tutorial</code>) and start any coding agent.
            </li>
            <li>
              Say <b>coach me</b>. It creates your factory repo, for example <code>/workspaces/my-factory</code>.
            </li>
            <li>Add that repo to BB as a project, then come back here.</li>
          </ol>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={() => queryCache.invalidate((key) => key === QUERY_KEYS.candidates)}>
            Check again
          </button>
        </div>
      ) : null}
      {listed.length === 0 ? null : (
        <>
          {view.mode === "setup" ? <p className="tp-section-label tp-pick-label">Or use one of these projects anyway</p> : null}
          <div className="tp-picker" role="radiogroup" aria-label="Factory project">
            {listed.map((project) => (
              <button
                key={project.projectId}
                type="button"
                role="radio"
                aria-checked={selected === project.projectId}
                className={`tp-pk${selected === project.projectId ? " tp-pk--sel" : ""}${project.qualifies ? "" : " tp-pk--dis"}`}
                onClick={() => setSelected(project.projectId)}
              >
                <span className="tp-r" aria-hidden />
                <span>
                  <span className="tp-nm">{project.name}</span>
                  <span className="tp-pth">{project.root ?? "no local checkout"}</span>
                </span>
                <span className={project.qualifies ? "tp-v tp-v--ok" : "tp-v"}>
                  {project.qualifies ? "✓ " : ""}
                  {project.detail}
                </span>
              </button>
            ))}
          </div>
          <div className="tp-continue">
            <button type="button" className="tp-btn tp-btn--big" disabled={selected === null || confirm.pending} onClick={() => void confirm.run()}>
              {confirm.pending ? "Saving…" : "Start the course →"}
            </button>
            {view.mode === "confirm" && view.others.length > 0 ? (
              <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Only show detected projects" : "Use a different project"}
              </button>
            ) : null}
          </div>
          {confirm.error === null ? null : <ErrorNotice message={confirm.error} />}
        </>
      )}
    </>
  );
}
