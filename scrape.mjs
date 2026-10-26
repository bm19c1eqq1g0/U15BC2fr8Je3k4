// Fetches the league team pages, extracts the embedded TeamLinkt JSON, writes data.json
import fs from "node:fs";
const L = {
  League: "963092 964672 966643 946175 963093 964682 962685 961224 966958 966225 946176 965764 964673 964191 962686",
};
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
for (const div of Object.keys(L)) for (const id of L[div].split(" ")) {
  try {
    const r = await fetch(`https://leagues.teamlinkt.com/hockeycalgary/view/team/${id}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-CA,en;q=0.9" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const site = extract(await r.text());
    teams.push({ div, site });
    const lg = site.entityPageContext?.data?.lastGame;
    if (lg && lg.homeScore != null) history[lg.id] = { id: lg.id, date: lg.date, home: lg.homeTeam || lg.homeTeamName, away: lg.awayTeam || lg.awayTeamName, loc: lg.location, time: lg.startTime, hs: lg.homeScore, as: lg.awayScore };
    console.log("ok", id);
  } catch (e) { fail++; console.error("FAIL", id, e.message); }
  await new Promise(r => setTimeout(r, 1500));
}
if (teams.length < 10) { console.error("Too few teams fetched; keeping old data.json"); process.exit(1); }
const names = new Set(teams.map(t => t.site.entityPageContext?.data?.teamData?.name));
for (const k of Object.keys(history)) if (!names.has(history[k].home) && !names.has(history[k].away)) delete history[k];
// Official standings (games played, W-L-T, goals for/against) from the league's public standings feed.
let standings = prev.standings || {};
try {
  const r = await fetch("https://app.teamlinkt.com/api/public/sites/hockeycalgary/standings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
    body: JSON.stringify({ seasonId: 61563 }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const ours = new Set(teams.map(t => t.site.entityPageContext?.data?.teamData?.id));
  const CUR = new Set([60742, 61014, 61563]);
  const fresh = {};
  for (const t of j.teams || []) {
    if (!ours.has(t.id) || !t.division || !CUR.has(t.division.seasonId)) continue;
    const gp = t.gamesPlayed || 0;
    if (!fresh[t.id] || gp > fresh[t.id].gp) fresh[t.id] = { gp, w: t.wins || 0, l: t.losses || 0, t: t.ties || 0, gf: t.goals_for || 0, ga: t.goals_against || 0 };
  }
  if (Object.keys(fresh).length) standings = fresh;
  console.log("standings for", Object.keys(fresh).length, "teams");
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
fs.writeFileSync("data.json", JSON.stringify({ updated: new Date().toISOString(), teams, history, standings }));
console.log(`wrote ${teams.length} teams, ${fail} failures`);
