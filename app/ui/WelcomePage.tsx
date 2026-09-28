// First run (mockup 8): confirm the detected factory project (8A) or explain
// how to create one (8B). The plugin never creates the project itself.
import { useEffect, useState } from "react";
import type { FactoryProject, CandidateProject } from "../../shared/rpc.ts";
import { refreshAll, useAction, useCourseNavigate, useOverview, useQuery, useStore, useTutorRpc } from "../hooks.ts";
import { homeDecision } from "../model/home.ts";
import { welcomeView } from "../model/welcome.ts";
import { QUERY_KEYS, queryCache, outlineMountedStore } from "../state/app-state.ts";
import { ErrorNotice, Loading, Notice, SketchPage } from "./common.tsx";
import { Button, Character, Highlight, Panel, Tick } from "./sketch/index.ts";

const COURSE_METHOD =
  "Each lesson is a spec: a plain description of what your factory should do next. Your coach works through it with you, one Rule at a time, in the repo where your factory lives.";

export function WelcomePage() {
  const rpc = useTutorRpc();
  const overview = useOverview();
  const candidates = useQuery(QUERY_KEYS.candidates, () => rpc.call("listCandidateProjects", null));
  const outlineMounted = useStore(outlineMountedStore);
  const course = overview.data?.course ?? null;

  return (
    <SketchPage roomy edge={<Character name="waver" className="tp-edge tp-edge--waver" />}>
      <p className="tp-eyebrow">Welcome</p>
      <h1 className="sk-title tp-page-title">
        <span className="sk-burst">
          <Highlight>{course?.title ?? "Your course"}</Highlight>
        </span>
      </h1>
      {candidates.data === null || overview.data === null ? (
        candidates.status === "error" || overview.status === "error" ? (
          <ErrorNotice message={candidates.error ?? overview.error} />
        ) : (
          <Loading label="Looking for your factory project…" />
        )
      ) : (
        <Picker
          candidates={candidates.data.projects}
          factoryProject={overview.data.factoryProject}
          description={course?.description ?? null}
        />
      )}
      {outlineMounted ? null : (
        <p className="tp-tip">
          Tip: turn on the course outline under <b>Settings → Appearance → Sidebar</b>, and pick <b>Course outline</b>.
        </p>
      )}
    </SketchPage>
  );
}

function Picker({
  candidates,
  factoryProject,
  description,
}: {
  candidates: readonly CandidateProject[];
  factoryProject: FactoryProject;
  description: string | null;
}) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const view = welcomeView(candidates, factoryProject);
  const [selected, setSelected] = useState<string | null>(view.preselected);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setSelected((current) => current ?? view.preselected), [view.preselected]);
  const confirm = useAction(async () => {
    if (selected === null) return;
    await rpc.call("confirmFactory", { projectId: selected });
    // Decide from a fresh overview: the cached one still says "unset".
    const decision = homeDecision(await rpc.call("getOverview", null));
    refreshAll();
    goCourse(decision.kind === "redirect" ? decision.route : { kind: "home" }, { replace: true });
  });

  const listed = view.mode === "confirm" && !showAll ? view.detected : [...view.detected, ...view.others];
  return (
    <>
      {view.missingProjectId === null ? null : (
        <Notice>We can't find the factory project you chose before, or it isn't checked out here. Pick it again, or choose another.</Notice>
      )}
      <p className="tp-dek">
        {view.mode === "confirm"
          ? `${description === null ? "" : `${description} `}${COURSE_METHOD}`
          : "Your coach needs a factory repo to work in. None of the projects in this Codespace has one yet."}
      </p>
      {view.mode === "setup" ? (
        <Panel dashed wash={false} className="tp-howto">
          <p className="tp-eyebrow">Set one up</p>
          <ol>
            <li>
              Fork <code>capstone-project-starter</code> and clone your fork here, usually into{" "}
              <code>/workspaces/capstone-project-starter</code>.
            </li>
            <li>
              Add the clone's folder to BB as a project, then come back here.
            </li>
          </ol>
          <Button secondary onClick={() => queryCache.invalidate((key) => key === QUERY_KEYS.candidates)}>
            Check again
          </Button>
        </Panel>
      ) : null}
      {listed.length === 0 ? null : (
        <>
          <p className="tp-eyebrow tp-pick-label">{view.mode === "setup" ? "Or use one of these projects anyway" : "Your factory project"}</p>
          <div className="tp-picker" role="radiogroup" aria-label="Factory project">
            {listed.map((project) => (
              <Panel
                key={project.projectId}
                as="div"
                tone={project.qualifies ? "teal" : undefined}
                wash={selected === project.projectId}
                className={`tp-pk${selected === project.projectId ? " tp-pk--sel" : ""}${project.qualifies ? "" : " tp-pk--dis"}`}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected === project.projectId}
                  className="tp-pk-hit"
                  onClick={() => setSelected(project.projectId)}
                >
                  <span className="tp-r" aria-hidden />
                  <span className="tp-pk-text">
                    <span className="tp-nm">{project.name}</span>
                    <span className="tp-pth">{project.root ?? "no local checkout"}</span>
                  </span>
                  <span className={project.qualifies ? "tp-v tp-v--ok" : "tp-v"}>
                    {project.qualifies ? <Tick className="tp-v-tick" /> : null}
                    {project.detail}
                  </span>
                </button>
              </Panel>
            ))}
          </div>
          <div className="tp-continue">
            <Button disabled={selected === null || confirm.pending} onClick={() => void confirm.run()}>
              {confirm.pending ? "Saving…" : "Start the course →"}
            </Button>
            {view.mode === "confirm" && view.others.length > 0 ? (
              <Button secondary onClick={() => setShowAll(!showAll)}>
                {showAll ? "Only show detected projects" : "Use a different project"}
              </Button>
            ) : null}
          </div>
          {confirm.error === null ? null : <ErrorNotice message={confirm.error} />}
        </>
      )}
    </>
  );
}
