// Style prototypu stanów kafelka (tylko ta strona). --z = powiększenie kanwy: grubość ramki i znaczek dzielimy przez nie, żeby na ekranie były stałe.
export const PROTO_CSS = `
.proto { --c-or: #F97316; --c-bl: #2563EB; --c-vi: #9333EA; --c-rd: #DC2626; --c-gr: #9CA3AF; max-width: 1480px; margin: 0 auto; padding: 24px 20px 64px; }
.proto h1 { font-size: 20px; margin: 0 0 6px; } .proto h2 { font-size: 16px; margin: 0 0 4px; } .proto h3 { font: 600 12px/1 var(--font); color: var(--sub); margin: 20px 0 10px; text-transform: none; }
.pt-head p, .pt-note { color: var(--sub); margin: 0 0 12px; max-width: 760px; }
.pt-head nav { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.pt-sec { margin-top: 28px; padding: 20px; border-radius: var(--r-lg); background: var(--glass); box-shadow: 0 0 0 1px var(--line); }
.pt-zone { overflow: hidden; padding: 4px 0; }
.pt-row { display: flex; flex-wrap: wrap; gap: 24px; padding: 14px; }
.pt-row .node { position: relative; cursor: default; flex: none; }

.node.pt { --bw: 3px; --sc: var(--sub); background: color-mix(in srgb, var(--sc) 8%, var(--surface));
  box-shadow: 0 2px 10px var(--shadow), 0 0 0 calc(var(--bw) / var(--z, 1)) var(--sc); }
.node.pt.s-live { --sc: var(--c-or); }
.node.pt.s-mine { --sc: var(--c-bl); }
.node.pt.s-help { --sc: var(--c-rd); }
.node.pt.s-plan-ag { --sc: var(--c-vi); }
.node.pt.s-plan-me { --sc: var(--c-bl); }
.node.pt.s-plan-ag, .node.pt.s-plan-me { --bw: 2px; background: color-mix(in srgb, var(--sc) 5%, var(--surface)); box-shadow: 0 2px 10px var(--shadow);
  outline: calc(var(--bw) / var(--z, 1)) dashed var(--sc); outline-offset: 0; }
.node.pt.s-done { --sc: var(--c-gr); background: var(--surface); box-shadow: 0 2px 10px var(--shadow); opacity: .6; }
.node.pt.s-done .n-title { color: var(--sub); }

/* praca agenta (Mac albo chmura): światełko biegnie po obwódce */
.node.pt.s-live::after { content: ""; position: absolute; inset: calc(-1 * var(--bw) / var(--z, 1)); border-radius: calc(var(--r-md) + var(--bw) / var(--z, 1));
  padding: calc(var(--bw) / var(--z, 1)); pointer-events: none;
  background: conic-gradient(from var(--a), transparent 0 65%, color-mix(in srgb, var(--sc) 25%, white) 88%, var(--sc) 100%);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; animation: run-light 1.4s linear infinite; }
/* spinner przy etykiecie, w pasku (B) i w znaczku (C) */
.pt-spin { animation: pt-rot .9s linear infinite; flex: none; }
@keyframes pt-rot { to { transform: rotate(360deg); } }
.node.pt .pt-st { display: inline-flex; align-items: center; gap: 4px; }
@media (prefers-reduced-motion: reduce) { .node.pt::after, .pt-spin { animation: none !important; } }

/* etykieta stanu: kolor stanu, tekst przyciemniony do kontrastu */
.node.pt .pt-st { background: color-mix(in srgb, var(--sc) 16%, transparent); color: color-mix(in srgb, var(--sc) 62%, var(--text)); box-shadow: none; }
.node.pt.s-plan-ag .pt-st, .node.pt.s-plan-me .pt-st { background: transparent; box-shadow: inset 0 0 0 1px var(--sc); }
.node.pt.s-done .pt-st { background: color-mix(in srgb, var(--sc) 18%, transparent); color: var(--sub); }

/* B: pasek u góry; przy oddaleniu sam pasek z ikoną, większy */
.node.pt.v-b { padding-top: calc(16px + 26px); height: calc(116px + 26px); }
.node.task.pt.v-b { height: calc(172px + 26px); }
.pt-bar { position: absolute; left: 0; right: 0; top: 0; height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 16px;
  border-radius: var(--r-md) var(--r-md) 0 0; background: color-mix(in srgb, var(--sc) 82%, #000); color: #fff; font-size: 11.5px; font-weight: 650; }
.node.pt.s-done .pt-bar { background: color-mix(in srgb, var(--sc) 30%, var(--surface)); color: var(--sub); }
.node.pt.s-plan-ag .pt-bar, .node.pt.s-plan-me .pt-bar { background: color-mix(in srgb, var(--sc) 10%, transparent); color: color-mix(in srgb, var(--sc) 62%, var(--text)); border-bottom: calc(1px / var(--z, 1)) dashed var(--sc); }
.pt-zone.far .node.pt.v-b { padding-top: calc(16px + 64px); height: calc(116px + 64px); }
.pt-zone.far .node.task.pt.v-b { height: calc(172px + 64px); }
.pt-zone.far .pt-bar { height: 64px; gap: 10px; padding: 0 12px; font-size: 22px; white-space: nowrap; overflow: hidden; }
.pt-zone.far .pt-bar svg { width: 38px; height: 38px; }

/* C: znaczek w rogu; przy oddaleniu rośnie odwrotnie do powiększenia */
.pt-badge { position: absolute; right: calc(-8px / var(--z, 1)); top: calc(-8px / var(--z, 1)); width: calc(24px / var(--z, 1)); height: calc(24px / var(--z, 1));
  border-radius: 999px; display: grid; place-items: center; background: color-mix(in srgb, var(--sc) 82%, #000); color: #fff; z-index: 2;
  box-shadow: 0 0 0 calc(2px / var(--z, 1)) var(--surface); }
.pt-badge svg { width: calc(14px / var(--z, 1)); height: calc(14px / var(--z, 1)); }
.node.pt.s-plan-ag .pt-badge, .node.pt.s-plan-me .pt-badge { background: var(--surface); color: var(--sc); box-shadow: 0 0 0 calc(2px / var(--z, 1)) var(--sc); }
.node.pt.s-done .pt-badge { background: var(--c-gr); }
.node.pt.v-c .n-top .pt-st { margin-right: 10px; }

.pt-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin: 8px 0 12px; }
.pt-lg { display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; align-items: center; }
.pt-lg i { width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 3px var(--sc); background: color-mix(in srgb, var(--sc) 8%, transparent); }
.pt-lg.s-live { --sc: var(--c-or); } .pt-lg.s-mine { --sc: var(--c-bl); } .pt-lg.s-help { --sc: var(--c-rd); }
.pt-lg.s-plan-ag { --sc: var(--c-vi); } .pt-lg.s-plan-me { --sc: var(--c-bl); } .pt-lg.s-done { --sc: var(--c-gr); }
.pt-lg.s-plan-ag i, .pt-lg.s-plan-me i { box-shadow: none; outline: 2px dashed var(--sc); outline-offset: -2px; }
.pt-lg.s-done i { box-shadow: none; background: color-mix(in srgb, var(--sc) 40%, transparent); }
.pt-lg span { grid-column: 2; color: var(--sub); font-size: 12px; }
@media (max-width: 640px) { .proto { padding: 16px 16px 48px; } .pt-sec { padding: 12px; } }
`;
