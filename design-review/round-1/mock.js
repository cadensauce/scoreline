// Design round 1 mock renderer. Run inside the live Scoreline page: it fetches today's real ESPN scoreboards
// and draws the home screen in one of three directions (A, B, C) on top of the page, for screenshots.
window.scorelineMock = async function (dir, wide) {
  const API = "https://site.api.espn.com/apis/site/v2/sports/";
  const L = [["nfl", "football/nfl", "NFL"], ["nba", "basketball/nba", "NBA"], ["cfb", "football/college-football", "College Football", "?groups=80"]];
  const data = await Promise.all(L.map(([k, p, n, q]) => fetch(API + p + "/scoreboard" + (q || "")).then((r) => r.json()).then((j) => ({ k, n, ev: j.events || [] }))));
  const game = (e, k) => {
    const c = e.competitions[0], st = e.status.type, t = c.competitors.slice().sort((a) => (a.homeAway === "away" ? -1 : 1));
    const poss = c.situation?.possession;
    return { k, state: st.state, detail: st.state === "pre" ? new Date(e.date).toLocaleTimeString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : st.state === "post" ? "Final" : st.shortDetail,
      down: c.situation?.shortDownDistanceText || "",
      t: t.map((x) => ({ ab: x.team.abbreviation, name: x.team.shortDisplayName, logo: x.team.logo, score: x.score, rec: x.records?.[0]?.summary || "", win: x.winner, poss: poss && poss === x.team.id })) };
  };
  const all = data.flatMap((d) => d.ev.map((e) => game(e, d.k)));
  const live = all.filter((g) => g.state === "in").slice(0, 3);
  const sections = data.map((d) => ({ n: d.n, g: d.ev.map((e) => game(e, d.k)).filter((g) => g.state !== "in").sort((a, b) => (a.state === "pre") - (b.state === "pre")).slice(0, wide ? 6 : 3) }));

  const S = {
    A: { font: "Inter", css: `--bg:#0f0f10;--fg:#ececec;--mut:#8b8b90;--line:rgba(255,255,255,.07);--surf:transparent;--rad:0;--chip:#1c1c1e;--chipOn:#ececec;--chipOnFg:#0f0f10;--title:600 34px/1.1 var(--f);--row:16px 0;--score:600 22px var(--f);--name:500 17px var(--f);--sec:600 12px var(--f);--secCase:uppercase;--secTrack:.12em;--liveDot:#ececec;--nav:#0f0f10;--navLine:rgba(255,255,255,.07);` },
    B: { font: "Manrope", css: `--bg:#121214;--fg:#f1f1f3;--mut:#8f8f97;--line:rgba(255,255,255,.06);--surf:#1b1b1f;--rad:22px;--chip:#1e1e22;--chipOn:#f1f1f3;--chipOnFg:#121214;--title:700 30px/1.15 var(--f);--row:15px 18px;--score:700 21px var(--f);--name:600 16px var(--f);--sec:700 15px var(--f);--secCase:none;--secTrack:0;--liveDot:#f1f1f3;--nav:rgba(30,30,34,.86);--navLine:rgba(255,255,255,.08);` },
    C: { font: "Inter Tight", css: `--bg:#f5f4f0;--fg:#161616;--mut:#6e6c67;--line:rgba(0,0,0,.08);--surf:transparent;--rad:0;--chip:#e9e7e1;--chipOn:#161616;--chipOnFg:#f5f4f0;--title:600 40px/1.05 var(--f);--row:16px 0;--score:600 24px var(--f);--name:500 17px var(--f);--sec:600 12px var(--f);--secCase:uppercase;--secTrack:.12em;--liveDot:#161616;--nav:#f5f4f0;--navLine:rgba(0,0,0,.08);` },
  }[dir];

  const row = (g) => `<div class="m-row">${g.t.map((t) => `<div class="m-team ${g.state === "post" && !t.win ? "lose" : ""}"><img src="${t.logo}" alt=""><b>${t.name}</b>${t.poss ? '<i class="m-ball">●</i>' : ""}<small>${t.rec}</small><span class="m-sc">${g.state === "pre" ? "" : t.score}</span></div>`).join("")}
    <div class="m-st"><span>${g.state === "in" ? '<i class="m-dot"></i> ' : ""}${g.detail}</span>${g.down && g.state === "in" ? `<small>${g.down}</small>` : ""}</div></div>`;
  const block = (title, games, more) => games.length ? `<section class="m-sec"><div class="m-h"><span>${title}</span>${more ? "<a>See all</a>" : ""}</div><div class="m-list">${games.map(row).join("")}</div></section>` : "";
  const nav = ["Home", "NFL", "CFB", "F1", "Profile"];
  const html = `<style>
    @import url('https://fonts.googleapis.com/css2?family=${S.font.replace(/ /g, "+")}:wght@400;500;600;700&display=swap');
    #m-root{${S.css}--f:'${S.font}',system-ui,sans-serif;position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--bg);color:var(--fg);font-family:var(--f);-webkit-font-smoothing:antialiased;font-feature-settings:"tnum"}
    :where(#m-root *){box-sizing:border-box;margin:0;padding:0}
    .m-wrap{max-width:${wide ? "1120px" : "none"};margin:0 auto;padding:${wide ? "28px 40px 60px" : "16px 20px 110px"}}
    .m-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:${wide ? "36px" : "22px"}}
    .m-word{font:700 17px var(--f);letter-spacing:.02em}
    .m-tnav{display:flex;gap:6px}.m-tnav span{padding:8px 14px;border-radius:999px;color:var(--mut);font:500 15px var(--f)}.m-tnav span.on{background:var(--chip);color:var(--fg)}
    .m-title{font:var(--title);letter-spacing:-.02em;margin-bottom:6px}
    .m-sub{color:var(--mut);font:400 16px var(--f);margin-bottom:20px}
    .m-chips{display:flex;gap:8px;margin-bottom:${wide ? "34px" : "26px"}}.m-chips span{padding:9px 16px;border-radius:999px;background:var(--chip);color:var(--mut);font:500 15px var(--f)}.m-chips span.on{background:var(--chipOn);color:var(--chipOnFg)}
    .m-grid{display:${wide ? "grid" : "block"};grid-template-columns:1fr 1fr;column-gap:56px}
    .m-sec{margin-bottom:${dir === "B" ? "22px" : "34px"}}
    .m-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:${dir === "B" ? "12px" : "4px"};font:var(--sec);text-transform:var(--secCase);letter-spacing:var(--secTrack);color:${dir === "B" ? "var(--fg)" : "var(--mut)"}}.m-h a{font:500 14px var(--f);letter-spacing:0;text-transform:none;color:var(--mut)}
    .m-list{background:var(--surf);border-radius:var(--rad);${dir === "B" ? "padding:2px 0;" : ""}}
    .m-row{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;column-gap:18px;row-gap:8px;padding:var(--row);border-top:1px solid ${dir === "B" ? "transparent" : "var(--line)"};position:relative}
    ${dir === "B" ? ".m-row+.m-row:before{content:'';position:absolute;left:18px;right:18px;top:0;height:1px;background:var(--line)}" : ""}
    .m-row:first-child{border-top-color:transparent}
    .m-team{grid-column:1;width:100%;display:flex;align-items:center;gap:12px;min-width:0}.m-team img{width:24px;height:24px;object-fit:contain}
    .m-team b{font:var(--name);white-space:nowrap}.m-team small{color:var(--mut);font:400 14px var(--f)}.m-team .m-ball{font-style:normal;font-size:9px;color:var(--fg)}
    .m-sc{margin-left:auto;font:var(--score);min-width:34px;text-align:right}
    .m-team.lose b,.m-team.lose .m-sc{color:var(--mut);font-weight:500}
    .m-st{grid-column:2;grid-row:1/3;align-self:center;text-align:right;min-width:78px;font:500 14px var(--f);color:var(--mut);display:flex;flex-direction:column;align-items:flex-end;gap:3px}
    .m-st small{font:400 13px var(--f)}
    .m-dot{width:7px;height:7px;border-radius:50%;background:var(--liveDot);display:inline-block;margin:0 6px 1px 0;vertical-align:middle}
    .m-row:has(.m-dot) .m-st{color:var(--fg)}
    .m-nav{position:fixed;left:${dir === "B" ? "16px" : "0"};right:${dir === "B" ? "16px" : "0"};bottom:${dir === "B" ? "18px" : "0"};display:flex;justify-content:space-around;padding:${dir === "B" ? "12px 6px" : "10px 6px 26px"};background:var(--nav);border-top:1px solid var(--navLine);${dir === "B" ? "border:1px solid var(--navLine);border-radius:28px;backdrop-filter:blur(14px);" : ""}}
    .m-nav span{font:500 12px var(--f);color:var(--mut);display:flex;flex-direction:column;align-items:center;gap:5px;min-width:56px}.m-nav span.on{color:var(--fg)}.m-nav i{width:20px;height:20px;border-radius:${dir === "B" ? "7px" : "50%"};border:1.6px solid currentColor;display:block}
    ${dir === "B" ? "#m-root{background:radial-gradient(1200px 500px at 50% -200px,rgba(255,255,255,.06),transparent 70%),var(--bg)}" : ""}
  </style>
  <div class="m-wrap">
    <div class="m-top"><span class="m-word">SCORELINE</span>${wide ? `<div class="m-tnav">${nav.slice(0, 4).map((n, i) => `<span class="${i ? "" : "on"}">${n}</span>`).join("")}<span>Profile</span></div>` : '<span class="m-word" style="font-weight:500;color:var(--mut);font-size:15px">Sun, Nov 15</span>'}</div>
    <h1 class="m-title">Today</h1><p class="m-sub">${live.length} live · your teams first</p>
    <div class="m-chips"><span class="on">All</span><span>My teams</span><span>Live</span><span>Closest</span></div>
    <div class="m-grid"><div>${block("Live now", live)}${block(sections[0].n, sections[0].g, 1)}</div><div>${block(sections[1].n, sections[1].g, 1)}${block(sections[2].n, sections[2].g, 1)}</div></div>
  </div>
  ${wide ? "" : `<nav class="m-nav">${nav.map((n, i) => `<span class="${i ? "" : "on"}"><i></i>${n}</span>`).join("")}</nav>`}`;
  document.getElementById("m-root")?.remove();
  const root = document.createElement("div"); root.id = "m-root"; root.innerHTML = html; document.body.appendChild(root);
  await document.fonts.ready; await new Promise((r) => setTimeout(r, 600));
  return { live: live.length, games: all.length };
};
