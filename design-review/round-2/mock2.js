// Design round 2 mock: the chosen A+B direction (open rows, hairlines, rounded pill controls, floating bar, soft
// glow) applied to components and a real game page. Three variants differ in typeface, radius and density.
// Run inside the live Scoreline page; fetches real ESPN data. scorelineMock2(variant, view, wide)
// variant: "1" Inter airy | "2" Manrope soft | "3" Geist crisp ; view: "parts" | "game"
window.scorelineMock2 = async function (variant, view, wide) {
  const V = {
    "1": { font: "Inter", rad: 20, row: 18, glow: .05, w: 600, track: "-.02em" },
    "2": { font: "Manrope", rad: 26, row: 17, glow: .08, w: 700, track: "-.015em" },
    "3": { font: "Geist", rad: 14, row: 15, glow: .04, w: 600, track: "-.03em" },
  }[variant];
  const API = "https://site.api.espn.com/apis/site/v2/sports/";
  const sb = await (await fetch(API + "football/nfl/scoreboard")).json();
  const evs = sb.events || [];
  const pickEv = evs.find((e) => e.status.type.state === "in") || evs.find((e) => e.status.type.state === "post") || evs[0];
  const sum = await (await fetch(API + "football/nfl/summary?event=" + pickEv.id)).json();
  const comp = pickEv.competitions[0], st = pickEv.status.type;
  const T = comp.competitors.slice().sort((a) => (a.homeAway === "away" ? -1 : 1));
  const wp = (sum.winprobability || []).map((w) => +w.homeWinPercentage);
  const hp = wp.length ? wp[wp.length - 1] : null;
  const [aw, hm] = T, lead = +hm.score > +aw.score ? hm : +aw.score > +hm.score ? aw : null;
  const diff = Math.abs(+hm.score - +aw.score);
  const leaderP = lead && hp != null ? Math.round((lead === hm ? hp : 1 - hp) * 100) : null;
  const status = st.state === "pre" ? "Kickoff " + new Date(pickEv.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : lead ? `${lead.team.shortDisplayName} ${st.state === "post" ? "won" : "lead"} by ${diff}${st.state === "in" ? " · " + st.shortDetail : ""}` + (leaderP && st.state === "in" ? `, and teams in this spot win about ${leaderP}% of the time.` : ".")
    : "Tied · " + st.shortDetail;
  const W = 320, H = 110, n = wp.length;
  const path = n > 1 ? wp.map((p, i) => (i ? "L" : "M") + (i / (n - 1) * W).toFixed(1) + "," + ((1 - p) * H).toFixed(1)).join("") : "";
  const rows = evs.filter((e) => e !== pickEv).slice(0, 3).map((e) => {
    const c = e.competitions[0], t = c.competitors.slice().sort((a) => (a.homeAway === "away" ? -1 : 1)), s = e.status.type;
    return `<div class="r2-row">${t.map((x) => `<div class="r2-tm ${s.state === "post" && !x.winner ? "lose" : ""}"><img src="${x.team.logo}"><b>${x.team.shortDisplayName}</b><span>${s.state === "pre" ? "" : x.score}</span></div>`).join("")}<div class="r2-st">${s.state === "in" ? '<i class="r2-dot"></i>' : ""}${s.state === "post" ? "Final" : s.shortDetail}</div></div>`;
  }).join("");
  const markIcons = [
    ["Tick", '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
    ["Score lines", '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 12h5M8 15h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'],
    ["Notch", '<svg viewBox="0 0 24 24"><path d="M12 2.5l8.5 5v9L12 21.5l-8.5-5v-9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 13.5l3.5-4 3.5 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  ];
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=${V.font}:wght@400;500;600;700&display=swap');
    #m2{--bg:#101012;--fg:#ececee;--mut:#8e8e95;--faint:#5e5e64;--line:rgba(255,255,255,.07);--chip:#1c1c20;--surf:#18181b;--f:'${V.font}',system-ui,sans-serif;
      position:fixed;inset:0;z-index:2147483647;overflow:auto;color:var(--fg);font-family:var(--f);-webkit-font-smoothing:antialiased;font-feature-settings:"tnum";
      background:radial-gradient(900px 420px at 50% -160px,rgba(255,255,255,${V.glow}),transparent 70%),var(--bg)}
    :where(#m2 *){box-sizing:border-box;margin:0;padding:0}
    .r2{max-width:${wide ? "1040px" : "none"};margin:0 auto;padding:${wide ? "30px 40px 60px" : "18px 20px 120px"};display:${wide ? "grid" : "block"};grid-template-columns:1fr 1fr;gap:56px}
    .r2-h{font:600 12px var(--f);letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin:26px 0 12px}
    .r2-t{font:${V.w} 30px/1.1 var(--f);letter-spacing:${V.track}}
    .r2-btns{display:flex;flex-wrap:wrap;gap:10px}
    .b1,.b2,.b3{font:600 15px var(--f);border-radius:999px;padding:12px 20px;border:0}
    .b1{background:var(--fg);color:var(--bg)}.b2{background:var(--chip);color:var(--fg)}.b3{background:transparent;color:var(--mut);box-shadow:inset 0 0 0 1px var(--line)}
    .seg{display:inline-flex;background:var(--chip);border-radius:999px;padding:4px;gap:2px}.seg span{padding:8px 14px;border-radius:999px;font:500 14px var(--f);color:var(--mut)}.seg .on{background:var(--fg);color:var(--bg)}
    .sw{display:flex;justify-content:space-between;align-items:center;padding:${V.row}px 0;border-top:1px solid var(--line);font:500 16px var(--f)}.sw small{display:block;color:var(--mut);font:400 13px var(--f);margin-top:2px}
    .tg{width:46px;height:28px;border-radius:999px;background:var(--fg);position:relative;flex:none}.tg:after{content:"";position:absolute;right:3px;top:3px;width:22px;height:22px;border-radius:50%;background:var(--bg)}
    .tg.off{background:var(--chip)}.tg.off:after{left:3px;right:auto;background:var(--mut)}
    .r2-row{display:grid;grid-template-columns:1fr auto;column-gap:16px;row-gap:8px;padding:${V.row}px 0;border-top:1px solid var(--line)}
    .r2-tm{grid-column:1;display:flex;align-items:center;gap:12px}.r2-tm img{width:24px;height:24px}.r2-tm b{font:500 17px var(--f)}.r2-tm span{margin-left:auto;font:600 21px var(--f)}
    .r2-tm.lose b,.r2-tm.lose span{color:var(--mut);font-weight:500}
    .r2-st{grid-column:2;grid-row:1/3;align-self:center;font:500 14px var(--f);color:var(--mut);min-width:70px;text-align:right}
    .r2-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--fg);margin-right:6px;vertical-align:middle}
    .icons{display:flex;gap:18px}.icons div{display:flex;flex-direction:column;align-items:center;gap:8px;font:500 13px var(--f);color:var(--mut)}
    .icons svg{width:40px;height:40px;color:var(--fg)}.bal{display:flex;align-items:center;gap:8px;font:600 22px var(--f);margin-top:14px}.bal svg{width:22px;height:22px}
    .gh{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;text-align:center;margin:8px 0 14px}.gh img{width:52px;height:52px}.gh b{display:block;font:600 16px var(--f);margin-top:6px}.gh small{color:var(--mut);font:400 13px var(--f)}
    .gs{font:${V.w} 40px var(--f);letter-spacing:${V.track}}.gstat{font:500 13px var(--f);color:var(--mut);margin-top:4px}
    .plain{font:400 16px/1.5 var(--f);color:var(--fg);padding:14px 16px;background:var(--surf);border-radius:${V.rad}px}
    .tabs{display:flex;gap:6px;margin:16px 0 4px;overflow:hidden}.tabs span{padding:9px 15px;border-radius:999px;font:500 14px var(--f);color:var(--mut)}.tabs .on{background:var(--chip);color:var(--fg)}
    .wpn{display:flex;justify-content:space-between;font:500 14px var(--f);color:var(--mut);margin-bottom:6px}.wpn b{color:var(--fg);font:600 22px var(--f)}
    .wpsvg{width:100%;height:120px;display:block}.wpsvg .l{fill:none;stroke:var(--fg);stroke-width:2;vector-effect:non-scaling-stroke}.wpsvg .m{stroke:var(--line);stroke-dasharray:3 4;vector-effect:non-scaling-stroke}
    .nav{position:fixed;left:16px;right:16px;bottom:18px;display:flex;justify-content:space-around;padding:12px 6px;background:rgba(28,28,32,.88);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:${V.rad + 8}px}
    .nav span{font:500 12px var(--f);color:var(--mut);display:flex;flex-direction:column;align-items:center;gap:5px;min-width:54px}.nav .on{color:var(--fg)}.nav svg{width:22px;height:22px}`;
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const navIcons = { Home: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>', NFL: '<ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-35 12 12)"/><path d="M9.5 14.5l5-5M11 11.5l1.5 1.5"/>', CFB: '<path d="M4 10l8-4 8 4-8 4z"/><path d="M8 12v4c2 1.5 6 1.5 8 0v-4"/>', F1: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>', Profile: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>' };
  const nav = wide ? "" : `<nav class="nav">${Object.entries(navIcons).map(([k, d], i) => `<span class="${i === (view === "game" ? 1 : 0) ? "on" : ""}">${ic(d)}${k}</span>`).join("")}</nav>`;
  const parts = `<div><p class="r2-t">Components</p>
      <p class="r2-h">Buttons</p><div class="r2-btns"><button class="b1">Make a pick</button><button class="b2">Follow</button><button class="b3">See all</button></div>
      <p class="r2-h">Filters</p><div class="seg"><span class="on">All</span><span>My teams</span><span>Live</span><span>Closest</span></div>
      <p class="r2-h">Settings rows</p><div class="sw"><span>Score alerts<small>Only about teams you follow</small></span><i class="tg"></i></div><div class="sw"><span>Beginner Mode<small>Explains terms as you go</small></span><i class="tg off"></i></div>
    </div><div><p class="r2-h">Game rows</p>${rows}
      <p class="r2-h">Currency: Marks (icon options)</p><div class="icons">${markIcons.map(([k, s]) => `<div>${s}${k}</div>`).join("")}</div><div class="bal">${markIcons[1][1]} 1,250 Marks</div></div>`;
  const game = `<div><div class="gh"><div><img src="${aw.team.logo}"><b>${aw.team.abbreviation}</b><small>${aw.records?.[0]?.summary || ""}</small></div>
      <div><div class="gs">${st.state === "pre" ? "–" : aw.score + " – " + hm.score}</div><div class="gstat">${st.state === "in" ? "● " : ""}${st.shortDetail}</div></div>
      <div><img src="${hm.team.logo}"><b>${hm.team.abbreviation}</b><small>${hm.records?.[0]?.summary || ""}</small></div></div>
      <p class="plain">${status}</p>
      <div class="tabs"><span class="on">Summary</span><span>Plays</span><span>Stats</span><span>Players</span></div></div>
    <div><p class="r2-h">Win probability</p>${hp != null ? `<div class="wpn"><span>${aw.team.abbreviation} <b>${Math.round((1 - hp) * 100)}%</b></span><span><b>${Math.round(hp * 100)}%</b> ${hm.team.abbreviation}</span></div>
      <svg class="wpsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="m" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><path class="l" d="${path}"/></svg>` : '<p class="gstat">Not available yet</p>'}
      <p class="r2-h">Other games</p>${rows}</div>`;
  const html = `<style>${css}</style><div id="m2"><div class="r2">${view === "game" ? game : parts}</div>${nav}</div>`;
  document.getElementById("m2-wrap")?.remove();
  const root = document.createElement("div"); root.id = "m2-wrap"; root.innerHTML = html; document.body.appendChild(root);
  await document.fonts.ready; await new Promise((r) => setTimeout(r, 700));
  return { game: pickEv.name, state: st.state, wpPoints: n };
};
