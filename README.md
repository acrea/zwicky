# zwicky.

A browser-only tool to span a problem space, span a solution space, compose solution options from it, and rate those options against criteria. Named after Fritz Zwicky, the Swiss astrophysicist who formalised morphological analysis (the "Zwicky box").

**Status:** 1.0.0 (see [`VERSION`](VERSION)).

## Use it

**Live: <https://acrea.github.io/zwicky/>** (the latest release).

Or open [`dist/zwicky.html`](dist/zwicky.html) in a current browser. That one file (about 520 KB, fonts included) is the whole app. It works when opened from disk (`file://`), on GitHub Pages or on any web server, and it makes no network requests.

1. **Problem.** Write the problem statement, then lay out the problem space as dimensions (rows) × parameters (cells). Scope it in up to three stages (Horizon 1–3 by default, renamable): `1`–`3` or `F` give a parameter its stage, `X` marks it out of scope. The legend above the grid explains the tints, and *Scope up to* greys out what lies beyond a stage.
2. **Solution.** Lay out the solution space the same way. Add options, click an option's chip, then click the parameters it picks: 0, 1 or several per dimension. The active option is drawn as a path through the box; *Compare* draws all options at once, and *Line styles* adds dash patterns for greyscale printing. In the option's inspector, set the stage of the problem it addresses.
3. **Evaluation.** Compare the options' profiles side by side, add criteria with weights (0–10), and rate every option against every criterion. Every rating can carry a note with the rationale or assumption. zwicky computes the weighted score and the rank.

Every item (dimension, parameter, option, criterion, rating) can hold a plain-text note. Select something to edit it in the inspector on the right (`I` shows or hides it). Press `?` for help, the keyboard shortcuts and the examples.

**Print / PDF** prints every tab on its own landscape page, with notes as numbered footnotes, ready to drop into a slide deck.

### Keyboard

| Keys | Action |
|---|---|
| Arrows, Tab | Move the selection |
| Enter, F2, double-click | Edit a title (Enter on a rating writes its note) |
| Esc | Cancel editing, leave pick mode |
| Delete | Delete the selected item (asks first if it has a note or picks) |
| Alt + ↑ ↓ / ← → | Move a dimension or criterion / a parameter |
| M | Move the selected dimension between the problem and the solution space |
| 1 – 3, 0 | Problem: set the stage of a parameter, clear it |
| F, X | Problem: cycle the stage / mark out of scope |
| 1 – 9 | Solution: toggle the pick of O1 – O9. Evaluation: set a score or weight |
| Space | Pick mode: toggle the pick of the active option |
| + / − | Evaluation: raise or lower a score or weight |
| Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z | Undo, redo |
| Ctrl/⌘ + S, Ctrl/⌘ + O | Save, open |

## Where your data lives

Everything stays in your browser. zwicky keeps the open space in the browser's local storage, so a reload does not lose it, but **that cache is a convenience, not a backup**: clearing site data, a private window or another browser loses it. Save your space as a `.zwicky.md` file. In Chrome and Edge, Save writes back to the file you opened; in other browsers it downloads the file.

## The file format

Spaces are stored as constrained Markdown, `*.zwicky.md`, that reads well in any editor and diffs cleanly in Git:

```markdown
---
zwicky: 1
title: Car Concept (demo)
scale: 1-5
---

# Problem
> Which new car concept should we bring to market next?

## Market
- Urban commuters {focus}
- Luxury segment {out}

# Solution

## Drivetrain
- Hybrid {O1}
- Electric {O2}

# Options

## O1 Athletic hybrid SUV

## O2 City coupé

# Criteria

## C1 Market size {w=3}

# Ratings

## O1 Athletic hybrid SUV
- C1: 4
  > Assumes LOHAS and WOOPIEs overlap little.
```

[docs/FORMAT.md](docs/FORMAT.md) is the full specification; Help in the app can copy it. Hand it to an LLM to draft or edit a space, then paste the result into *File → Import from text*. zwicky reads small variations and reports what it changed; it always saves one canonical form. [examples/](examples/) has sample files.

## Development

Requires Node 20 or later. No npm packages.

```sh
node build.mjs       # writes dist/zwicky.html (commit it: it is the product)
node --test          # unit tests: format, model, scoring
node tests/e2e.mjs   # optional browser checks; needs Playwright (npm i -g playwright)
```

| Path | What |
|---|---|
| `src/js/format.js` | `parse(markdown) → { space, report }`, `serialize(space) → markdown` |
| `src/js/model.js` | Data model, ids, invariants, scoring and ranking |
| `src/js/history.js`, `src/js/store.js` | Undo/redo snapshots; autosave, open/save, clipboard |
| `src/js/ui/` | The interface: `app.js` (shell), `grid.js`, `paths.js`, `options-bar.js`, `evaluation.js`, `inspector.js`, `print.js` |
| `src/css/base.css`, `src/css/print.css` | Layout and components, using theme tokens only |
| `src/themes/dm.css` | The theme: every colour, font and spacing value as a CSS token. Change the look here. |
| `src/fonts/` | WOFF2 subsets (Latin, Latin Extended) of Playfair Display, Lora and Source Code Pro from Fontsource, with their licences |
| `build.mjs` | Bundles the modules, inlines CSS, fonts, examples and the format spec, computes the CSP hash |
| `VERSION` | The app version, shown in Help and checked against release tags |
| `examples/` | Two canonical examples, plus `messy-input.md` and its expected canonical output |

`format.js` and `model.js` have no DOM dependencies, so they run in Node. The built page carries a strict Content-Security-Policy (no network access, only its one hashed inline script), and user text is only ever rendered as text.

## Releasing

The app is published to GitHub Pages **only for full releases**: pushes to `main` and pre-releases never change the live site.

1. Set the version in [`VERSION`](VERSION) (e.g. `1.1.0`, or `1.1.0-rc.1` for a release candidate), run `node build.mjs`, and merge that through a pull request.
2. On GitHub, *Releases → Draft a new release*, create the tag `v` + that version on `main`, and publish it:
   - **Release candidate** (`v1.1.0-rc.1`): tick *Set as a pre-release*. Nothing is deployed; download `dist/zwicky.html` from the tag to test it.
   - **Release** (`v1.1.0`): the [Pages workflow](.github/workflows/pages.yml) checks that the tag matches `VERSION`, runs the tests, verifies the committed build and deploys it.
3. To roll back, run the Pages workflow manually (*Actions → Pages → Run workflow*) with an older tag.

One-time setup, by a repository admin:

- *Settings → Pages → Build and deployment → Source*: **GitHub Actions**.
- *Settings → Environments → github-pages → Deployment branches and tags*: add a tag rule **`v*`**. By default only `main` may deploy, which would reject release tags.

[CI](.github/workflows/ci.yml) runs the unit tests, the build check and the browser checks on every pull request and push to `main`.

## Licence

TODO(question): licence not decided yet. The bundled fonts are under the SIL Open Font License 1.1 (see `src/fonts/*-OFL.txt`).
