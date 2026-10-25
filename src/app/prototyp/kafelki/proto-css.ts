// Style prototypu stanów kafelka (tylko ta strona). --z = powiększenie kanwy: grubość ramki i znaczek dzielimy przez nie, żeby na ekranie były stałe.
export const PROTO_CSS = `
.proto { --cl: #8B5CF6; --ap: var(--t-mail); max-width: 1480px; margin: 0 auto; padding: 24px 20px 64px; }
@media (prefers-color-scheme: dark) { .proto { --cl: #A78BFA; } }
.proto h1 { font-size: 20px; margin: 0 0 6px; } .proto h2 { font-size: 16px; margin: 0 0 4px; } .proto h3 { font: 600 12px/1 var(--font); color: var(--sub); margin: 20px 0 10px; text-transform: none; }
.pt-head p, .pt-note { color: var(--sub); margin: 0 0 12px; max-width: 760px; }
.pt-head nav { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.pt-sec { margin-top: 28px; padding: 20px; border-radius: var(--r-lg); background: var(--glass); box-shadow: 0 0 0 1px var(--line); }
.pt-zone { overflow: hidden; padding: 4px 0; }
.pt-row { display: flex; flex-wrap: wrap; gap: 24px; padding: 14px; }
.pt-row .node { position: relative; cursor: default; flex: none; }

.node.pt { --bw: 3px; --sc: var(--sub); background: color-mix(in srgb, var(--sc) 8%, var(--surface));
  box-shadow: 0 2px 10px var(--shadow), 0 0 0 calc(var(--bw) / var(--z, 1)) var(--sc); }
.node.pt.s-live { --sc: var(--t-claude); }
.node.pt.s-cloud { --sc: var(--cl); }
.node.pt.s-queue { --sc: var(--sub); --bw: 2px; box-shadow: 0 2px 10px var(--shadow); outline: calc(var(--bw) / var(--z, 1)) dashed var(--sc); outline-offset: 0; }
.node.pt.s-approve { --sc: var(--ap); }
.node.pt.s-mine { --sc: var(--ok); }
.node.pt.s-help { --sc: var(--danger); }
.node.pt.s-todo { --sc: var(--sub); --bw: 1px; background: var(--surface); box-shadow: 0 2px 10px var(--shadow), 0 0 0 calc(var(--bw) / var(--z, 1)) var(--line); }
.node.pt.s-done { background: var(--surface); box-shadow: 0 2px 10px var(--shadow); opacity: .6; }
.node.pt.s-done .n-title { color: var(--sub); }

/* praca agenta: światełko po obwódce, w chmurze wolniej */
.node.pt.s-live::after, .node.pt.s-cloud::after { content: ""; position: absolute; inset: calc(-1 * var(--bw) / var(--z, 1)); border-radius: calc(var(--r-md) + var(--bw) / var(--z, 1));
  padding: calc(var(--bw) / var(--z, 1)); pointer-events: none;
  background: conic-gradient(from var(--a), transparent 0 65%, color-mix(in srgb, var(--sc) 25%, white) 88%, var(--sc) 100%);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; animation: run-light 1.4s linear infinite; }
.node.pt.s-cloud::after { animation-duration: 3.2s; }
@media (prefers-reduced-motion: reduce) { .node.pt::after { animation: none !important; } }

/* etykieta stanu: kolor stanu, tekst przyciemniony do kontrastu */
.node.pt .pt-st { background: color-mix(in srgb, var(--sc) 16%, transparent); color: color-mix(in srgb, var(--sc) 62%, var(--text)); box-shadow: none; }
.node.pt.s-todo .pt-st { background: transparent; color: var(--sub); box-shadow: inset 0 0 0 1px var(--line); }
.node.pt.s-done .pt-st { background: var(--ok-soft); color: var(--ok); }
.node.pt.s-queue .pt-st { background: transparent; box-shadow: inset 0 0 0 1px var(--sc); color: var(--text); }

/* B: pasek u góry; przy oddaleniu sam pasek z ikoną, większy */
.node.pt.v-b { padding-top: calc(16px + 26px); height: calc(116px + 26px); }
.node.task.pt.v-b { height: calc(172px + 26px); }
.pt-bar { position: absolute; left: 0; right: 0; top: 0; height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 16px;
  border-radius: var(--r-md) var(--r-md) 0 0; background: color-mix(in srgb, var(--sc) 82%, #000); color: #fff; font-size: 11.5px; font-weight: 650; }
.node.pt.s-todo .pt-bar { background: var(--surface-2); color: var(--sub); }
.node.pt.s-done .pt-bar { background: var(--ok-soft); color: var(--ok); }
.node.pt.s-queue .pt-bar { background: transparent; color: var(--text); border-bottom: calc(1px / var(--z, 1)) dashed var(--sc); }
.pt-zone.far .node.pt.v-b { padding-top: calc(16px + 64px); height: calc(116px + 64px); }
.pt-zone.far .node.task.pt.v-b { height: calc(172px + 64px); }
.pt-zone.far .pt-bar { height: 64px; gap: 10px; padding: 0 12px; font-size: 22px; white-space: nowrap; overflow: hidden; }
.pt-zone.far .pt-bar svg { width: 38px; height: 38px; }

/* C: znaczek w rogu; przy oddaleniu rośnie odwrotnie do powiększenia */
.pt-badge { position: absolute; right: calc(-8px / var(--z, 1)); top: calc(-8px / var(--z, 1)); width: calc(24px / var(--z, 1)); height: calc(24px / var(--z, 1));
  border-radius: 999px; display: grid; place-items: center; background: color-mix(in srgb, var(--sc) 82%, #000); color: #fff; z-index: 2;
  box-shadow: 0 0 0 calc(2px / var(--z, 1)) var(--surface); }
.pt-badge svg { width: calc(14px / var(--z, 1)); height: calc(14px / var(--z, 1)); }
.node.pt.s-todo .pt-badge { background: var(--surface-2); color: var(--sub); }
.node.pt.s-done .pt-badge { background: var(--ok); }
.node.pt.v-c .n-top .pt-st { margin-right: 10px; }

.pt-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin: 8px 0 12px; }
.pt-lg { display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; align-items: center; }
.pt-lg i { width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 3px var(--sc); background: color-mix(in srgb, var(--sc) 8%, transparent); }
.pt-lg.s-live { --sc: var(--t-claude); } .pt-lg.s-cloud { --sc: var(--cl); } .pt-lg.s-queue { --sc: var(--sub); } .pt-lg.s-approve { --sc: var(--ap); }
.pt-lg.s-mine { --sc: var(--ok); } .pt-lg.s-help { --sc: var(--danger); } .pt-lg.s-todo { --sc: var(--line); } .pt-lg.s-done { --sc: transparent; }
.pt-lg.s-queue i { box-shadow: none; outline: 2px dashed var(--sc); outline-offset: -2px; }
.pt-lg span { grid-column: 2; color: var(--sub); font-size: 12px; }
@media (max-width: 640px) { .proto { padding: 16px 16px 48px; } .pt-sec { padding: 12px; } }
`;
