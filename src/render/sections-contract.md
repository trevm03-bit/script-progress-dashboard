# Contract for section renderers (for anyone adding one)

A section renderer is a pure TypeScript module in `src/render/` that:

- imports NO `vscode` API (it must run under `node --test` against `out/`);
- exports one function returning an HTML string, built with the helpers in `./html.ts`:
  `section(id, title, body, opts)` for the card, `esc()` for every user-provided string,
  `icon(name)` for codicons, `empty(text, action?)` for empty states, `chip()` / `metricText()`;
- takes `(data: DashboardData, settings: Settings, now: Date, opts: SectionOpts, ...)` and pins
  every date computation on the `now` argument;
- puts any logic that is not markup into `src/logic/<name>.ts` (also pure) so it can be tested
  without HTML parsing;
- uses only theme CSS variables in any inline style, never literal colours; classes live in
  `media/dashboard.css` (look for the `/* ---- <section> ---- */` blocks);
- is wired in `src/render/dashboard.ts` under its `SectionId` (see `src/types.ts`), and has its
  boolean switch in `package.json` → `scriptProgress.sections.<id>` plus any settings under a
  `scriptProgress.<id>.*` group (never nested under the boolean — a key cannot be both a value
  and a parent);
- gets a unit test in `test/render.test.js` (markup) and `test/logic.test.js` (numbers) using the
  fixtures in `test/fixtures/`.

Interactive behaviour (sorting, filtering, expand) is delegated from `media/dashboard.js` on
`document`, keyed on `data-*` attributes, so re-rendered sections keep working. Sections are
patched per `data-section` element; anything that must survive a re-render (a canvas, an input's
text) is carried across explicitly in `applySections()`.
