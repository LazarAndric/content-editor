# Changelog

## 0.4.0 — 2026-10-27

- Added optional same-origin editor tabs and host request handlers. Application
  settings, assets and file ownership remain in the host project.
- Added an opt-out for shared-text creation while preserving translation editing
  and backwards-compatible defaults for existing consumers.
- Prepared a standalone Content Editor distribution with no application imports,
  application branding, machine-specific setup paths or internal integration notes.
- Spreadsheet exports use neutral author/context labels and configured language
  names (with established English/Chinese column labels retained). Stable v1
  rich-text and workbook identifiers preserve data compatibility.
- Initializer reads the package name from metadata; the content-editor executable
  is available alongside the existing content-kit command.
- Replaced the GPL-mode rich-text editor with MIT-licensed SunEditor while
  retaining existing HTML storage, sanitization, table and formatting support.
- Licensed package sources under MIT and included browser dependency notices
  in static site exports.
- Included a CI configuration template and compatibility checks; registry publication awaits the npm scope
  selection.

## 0.3.0 — 2026-10-23

- Shared texts can be created, translated and described through the editor.
  Optional project field declarations appear before values exist; an explicit
  revision-protected plan registers missing records without overwriting values.
- Added plain/rich/named-message HTML bindings, safe attribute bindings and
  runtime diagnostics. Missing visitor-facing text has an explicit fallback
  policy independent of the backward-compatible core missing-key message.
- Added a language control sharing navigation state, optional persisted choices,
  lang/dir updates and fallback when a language is removed.
- Added arbitrary tree/group/item wrapper hooks and a standalone navigation DOM
  behavior adapter. Combined and separate select/toggle actions are supported.
- Block renderer preserves unchanged media DOM through expansion and unrelated
  live edits; added styling/wrapper hooks and contextual localized messages.
- Added localized image descriptions, decorative flags, semantic block roles,
  configured icon/content-type selectors and an explicit card projection helper.
- Full XLSX preserves all optional metadata while remaining compatible with
  prior schemas. Required field/message/accessibility errors block static export.
- Added read-only doctor, offline field-plan CLI, configured export destinations,
  restart notices and complete integration recipes for three adoption paths.

## 0.2.0 — 2026-10-23

- Added the content-kit CLI: non-destructive vanilla init, one-process dev,
  and an explicit static site export that refuses existing destinations.
- startContentServer optionally serves a dedicated siteDirectory on the same
  port as the editor. Existing editor-only callers retain their root page.
- Added supported dependency-complete browser ESM routes without import maps,
  client loading/live/static modes, and optional headless navigation state.
- Added vanilla tree/block adapters with custom markup, focus preservation,
  keyboard controls, empty states, safe rich text and missing-media feedback.
- Preserved existing model, localization, React and XLSX entry points and schema.
- Deferred server XLSX imports until an XLSX endpoint is requested.
- Added end-to-end vanilla template and standalone automated integration tests.

Existing applications must reinstall the package to receive this version.
No site, content file, existing host navigation or installed consumer is
automatically migrated or started.
