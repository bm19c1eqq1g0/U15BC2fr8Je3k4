// Fetches the league team pages, extracts the embedded TeamLinkt JSON, writes data.json
import fs from "node:fs";
const L = {
  League: "963092 964672 966643 946175 963093 964682 962685 961224 966958 966225 946176 965764 964673 964191 962686",
};
async function fetchRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status < 500) return r;      // 2xx/3xx/4xx: return as-is
      last = new Error("HTTP " + r.status);
    } catch (e) { last = e; }
    if (i < tries - 1) await new Promise(res => setTimeout(res, 5000 * (i + 1) * (i + 1)));
  }
  throw last;
}
function extract(txt) {
  const m = "__TEAMLINKT_SITE__", i = txt.indexOf(m);
  if (i < 0) throw new Error("marker not found");
  const st = txt.indexOf("{", i);
  let d = 0, q = false, e = false, j;
  for (j = st; j < txt.length; j++) {
    const c = txt[j];
    if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false; }
    else if (c === '"') q = true; else if (c === "{") d++; else if (c === "}") { d--; if (!d) break; }
  }
  return JSON.parse(txt.slice(st, j + 1));
}
const prev = fs.existsSync("data.json") ? JSON.parse(fs.readFileSync("data.json", "utf8")) : {};
const history = prev.history || {};
const teams = [];
let fail = 0;
outer: for (const div of Object.keys(L)) for (const id of L[div].split(" ")) {
  try {
    const r = await fetchRetry(`https://leagues.teamlinkt.com/hockeycalgary/view/team/${id}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-CA,en;q=0.9" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const site = extract(await r.text());
    teams.push({ div, site });
    const lg = site.entityPageContext?.data?.lastGame;
    if (lg && lg.homeScore != null) history[lg.id] = { id: lg.id, date: lg.date, home: lg.homeTeam || lg.homeTeamName, away: lg.awayTeam || lg.awayTeamName, loc: lg.location, time: lg.startTime, hs: lg.homeScore, as: lg.awayScore };
    console.log("ok", id);
  } catch (e) { fail++; console.error("FAIL", id, e.message); if (fail >= 3 && teams.length === 0) { console.error("League site looks down; stopping early."); break outer; } }
  await new Promise(r => setTimeout(r, 1500));
}
if (teams.length < 10) {
  console.error("Too few teams fetched; keeping old data.json");
  process.exit(prev.teams && prev.teams.length ? 0 : 1);
}
const names = new Set(teams.map(t => t.site.entityPageContext?.data?.teamData?.name));
for (const k of Object.keys(history)) if (!names.has(history[k].home) && !names.has(history[k].away)) delete history[k];
// Official standings (games played, W-L-T, goals for/against) from the league's public standings feed.
// Only 2026-2027 Seeding (61563) and Regular Season (60742) are used; Exhibition and older seasons are ignored.
let standings = prev.standings || {};
try {
  const API = "https://app.teamlinkt.com/api/public/sites/hockeycalgary/";
  const hdr = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
  const ours = new Set(teams.map(t => t.site.entityPageContext?.data?.teamData?.id));
  const ages = new Set(teams.map(t => (t.site.entityPageContext?.data?.teamData?.name || "").match(/^U\d+/)?.[0]).filter(Boolean));
  const SEEDING = 61563, REGULAR = 60742;
  const dr = await fetchRetry(API + "divisions", { headers: hdr });
  if (!dr.ok) throw new Error("divisions HTTP " + dr.status);
  const tiers = (await dr.json()).filter(d => (d.seasonId === SEEDING || d.seasonId === REGULAR) && d.path.length >= 2 && ages.has(d.path[0]));
  const bySeason = { [SEEDING]: {}, [REGULAR]: {} };
  let n = 0, bad = 0;
  const worker = async () => {
    while (n < tiers.length) {
      const d = tiers[n++];
      try {
        const r = await fetchRetry(API + "standings", { method: "POST", headers: hdr, body: JSON.stringify({ season_id: d.seasonId, division_id: d.id }) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        for (const t of (await r.json()).teams || []) if (ours.has(t.id)) bySeason[d.seasonId][t.id] = { gp: t.gamesPlayed || 0, w: t.wins || 0, l: t.losses || 0, t: t.ties || 0, gf: t.goals_for || 0, ga: t.goals_against || 0 };
      } catch (e) { bad++; }
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));
  const fresh = {};
  for (const id of ours) {
    const reg = bySeason[REGULAR][id], seed = bySeason[SEEDING][id];
    const pick = reg && reg.gp > 0 ? reg : (seed || reg);   // Regular Season once it has games, else Seeding
    if (pick) fresh[id] = pick;
  }
  if (Object.keys(fresh).length) standings = fresh;
  console.log("standings for", Object.keys(fresh).length, "teams;", tiers.length, "divisions,", bad, "failed");
} catch (e) { console.error("standings fetch failed (keeping previous):", e.message); }
// Manual results: edit manual-scores.json to add scores the league page no longer shows.
// Format: [{"date":"2026-10-17","home":"Springbank","away":"Knights BC 2 Black","hs":3,"as":1}]  (names can be partial)
try {
  const manual = JSON.parse(fs.readFileSync("manual-scores.json", "utf8"));
  const sched = {};
  for (const t of teams) for (const g of (t.site.entityPageContext?.data?.scheduleGames?.data || [])) sched[g.id] = g;
  const has = (full, part) => (full || "").toLowerCase().includes(String(part).toLowerCase());
  for (const x of manual) {
    const g = Object.values(sched).find(s => s.date === x.date && has(s.homeTeam, x.home) && has(s.awayTeam, x.away));
    if (!g) { console.error("manual score not matched:", JSON.stringify(x)); continue; }
    history[g.id] = { id: g.id, date: g.date, home: g.homeTeam, away: g.awayTeam, loc: g.location, time: g.startTime, hs: x.hs, as: x.as };
  }
} catch (e) { if (e.code !== "ENOENT") console.error("manual-scores.json problem:", e.message); }
for (const k of Object.keys(history)) if ((history[k].date || "") < "2026-09-01") delete history[k];   // 2026-27 season only
fs.writeFileSync("data.json", JSON.stringify({ updated: new Date().toISOString(), teams, history, standings }));
console.log(`wrote ${teams.length} teams, ${fail} failures`);
