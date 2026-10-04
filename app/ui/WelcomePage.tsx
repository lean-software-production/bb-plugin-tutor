// First run (mockup 8): confirm the detected workspace (8A) or explain
// how to create one (8B). The plugin never creates the project itself.
// A hosted student has no candidates to pick from (their checkout lives on a
// separate, enrolled machine), so HostedOffer (mockup 8C) offers it instead.
import { useEffect, useState } from "react";
import type { Workspace, CandidateProject } from "../../shared/rpc.ts";
import { refreshAll, useAction, useCourseNavigate, useOverview, useQuery, useStore, useTutorRpc } from "../hooks.ts";
import { homeDecision } from "../model/home.ts";
import { hostedWelcome, welcomeView } from "../model/welcome.ts";
import { QUERY_KEYS, queryCache, outlineMountedStore } from "../state/app-state.ts";
import { ErrorNotice, Loading, Notice, SketchPage } from "./common.tsx";
import { Button, Character, Highlight, Panel, Tick } from "./sketch/index.ts";

/** How often the page checks offerWorkspace again while no machine is enrolled yet. */
const OFFER_POLL_MS = 5_000;

const COURSE_METHOD =
  "Your coach works through each lesson with you, one Rule at a time, in the workspace you pick below.";

export function WelcomePage() {
  const rpc = useTutorRpc();
  const overview = useOverview();
  const candidates = useQuery(QUERY_KEYS.candidates, () => rpc.call("listCandidateProjects", null));
  const outlineMounted = useStore(outlineMountedStore);
  // The course a first run sets up: the one after Tutor's built-in course, else the built-in one.
  const courses = overview.data?.courses ?? [];
  const course = (courses.find((entry) => !entry.builtin) ?? courses[0])?.course ?? null;

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
          <Loading label="Looking for your workspace…" />
        )
      ) : (
        candidates.data.projects.length === 0 ? (
          <HostedOffer />
        ) : (
          <Picker
            candidates={candidates.data.projects}
            workspace={overview.data.workspace}
            description={course?.description ?? null}
          />
        )
      )}
      {outlineMounted ? null : (
        <p className="tp-tip">
          Tip: turn on the course outline under <b>Settings → Appearance → Sidebar</b>, and pick <b>Course outline</b>.
        </p>
      )}
    </SketchPage>
  );
}

/** Mockup 8C: the hosted first run, when there is no candidate project to pick from. */
function HostedOffer() {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const offer = useQuery(QUERY_KEYS.offer, () => rpc.call("offerWorkspace", null));

  // No machine enrolled yet: the student still has to open theirs, so keep
  // checking back for it instead of waiting on a signal that never comes.
  useEffect(() => {
    if (offer.data?.status !== "no-machine") return;
    const timer = window.setInterval(() => {
      queryCache.invalidate((key) => key === QUERY_KEYS.offer);
    }, OFFER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [offer.data?.status]);

  const create = useAction(async (hostId: string, folder: string) => {
    await rpc.call("createWorkspace", { hostId, folder });
    // Decide from a fresh overview: the cached one still says "unset".
    const decision = homeDecision(await rpc.call("getOverview", null));
    refreshAll();
    goCourse(decision.kind === "redirect" ? decision.route : { kind: "home" }, { replace: true });
  });

  if (offer.data === null) {
    return offer.status === "error" ? (
      <ErrorNotice message={offer.error} />
    ) : (
      <Loading label="Looking for your workspace…" />
    );
  }

  const view = hostedWelcome(offer.data);
  return (
    <>
      <p className="tp-eyebrow tp-pick-label">{view.heading}</p>
      <p className="tp-dek">{view.body}</p>
      {view.action === null ? null : (
        <div className="tp-continue">
          <Button
            disabled={create.pending}
            onClick={() => void create.run(view.action!.hostId, view.action!.folder)}
          >
            {create.pending ? "Setting up…" : view.action.label}
          </Button>
        </div>
      )}
      {create.error === null ? null : <ErrorNotice message={create.error} />}
    </>
  );
}

function Picker({
  candidates,
  workspace,
  description,
}: {
  candidates: readonly CandidateProject[];
  workspace: Workspace;
  description: string | null;
}) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const view = welcomeView(candidates, workspace);
  const [selected, setSelected] = useState<string | null>(view.preselected);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setSelected((current) => current ?? view.preselected), [view.preselected]);
  const confirm = useAction(async () => {
    if (selected === null) return;
    await rpc.call("confirmWorkspace", { projectId: selected });
    // Decide from a fresh overview: the cached one still says "unset".
    const decision = homeDecision(await rpc.call("getOverview", null));
    refreshAll();
    goCourse(decision.kind === "redirect" ? decision.route : { kind: "home" }, { replace: true });
  });

  const listed = view.mode === "confirm" && !showAll ? view.detected : [...view.detected, ...view.others];
  return (
    <>
      {view.missingProjectId === null ? null : (
        <Notice>We can't find the workspace you chose before, or it isn't checked out here. Pick it again, or choose another.</Notice>
      )}
      <p className="tp-dek">
        {view.mode === "confirm"
          ? `${description === null ? "" : `${description} `}${COURSE_METHOD}`
          : "Your coach needs a folder to work in. Run `tutor up <folder>` to make one, or pick a project below."}
      </p>
      {view.mode === "setup" ? (
        <Panel dashed wash={false} className="tp-howto">
          <p className="tp-eyebrow">Set one up</p>
          <ol>
            <li>
              Pick the folder you'll work in, then run <code>tutor up &lt;folder&gt;</code> there.
            </li>
            <li>Come back here once it's done.</li>
          </ol>
          <Button secondary onClick={() => queryCache.invalidate((key) => key === QUERY_KEYS.candidates)}>
            Check again
          </Button>
        </Panel>
      ) : null}
      {listed.length === 0 ? null : (
        <>
          <p className="tp-eyebrow tp-pick-label">
            {view.mode === "setup" ? "Or use one of these projects anyway" : "Pick the folder you'll work in"}
          </p>
          <div className="tp-picker" role="radiogroup" aria-label="Workspace">
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
