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
fs.writeFileSync("data.json", JSON.stringify({ updated: new Date().toISOString(), teams, history }));
console.log(`wrote ${teams.length} teams, ${fail} failures`);
