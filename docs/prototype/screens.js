// Renders one screen per URL: ?s=<screen>&theme=light|dark&sheet=1
const P = new URLSearchParams(location.search);
const S = P.get("s") || "refine-autocomplete";
const D = window.DATA;
if (P.get("theme") === "dark") document.documentElement.classList.add("dark");

const i = (name, extra = "") => `<i data-lucide="${name}" ${extra}></i>`;
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const TABS = [
  ["refine", "pen-line", "Refine"],
  ["knowledge", "library", "Knowledge"],
  ["activity", "activity", "Activity"],
  ["settings", "settings-2", "Settings"],
];
const tabOf = S.split("-")[0];

function rail() {
  return `<nav class="rail" aria-label="Tabs">
    <div class="mark" aria-label="Prompt Enhance">¶</div>
    ${TABS.map(([k, ic, l]) => `<button class="rail-btn ${k === tabOf ? "on" : ""}" aria-label="${l}">${i(ic)}</button>`).join("")}
    <div class="spacer"></div>
    <button class="rail-btn" aria-label="Toggle theme">${i(document.documentElement.classList.contains("dark") ? "sun" : "moon")}</button>
  </nav>`;
}
function tabbar() {
  return `<nav class="tabbar" role="tablist">${TABS.map(([k, ic, l]) => `<button class="tab ${k === tabOf ? "on" : ""}" role="tab">${i(ic)}<span>${l}</span></button>`).join("")}</nav>`;
}
function head(title, right = "") {
  return `<header class="main-head"><h1 class="title">${title}</h1><div class="topbar-action row">${right}</div></header>`;
}
function shell(main, inspector, overlay = "") {
  const insp = inspector ? `<div class="handle" role="separator" aria-label="Resize inspector"></div><aside class="inspector">${inspector}</aside>` : "";
  return `<div class="app ${inspector ? "" : "no-inspector"}">${rail()}<main class="main">${main}</main>${insp}${tabbar()}</div>${overlay}`;
}
function sheet(content) {
  return P.get("sheet") ? `<div class="sheet-scrim"></div><div class="sheet"><div class="grab"></div>${content}</div>` : "";
}

/* ---------------- Refine ---------------- */
function editor({ text, ghost, rev, cursor, state }) {
  const left = state === "requesting"
    ? `<span class="pulse" aria-label="Generating suggestion"><i></i><i></i><i></i></span>`
    : `<span class="data">rev ${rev} · ${cursor}:${cursor}</span>`;
  const ghostHtml = ghost ? `<span class="ghost">${esc(ghost)}</span><span class="kbd marker ghost-hint">Tab</span>` : "";
  return `<section class="editor ${state === "idle" ? "idle" : ""}" aria-label="Prompt">
    <div class="editor-text">${esc(text)}<span class="caret"></span>${ghostHtml}</div>
    <div class="editor-foot">${left}<div class="grow"></div><span class="data">${text.length}</span>
      <button class="btn primary sm">${i("send")}Send to Codex</button></div>
  </section>`;
}
function knowledgeUsed(q) {
  const used = q ? D.usedQ : D.used, dropped = q ? D.droppedQ : D.dropped;
  return `<div><div class="label" style="margin-bottom:6px">Knowledge used</div>
    <div class="ilist">${used.map((u) => `<div class="irow">${i(u.kind)}<span class="grow trunc mono" style="font-size:13px">${u.title}</span><span class="data">${u.score}</span></div>`).join("")}</div>
    <div class="toggle-line">${i("chevron-right", 'style="width:14px;height:14px"')}Show dropped (${dropped})</div></div>`;
}
function pipeline(q) {
  const steps = q ? D.pipelineQ : D.pipeline, tags = q ? D.tagsQ : D.tags;
  return `<div><div class="label" style="margin-bottom:4px">Pipeline</div>
    ${steps.map((p, n) => `<div class="step"><span class="dot ok"></span><div><div style="font-weight:500">${p.step}</div><div class="data">${p.model}</div>
      ${n === 0 ? `<div class="chips" style="margin-top:8px">${tags.map(([t, s]) => `<span class="chip tagname">${t}<span class="data">${s}</span></span>`).join("")}</div>` : ""}</div><span class="data">${p.ms}</span></div>`).join("")}
  </div>`;
}
function refineInspector(q) {
  return `<div class="insp-head"><span class="section">Context</span><div class="grow"></div><span class="data">${q ? "req_2c90d415" : "req_7f3a91c2"}</span></div>
    <div class="insp-body">${knowledgeUsed(q)}${pipeline(q)}</div>`;
}
function questionCard() {
  const q = D.question;
  const plus = q.diffIns.length + q.diffEnd.length, minus = q.diffDel.length;
  return `<section class="qcard" aria-label="Question">
    <div class="qhead"><div class="grow"><div class="label">Question</div><div class="qtext">${q.q}</div></div>
      <button class="icon-btn" aria-label="Decline all options">${i("x")}</button></div>
    <div class="opts" role="radiogroup">${q.options.map((o, n) => `<div class="opt ${n === q.selected ? "on" : ""}" role="radio" aria-checked="${n === q.selected}">
      <span class="kbd">${n + 1}</span><div class="grow"><div class="opt-label">${o.label}</div>
      ${n === q.selected ? `<div class="diff">${esc(q.diffBefore)}<span class="del">${esc(q.diffDel)}</span><span class="ins">${esc(q.diffIns)}</span>${esc(q.diffMid)}<span class="ins">${esc(q.diffEnd)}</span></div><div class="data" style="margin-top:6px">2 edits · +${plus} −${minus}</div>` : ""}
      </div></div>`).join("")}</div>
    <div class="qfoot"><button class="btn ghost">Decline all</button><span class="kbd">Esc</span><div class="grow"></div><span class="kbd">↵</span><button class="btn primary">Apply</button></div>
  </section>`;
}
function refineHead() {
  return head("Refine", `<button class="icon-btn hide-wide" aria-label="Show context">${i("panel-right")}</button>`);
}
const screens = {};
screens["refine-autocomplete"] = () => shell(
  refineHead() + `<div class="main-body">${editor({ text: D.autocomplete.prompt, ghost: D.autocomplete.ghost, rev: D.autocomplete.rev, cursor: D.autocomplete.prompt.length })}</div>`,
  refineInspector(), sheet(refineInspector()));
screens["refine-question"] = () => shell(
  refineHead() + `<div class="main-body">${editor({ text: D.question.prompt, rev: D.question.rev, cursor: D.question.prompt.length, state: "idle" })}${questionCard()}</div>`,
  refineInspector(true));
screens["refine-states"] = () => shell(
  refineHead() + `<div class="main-body">
    <div class="label">Requesting</div>${editor({ text: "Add rate limiting to the public search endpoint", rev: 3, cursor: 47, state: "requesting" })}
    <div class="label">Error</div>
    <section class="editor idle"><div class="editor-text" style="min-height:0">Summarise the failing CI job and propose a fix<span class="caret"></span></div>
      <div class="editor-foot"><span class="dot err"></span><span class="data err-msg" style="color:var(--destructive)">502 · upstream model timeout</span><button class="btn ghost sm">Retry</button><span class="data">46</span><button class="btn primary sm">${i("send")}Send to Codex</button></div></section>
  </div>`, null);

/* ---------------- Knowledge ---------------- */
function kToolbar() {
  return `<div class="toolbar"><div class="input grow" style="max-width:320px">${i("search")}<span>Search knowledge</span></div>
    <div class="seg hide-n"><span class="on">All</span><span>Skills</span><span>Prompts</span><span>Graphs</span></div>
    <button class="btn outline hide-n">${i("tag")}Tags<span class="data">2</span></button>
    <div class="grow"></div><button class="btn primary">${i("plus")}Add knowledge</button></div>`;
}
function kList(sel = 0) {
  return `<div class="chips" style="flex:none"><span class="chip tagname sel">python ${i("x", 'style="width:12px;height:12px"')}</span><span class="chip tagname sel">retry ${i("x", 'style="width:12px;height:12px"')}</span><span class="data" style="align-self:center">9 of 214</span></div>
    <div class="klist" role="listbox">${D.knowledge.map((k, n) => `<div class="krow ${n === sel ? "on" : ""}" role="option">${i(k.kind)}
      <div style="min-width:0"><div class="row"><span class="ktitle trunc">${k.title}</span></div><div class="ksum trunc">${k.sum}</div></div>
      <div class="kmeta kdate">${k.tags.slice(0, 2).map((t) => `<span class="chip tagname">${t}</span>`).join("")}${k.tags.length + k.more > 2 ? `<span class="data">+${k.tags.length + k.more - 2}</span>` : ""}<span class="data" style="width:44px;text-align:right">${k.date}</span></div></div>`).join("")}</div>`;
}
function kDetail() {
  const k = D.knowledge[0];
  return `<div class="insp-head"><span class="section">Skill</span><div class="grow"></div><button class="icon-btn" aria-label="Edit">${i("pencil")}</button><button class="icon-btn" aria-label="Delete">${i("trash-2")}</button></div>
    <div class="insp-body">
      <div><div class="title mono" style="font-size:16px">${k.title}</div><div class="data" style="margin-top:4px">added 22 Oct 11:48 · used 37×</div></div>
      <div><div class="label" style="margin-bottom:8px">Tags</div><div class="chips">${["retry", "python", "resilience", "backoff"].map((t) => `<span class="chip tagname">${t}</span>`).join("")}</div></div>
      <div><div class="label" style="margin-bottom:6px">Summary</div><p>${k.sum}</p></div>
      <div><div class="label" style="margin-bottom:6px">Body</div><div class="body-block">${esc(D.kdetail.body)}</div></div>
    </div>`;
}
screens["knowledge"] = () => shell(head("Knowledge") + `<div class="main-body">${kToolbar()}${kList()}</div>`, kDetail(), sheet(kDetail()));
screens["knowledge-add"] = () => shell(head("Knowledge") + `<div class="main-body">${kToolbar()}${kList(-1)}</div>`, null,
  `<div class="scrim"><div class="dialog" role="dialog" aria-label="Add knowledge">
    <div class="dlg-head"><span class="section grow">Add knowledge</span><button class="icon-btn" aria-label="Close">${i("x")}</button></div>
    <div class="dlg-body">
      <div class="seg" style="align-self:flex-start"><span class="on">Skill</span><span>Prompt</span><span>Graph</span></div>
      <label class="field"><span>Title</span><div class="input"><span class="val mono">postgres-session-store</span></div></label>
      <label class="field"><span>Body</span><div class="ta" style="height:120px;overflow:hidden"># postgres-session-store\n\nStore sessions in an UNLOGGED table keyed by\nsession id; expire with a partial index on\nexpires_at and a periodic DELETE in batches.</div></label>
      <div class="progress">${["Summarise", "Tag", "Embed", "Save"].map((s) => `<span>${i("check")}${s}</span>`).join('<span class="muted">·</span>')}</div>
      <div class="field"><span>Summary</span><p style="font-size:13px">Postgres-backed session storage with UNLOGGED tables, TTL via partial index and batched expiry deletes.</p></div>
      <div class="field"><span>Tags</span><div class="chips">${[["postgres", "existing"], ["sessions", "new"], ["caching", "existing"], ["ttl", "new"]].map(([t, s]) => `<span class="chip tagname removable">${t}<span class="data">${s}</span>${i("x")}</span>`).join("")}<span class="chip" style="background:none;border:1px dashed var(--input)">${i("plus", 'style="width:12px;height:12px"')}Tag</span></div></div>
    </div>
    <div class="dlg-foot"><button class="btn primary">Done</button></div>
  </div></div>`);

/* ---------------- Activity ---------------- */
function stats() {
  return `<div class="stats">${[["1,284", "Suggestions"], ["41%", "Accepted"], ["17%", "Declined"], ["1.42 s", "p50 latency"], ["0.81", "Classifier AUC · 22 Oct"]].map(([v, l]) => `<div class="stat"><b>${v}</b><span class="label">${l}</span></div>`).join("")}</div>`;
}
function logTable() {
  const dot = (s) => (s >= 500 ? "err" : s >= 400 ? "warn" : "ok");
  return `<div class="toolbar"><div class="seg"><span class="on">All</span><span>AI calls</span><span>API calls</span></div>
      <div class="seg hide-n"><span class="on">Any</span><span>2xx</span><span>4xx</span><span>5xx</span></div><div class="grow"></div>
      <div class="input hide-n" style="width:220px">${i("search")}<span>Request id</span></div></div>
    <div class="table" role="table">
      <div class="tr th label"><span>Time</span><span>Kind</span><span>Operation</span><span>Model</span><span>Status</span><span class="r">Latency</span><span class="r">Tokens</span></div>
      ${D.logs.map((l) => `<div class="tr ${l.child ? "child" : ""} ${l.on ? "on" : ""}" role="row">
        <span class="data c-time">${l.t}</span><span class="badge c-kind">${l.kind}</span>
        <span class="op c-op trunc ${l.kind === "ai" ? "mono" : ""}" style="${l.kind === "ai" ? "font-size:12.5px" : "font-weight:500"}">${l.child ? "" : (l.on ? i("chevron-down", 'style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"') : i("chevron-right", 'style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"'))}${l.op}</span>
        <span class="data c-model trunc">${l.model}</span>
        <span class="row c-status" style="gap:6px"><span class="dot ${dot(l.st)}"></span><span class="data">${l.st}</span></span>
        <span class="data r c-lat">${l.lat}</span><span class="data r c-tok">${l.tok}</span></div>`).join("")}
    </div>`;
}
function logDetail() {
  const bars = [["extract_tags", 0, 11.7, "184 ms"], ["embed_tags", 11.8, 6.1, "96 ms"], ["retrieve", 18, 2.4, "38 ms"], ["judge ×5", 20.6, 39, "612 ms"], ["generate", 60, 46.5, "731 ms"]];
  return `<div class="insp-head"><span class="section mono" style="font-weight:500">req_7f3a91c2</span><button class="icon-btn" aria-label="Copy request id">${i("copy")}</button><div class="grow"></div><span class="row" style="gap:6px"><span class="dot ok"></span><span class="data">200</span></span></div>
    <div class="insp-body">
      <dl class="kv"><dt>Endpoint</dt><dd>POST /v1/enhance</dd><dt>Started</dt><dd class="data" style="color:var(--foreground)">24 Oct 14:02:29.848</dd><dt>Total</dt><dd class="data" style="color:var(--foreground)">1.57 s</dd><dt>Result</dt><dd>autocomplete · rev 14</dd><dt>Outcome</dt><dd class="row" style="gap:6px"><span class="dot ok"></span>Accepted after 2.1 s</dd><dt>Tokens</dt><dd class="data" style="color:var(--foreground)">5.9k in / 239 out</dd></dl>
      <div><div class="label" style="margin-bottom:10px">Timeline</div><div class="timeline">${bars.map(([n, l, w, ms]) => `<div class="tl"><span class="mono trunc" style="font-size:11.5px">${n}</span><div class="track"><div class="bar" style="left:${l * 0.86}%;width:${w * 0.86}%"></div></div><span class="data" style="text-align:right">${ms}</span></div>`).join("")}</div></div>
      <div><div class="label" style="margin-bottom:6px">Payloads</div><div class="row small muted"><span class="pending-decision">D1</span>Not stored</div></div>
    </div>`;
}
screens["activity"] = () => shell(head("Activity") + `<div class="main-body">${stats()}${logTable()}</div>`, logDetail(), sheet(logDetail()));

/* ---------------- Settings ---------------- */
screens["settings"] = () => shell(head("Settings") + `<div class="main-body" style="overflow:hidden"><div class="settings">
  <section class="sgroup"><h2 class="section">Backend</h2>
    <div class="srow"><span>URL</span><div class="row"><div class="input grow"><span class="val mono">http://127.0.0.1:8000</span></div><button class="btn outline">Test</button></div></div>
    <div class="srow inline"><span>Status</span><span class="row" style="gap:6px"><span class="dot ok"></span><span class="data">healthy · 23 ms · db ok · gemini ok</span></span></div></section>
  <section class="sgroup"><h2 class="section">Suggestions</h2>
    <div class="srow"><span>Trigger delay</span><div class="row" style="gap:12px"><div class="slider"><i></i><b></b></div><span class="data" style="width:56px;text-align:right">400 ms</span></div></div>
    <div class="srow inline"><span>Autocomplete</span><span class="switch on" role="switch" aria-checked="true"></span></div>
    <div class="srow inline"><span>Questions</span><span class="switch on" role="switch" aria-checked="true"></span></div>
    <div class="srow inline"><span>Max options</span><div class="seg"><span>2</span><span>3</span><span class="on">4</span><span>5</span><span>6</span></div></div></section>
  <section class="sgroup"><h2 class="section">Appearance</h2>
    <div class="srow inline"><span>Theme</span><div class="seg"><span class="on">System</span><span>Light</span><span>Dark</span></div></div></section>
  <section class="sgroup"><h2 class="section">Logging</h2>
    <div class="srow inline"><span class="row">Store payloads <span class="pending-decision">D1</span></span><span class="switch" role="switch" aria-checked="false"></span></div>
    <div class="srow inline"><span class="row">Retention <span class="pending-decision">D2</span></span><div class="input" style="width:140px"><span class="val">30 days</span><div class="grow"></div>${i("chevrons-up-down")}</div></div>
    <div class="srow inline"><span>Stored</span><div class="row"><span class="data">18,402 entries · 6.1 MB</span><button class="btn danger sm">Clear logs</button></div></div></section>
  <section class="sgroup"><h2 class="section">Snowflake</h2>
    <div class="srow inline"><span>Last export</span><span class="data">24 Oct 13:00 · 1,284 events</span></div>
    <div class="srow inline"><span>Classifier</span><div class="row"><span class="data">AUC 0.81 · 22 Oct</span><button class="btn outline sm">Export now</button><button class="btn outline sm">Retrain</button></div></div></section>
  </div></div>`, null,
  P.get("toast") ? `<div class="toast" role="status">${i("check-circle-2")}<span class="grow">Exported 1,284 events</span></div>` : "");

/* ---------------- render ---------------- */
document.getElementById("root").innerHTML = (screens[S] || screens["refine-autocomplete"])();
lucide.createIcons({ attrs: { "stroke-width": 1.75 } });
document.fonts.ready.then(() => document.body.setAttribute("data-ready", "1"));
