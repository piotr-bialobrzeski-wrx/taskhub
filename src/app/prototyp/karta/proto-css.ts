// Style prototypu karty zrobionego kroku (tylko ta strona). Panel jak prawdziwy panel kroku, ale w przepływie strony, nie przyklejony do kanwy.
export const PROTO_CSS = `
.proto { max-width: 1480px; margin: 0 auto; padding: 24px 20px 64px; }
.proto h1 { font-size: 20px; margin: 0 0 6px; } .proto h2 { font-size: 16px; margin: 0 0 4px; }
.pc-head p, .pc-note { color: var(--sub); margin: 0 0 12px; max-width: 760px; }
.pc-head nav { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.pc-sec { margin-top: 28px; padding: 20px; border-radius: var(--r-lg); background: var(--glass); box-shadow: 0 0 0 1px var(--line); }
.pc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 20px; align-items: start; }
.pc-panel { position: static; width: auto; max-width: none; border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; container-type: inline-size; background: var(--surface); box-shadow: 0 6px 24px var(--shadow), 0 0 0 1px var(--line); }
.pc-panel .d-body { overflow: visible; }
.pc-panel .d-bar .ttl { flex: 1; min-width: 0; font-size: 15px; line-height: 1.3; font-weight: 650; letter-spacing: -0.01em; }

/* znaczek „Zrobione, kto, godzina” przy nagłówku zlecenia */
.pc-tick { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--ok); color: #fff; flex: none; }
.pc-done { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11.5px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--ok); white-space: nowrap; }
.pc-order > .lbl { display: flex; align-items: center; gap: var(--s-2); }
/* klocek zlecenia: ptaszek w rogu (A, C), w B do tego zielona ramka */
.pc-b { position: relative; }
.pc-b > .pc-tick { position: absolute; top: 10px; right: 10px; z-index: 1; }
.pc-b .block, .pc-b .note { padding-right: 36px; }
.pc-b .block.q { padding-right: 36px; }
.v-b .pc-b { border-radius: var(--r-sm); box-shadow: 0 0 0 1.5px var(--ok); background: color-mix(in srgb, var(--ok) 5%, transparent); }
.v-b .pc-b .note { box-shadow: none; }
/* pytanie z kartki: wybrana opcja wyróżniona, pozostałe przygaszone */
.pc-panel .block.q .chip:not(.on) { opacity: .45; }
.pc-panel .block.q .chip.on { background: var(--ok-soft); color: var(--ok); box-shadow: inset 0 0 0 1.5px var(--ok); font-weight: 600; }

/* C: dwie zakładki bez skryptu (radio + CSS), domyślnie „Wynik” */
.pc-tabs { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--surface-2); align-self: flex-start; }
.pc-tabs label { padding: 6px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--sub); cursor: pointer; min-height: 32px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.pc-c input { position: absolute; opacity: 0; pointer-events: none; }
.pc-c .pc-pane { display: none; }
.pc-c input.t-res:checked ~ .pc-pane.res, .pc-c input.t-ord:checked ~ .pc-pane.ord { display: flex; }
.pc-c input.t-res:checked ~ .pc-tabs label.res, .pc-c input.t-ord:checked ~ .pc-tabs label.ord { background: var(--surface); color: var(--text); box-shadow: 0 1px 4px var(--shadow); }
.pc-c { display: flex; flex-direction: column; gap: 14px; }
.pc-pane { flex-direction: column; gap: 14px; }
`;
