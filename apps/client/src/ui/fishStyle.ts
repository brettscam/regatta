// The fishing panels' own styles, added to the page once when anything of fishing is first drawn.
// They are here and not in `style.css` so that fishing brings everything it needs with it.
const CSS = `
.fishline[hidden], .fishcatch[hidden] { display: none; }
/* Above the chart in the corner: clear of the hails on the left and the crew's words along the bottom. */
.fishline { z-index: 6; right: var(--edge-right); bottom: calc(var(--edge-bottom) + 208px); width: min(380px, calc(100% - 32px)); padding: 10px 13px 11px; display: grid; gap: 5px; font-size: 12.5px; line-height: 1.4; pointer-events: none; }
.fishline h4 { margin: 0; font-size: 10.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); display: flex; justify-content: space-between; gap: 10px; }
.fishline h4 i { font-style: normal; color: var(--amber); letter-spacing: 0.06em; }
.fishline p { margin: 0; color: rgba(238, 243, 244, 0.88); }
.fishline p.dim { color: var(--dim); font-size: 12px; }
.fishline .call { color: var(--amber); font-weight: 600; min-height: 1.4em; }
.fishline .bar { display: grid; grid-template-columns: 52px minmax(0, 1fr) 58px; gap: 8px; align-items: center; font-variant-numeric: tabular-nums; }
.fishline .bar span { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); }
.fishline .bar b { text-align: right; font-weight: 600; }
.fishline .track { position: relative; height: 9px; border-radius: 5px; background: rgba(238, 243, 244, 0.1); overflow: hidden; }
.fishline .track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; background: #8fd8ff; }
.fishline .track.strain { background: linear-gradient(90deg, rgba(255, 138, 110, 0.35) 0 9%, rgba(238, 243, 244, 0.1) 9% 54%, rgba(255, 196, 107, 0.28) 54% 77%, rgba(255, 138, 110, 0.5) 77% 100%); }
.fishline .track.strain i { background: none; border-right: 3px solid var(--ink); border-radius: 0; }
.fishline .fishstate { font-size: 15px; font-weight: 600; }
.fishline .where { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 8px; align-items: center; }
.fishline .where span { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); }
.fishline .arc { position: relative; height: 9px; border-radius: 5px; background: linear-gradient(90deg, rgba(255, 138, 110, 0.5) 0 18%, rgba(238, 243, 244, 0.1) 18% 82%, rgba(255, 138, 110, 0.5) 82% 100%); }
.fishline .arc i { position: absolute; top: -2px; width: 5px; height: 13px; margin-left: -2px; border-radius: 2px; background: var(--ink); }
.fishcatch { left: 50%; top: calc(var(--edge-top, 16px) + 92px); transform: translateX(-50%); padding: 12px 18px 13px; text-align: center; display: grid; gap: 3px; max-width: min(520px, calc(100% - 32px)); border-color: var(--amber); pointer-events: none; z-index: 3; }
.fishcatch small { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--amber); }
.fishcatch b { font-size: 19px; font-weight: 600; }
.fishcatch b em { font-style: normal; color: var(--amber); }
.fishcatch span { font-size: 12.5px; color: rgba(238, 243, 244, 0.86); }
.fishcatch i { font-style: normal; font-size: 12px; color: var(--dim); }
@media (max-width: 760px) { .fishline { bottom: calc(var(--edge-bottom) + 160px); } }
body.lobby .fishline, body.lobby .fishcatch, body.lobby .fishcard { display: none; }
.fleetpanel.fishcard { width: min(460px, calc(100% - 32px)); }
.fishcard .biting { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.fishcard .biting li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 64px; gap: 8px; align-items: center; padding: 6px 10px; font-size: 13px; background: rgba(238, 243, 244, 0.04); border-radius: 8px; }
.fishcard .biting span { color: var(--dim); font-size: 11.5px; }
.fishcard .biting i { height: 7px; border-radius: 4px; background: linear-gradient(90deg, var(--amber) calc(var(--k) * 100%), rgba(238, 243, 244, 0.1) 0); }
.fishcard .invite { display: flex; gap: 8px; }
.fishcard .invite input { flex: 1; min-width: 0; font: inherit; font-size: 12px; color: var(--ink); background: rgba(238, 243, 244, 0.06); border: 1px solid var(--edge); border-radius: 8px; padding: 6px 8px; }
.fishcard .go-bar { display: flex; justify-content: flex-end; }
.fishcard .note { color: var(--amber); }
.chart-side .layers button { font: inherit; font-size: 12.5px; color: var(--ink); background: rgba(238, 243, 244, 0.06); border: 1px solid var(--edge); border-radius: 8px; padding: 6px 10px; cursor: pointer; justify-self: start; }
.chart-side .layers button[aria-pressed="true"] { border-color: var(--amber); background: rgba(255, 196, 107, 0.12); }
.board .catchcard .barhop li span { font-variant-numeric: tabular-nums; }
`;

if (typeof document !== 'undefined' && !document.getElementById('fish-style')) {
  const style = document.createElement('style');
  style.id = 'fish-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export {};
