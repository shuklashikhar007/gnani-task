// app/architecture/page.tsx  (Next.js App Router, server component, no extra deps)
import type { CSSProperties } from "react";
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const STACK = ["Next.js", "FastAPI", "Cloudflare R2", "Gnani API", "Groq API", "Neon PostgreSQL"];

const CHUNKS = 8;
const BARS = 9;
const WAVE = Array.from({ length: CHUNKS }, (_, c) =>
  Array.from({ length: BARS }, (_, b) => {
    const i = c * BARS + b;
    return Math.round(14 + 96 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.17 + 0.8)));
  })
);

const PHASES = [
  {
    title: "Upload in parts",
    tone: "teal",
    steps: [
      { n: 1, tone: "blue", actor: "Browser", title: "Identify the guest", route: ["GET", "/whoami"], body: "The frontend asks the API who the current guest is, so every recording belongs to a guest session." },
      { n: 2, tone: "violet", actor: "FastAPI", title: "Create the recording", route: ["POST", "/recordings"], body: "The API creates a recording row and opens a multipart upload on Cloudflare R2. The response carries the recording id used by every later call." },
      { n: 3, tone: "teal", actor: "Browser to R2", title: "Send parts one at a time", route: ["POST", "/recordings/{id}/parts"], body: "The browser slices the file into parts, asks the API for presigned URLs, and uploads each part to R2 in turn. A dropped connection only costs the part that was in flight." },
      { n: 4, tone: "blue", actor: "Browser", title: "Resume after a break", route: ["GET", "/recordings/{id}/parts"], body: "The API lists the parts R2 already holds. The browser skips those and continues from the first missing part instead of starting over." },
      { n: 5, tone: "violet", actor: "FastAPI", title: "Complete the upload", route: ["POST", "/recordings/{id}/complete"], body: "R2 stitches the parts into a single audio object. The API submits it to Gnani, stores the job with the status transcription pending, and responds right away without waiting." },
    ],
  },
  {
    title: "Transcription",
    tone: "amber",
    steps: [
      { n: 6, tone: "amber", actor: "Gnani API", title: "Gnani transcribes", body: "Gnani processes the audio on its side. The recording stays in transcription pending and the frontend can show that state." },
      { n: 7, tone: "violet", actor: "FastAPI", title: "Webhook confirms completion", route: ["POST", "/webhooks/gnani/{recording_id}"], body: "Gnani calls back. The API verifies the HMAC token, checks the completion status in the database, and moves the recording to transcript done." },
    ],
  },
  {
    title: "Summary",
    tone: "violet",
    steps: [
      { n: 8, tone: "amber", actor: "Groq API", title: "Generate the summary", body: "With the transcript saved, the API sends it to Groq. The returned summary is stored next to the transcript." },
      { n: 9, tone: "blue", actor: "Browser", title: "Show the result", route: ["GET", "/recordings/{id}"], body: "The frontend reads the recording and renders the transcript and the summary. The list view is fed by GET /recordings." },
    ],
  },
];

const ROUTE_GROUPS = [
  {
    name: "default",
    note: "Service basics",
    routes: [
      { m: "GET", p: "/", name: "Hello", phase: "Health", tone: "green", d: "Root route that returns a greeting. A quick check that the API process is reachable." },
      { m: "GET", p: "/health", name: "Health", phase: "Health", tone: "green", d: "Liveness check for uptime monitors and the hosting platform. It is also the route to ping when a free-tier host has gone to sleep." },
    ],
  },
  {
    name: "guest",
    note: "Anonymous sessions",
    routes: [
      { m: "GET", p: "/whoami", name: "Whoami", phase: "Session", tone: "blue", d: "Returns the current guest identity. Recordings are scoped to this guest, so users see only their own uploads without signing up." },
    ],
  },
  {
    name: "recordings",
    note: "Upload, status and results",
    routes: [
      { m: "GET", p: "/recordings", name: "List Recordings", phase: "Results", tone: "violet", d: "Lists the guest recordings with their current status, which drives the history view and the pending badges." },
      { m: "POST", p: "/recordings", name: "Create Recording", phase: "Upload", tone: "teal", d: "Creates the recording row and opens the multipart upload on R2. Returns the recording id for the rest of the flow." },
      { m: "POST", p: "/recordings/refresh", name: "Refresh Recordings", phase: "Transcription", tone: "amber", d: "Re-checks the status of the guest recordings that are still in progress, which covers a missed webhook for any of them." },
      { m: "GET", p: "/recordings/{recording_id}", name: "Get Recording", phase: "Results", tone: "violet", d: "Fetches one recording with its status, transcript and summary. This is what the results page reads." },
      { m: "DELETE", p: "/recordings/{recording_id}", name: "Delete Recording", phase: "Results", tone: "violet", d: "Removes a recording and its stored data so a guest can clear their history." },
      { m: "POST", p: "/recordings/{recording_id}/refresh", name: "Refresh Recording", phase: "Transcription", tone: "amber", d: "Re-checks the status of a single recording on demand, the same idea as the bulk refresh but for one id." },
      { m: "POST", p: "/recordings/{recording_id}/parts", name: "Presign Parts", phase: "Upload", tone: "teal", d: "Issues presigned URLs for the requested part numbers. The browser PUTs each chunk straight to R2, so audio bytes never pass through the API." },
      { m: "GET", p: "/recordings/{recording_id}/parts", name: "Get Uploaded Parts", phase: "Upload", tone: "teal", d: "Lists the parts R2 already stores for this upload. This is the resume point after a network break." },
      { m: "POST", p: "/recordings/{recording_id}/complete", name: "Complete Upload", phase: "Upload", tone: "teal", d: "Closes the multipart upload, submits the audio to Gnani and sets the status to transcription pending." },
      { m: "POST", p: "/recordings/{recording_id}/retry", name: "Retry Transcription", phase: "Transcription", tone: "amber", d: "Submits the stored audio to Gnani again for a recording whose transcription failed, without a new upload." },
    ],
  },
  {
    name: "webhooks",
    note: "Called by external services",
    routes: [
      { m: "POST", p: "/webhooks/gnani/{recording_id}", name: "Gnani Job Finished", phase: "Webhook", tone: "amber", d: "Callback from Gnani when a transcription job ends. The HMAC token is verified, the completion status is checked in the database, the recording becomes transcript done, and summary generation starts." },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* SVG building blocks                                                 */
/* ------------------------------------------------------------------ */

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="#566074" />
      </marker>
    </defs>
  );
}

type NodeProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  tone: string;
  pill?: boolean;
};

function Node({ x, y, w, h, title, sub, tone, pill }: NodeProps) {
  const cy = y + h / 2;
  return (
    <g className={`node t-${tone}`}>
      <rect x={x} y={y} width={w} height={h} rx={pill ? h / 2 : 10} />
      <text x={x + w / 2} y={sub ? cy - 3 : cy + 5} textAnchor="middle" className="node-title">{title}</text>
      {sub && (
        <text x={x + w / 2} y={cy + 15} textAnchor="middle" className="node-sub">{sub}</text>
      )}
    </g>
  );
}

type EdgeProps = {
  d: string;
  marker: string;
  dash?: boolean;
  both?: boolean;
  label?: string;
  lx?: number;
  ly?: number;
  anchor?: "start" | "middle" | "end";
};

function Edge({ d, marker, dash, both, label, lx, ly, anchor = "middle" }: EdgeProps) {
  return (
    <g>
      <path
        d={d}
        className={`edge${dash ? " dash" : ""}`}
        markerEnd={`url(#${marker})`}
        markerStart={both ? `url(#${marker})` : undefined}
      />
      {label && (
        <text x={lx} y={ly} textAnchor={anchor} className="edge-label">{label}</text>
      )}
    </g>
  );
}

function Lane({ x, y, w, h, title, tone }: { x: number; y: number; w: number; h: number; title: string; tone: string }) {
  return (
    <g className={`t-${tone}`}>
      <rect x={x} y={y} width={w} height={h} rx={18} className="lane" />
      <rect x={x} y={y} width={w} height={5} rx={2.5} className="lane-cap" />
      <text x={x + 18} y={y + 30} className="lane-title">{title}</text>
    </g>
  );
}

function ArchitectureDiagram() {
  const m = "arch-arrow";
  return (
    <svg className="diagram" viewBox="0 0 1120 800" role="img" aria-label="System architecture: Next.js frontend, FastAPI backend, and external services Cloudflare R2, Gnani, Groq and Neon PostgreSQL">
      <Defs id={m} />

      <Lane x={20} y={70} w={280} h={710} title="Next.js frontend" tone="blue" />
      <Lane x={400} y={70} w={320} h={710} title="FastAPI backend" tone="violet" />
      <Lane x={820} y={70} w={280} h={710} title="External services" tone="teal" />

      {/* Frontend */}
      <Node x={60} y={130} w={150} h={40} title="User picks a file" tone="blue" pill />
      <Node x={50} y={200} w={220} h={70} title="Upload UI" sub="Splits the file into parts" tone="blue" />
      <Node x={50} y={680} w={220} h={70} title="Results UI" sub="Transcript and summary" tone="blue" />

      {/* Backend */}
      <Node x={430} y={200} w={260} h={70} title="Recordings API" sub="create, presign, complete" tone="violet" />
      <Node x={430} y={320} w={260} h={70} title="Start transcription" sub="Send audio URI to Gnani" tone="violet" />
      <Node x={430} y={440} w={260} h={70} title="Webhook handler" sub="Verify HMAC, check status in DB" tone="violet" />
      <Node x={430} y={560} w={260} h={70} title="Summarize" sub="Send transcript to Groq" tone="violet" />
      <Node x={430} y={680} w={260} h={70} title="Persist" sub="Status, transcript, summary" tone="violet" />

      {/* External */}
      <Node x={850} y={200} w={220} h={70} title="Cloudflare R2" sub="Audio parts and objects" tone="teal" />
      <Node x={850} y={320} w={220} h={70} title="Gnani API" sub="Audio to transcript" tone="amber" />
      <Node x={850} y={560} w={220} h={70} title="Groq API" sub="Transcript to summary" tone="amber" />
      <Node x={850} y={680} w={220} h={70} title="Neon PostgreSQL" sub="Recordings and status" tone="green" />

      {/* Edges */}
      <Edge marker={m} d="M135 170 V200" />
      <Edge marker={m} d="M250 200 V44 H1040 V200" label="PUT each part straight to R2 with presigned URLs" lx={640} ly={34} />
      <Edge marker={m} d="M270 235 H430" label="API calls" lx={350} ly={225} />
      <Edge marker={m} both d="M690 235 H850" label="create / complete" lx={770} ly={225} />
      <Edge marker={m} d="M560 270 V320" />
      <Edge marker={m} d="M690 355 H850" label="audio URI" lx={770} ly={345} />
      <Edge marker={m} dash d="M560 390 V440" label="waits for callback" lx={572} ly={420} anchor="start" />
      <Edge marker={m} dash d="M960 390 V475 H690" label="webhook + HMAC" lx={972} ly={440} anchor="start" />
      <Edge marker={m} d="M560 510 V560" />
      <Edge marker={m} both d="M690 595 H850" label="text to summary" lx={770} ly={585} />
      <Edge marker={m} d="M560 630 V680" />
      <Edge marker={m} both d="M690 715 H850" label="read / write" lx={770} ly={705} />
      <Edge marker={m} d="M430 715 H270" label="JSON" lx={350} ly={705} />
    </svg>
  );
}

function StatusDiagram() {
  const m = "status-arrow";
  return (
    <svg className="diagram diagram-narrow" viewBox="0 0 1000 230" role="img" aria-label="Recording status lifecycle: uploading, transcription pending, transcript done, summary ready, with failed and retry">
      <Defs id={m} />
      <Node x={20} y={30} w={140} h={54} title="Uploading" tone="teal" pill />
      <Node x={270} y={30} w={180} h={54} title="Transcription pending" tone="amber" pill />
      <Node x={560} y={30} w={150} h={54} title="Transcript done" tone="violet" pill />
      <Node x={820} y={30} w={150} h={54} title="Summary ready" tone="green" pill />
      <Node x={270} y={160} w={180} h={50} title="Failed" tone="red" pill />

      <Edge marker={m} d="M160 57 H270" label="POST /complete" lx={215} ly={46} />
      <Edge marker={m} d="M450 57 H560" label="webhook + HMAC" lx={505} ly={46} />
      <Edge marker={m} d="M710 57 H820" label="Groq summary" lx={765} ly={46} />
      <Edge marker={m} dash d="M320 84 V160" label="provider error" lx={310} ly={126} anchor="end" />
      <Edge marker={m} d="M400 160 V84" label="POST /retry" lx={410} ly={126} anchor="start" />
    </svg>
  );
}

function QueueToday() {
  const m = "q1-arrow";
  return (
    <svg className="diagram diagram-small" viewBox="0 0 520 270" role="img" aria-label="Today: uploads wait in line for a single pipeline">
      <Defs id={m} />
      <Node x={20} y={30} w={130} h={54} title="Upload A" sub="running" tone="blue" />
      <Node x={20} y={108} w={130} h={54} title="Upload B" sub="waiting" tone="mute" />
      <Node x={20} y={186} w={130} h={54} title="Upload C" sub="waiting" tone="mute" />
      <Node x={320} y={84} w={180} h={100} title="One pipeline" sub="upload, transcribe, summarize" tone="violet" />
      <Edge marker={m} d="M150 57 H235 V120 H320" />
      <Edge marker={m} dash d="M150 135 H320" />
      <Edge marker={m} dash d="M150 213 H235 V150 H320" />
    </svg>
  );
}

function QueueNext() {
  const m = "q2-arrow";
  return (
    <svg className="diagram diagram-small" viewBox="0 0 520 270" role="img" aria-label="With Redis and Celery: the API enqueues jobs and several workers process them in parallel">
      <Defs id={m} />
      <Node x={20} y={108} w={110} h={54} title="FastAPI" sub="returns a job ID" tone="violet" />
      <Node x={175} y={108} w={110} h={54} title="Redis queue" sub="jobs wait here" tone="red" />
      <Node x={340} y={30} w={160} h={50} title="Celery worker 1" tone="amber" />
      <Node x={340} y={110} w={160} h={50} title="Celery worker 2" tone="amber" />
      <Node x={340} y={190} w={160} h={50} title="Celery worker 3" tone="amber" />
      <Edge marker={m} d="M130 135 H175" />
      <Edge marker={m} d="M285 135 H312 V55 H340" />
      <Edge marker={m} d="M285 135 H340" />
      <Edge marker={m} d="M285 135 H312 V215 H340" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ArchitecturePage() {
  return (
    <div className={`arch ${display.variable} ${sans.variable} ${mono.variable}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav className="nav">
        <div className="wrap nav-in">
          <span className="nav-brand">Audio notes pipeline</span>
          <div className="nav-links">
            <a href="#architecture">Architecture</a>
            <a href="#flow">Flow and routes</a>
            <a href="#next">With more time</a>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <header className="wrap hero">
          <h1>How a recording becomes a summary</h1>
          <p className="lead">
            Audio is uploaded in resumable chunks, transcribed by Gnani, and summarized by Groq.
            This page maps the architecture, the life of a request, every API route, and what I
            would build next.
          </p>
          <div className="stack">
            {STACK.map((s) => (
              <span className="chip" key={s}>{s}</span>
            ))}
          </div>

          <div className="wave" aria-hidden="true">
            {WAVE.map((bars, c) => (
              <div className="chunk" key={c}>
                <div className="chunk-bars">
                  {bars.map((h, b) => (
                    <span key={b} className="bar" style={{ "--h": `${h}px`, "--i": c * BARS + b } as CSSProperties} />
                  ))}
                </div>
                <div className="chunk-label" style={{ "--c": c } as CSSProperties}>
                  <span>part {c + 1}</span>
                </div>
              </div>
            ))}
          </div>
        </header>

        {/* Section 1 */}
        <section id="architecture" className="section">
          <div className="wrap">
            <div className="sec-head">
              <h2>Architecture</h2>
              <p>
                A Next.js frontend talks to a FastAPI backend. The backend coordinates four
                external services: R2 stores audio, Gnani transcribes it, Groq summarizes the
                transcript, and Neon PostgreSQL keeps the state of every recording.
              </p>
            </div>

            <div className="panel">
              <div className="diagram-scroll">
                <ArchitectureDiagram />
              </div>
              <div className="legend">
                <span><i className="ln" /> request or data</span>
                <span><i className="ln dashed" /> asynchronous, arrives later</span>
              </div>
            </div>

            <div className="grid-3">
              <article className="note t-blue">
                <h3>Frontend</h3>
                <p>Slices the file, uploads parts directly to R2, and renders status, transcript and summary for the guest.</p>
              </article>
              <article className="note t-violet">
                <h3>Backend</h3>
                <p>Owns the state machine. It issues presigned URLs, starts transcription, verifies webhooks, and triggers the summary.</p>
              </article>
              <article className="note t-teal">
                <h3>External services</h3>
                <p>Object storage, speech to text, an LLM, and a database. Each does one job and the API stitches them together.</p>
              </article>
            </div>
          </div>
        </section>

        {/* Section 2 */}
        <section id="flow" className="section">
          <div className="wrap">
            <div className="sec-head">
              <h2>Flow and routes</h2>
              <p>
                Nothing in the pipeline waits on a long-lived request. Each step records a status,
                hands off to the next service, and moves on when a callback or a poll says so.
              </p>
            </div>

            <h3 className="sub-h">Status of one recording</h3>
            <p className="sub-p">Every recording moves through the same states. A failure sits beside the main path and has a way back.</p>
            <div className="panel">
              <div className="diagram-scroll">
                <StatusDiagram />
              </div>
            </div>

            <h3 className="sub-h">Lifecycle, step by step</h3>
            <p className="sub-p">From a selected file to a summary on screen, with the route that powers each step.</p>

            {PHASES.map((phase) => (
              <div className={`phase t-${phase.tone}`} key={phase.title}>
                <h4 className="phase-title">
                  <span className="phase-dot" />
                  {phase.title}
                </h4>
                <ol className="steps">
                  {phase.steps.map((s) => (
                    <li className={`step t-${s.tone}`} key={s.n}>
                      <span className="step-n">{s.n}</span>
                      <div className="step-body">
                        <div className="step-top">
                          <strong>{s.title}</strong>
                          <span className="actor">{s.actor}</span>
                        </div>
                        {s.route && (
                          <div className="step-route">
                            <span className={`method m-${s.route[0]}`}>{s.route[0]}</span>
                            <code>{s.route[1]}</code>
                          </div>
                        )}
                        <p>{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}

            <h3 className="sub-h">Resumable chunked upload</h3>
            <p className="sub-p">
              Large audio files fail on real networks. Splitting the file into parts means a break
              costs one part, and the listing route tells the browser where to pick up.
            </p>
            <div className="panel">
              <div className="chunk-demo">
                <div className="chunk-row">
                  <span className="row-label">First attempt</span>
                  <div className="parts">
                    {["done", "done", "done", "fail", "wait", "wait", "wait", "wait"].map((s, i) => (
                      <span key={i} className={`part p-${s}`}>{i + 1}</span>
                    ))}
                  </div>
                  <span className="row-note">Connection drops during part 4</span>
                </div>
                <div className="chunk-row">
                  <span className="row-label">After reconnect</span>
                  <div className="parts">
                    {["stored", "stored", "stored", "resend", "resend", "resend", "resend", "resend"].map((s, i) => (
                      <span key={i} className={`part p-${s}`}>{i + 1}</span>
                    ))}
                  </div>
                  <span className="row-note">Parts 1 to 3 are skipped, the rest are sent</span>
                </div>
              </div>
              <div className="legend">
                <span><i className="sw p-done" /> uploaded</span>
                <span><i className="sw p-fail" /> interrupted</span>
                <span><i className="sw p-wait" /> not sent yet</span>
                <span><i className="sw p-resend" /> sent on resume</span>
              </div>
            </div>

            <h3 className="sub-h">Webhook verification</h3>
            <p className="sub-p">
              The webhook route is public, so it must prove the caller is Gnani before it changes
              anything. An HMAC token does that, and a database check keeps the state honest.
            </p>
            <div className="hmac">
              <article className="hmac-card t-amber">
                <span className="hmac-n">Gnani</span>
                <h4>Signs the callback</h4>
                <p>When the job finishes, Gnani calls the webhook with an HMAC token derived from a secret it shares with the backend.</p>
              </article>
              <span className="hmac-arrow" aria-hidden="true" />
              <article className="hmac-card t-violet">
                <span className="hmac-n">FastAPI</span>
                <h4>Verifies the token</h4>
                <p>The API recomputes the HMAC and compares it with the one received. A mismatch is rejected, so only Gnani can mark work as complete.</p>
              </article>
              <span className="hmac-arrow" aria-hidden="true" />
              <article className="hmac-card t-green">
                <span className="hmac-n">Database</span>
                <h4>Checks and advances</h4>
                <p>The completion status is checked in the database, the recording becomes transcript done, and the transcript moves on to the LLM for the summary.</p>
              </article>
            </div>

            <h3 className="sub-h">Every route</h3>
            <p className="sub-p">All {ROUTE_GROUPS.reduce((n, g) => n + g.routes.length, 0)} endpoints of the FastAPI backend, grouped as in the generated docs.</p>

            {ROUTE_GROUPS.map((g) => (
              <div className="rgroup" key={g.name}>
                <div className="rgroup-head">
                  <h4>{g.name}</h4>
                  <span>{g.note}</span>
                </div>
                {g.routes.map((r) => (
                  <article className="route" key={r.m + r.p}>
                    <span className={`method m-${r.m}`}>{r.m}</span>
                    <div>
                      <div className="route-line">
                        <code className="route-path">{r.p}</code>
                        <span className="route-name">{r.name}</span>
                      </div>
                      <p className="route-desc">{r.d}</p>
                    </div>
                    <span className={`phase-chip t-${r.tone}`}>{r.phase}</span>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* Section 3 */}
        <section id="next" className="section">
          <div className="wrap">
            <div className="sec-head">
              <h2>With more time</h2>
              <p>
                The current version works end to end. These are the three upgrades I would make
                to take it from a working project to a service that holds up.
              </p>
            </div>

            <div className="grid-2">
              <article className="improve t-blue">
                <span className="tag">Deployment</span>
                <h3>Docker, and off the Render free tier</h3>
                <p>
                  The backend runs on Render today. The free tier puts the service to sleep after
                  15 minutes without traffic, so the next visitor waits through a cold start. I
                  started learning Docker so the API ships as one image that runs the same on my
                  machine and on a server that never sleeps.
                </p>
              </article>
              <article className="improve t-teal">
                <span className="tag">Production</span>
                <h3>AWS EC2 for the backend</h3>
                <p>
                  Running the container on an EC2 instance gives an always-on service with
                  control over the instance, networking and scaling. The /health route is ready
                  for monitoring and load balancer checks, and the webhook endpoint stays
                  reachable whenever Gnani calls back.
                </p>
              </article>
            </div>

            <article className="improve improve-wide t-violet">
              <span className="tag">Concurrency</span>
              <h3>Asynchronous processing with Redis and Celery</h3>
              <p>
                Right now one upload blocks the others until it finishes, and only one transcript
                is produced at a time while the remaining uploads wait in line. With Redis as the
                broker and Celery workers, the API would accept an upload, enqueue a job, and
                return a job ID at once. Workers would then transcribe and summarize several
                recordings in parallel.
              </p>
              <div className="compare">
                <figure>
                  <figcaption>Today</figcaption>
                  <QueueToday />
                </figure>
                <figure>
                  <figcaption>With Redis and Celery</figcaption>
                  <QueueNext />
                </figure>
              </div>
            </article>
          </div>
        </section>

        {/* Footer */}
        <footer className="foot">
          <div className="wrap foot-in">
            <div>
              <h2>Source code</h2>
              <p>The Next.js frontend, the FastAPI backend and the integrations live in one repository.</p>
            </div>
            <a
              className="btn"
              href="https://github.com/shuklashikhar007/gnani-task"
              target="_blank"
              rel="noopener noreferrer"
            >
              View repository on GitHub
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles (scoped under .arch)                                         */
/* ------------------------------------------------------------------ */

const CSS = `
.arch{
  --paper:#F3F5F9; --surface:#FFFFFF; --ink:#0E1320; --muted:#566074;
  --line:#D8DEE9; --line-strong:#8A94A8;
  --blue:#2456E8; --blue-bg:#EAF0FE;
  --violet:#6A3FD6; --violet-bg:#F1ECFC;
  --teal:#0D8A7E; --teal-bg:#E3F5F2;
  --amber:#B8690A; --amber-bg:#FDF2E0;
  --green:#1F7F3E; --green-bg:#E5F5EA;
  --red:#C93A3A; --red-bg:#FCEAEA;
  background:var(--paper); color:var(--ink);
  font-family:var(--font-sans), system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height:1.6; min-height:100vh; -webkit-font-smoothing:antialiased;
}
.arch *{box-sizing:border-box}
.arch h1,.arch h2,.arch h3,.arch h4{font-family:var(--font-display), system-ui, sans-serif; margin:0; letter-spacing:-0.02em; line-height:1.12}
.arch p{margin:0}
.arch code{font-family:var(--font-mono), ui-monospace, Menlo, Consolas, monospace}
.arch a:focus-visible{outline:3px solid var(--blue); outline-offset:3px; border-radius:4px}
.arch .wrap{max-width:1120px; margin:0 auto; padding:0 24px}

/* tone helpers */
.arch .t-blue{--c:var(--blue); --cbg:var(--blue-bg)}
.arch .t-violet{--c:var(--violet); --cbg:var(--violet-bg)}
.arch .t-teal{--c:var(--teal); --cbg:var(--teal-bg)}
.arch .t-amber{--c:var(--amber); --cbg:var(--amber-bg)}
.arch .t-green{--c:var(--green); --cbg:var(--green-bg)}
.arch .t-red{--c:var(--red); --cbg:var(--red-bg)}
.arch .t-mute{--c:var(--line-strong); --cbg:#FFFFFF}

/* nav */
.arch .nav{position:sticky; top:0; z-index:20; background:rgba(243,245,249,.88); backdrop-filter:blur(10px); border-bottom:1px solid var(--line)}
.arch .nav-in{display:flex; justify-content:space-between; align-items:center; height:56px}
.arch .nav-brand{font-family:var(--font-display), system-ui, sans-serif; font-weight:700; font-size:17px}
.arch .nav-links{display:flex; gap:26px; font-size:14px}
.arch .nav-links a{text-decoration:none; color:var(--muted); padding:6px 0; border-bottom:2px solid transparent; transition:color .15s, border-color .15s}
.arch .nav-links a:hover{color:var(--ink); border-color:var(--blue)}

/* hero */
.arch .hero{padding-top:72px; padding-bottom:64px}
.arch .hero h1{font-size:clamp(42px,7.4vw,92px); font-weight:800; max-width:13ch; letter-spacing:-0.035em}
.arch .lead{max-width:60ch; font-size:18px; color:var(--muted); margin-top:24px}
.arch .stack{display:flex; flex-wrap:wrap; gap:8px; margin-top:26px}
.arch .chip{font-size:13px; font-weight:500; padding:5px 12px; border:1px solid var(--line); background:var(--surface); border-radius:999px; color:#2B3447}

.arch .wave{display:grid; grid-template-columns:repeat(8,1fr); gap:14px; margin-top:52px}
.arch .chunk{display:flex; flex-direction:column; gap:10px; min-width:0}
.arch .chunk-bars{display:flex; align-items:center; gap:3px; height:124px}
.arch .bar{flex:1; min-width:2px; height:var(--h); border-radius:2px; background:var(--line); animation:bar-on .45s ease forwards; animation-delay:calc(var(--i) * 38ms + 350ms)}
.arch .chunk-label{border-top:3px solid var(--line); padding-top:7px; font-family:var(--font-mono), monospace; font-size:12px; color:var(--muted); animation:label-on .4s ease forwards; animation-delay:calc(var(--c) * 300ms + 350ms)}
@keyframes bar-on{to{background:var(--blue)}}
@keyframes label-on{to{border-top-color:var(--blue); color:var(--ink)}}

/* sections */
.arch .section{padding:80px 0; border-top:1px solid var(--line)}
.arch .sec-head{max-width:68ch; margin-bottom:36px}
.arch .sec-head h2{font-size:clamp(30px,4.4vw,52px); font-weight:800; letter-spacing:-0.03em}
.arch .sec-head p{color:var(--muted); margin-top:16px; font-size:17px}
.arch .sub-h{font-size:24px; font-weight:700; margin:64px 0 8px}
.arch .sub-p{color:var(--muted); max-width:66ch; margin-bottom:24px}
.arch .panel{background:var(--surface); border:1px solid var(--line); border-radius:18px; padding:26px}
.arch .diagram-scroll{overflow-x:auto}
.arch .diagram{display:block; width:100%; min-width:860px; height:auto}
.arch .diagram-narrow{min-width:760px}
.arch .diagram-small{min-width:0}

/* svg parts */
.arch svg text{font-family:var(--font-sans), system-ui, sans-serif}
.arch .lane{fill:#FBFCFE; stroke:var(--line); stroke-width:1.5}
.arch .lane-cap{fill:var(--c)}
.arch .lane-title{font-size:14px; font-weight:600; fill:var(--c)}
.arch .node rect{fill:var(--cbg); stroke:var(--c); stroke-width:1.6}
.arch .node.t-mute rect{stroke-dasharray:5 4}
.arch .node-title{font-size:15px; font-weight:600; fill:var(--ink)}
.arch .node-sub{font-size:12px; fill:var(--muted)}
.arch .edge{fill:none; stroke:#566074; stroke-width:1.7}
.arch .edge.dash{stroke-dasharray:6 5}
.arch .edge-label{font-size:11.5px; fill:var(--muted)}

.arch .legend{display:flex; flex-wrap:wrap; gap:22px; margin-top:18px; font-size:13px; color:var(--muted)}
.arch .legend span{display:inline-flex; align-items:center; gap:8px}
.arch .ln{display:inline-block; width:28px; height:0; border-top:2px solid #566074}
.arch .ln.dashed{border-top-style:dashed}
.arch .sw{display:inline-block; width:16px; height:16px; border-radius:4px; border:1.5px solid}

.arch .grid-3{display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:22px}
.arch .note{background:var(--surface); border:1px solid var(--line); border-top:4px solid var(--c); border-radius:14px; padding:20px 22px}
.arch .note h3{font-size:18px; margin-bottom:8px; color:var(--c)}
.arch .note p{font-size:14.5px; color:#394357}

/* timeline */
.arch .phase{margin-top:44px}
.arch .phase-title{font-size:19px; font-weight:700; display:flex; align-items:center; gap:12px; margin-bottom:20px}
.arch .phase-dot{width:12px; height:12px; border-radius:50%; background:var(--c)}
.arch .steps{list-style:none; margin:0; padding:0}
.arch .step{position:relative; display:grid; grid-template-columns:44px 1fr; gap:18px; padding-bottom:26px}
.arch .step::before{content:""; position:absolute; left:21px; top:46px; bottom:2px; width:2px; background:var(--line)}
.arch .step:last-child::before{display:none}
.arch .step-n{width:44px; height:44px; border-radius:50%; display:grid; place-items:center; font-family:var(--font-display), sans-serif; font-weight:700; background:var(--cbg); border:2px solid var(--c); color:var(--c)}
.arch .step-body{background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:16px 20px}
.arch .step-top{display:flex; flex-wrap:wrap; align-items:center; gap:10px}
.arch .step-top strong{font-size:16px}
.arch .actor{font-size:12px; font-weight:500; padding:2px 10px; border-radius:999px; color:var(--c); background:var(--cbg)}
.arch .step-route{display:flex; align-items:center; gap:10px; margin-top:10px; font-size:14px}
.arch .step-body p{margin-top:10px; font-size:14.5px; color:#394357; max-width:72ch}

/* method badges */
.arch .method{display:inline-block; min-width:62px; text-align:center; font-family:var(--font-mono), monospace; font-size:12px; font-weight:500; padding:3px 8px; border-radius:6px; color:#fff}
.arch .m-GET{background:#3B7CF0}
.arch .m-POST{background:#1F9D63}
.arch .m-DELETE{background:#D8403F}

/* chunk demo */
.arch .chunk-demo{display:flex; flex-direction:column; gap:22px}
.arch .chunk-row{display:grid; grid-template-columns:130px 1fr 260px; gap:18px; align-items:center}
.arch .row-label{font-weight:600; font-size:14px}
.arch .row-note{font-size:13px; color:var(--muted)}
.arch .parts{display:grid; grid-template-columns:repeat(8,1fr); gap:8px}
.arch .part{height:44px; display:grid; place-items:center; border-radius:8px; border:1.5px solid; font-family:var(--font-mono), monospace; font-size:13px; font-weight:500}
.arch .p-done,.arch .p-stored{background:var(--green-bg); border-color:var(--green); color:var(--green)}
.arch .p-stored{opacity:.55}
.arch .p-fail{background:var(--red-bg); border-color:var(--red); color:var(--red)}
.arch .p-wait{background:#fff; border-color:var(--line-strong); border-style:dashed; color:var(--muted)}
.arch .p-resend{background:var(--blue-bg); border-color:var(--blue); color:var(--blue)}

/* hmac */
.arch .hmac{display:grid; grid-template-columns:1fr 40px 1fr 40px 1fr; align-items:stretch}
.arch .hmac-card{background:var(--surface); border:1px solid var(--line); border-top:4px solid var(--c); border-radius:14px; padding:20px 22px}
.arch .hmac-n{display:inline-block; font-size:12px; font-weight:600; padding:2px 10px; border-radius:999px; color:var(--c); background:var(--cbg); margin-bottom:12px}
.arch .hmac-card h4{font-size:18px; margin-bottom:8px}
.arch .hmac-card p{font-size:14.5px; color:#394357}
.arch .hmac-arrow{position:relative; align-self:center; height:2px; background:#566074}
.arch .hmac-arrow::after{content:""; position:absolute; right:-1px; top:-5px; border:6px solid transparent; border-left:9px solid #566074; border-right:0}

/* routes */
.arch .rgroup{margin-top:24px; background:var(--surface); border:1px solid var(--line); border-radius:18px; overflow:hidden}
.arch .rgroup-head{display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:16px 24px; background:#F8FAFD; border-bottom:1px solid var(--line)}
.arch .rgroup-head h4{font-size:20px}
.arch .rgroup-head span{font-size:13px; color:var(--muted)}
.arch .route{display:grid; grid-template-columns:76px 1fr auto; gap:18px; align-items:start; padding:18px 24px; border-bottom:1px solid var(--line)}
.arch .route:last-child{border-bottom:0}
.arch .route .method{margin-top:2px}
.arch .route-line{display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px}
.arch .route-path{font-size:15px; font-weight:500; word-break:break-all}
.arch .route-name{font-size:13px; color:var(--muted)}
.arch .route-desc{margin-top:6px; font-size:14.5px; color:#394357; max-width:72ch}
.arch .phase-chip{font-size:12px; font-weight:500; padding:3px 11px; border-radius:999px; color:var(--c); background:var(--cbg); white-space:nowrap}

/* improvements */
.arch .grid-2{display:grid; grid-template-columns:repeat(2,1fr); gap:20px}
.arch .improve{background:var(--surface); border:1px solid var(--line); border-left:6px solid var(--c); border-radius:16px; padding:26px 28px}
.arch .improve-wide{margin-top:20px}
.arch .tag{display:inline-block; font-size:12px; font-weight:600; padding:3px 11px; border-radius:999px; color:var(--c); background:var(--cbg); margin-bottom:14px}
.arch .improve h3{font-size:22px; margin-bottom:12px}
.arch .improve p{font-size:15px; color:#394357; max-width:74ch}
.arch .compare{display:grid; grid-template-columns:repeat(2,1fr); gap:20px; margin-top:26px}
.arch .compare figure{margin:0; background:#F8FAFD; border:1px solid var(--line); border-radius:14px; padding:16px 18px}
.arch .compare figcaption{font-family:var(--font-display), sans-serif; font-weight:700; font-size:16px; margin-bottom:6px}

/* footer */
.arch .foot{border-top:1px solid var(--line); background:var(--surface); padding:56px 0}
.arch .foot-in{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:24px}
.arch .foot h2{font-size:30px; margin-bottom:8px}
.arch .foot p{color:var(--muted); max-width:52ch}
.arch .btn{display:inline-block; background:var(--ink); color:#fff; text-decoration:none; font-weight:600; font-size:15px; padding:13px 24px; border-radius:10px; transition:background .15s}
.arch .btn:hover{background:var(--blue)}

/* responsive */
@media (max-width:900px){
  .arch .grid-3,.arch .grid-2,.arch .compare{grid-template-columns:1fr}
  .arch .hmac{grid-template-columns:1fr; gap:0}
  .arch .hmac-arrow{width:2px; height:28px; justify-self:center}
  .arch .hmac-arrow::after{right:auto; left:-5px; top:auto; bottom:-1px; border:6px solid transparent; border-top:9px solid #566074; border-bottom:0}
  .arch .chunk-row{grid-template-columns:1fr; gap:10px}
}
@media (max-width:640px){
  .arch .wrap{padding:0 16px}
  .arch .nav-links{gap:14px; font-size:13px}
  .arch .nav-brand{display:none}
  .arch .hero{padding-top:48px}
  .arch .wave{gap:6px}
  .arch .chunk-bars{height:80px; gap:1px}
  .arch .chunk-label{font-size:10px}
  .arch .panel{padding:16px}
  .arch .route{grid-template-columns:64px 1fr; gap:12px; padding:16px}
  .arch .route .phase-chip{grid-column:2; justify-self:start}
  .arch .step{grid-template-columns:36px 1fr; gap:12px}
  .arch .step-n{width:36px; height:36px; font-size:14px}
  .arch .step::before{left:17px; top:38px}
}
@media (prefers-reduced-motion:reduce){
  .arch .bar{animation:none; background:var(--blue)}
  .arch .chunk-label{animation:none; border-top-color:var(--blue); color:var(--ink)}
  .arch *{transition:none !important}
}
`;