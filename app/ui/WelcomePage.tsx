// First run (mockup 8): confirm the detected workspace (8A), or, when no
// project is on a connected machine, offer the student's Codespace checkout
// (HostedOffer, mockup 8C); Tutor makes the project for it once they say so.
// UnreachablePage is the course page for a workspace whose machine is not
// connected: it offers the student's current Codespace when that is a
// different machine (a rebuilt or new Codespace), else says it is asleep.
import { useEffect, useState } from "react";
import type { Workspace, CandidateProject, WorkspaceOffer } from "../../shared/rpc.ts";
import { refreshAll, useAction, useCourseNavigate, useOverview, useQuery, useStore, useTutorRpc } from "../hooks.ts";
import { homeDecision } from "../model/home.ts";
import { hostedWelcome, showsHostedOffer, unreachableView, welcomeView } from "../model/welcome.ts";
import type { HostedWelcome } from "../model/welcome.ts";
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
        showsHostedOffer(candidates.data.projects) ? (
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

/**
 * offerWorkspace's answer, re-asked every OFFER_POLL_MS while `waiting` says
 * there is nothing to take yet (the student still has to open their
 * Codespace, which sends no signal), with the action that takes the offer:
 * createWorkspace, then on to the course.
 */
function useCodespaceOffer(waiting: (offer: WorkspaceOffer) => boolean, alsoRefresh: readonly string[] = []) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const offer = useQuery(QUERY_KEYS.offer, () => rpc.call("offerWorkspace", null));
  const wait = offer.data !== null && waiting(offer.data);
  useEffect(() => {
    if (!wait) return;
    const keys = new Set<string>([QUERY_KEYS.offer, ...alsoRefresh]);
    const timer = window.setInterval(() => {
      queryCache.invalidate((key) => keys.has(key));
    }, OFFER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [wait]);

  const create = useAction(async (hostId: string, folder: string) => {
    await rpc.call("createWorkspace", { hostId, folder });
    // Decide from a fresh overview: the cached one still has the old workspace.
    const decision = homeDecision(await rpc.call("getOverview", null));
    refreshAll();
    goCourse(decision.kind === "redirect" ? decision.route : { kind: "home" }, { replace: true });
  });
  return { offer, create };
}

/** The offer's button, and what went wrong taking it. */
function OfferAction({ view, create }: { view: HostedWelcome; create: ReturnType<typeof useCodespaceOffer>["create"] }) {
  const action = view.action;
  return (
    <>
      {action === null ? null : (
        <div className="tp-continue">
          <Button disabled={create.pending} onClick={() => void create.run(action.hostId, action.folder)}>
            {create.pending ? "Setting up…" : action.label}
          </Button>
        </div>
      )}
      {create.error === null ? null : <ErrorNotice message={create.error} />}
    </>
  );
}

/** Mockup 8C: the first run when no candidate project is on a connected machine. */
function HostedOffer() {
  const { offer, create } = useCodespaceOffer((answer) => answer.status === "no-machine");
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
      <OfferAction view={view} create={create} />
    </>
  );
}

/**
 * The course page while the workspace's machine is not connected. Keeps
 * asking (the offer, and the overview, which redirects once the machine is
 * back) until there is something to do.
 */
export function UnreachablePage() {
  const { offer, create } = useCodespaceOffer((answer) => answer.status !== "offer", [QUERY_KEYS.overview]);
  // Until the offer is known, or when asking for it failed, the Codespace is asleep: there is nothing else to do.
  const view = unreachableView(offer.data);
  return (
    <SketchPage edge={<Character name="waver" className="tp-edge tp-edge--waver" />}>
      <p className="tp-eyebrow">Your workspace</p>
      <h1 className="sk-title tp-page-title">{view.heading}</h1>
      <p className="tp-dek">{view.body}</p>
      <OfferAction view={view} create={create} />
    </SketchPage>
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
          : "Your coach needs a folder to work in: your Codespace's checkout of capstone-project-starter, or a project below."}
      </p>
      {view.mode === "setup" ? (
        <Panel dashed wash={false} className="tp-howto">
          <HostedOffer />
          <Button secondary onClick={() => queryCache.invalidate((key) => key === QUERY_KEYS.candidates || key === QUERY_KEYS.offer)}>
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
