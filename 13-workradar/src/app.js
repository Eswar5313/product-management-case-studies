/* WorkRadar MVP. Vanilla JS, no build step. State lives in memory and is mirrored to localStorage per browser. */
(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = n => n.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
const STORE = "workradar.v1";

const ICON = {
  slack: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 2.5 5 13.5M11 2.5 10 13.5M2.5 6h11M2 10h11"/></svg>',
  jira: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8 1.8 14.2 8 8 14.2 1.8 8Z"/><path d="M8 5.4 10.6 8 8 10.6 5.4 8Z"/></svg>',
  github: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="4.5" cy="3.5" r="1.7"/><circle cx="4.5" cy="12.5" r="1.7"/><circle cx="11.5" cy="5.5" r="1.7"/><path d="M4.5 5.2v5.6M11.5 7.2c0 2.6-7 1.4-7 3.6"/></svg>',
  email: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.6"/><path d="m2.2 4.2 5.8 4.6 5.8-4.6"/></svg>',
  dashboard: '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.4"/><path d="M8 8 12.4 3.8" stroke-linecap="round"/></svg>',
  feed: '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h8M2.5 12h5"/></svg>',
  search: '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3.2 3.2"/></svg>'
};

/* ---------- state ---------- */
const state = { items: SEED.map(i => ({ status: "open", snoozeUntil: null, ...i })), userEvents: [], view: "dashboard", itemId: null, back: "dashboard",
  feed: { status: "open", lens: "all", src: "all" }, q: "", qsrc: "all", outage: false, menu: null, ai: null, aiBusy: false, toast: null };
let sample = null;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!saved) return;
    for (const it of state.items) if (saved.items?.[it.id]) Object.assign(it, saved.items[it.id]);
    state.userEvents = saved.userEvents || [];
  } catch (e) { /* storage unavailable: run in memory */ }
}
function save() {
  try {
    const items = {};
    for (const it of state.items) items[it.id] = { status: it.status, owner: it.owner, snoozeUntil: it.snoozeUntil };
    localStorage.setItem(STORE, JSON.stringify({ items, userEvents: state.userEvents }));
  } catch (e) { /* ignore */ }
}
const byId = id => state.items.find(i => i.id === id);
const status = it => (it.status === "snoozed" && it.snoozeUntil && it.snoozeUntil <= Date.now()) ? "open" : it.status;

/* ---------- time ---------- */
function rel(ts) { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); if (m < 60) return m + "m ago"; const h = Math.round(m / 60); if (h < 24) return h + "h ago"; return Math.round(h / 24) + "d ago"; }
function span(ts) { const h = (Date.now() - ts) / H; return h < 24 ? Math.max(1, Math.round(h)) + "h" : Math.floor(h / 24) + "d " + Math.round(h % 24) + "h"; }
const clock = ts => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function dayDiff(ts) { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(ts); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 864e5); }
function dueLabel(ts) { if (!ts) return "No due date"; if (ts < Date.now()) return "Overdue since " + clock(ts); const d = dayDiff(ts); if (d === 0) return "Due today " + clock(ts); if (d === 1) return "Due tomorrow " + clock(ts); return "Due " + new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }); }

/* ---------- priority model: transparent, additive, capped at 99 ---------- */
const BASE = { incident: 58, blocker: 34, decision: 28, review: 22, risk: 20, task: 12, fyi: 4 };
const TYPE = { incident: "Incident", blocker: "Blocker", decision: "Decision", review: "Review", risk: "Risk", task: "Planned work", fyi: "FYI" };
function score(it) {
  const f = [{ label: TYPE[it.type], pts: BASE[it.type] }];
  if (it.due) { const d = dayDiff(it.due); if (it.due < Date.now()) f.push({ label: "Overdue", pts: 24 }); else if (d === 0) f.push({ label: "Due today", pts: 18 }); else if (d === 1) f.push({ label: "Due tomorrow", pts: 10 }); else if (d <= 3) f.push({ label: "Due this week", pts: 4 }); }
  if (it.blocked) f.push({ label: "Blocks " + PEOPLE[it.blocked.who].name.split(" ")[0] + " for " + span(it.blocked.since), pts: (Date.now() - it.blocked.since) / H > 24 ? 14 : 9 });
  if (it.impact) f.push({ label: "Customer impact", pts: 12 });
  if (it.needsYou) f.push({ label: "Waiting on you", pts: 8 });
  if (it.release) f.push({ label: "Release 4.12 depends on it", pts: 8 });
  if (!it.owner && it.type !== "fyi") f.push({ label: "No owner", pts: 6 });
  const total = Math.min(99, f.reduce((a, b) => a + b.pts, 0));
  return { total, factors: f };
}
const tierOf = t => t >= 70 ? ["crit", "Critical"] : t >= 48 ? ["high", "High"] : t >= 28 ? ["med", "Medium"] : ["low", "Low"];
const ranked = list => list.map(it => ({ it, sc: score(it) })).sort((a, b) => b.sc.total - a.sc.total);
const lowerFirst = t => /^[A-Z][A-Z]/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
const needsOf = r => r.filter(x => x.it.needsYou || (!x.it.owner && x.sc.total >= 48));
const openItems = () => state.items.filter(i => status(i) === "open");

/* ---------- small renderers ---------- */
const srcTag = it => `<span class="src">${ICON[it.src]}${esc(SOURCES[it.src])} · ${esc(it.ref)}</span>`;
const av = id => id ? `<span class="av" title="${esc(PEOPLE[id].name)}">${id === "you" ? "You" : initials(PEOPLE[id].name)}</span>` : `<span class="av" title="No owner">–</span>`;
const ownerName = it => it.owner ? PEOPLE[it.owner].name : "No owner";
function scoreBadge(sc) { const [k] = tierOf(sc.total); return `<span class="score t-${k}" title="Priority score">${sc.total}</span>`; }
function statePill(it) { const s = status(it); if (s === "done") return '<span class="pill t-ok">Done</span>'; if (s === "snoozed") return `<span class="pill t-low">Snoozed until ${esc(new Date(it.snoozeUntil).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</span>`; return ""; }
function rowHTML({ it, sc }, n) {
  return `<button class="row ${status(it) === "done" ? "done" : ""}" data-act="open" data-id="${it.id}">
    ${n ? `<span class="rank">${n}</span>` : scoreBadge(sc)}
    <span><span class="t">${esc(it.title)}</span><span class="s">${srcTag(it)}<span>${esc(ownerName(it))}</span>${it.due ? `<span>${esc(dueLabel(it.due))}</span>` : ""}</span></span>
    ${n ? scoreBadge(sc) : av(it.owner)}</button>`;
}
function actsHTML(it) {
  const s = status(it), m = state.menu && state.menu.id === it.id ? state.menu.kind : null;
  if (s === "done") return `<div class="acts"><button class="btn sm" data-act="reopen" data-id="${it.id}">Reopen</button></div>`;
  if (s === "snoozed") return `<div class="acts"><button class="btn sm" data-act="reopen" data-id="${it.id}">Bring back now</button></div>`;
  const people = Object.entries(PEOPLE).map(([k, p]) => `<button data-act="assign" data-id="${it.id}" data-who="${k}">${av(k)}${k === "you" ? "Me" : esc(p.name)}<small>${it.owner === k ? "current" : esc(p.role)}</small></button>`).join("");
  const sn = [["1h", "1 hour"], ["tom", "Tomorrow 9 AM"], ["mon", "Next Monday 9 AM"]].map(([k, l]) => `<button data-act="snooze" data-id="${it.id}" data-for="${k}">${l}</button>`).join("");
  return `<div class="acts">
    <span class="menuwrap"><button class="btn sm" data-act="menu" data-kind="assign" data-id="${it.id}" aria-expanded="${m === "assign"}">Assign</button>${m === "assign" ? `<div class="menu" role="menu">${people}</div>` : ""}</span>
    <span class="menuwrap"><button class="btn sm" data-act="menu" data-kind="snooze" data-id="${it.id}" aria-expanded="${m === "snooze"}">Snooze</button>${m === "snooze" ? `<div class="menu" role="menu">${sn}</div>` : ""}</span>
    <button class="btn sm primary" data-act="done" data-id="${it.id}">Mark done</button></div>`;
}
function cardHTML({ it, sc }, hl) {
  const [k, label] = tierOf(sc.total), h = hl || esc;
  const why = sc.factors.slice(1).map(f => f.label).join(" · ") || TYPE[it.type];
  return `<div class="card">${scoreBadge(sc)}<div style="display:flex;flex-direction:column;gap:6px;min-width:0">
    <div class="s" style="display:flex;gap:6px 10px;flex-wrap:wrap;align-items:center">${srcTag(it)}<span class="pill t-${k}">${label}</span><span class="pill t-low">${TYPE[it.type]}</span>${statePill(it)}${state.outage && it.src === "jira" ? '<span class="pill t-high">Cached copy</span>' : ""}</div>
    <button class="open" data-act="open" data-id="${it.id}">${h(it.title)}</button>
    <p>${h(it.body)}</p>
    <div class="foot"><span class="why">${av(it.owner)} ${esc(ownerName(it))} · ${esc(why)}</span>${actsHTML(it)}</div></div></div>`;
}
const empty = (title, text, extra = "", err = false) => `<div class="empty ${err ? "err" : ""}"><b>${title}</b><span>${text}</span>${extra}</div>`;

/* ---------- brief ---------- */
function localBrief() {
  const r = ranked(openItems());
  if (!r.length) return "The radar is clear. Nothing open needs you right now.";
  const needs = needsOf(r), blocked = r.filter(x => x.it.blocked), unowned = r.filter(x => !x.it.owner && x.it.type !== "fyi");
  const top = (needs[0] || r[0]).it, out = [];
  out.push(`${needs.length ? needs.length + (needs.length === 1 ? " item needs" : " items need") + " you today." : "Nothing is waiting on you."} Start with “${top.title}”${top.impact ? " (" + top.impact.toLowerCase() + ")" : top.due ? " (" + dueLabel(top.due).toLowerCase() + ")" : ""}.`);
  if (blocked.length) out.push(`${blocked.length === 1 ? "One person is" : blocked.length + " people are"} blocked: ` + blocked.map(x => `${PEOPLE[x.it.blocked.who].name.split(" ")[0]} on ${lowerFirst(x.it.blocked.on)} (${span(x.it.blocked.since)})`).join("; ") + ".");
  if (unowned.length) out.push(`${unowned.length} open ${unowned.length === 1 ? "item has" : "items have"} no owner, led by “${unowned[0].it.title}”.`);
  const closed = state.items.filter(i => status(i) === "done").length;
  out.push(`So far today: ${closed} closed, ${allEvents().length} updates across ${Object.keys(SOURCES).length} tools.${state.outage ? " Jira did not sync, so Jira items may be out of date." : ""}`);
  return out.join(" ");
}
async function askClaude() {
  if (!sample || state.aiBusy) return;
  state.aiBusy = true; render();
  const data = ranked(openItems()).slice(0, 12).map(({ it, sc }) => ({ title: it.title, source: SOURCES[it.src], type: TYPE[it.type], owner: ownerName(it), due: it.due ? dueLabel(it.due) : null, score: sc.total, waitingOnManager: !!it.needsYou, blocked: it.blocked ? `${PEOPLE[it.blocked.who].name} blocked on ${it.blocked.on} for ${span(it.blocked.since)}` : null, customerImpact: it.impact || null }));
  const prompt = `You write the morning brief inside WorkRadar, a tool for engineering managers. Using ONLY the JSON below (ranked open work items, highest priority first), write a brief of at most 90 words in plain text, no markdown, no lists. Cover in order: what the manager must do first and why, who is blocked on what and for how long, what has no owner, and one closing line on the release risk if any. Be specific and use names. Do not invent facts.\n\n${JSON.stringify(data)}`;
  try { const res = await sample(prompt, { modelTier: "quick" }); state.ai = (res.text || "").trim() || null; }
  catch (e) { toast(e && e.code === "rate_limited" ? "Claude is busy. Try again in a minute." : "Claude could not write the brief. Showing the built-in summary."); state.ai = null; }
  state.aiBusy = false; render();
}

/* ---------- events ---------- */
const allEvents = () => [...state.userEvents, ...EVENTS].sort((a, b) => b.at - a.at);
const evHTML = e => `<button class="ev" data-act="open" data-id="${e.item}"><time>${esc(clock(e.at))}</time><span><b>${e.who ? esc(e.who === "you" ? "You" : PEOPLE[e.who].name.split(" ")[0]) + " " : ""}</b>${esc(e.text)} <span class="src">${ICON[e.src]}${SOURCES[e.src]}</span></span></button>`;

/* ---------- views ---------- */
function radarHTML(r) {
  const quad = { slack: 180, jira: 270, github: 0, email: 90 }, per = {};
  r.forEach(x => (per[x.it.src] = per[x.it.src] || []).push(x));
  let dots = "";
  for (const s in per) per[s].forEach((x, i) => {
    const a = (quad[s] + 90 * (i + 1) / (per[s].length + 1)) * Math.PI / 180, rad = 18 + (1 - x.sc.total / 100) * 108;
    const [k, label] = tierOf(x.sc.total), size = { crit: 7.5, high: 6.5, med: 5.5, low: 4.5 }[k];
    dots += `<circle class="blip" tabindex="0" role="button" data-act="open" data-id="${x.it.id}" cx="${(150 + rad * Math.cos(a)).toFixed(1)}" cy="${(150 + rad * Math.sin(a)).toFixed(1)}" r="${size}" fill="var(--${k})" aria-label="${esc(x.it.title)}, ${label}, score ${x.sc.total}"><title>${esc(x.it.title)} · ${label} ${x.sc.total}</title></circle>`;
  });
  const lab = (x, y, t, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="var(--mono)" font-size="11" fill="var(--muted)">${t}</text>`;
  return `<section class="panel radar"><header><h2>Radar</h2><span>closer to centre = more urgent</span></header>
    <div class="radar-box"><div class="sweep"></div><svg viewBox="0 0 300 300" role="group" aria-label="Open items plotted by source and urgency">
      ${[44, 86, 128].map(q => `<circle cx="150" cy="150" r="${q}" fill="none" stroke="var(--line)" stroke-width="1"/>`).join("")}
      <path d="M150 22V278M22 150H278" stroke="var(--line)" stroke-width="1" fill="none"/>
      ${lab(26, 30, "SLACK", "start")}${lab(274, 30, "JIRA", "end")}${lab(274, 282, "GITHUB", "end")}${lab(26, 282, "EMAIL", "start")}
      <circle cx="150" cy="150" r="3" fill="var(--gold)"/>${dots}</svg></div>
    <div class="radar-key"><span><i style="background:var(--crit)"></i>Critical</span><span><i style="background:var(--high)"></i>High</span><span><i style="background:var(--med)"></i>Medium</span><span><i style="background:var(--low)"></i>Low</span></div></section>`;
}
function dashboard() {
  const r = ranked(openItems());
  const needs = needsOf(r);
  const work = r.filter(x => x.it.owner && !needs.includes(x) && x.it.type !== "fyi").slice(0, 5);
  const blocked = r.filter(x => x.it.blocked);
  const ev = allEvents();
  const hello = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  return `<div class="head"><div><p class="eyebrow">${esc(new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }))} · Checkout squad</p><h1>${hello}. Here is your team at a glance.</h1></div>
      <p>${r.length} open items from 4 tools · demo data</p></div>
    <div class="hero">
      <section class="brief" aria-live="polite"><p class="eyebrow">${state.ai ? "Brief · written by Claude" : "Brief · auto-summary"}</p>
        <p class="brief-text ${state.aiBusy ? "busy" : ""}">${esc(state.ai || localBrief())}</p>
        <div class="brief-meta"><span>${state.ai ? "Written by Claude from the ranked items. Check details before acting." : "Built from the ranked items by fixed rules. Updates as you act."}</span>
          ${sample ? `<button class="btn ghost sm" data-act="ai" ${state.aiBusy ? "disabled" : ""}>${state.aiBusy ? "Writing…" : state.ai ? "Rewrite with Claude" : "Write with Claude"}</button>` : ""}
          ${state.ai ? '<button class="btn ghost sm" data-act="ai-clear">Show auto-summary</button>' : ""}</div></section>
      ${radarHTML(r)}</div>
    <div class="grid2">
      <section class="panel"><header><h2>Needs you now</h2><span>${needs.length} waiting on a decision, review or owner</span></header><div class="rows">${needs.length ? needs.slice(0, 6).map(x => rowHTML(x)).join("") : empty("Nothing is waiting on you", "Decisions, reviews and unowned risks will appear here.")}</div></section>
      <section class="panel"><header><h2>Top work today</h2><span>what the team is carrying, ranked</span></header><div class="rows">${work.length ? work.map((x, i) => rowHTML(x, i + 1)).join("") : empty("No active work", "Assigned items will be ranked here.")}</div></section>
      <section class="panel"><header><h2>Who is blocked</h2><span>${blocked.length} of 6 people</span></header><div class="rows">${blocked.length ? blocked.map(x => `<button class="row" data-act="open" data-id="${x.it.id}">${av(x.it.blocked.who)}<span><span class="t">${esc(PEOPLE[x.it.blocked.who].name)}</span><span class="s"><span>Waiting on: ${esc(x.it.blocked.on)}</span></span></span><span class="pill ${(Date.now() - x.it.blocked.since) / H > 24 ? "t-crit" : "t-high"}">${span(x.it.blocked.since)}</span></button>`).join("") : empty("Nobody is blocked", "When someone is waiting on a person, access or decision, they show up here.")}</div></section>
      <section class="panel"><header><h2>What happened today</h2><span>${ev.length} updates</span></header><div class="rows">${ev.slice(0, 7).map(evHTML).join("")}</div></section>
    </div>
    <div class="mobile-tools"><button class="linkbtn" data-act="outage">${state.outage ? "Restore Jira" : "Simulate Jira outage"}</button><button class="linkbtn" data-act="reset">Reset demo data</button></div>`;
}
function feed() {
  const f = state.feed;
  let list = state.items.filter(i => status(i) === f.status);
  if (f.src !== "all") list = list.filter(i => i.src === f.src);
  if (f.lens === "needs") list = list.filter(i => i.needsYou); if (f.lens === "blocked") list = list.filter(i => i.blocked); if (f.lens === "unowned") list = list.filter(i => !i.owner);
  const r = ranked(list), cnt = s => state.items.filter(i => status(i) === s).length;
  const chip = (group, val, label) => `<button class="chip" data-act="filter" data-group="${group}" data-val="${val}" aria-pressed="${f[group] === val}">${label}</button>`;
  let body;
  if (state.outage && f.src === "jira") body = empty("Jira did not sync", "WorkRadar could not reach Jira at the last refresh, so there is nothing reliable to rank here. Your Jira connection may have expired.", '<button class="btn primary" data-act="retry">Try again</button>', true);
  else if (!r.length) body = f.status === "open" && f.lens === "all" && f.src === "all" ? empty("The radar is clear", "Every item is done or snoozed. New items appear here as your tools report them.") : empty("Nothing matches these filters", "Try a different lens or source.", '<button class="btn" data-act="clear-filters">Clear filters</button>');
  else body = r.map(x => cardHTML(x)).join("");
  return `<div class="head"><div><p class="eyebrow">One ranked list across Slack, Jira, GitHub and Email</p><h1>Priority feed</h1></div><p>Ranked by a visible score. Open any item to see why.</p></div>
    <div class="toolbar"><div class="chips" role="group" aria-label="Status">${chip("status", "open", `Open ${cnt("open")}`)}${chip("status", "snoozed", `Snoozed ${cnt("snoozed")}`)}${chip("status", "done", `Done ${cnt("done")}`)}</div>
      <div class="chips" role="group" aria-label="Lens">${chip("lens", "all", "All")}${chip("lens", "needs", "Needs me")}${chip("lens", "blocked", "Blocked")}${chip("lens", "unowned", "No owner")}</div>
      <div class="chips" role="group" aria-label="Source">${chip("src", "all", "All tools")}${Object.entries(SOURCES).map(([k, v]) => chip("src", k, v)).join("")}</div></div>
    <section class="panel">${body}</section>`;
}
function hay(it) { return [it.id, it.title, it.body, it.ref, SOURCES[it.src], TYPE[it.type], ownerName(it), it.owner ? "" : "unassigned", it.blocked ? "blocked " + it.blocked.on : "", it.impact || "", status(it), it.digest].join(" ").toLowerCase(); }
function searchResults() {
  const q = state.q.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
  if (!toks.length) return `<div class="empty"><b>Search every tool at once</b><span>Find a ticket, a person, a release or a phrase across all four tools, including done and snoozed items.</span><div class="chips">${["refund", "blocked", "Rohan", "4.12", "PAY-490", "unassigned"].map(t => `<button class="chip" data-act="try" data-q="${t}">${t}</button>`).join("")}</div></div>`;
  let list = state.items.filter(it => { const h = hay(it); return toks.every(t => h.includes(t)); });
  if (state.qsrc !== "all") list = list.filter(i => i.src === state.qsrc);
  if (!list.length) return empty(`No results for “${esc(state.q)}”`, "Check the spelling, try a ticket number like PAY-482, or search a person's name.", state.qsrc !== "all" ? '<button class="btn" data-act="qsrc" data-val="all">Search all tools</button>' : "");
  const re = new RegExp("(" + toks.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  const hl = s => esc(s).replace(re, "<mark>$1</mark>");
  return `<p class="eyebrow" style="padding:12px 16px 8px">${list.length} result${list.length === 1 ? "" : "s"}, most urgent first</p>` + ranked(list).map(x => cardHTML(x, hl)).join("");
}
function search() {
  return `<div class="head"><div><p class="eyebrow">Slack · Jira · GitHub · Email</p><h1>Search</h1></div></div>
    <label class="searchbar">${ICON.search}<input id="q" type="search" placeholder="Search tickets, people, releases…" value="${esc(state.q)}" autocomplete="off" aria-label="Search all items"></label>
    <div class="chips" id="qchips">${qchips()}</div>
    <section class="panel" id="results">${searchResults()}</section>`;
}
const qchips = () => [["all", "All tools"], ...Object.entries(SOURCES)].map(([k, v]) => `<button class="chip" data-act="qsrc" data-val="${k}" aria-pressed="${state.qsrc === k}">${v}</button>`).join("");
function detail() {
  const it = byId(state.itemId);
  if (!it) return `<button class="btn" data-act="nav" data-view="feed" style="align-self:flex-start">← Back</button><section class="panel">${empty("This item could not be found", "It may have been removed from its source tool.", "", true)}</section>`;
  const sc = score(it), [k, label] = tierOf(sc.total), names = { dashboard: "Dashboard", feed: "Priority feed", search: "Search" };
  return `<button class="btn" data-act="nav" data-view="${state.back}" style="align-self:flex-start">← ${names[state.back]}</button>
    <div class="detail">
      <section class="panel">
        <div class="sec"><div style="display:flex;gap:6px 10px;flex-wrap:wrap;align-items:center">${srcTag(it)}<span class="pill t-${k}">${label} · ${sc.total}</span><span class="pill t-low">${TYPE[it.type]}</span>${statePill(it)}</div>
          <h1>${esc(it.title)}</h1><p style="color:var(--muted)">${esc(it.body)}</p>${actsHTML(it)}</div>
        <div class="sec"><h3>AI digest of the thread</h3><p class="digest">${esc(it.digest)}</p><p style="font-size:12.5px;color:var(--muted)">Sample digest for the demo. In production this is generated from the source thread.</p></div>
        <div class="sec"><h3>Suggested next step</h3><p class="next">${esc(it.next)}</p></div>
        <div class="sec"><h3>Thread · ${it.thread.length} updates</h3>${it.thread.map(m => `<div class="msg">${av(m.who)}<div class="m"><small>${esc(m.who === "you" ? "Inbox" : PEOPLE[m.who].name)} · ${esc(rel(m.at))}</small>${esc(m.text)}</div></div>`).join("")}</div>
      </section>
      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <section class="panel"><div class="sec"><h3>Details</h3><dl class="kv" style="margin:0"><dt>Owner</dt><dd>${esc(ownerName(it))}</dd><dt>Due</dt><dd>${esc(dueLabel(it.due))}</dd><dt>Source</dt><dd>${esc(SOURCES[it.src])} · ${esc(it.ref)}</dd>${it.blocked ? `<dt>Blocked on</dt><dd>${esc(it.blocked.on)} (${span(it.blocked.since)})</dd>` : ""}${it.impact ? `<dt>Impact</dt><dd>${esc(it.impact)}</dd>` : ""}<dt>Updated</dt><dd>${esc(rel(it.updated))}</dd><dt>ID</dt><dd style="font-family:var(--mono);font-size:13px">${it.id}</dd></dl></div></section>
        <section class="panel"><div class="sec"><h3>Why it is ranked here</h3>${sc.factors.map(f => `<div class="factor"><span>${esc(f.label)}</span><b>+${f.pts}</b></div>`).join("")}<div class="bar" aria-hidden="true"><i style="width:${sc.total}%"></i></div><div class="factor"><span>Priority score (max 99)</span><b>${sc.total}</b></div></div></section>
      </div></div>`;
}
function rail() {
  const n = openItems().length;
  const nav = [["dashboard", "Dashboard"], ["feed", "Priority feed"], ["search", "Search"]].map(([v, l]) => `<button data-act="nav" data-view="${v}" ${state.view === v || (state.view === "detail" && state.back === v) ? 'aria-current="page"' : ""}>${ICON[v]}<span>${l}</span>${v === "feed" ? `<span class="count">${n}</span>` : ""}</button>`).join("");
  return `<div class="brand"><svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="11.5" stroke="var(--gold)" stroke-width="1.6"/><circle cx="13" cy="13" r="6" stroke="var(--rail-muted)" stroke-width="1.2"/><path d="M13 13 21 6.5" stroke="var(--gold)" stroke-width="1.8" stroke-linecap="round"/><circle cx="13" cy="13" r="1.8" fill="var(--gold)"/></svg><b>WorkRadar</b></div>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="rail-foot"><div class="srcs">${Object.entries(SOURCES).map(([k, v]) => `<span><i class="dot ${state.outage && k === "jira" ? "bad" : ""}"></i>${v} ${state.outage && k === "jira" ? "sync failed" : "synced"}</span>`).join("")}</div>
      <button class="linkbtn" data-act="outage">${state.outage ? "Restore Jira" : "Simulate Jira outage"}</button><button class="linkbtn" data-act="reset">Reset demo data</button>
      <div class="who">${av("you")}<span>Priya Menon<small>Engineering Manager</small></span></div></div>`;
}
function render() {
  $("#rail").innerHTML = rail();
  const banner = state.outage ? `<div class="banner" role="alert"><span><b>Jira did not sync.</b> Jira items below are a cached copy and may be out of date.</span><button class="btn sm" data-act="retry">Try again</button></div>` : "";
  $("#view").innerHTML = banner + ({ dashboard, feed, search, detail }[state.view])();
  $("#toast").innerHTML = state.toast ? `<div class="toast" role="status"><span>${esc(state.toast.msg)}</span>${state.toast.undo ? '<button data-act="undo">Undo</button>' : ""}</div>` : "";
}
function go(view, id) {
  if (view === "detail") { if (state.view !== "detail") state.back = state.view; state.itemId = id; }
  state.view = view; state.menu = null;
  try { history.replaceState(null, "", "#" + (view === "detail" ? "item-" + id : view)); } catch (e) { /* hash is optional */ }
  render(); window.scrollTo(0, 0);
  if (view === "search") $("#q")?.focus();
}

/* ---------- actions ---------- */
let toastTimer;
function toast(msg, undo) { state.toast = { msg, undo }; clearTimeout(toastTimer); toastTimer = setTimeout(() => { state.toast = null; render(); }, 6000); }
function act(it, change, msg, evText) {
  const prev = { id: it.id, status: it.status, owner: it.owner, snoozeUntil: it.snoozeUntil, ev: state.userEvents.length };
  Object.assign(it, change);
  if (evText) state.userEvents.push({ at: Date.now(), src: it.src, who: "you", text: evText, item: it.id });
  state.ai = null; state.menu = null; save(); toast(msg, prev); render();
}
function snoozeUntil(k) { if (k === "1h") return Date.now() + H; if (k === "tom") return todayAt(9, 0, 1); const d = new Date(); const add = ((8 - d.getDay()) % 7) || 7; return todayAt(9, 0, add); }

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) { if (state.menu) { state.menu = null; render(); } return; }
  const a = el.dataset.act, it = el.dataset.id ? byId(el.dataset.id) : null;
  if (a === "open") return go("detail", el.dataset.id);
  if (a === "nav") return go(el.dataset.view);
  if (a === "menu") { state.menu = state.menu && state.menu.id === it.id && state.menu.kind === el.dataset.kind ? null : { id: it.id, kind: el.dataset.kind }; return render(); }
  if (a === "assign") { const who = el.dataset.who; return act(it, { owner: who }, `Assigned to ${who === "you" ? "you" : PEOPLE[who].name}`, `assigned “${it.title}” to ${who === "you" ? "yourself" : PEOPLE[who].name}`); }
  if (a === "done") return act(it, { status: "done" }, "Marked done", `marked “${it.title}” done`);
  if (a === "snooze") { const until = snoozeUntil(el.dataset.for); return act(it, { status: "snoozed", snoozeUntil: until }, `Snoozed until ${new Date(until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`, `snoozed “${it.title}”`); }
  if (a === "reopen") return act(it, { status: "open", snoozeUntil: null }, "Back in the feed", `reopened “${it.title}”`);
  if (a === "undo") { const p = state.toast.undo, t = byId(p.id); Object.assign(t, { status: p.status, owner: p.owner, snoozeUntil: p.snoozeUntil }); state.userEvents.length = p.ev; state.toast = null; save(); return render(); }
  if (a === "filter") { state.feed[el.dataset.group] = el.dataset.val; return render(); }
  if (a === "clear-filters") { state.feed = { status: "open", lens: "all", src: "all" }; return render(); }
  if (a === "qsrc") { state.qsrc = el.dataset.val; $("#qchips").innerHTML = qchips(); $("#results").innerHTML = searchResults(); return; }
  if (a === "try") { state.q = el.dataset.q; render(); return $("#q")?.focus(); }
  if (a === "outage") { state.outage = !state.outage; toast(state.outage ? "Simulating a failed Jira sync" : "Jira restored"); return render(); }
  if (a === "retry") { state.outage = false; toast("Jira synced. Items are up to date."); return render(); }
  if (a === "reset") { try { localStorage.removeItem(STORE); } catch (err) { /* ignore */ } state.items = SEED.map(i => ({ status: "open", snoozeUntil: null, ...i })); state.userEvents = []; state.ai = null; state.outage = false; toast("Demo data reset"); return render(); }
  if (a === "ai") return askClaude();
  if (a === "ai-clear") { state.ai = null; return render(); }
});
document.addEventListener("input", e => { if (e.target.id === "q") { state.q = e.target.value; $("#results").innerHTML = searchResults(); } });
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); go("search"); }
  if (e.key === "Escape" && state.menu) { state.menu = null; render(); }
  if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("blip")) { e.preventDefault(); go("detail", e.target.dataset.id); }
});

/* ---------- boot ---------- */
load();
const h = (location.hash || "").slice(1);
if (h.startsWith("item-") && byId(h.slice(5))) { state.view = "detail"; state.itemId = h.slice(5); state.back = "feed"; } else if (["feed", "search"].includes(h)) state.view = h;
render();
/* Optional: inside Claude, a real model can write the brief. Elsewhere the rule-based summary stays. */
if (window.claude && typeof window.claude.use === "function") window.claude.use("sample").then(s => { if (s) { sample = s; render(); } }).catch(() => {});
})();
