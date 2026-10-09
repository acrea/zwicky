# The zwicky file format (`*.zwicky.md`), version 1

A zwicky file holds one **space**: a problem space and a solution space (grids of *dimensions × parameters*), the **options** composed from the solution space, the **criteria** they are rated against, and the **ratings**. It is plain Markdown, readable in any viewer and diffable in Git, with a small, strict structure that tools (and LLMs) can parse.

This document is the contract. The reference implementation is `src/js/format.js`, and it is kept in sync with this text. You can hand this file to an LLM and ask it to draft or edit a space.

## Principles

- Every file is valid CommonMark.
- Structure is carried **only** by: the front matter, heading levels, list items, blockquote notes (`>`), and one trailing `{…}` tag group. Nothing else has meaning.
- **Tolerant reader, canonical writer.** zwicky accepts small variations when it opens a file and always saves one canonical form. Saving an unchanged canonical file produces the same bytes (apart from `updated`).
- Opening never fails on content. Problems are listed in an **import report** with line numbers. Lines that cannot be placed are kept in a `# Notes` section instead of being dropped.
- Parameters belong to their dimension by position. Options and criteria have **stable ids** (`O1`, `C1`) used for all cross-references.

## Example

```markdown
---
zwicky: 1
title: Car Concept
scale: 1-5
updated: 2026-10-09
---

# Problem
> The problem statement. Consecutive "> " lines form one multi-line note.

## Market
> A dimension note.
- Urban commuters {focus}
  > A parameter note, indented two spaces.
- Luxury segment {out}
- Families

# Solution

## Drivetrain
- Hybrid {O1}
- Electric {O1 O2}
  > A parameter note.
- Diesel

# Options

## O1 Athletic hybrid SUV
> An option note.

## O2 City coupé

# Criteria

## C1 Market size {w=3}
> What "great" looks like.

## C2 Brand fit

# Ratings

## O1 Athletic hybrid SUV
- C1: 4
  > The rationale or assumption behind this score.
- C2: ?
  > A note without a score yet.

## O2 City coupé
- C1: 3
```

## Grammar

### Front matter

The file starts with a front matter block between two `---` lines. It is a strict subset of YAML: one `key: value` per line, no nesting, no quoting. The value is everything after the first `: `, trimmed.

| Key | Meaning |
|---|---|
| `zwicky` | Format version. Required; currently `1`. |
| `title` | Document title. |
| `scale` | Rating scale `<min>-<max>`, non-negative integers, `min < max ≤ 100`. Default `1-5`. |
| `updated` | ISO date (`YYYY-MM-DD`), set by zwicky on Save. |

Other keys are kept, in their original order.

### Sections

Top-level `#` headings, in this order, each optional:

| Section | Holds |
|---|---|
| `# Problem` | Dimensions of the problem space. Its note is the **problem statement**. |
| `# Solution` | Dimensions of the solution space. |
| `# Options` | One `## O<n> Title` heading per option. |
| `# Criteria` | One `## C<n> Title {w=<weight>}` heading per criterion. |
| `# Ratings` | One `## O<n> Title` block per option, with one line per rated criterion. |
| `# Notes` | Free text, kept verbatim. Always last. |

Every section except `# Notes` can carry a note directly under its heading.

### Dimensions and parameters (Problem, Solution)

- A **dimension** is a `##` heading. Its title is a short buzzword.
- A **parameter** is a list item `- Title` under its dimension. Rows can have different numbers of parameters.
- Problem parameters can carry a **mark** tag: `{focus}` or `{out}` (out of scope).
- Solution parameters list the options that **pick** them: `{O1 O3}`. An option picks 0..n parameters per dimension.

### Options and criteria

- Headings start with the id: `## O3 Title`, `## C2 Title`. Ids are positive integers, assigned once (highest + 1) and never renumbered.
- A criterion's **weight** is an integer 0–10, written as `{w=3}`. The default is 1 and is not written. Weight 0 excludes the criterion from the total.

### Ratings

- Under `# Ratings`, each `## O<n> Title` heading opens the ratings of one option. The **id is authoritative**; the title is informational and is rewritten with the current option title on save.
- A rating line is `- C<n>: <score>`, with an integer score on the document's scale, or `- C<n>: ?` for a note without a score yet.
- A missing line means *unrated*, which is not the same as a low score.

### Notes

- A note is one or more consecutive `>` lines directly after the heading or list item it belongs to.
- Notes of list items are indented two spaces: `  > …`.
- A bare `>` line is an empty line inside the note.
- Notes are plain text. Line breaks are kept; Markdown inside notes is not rendered.

### Titles

- Titles are single-line. (Use notes for anything longer.)
- Tags are a single `{…}` group at the **end** of a heading or list-item line, after whitespace, with space-separated tokens.
- A title **never ends in a `{…}` group** (braces preceded by a space, or making up the whole title), because that is exactly what a tag group looks like. zwicky turns the braces of such a trailing group into parentheses: `Budget {in CHF}` becomes `Budget (in CHF)`. Braces anywhere else are fine: `Set {a, b} of tags`, `a{b}`. So the format needs no escaping.

### Tags

| Token | Where | Meaning |
|---|---|---|
| `focus`, `out` | Problem parameters | Mark (one per parameter). |
| `O<n>` | Solution parameters | Picked by option `O<n>`. |
| `w=<int>` | Criterion headings | Weight 0–10. |

Any other token is **kept** (and reported as unknown), so other tools can add their own.

### Reserved: `###`

`###` headings are reserved for **sub-dimensions** in a future version. Version 1 reads a `###` inside a dimension by flattening it into its parent: each of its parameters gets the title prefix `<Sub-dimension title> › `, and its note is appended to the parent dimension's note as `<Sub-dimension title>: <note>`. This is lossy by design and reported as a warning. zwicky v1 never writes `###`.

```markdown
## Slide-Typen
* Ohne Einschränkung
### Mit Einschränkung
> Nur Slides mit vorgängig definiertem Template.
* Strukturelle Slides
* Offerten-Slides
```

is read as

```markdown
## Slide-Typen
> Mit Einschränkung: Nur Slides mit vorgängig definiertem Template.
- Ohne Einschränkung
- Mit Einschränkung › Strukturelle Slides
- Mit Einschränkung › Offerten-Slides
```

## Canonical form

This is exactly what zwicky writes:

- UTF-8 without BOM, LF line endings, exactly one trailing newline, no trailing spaces.
- Front matter keys in the order `zwicky`, `title`, `scale`, `updated`, then other keys in their original order. `scale` is always written; `title` and `updated` only when set.
- A blank line after the closing `---`, and exactly one blank line before every `#` and `##` heading. No other blank lines: notes follow their heading or item directly, and the list items of a dimension or rating block are contiguous.
- Notes use `> ` (one space) and `>` for empty lines; list-item notes use `  > `. Leading and trailing empty note lines are dropped.
- List bullets are `- `.
- Tag tokens: the mark first, then option ids sorted numerically, then unknown tokens in their original order. `{w=1}` is omitted.
- Sections in the order Problem, Solution, Options, Criteria, Ratings, Notes. Empty sections are omitted.
- In `# Ratings`, options follow the Options order and rating lines follow the Criteria order. Options without any rating or rating note are omitted.
- `# Notes` is written verbatim (trailing spaces and leading/trailing blank lines removed).

## What the reader tolerates

Each of these opens fine. Items marked † add a line to the import report.

- A byte-order mark, CRLF or CR line endings, trailing spaces.
- Extra or missing blank lines anywhere.
- `*` and `+` bullets; list items and `>` notes at any indentation.
- Missing sections, sections in any order, lower-case section names (`# solution`).
- No front matter (read as version 1) †; front matter without `zwicky` †; an invalid `scale` (falls back to `1-5`) †; duplicate keys (the last wins) †.
- `## O1: Title` or `## O1. Title` as well as `## O1 Title`.
- Option or criterion headings without an id: they get the next free id †.
- Duplicate option or criterion ids: later duplicates get new ids †.
- Picks or ratings referring to unknown options or criteria: dropped †.
- Scores outside the scale: clamped †. Weights outside 0–10: clamped †. Scores that are not whole numbers: left unscored †.
- Unknown tag tokens: kept †.
- A title that still ends in `{…}` after the tag group is removed, e.g. `- Budget {in CHF} {O2}`: the title's braces become parentheses †.
- A parameter with both `focus` and `out`: the first wins †.
- `###` sub-dimensions: flattened †.
- A section repeated: merged †.
- Unknown `#` sections and lines that fit nowhere (paragraph text, list items outside a dimension, notes with nothing to belong to): moved to `# Notes` †.
- `- C1:` with nothing after the colon: same as `?`.

## Versions

`zwicky: 1` in the front matter is the format version. A file with a higher version than the app supports is refused with a clear message instead of being misread. Older versions are upgraded step by step on open (the `MIGRATIONS` list in `format.js`).

## Scoring (for reference)

The weighted score of an option is Σ weight × score ÷ Σ weight, over the criteria that are rated for that option and have weight > 0, shown with one decimal. Unrated criteria do not count as zero; they are counted separately. Options are ranked by the displayed score; equal scores share a rank (1, 1, 3).
