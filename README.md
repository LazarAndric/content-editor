# Content Editor

Reusable local content toolkit, version 0.4.0. It includes hierarchy validation,
localization, media references, rich text, a local editor, JSON persistence and
readable XLSX import/export. The framework-independent entry point has no React,
Electron, Vite or application-screen dependencies. React and live notifications
are optional integrations. No build step is needed to consume these sources.

Project-specific editor screens and settings APIs belong to the consuming
application. `definition.editorTabs` adds same-origin embedded screens;
`startContentServer({handleRequest})` supplies guarded host routes without
adding application code to this package. Set `allowSharedTextCreation: false`
in the host definition to keep shared-text editing while hiding creation and
field-registration controls. The default remains enabled for other consumers.

Version 0.3.0 adds shared-text creation/registration, HTML bindings, language
controls, diagnostics, arbitrary menu wrapper hooks and stable media rendering.
See [integration recipes](docs/INTEGRATION.md) for three complete paths: a new
vanilla project, an existing site preserving its DOM/CSS, and localization only.

## Quick start: one Node.js process, no Python

Create a new project:

```powershell
npx --package=@unla4ky/content-editor@0.4.0 content-editor init --template vanilla --dir ./demo
cd demo
npm install
npm run dev
```

Open `http://127.0.0.1:8012/` for the site and `/editor` on the same address
for editing. One Node process serves the site, editor, media, browser modules
and live updates. It does not open a browser or silently choose another port.
Stop it with Ctrl+C. No Python, Vite, import map or build is required.

When the package is already installed in a project, the initializer is also
available as `npx --no-install content-editor init --template vanilla --dir ./demo`.
The initializer creates configuration, a small populated hierarchy, project-owned
HTML/CSS/JS and npm scripts. It refuses existing template files or conflicting
scripts before writing. It does not automatically install, start or overwrite
an existing site. Run it in a new directory to inspect the complete example.

The starter selects the first category, supports nested accordion menus and
language switching, and updates from the editor immediately. A repeated click
on the selected category opens/closes its branch. Selection and expansion are
preserved during content changes. Deleting the selection selects the nearest
surviving ancestor, then the first root; an empty collection clears selection.

## Connect an existing HTML/CSS/JS site

Keep browser-visible files in a dedicated `public/` folder. Keep the content
directory, configuration, dependencies and secrets outside that folder.
Create `content-kit.config.mjs` next to package.json:

```js
export default {
  siteDirectory: './public',
  directory: './content',
  port: 8012,
  definition: {groups: {main: {label: 'Main menu', parentId: null}}},
};
```

Set the project's dev script to `content-kit dev`, or run `npx --no-install content-editor dev`.
Existing saved editor JSON and its content-media folder can be placed in the
configured content directory; they are not replaced by the starter seed.
Only files inside public/ are served as site assets. Hidden paths and symlinks
escaping that root are rejected. This is a local development editor, not an
authenticated production CMS; keep the default loopback binding.

In the existing page, keep its layout and add containers for the content:

```html
<nav id="menu" aria-label="Content"></nav>
<article id="blocks"></article>
<script type="module" src="./app.mjs"></script>
```

In public/app.mjs:

```js
import {
  createContentClient, createContentNavigation,
  mountContentTree, mountContentBlocks,
} from './content-kit/browser.mjs';
import {contentOptions} from './content-kit/runtime.mjs';

const client = await createContentClient(contentOptions);
const navigation = createContentNavigation({
  store: client.store, group: 'main', mode: 'accordion', selectFirst: true,
});
const tree = mountContentTree({
  container: document.querySelector('#menu'), navigation,
  renderItem: ({item, selected, active, expanded, hasChildren}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = selected ? 'my-button selected' : 'my-button';
    button.textContent = item.label;
    // Add your icons/arrows/classes here. Key icon mappings by item.id,
    // not by the position of an item in the collection.
    return button;
  },
});
const blocks = mountContentBlocks({
  container: document.querySelector('#blocks'), store: client.store, navigation,
});

// On teardown: tree.destroy(); blocks.destroy(); navigation.destroy(); client.close();
```

The same relative import path is supported by the local server and static
export; do not import private package internals or hard-code 127.0.0.1 in the
site. `templates/vanilla/public/app.mjs` is the complete working example,
including title, breadcrumb, languages, initial error handling and teardown.
With a bundler, equivalent public exports are `@unla4ky/content-editor/client`,
`/navigation`, `/vanilla` and `/browser`; the existing core and React APIs remain.

`renderItem` returns one focusable row element; the adapter wraps it in nested
lists, adds selection/expansion ARIA state, preserves focus by stable ID, and
handles click/keyboard navigation. Its `active` flag includes selected ancestors.
An optional separate toggle control inside a row can use
`data-content-action="toggle"`. Do not also attach a selection click handler:
the adapter owns that action. A custom handler can preventDefault to take over.
For complete DOM ownership, use navigation.rows(), subscribe() and its
select/toggle/activate methods without mountContentTree.

Navigation is optional. mode `tree` keeps multiple branches open; `accordion`
closes sibling branches. setLanguage(code) changes resolved content; language
removal in the editor falls back to the new default. destroy() unsubscribes.
Neither controller specifies animations, layout, icons or screen transitions.

mountContentBlocks renders sanitized heading/text, image and video blocks in
order. A load error becomes a missing-media message rather than a broken page.
Optional renderers are callbacks like `image: ({block, item, document}) => element`;
provide them when a project needs its own media wrapper, accessible image
description, transition or playback policy. Override default empty-state copy
through messages keyed by `no-selection`, `children-only`, `empty` or
`missing-media`. onState({state,item}) can drive project-owned diagnostics.
Without navigation, pass a resolved item and use update(nextItem) to change it.

createContentClient loads configuration and content before connecting to SSE.
No manual sorting, translation fallback or media URL assembly is needed.
It accepts baseUrl for an explicitly separate host, staticUrl for a content
manifest, onError for rejected live payloads, and fetch/EventSource overrides.
The default URLs share the page's origin; static mode opens no SSE connection.
close() releases the connection. In a SPA, dispose on unmount and reconnect
on mount; the example's pagehide cleanup is intended for a simple page.

## Static website export

Once you are ready to publish, run this explicitly in the consuming project:

```sh
npx --no-install content-editor export --out dist
```

The command copies public/ and writes content.json, content-media/ and
content-kit/ (the supported browser client, formatter dependencies and static
runtime configuration). Upload that entire directory to static hosting.
The starter needs no source edit: runtime.mjs switches it to the saved manifest
and hides the local editor link. The result works under a hosting subdirectory;
visitors need no Node.js or Python installation and never contact the editor.
Serve it over HTTP(S), rather than opening index.html through file://.

The exporter validates saved JSON and every declared media file/language variant.
If there is no saved JSON yet, it can export the configured initialContent.
Corrupt JSON, unsafe symlinks, missing media and source/output overlaps fail;
existing output is never overwritten. Choose a fresh output path for each run.
Export is a snapshot: later editor changes require another explicit export.
XLSX export remains a translation/editing workflow, separate from site export.
For an existing site, use the documented runtime import to opt into this switch;
the exporter cannot rewrite arbitrary hard-coded endpoints in custom code.

## Add to another project

Install the public scoped package in the consuming project:

```sh
npm install @unla4ky/content-editor@0.4.0
```

The package is named `@unla4ky/content-editor`; the unscoped name belongs to
another project. Both `content-editor` and the older `content-kit` executable
are included.

Install React in the host only if using the optional React entry point. Node
22.13 or newer is required for the local editor and Excel tools. No build step
or database is required. For local package development, use
`npm install --install-links /absolute/path/to/content-editor` instead.

## Define collections once

Share this ordinary JavaScript definition between the editor and the host:

```js
export const definition = {
  title: "My project",
  groups: {
    "main-menu": { label: "Main menu", parentId: null },
  },
};
```

`parentId: null` means the existing root collection, not an additional tree
item. To bind a nested collection, use an existing item's stable ID as
`parentId`. Groups are aliases over one tree; items are not copied. Their
names, translations and order can change without changing identity. A declared
nested group must keep its anchor item. A missing anchor rejects an update.

The editor displays the configured collections; with multiple collections it
provides a collection selector. Populate the chosen collection through the
editor. Creating a group declaration does not manufacture initial content or
scan components. The first version uses the existing label/title and
heading/text/image/video block model. There is no arbitrary field-schema editor.

## Use content without React or a network connection

```js
import { createContent, createContentStore } from "@unla4ky/content-editor";
import { definition } from "./content-definition.js";

const store = createContentStore({
  definition,
  content: createContent({
    languages: [{ code: "en", label: "English" }],
  }),
});

store.setContent(savedContent);
const menu = store.group("main-menu", "en");
const item = store.item(selectedId, "en");
const unsubscribe = store.subscribe(() => updateView());
```

`group` and `children` return ordered items with resolved `label`, `title`,
`hasChildren` and blocks. Text/heading blocks expose `text`; media blocks
expose `asset` (`file`, `url`, `type`, `missing`). Pass `resolveMediaUrl` to
the store when media files need a host-specific URL prefix. The core does not
fetch or play files. A renderer handles load failure or codec support.

The active language takes precedence over `default`; missing text produces a
message with its key. Missing media produces `missing: true`. The default
language chooses the initial language; it is distinct from the shared
`default` value. `getSnapshot()` returns the stable raw snapshot for
subscriptions. Treat snapshots as read-only; change content through `setContent`.

## Local files and editor

```js
import path from "node:path";
import { createContent } from "@unla4ky/content-editor";
import { startContentServer } from "@unla4ky/content-editor/server";
import { definition } from "./content-definition.js";

const server = await startContentServer({
  directory: path.resolve("./content"),
  definition,
  initialContent: createContent({
    languages: [{ code: "en", label: "English" }],
  }),
  port: 8012,
});
// Close the server during host shutdown.
```

Open `http://127.0.0.1:8012/editor`. The generic server binds to loopback by
default; the host can set `host` explicitly. Its endpoints are an optional
local editor transport, not a required external API for embedded content use.
It saves `content-editor.json`, the previous revision in `.bak`, and uploads
in `content-media/`. Existing saved content wins over `initialContent`.
Invalid saves and stale revisions are rejected. A corrupt file can recover
from a valid backup; if neither is valid, files are preserved and startup fails.

For direct Node file access without the editor, use `openLocalContent` from
`@unla4ky/content-editor/local`, then `getSnapshot()`, `subscribe()` and
`save(nextContent, baseRevision)`. Concurrent saves are serialized. A stale
save throws an error with `status: 409`.

The optional project definition accepts:

- `protectedTextKeys`: shared texts referenced outside the item tree, so unused
  text cleanup preserves them.
- `mediaFields`: permanent media entries (`id`, `type`, `label`, `description`).
  The package has no built-in application screens or branded assets.
- `fieldLabels`: editor captions such as `title` and `heading`.
- `preview: true`: emit an application preview event. The host decides what
  that event means; the package never navigates a screen.

An optional `validate(content)` server callback can add project constraints.
An optional `resolveKey(key)` handles legacy spreadsheet aliases. Neither
requires importing the host from inside the package.

## Optional live React binding

```jsx
import { createContentStore } from "@unla4ky/content-editor";
import { createLiveSource } from "@unla4ky/content-editor/live";
import { createContentBindings } from "@unla4ky/content-editor/react";
import { definition } from "./content-definition.js";

const store = createContentStore({ definition });
const source = createLiveSource({
  store,
  url: "http://127.0.0.1:8012/api/events",
});
export const { useContent, ContentItems } = createContentBindings(source);

function Menu({ language, onSelect }) {
  return (
    <ContentItems
      group="main-menu"
      language={language}
      renderItem={item => (
        <MyButton label={item.label} onClick={() => onSelect(item.id)} />
      )}
    />
  );
}
```

`MyButton` is supplied by the project. The binding handles iteration and data
updates; it does not add layout, selection, navigation, styles or animations.
Multiple mounted consumers share one live connection. For static or embedded
content use `createContentBindings(store)` without `createLiveSource`.
`onPreview` and `onError` callbacks are available on the live integration.

Rich-text strings should be rendered with `contentHtml` from
`@unla4ky/content-editor/format`, which sanitizes HTML. That entry requires a DOM;
`createContentFormatter(window)` accepts an explicit DOM. The raw core entry
does not require a browser or DOM.

## Excel compatibility

`@unla4ky/content-editor/xlsx` exports `exportContentWorkbook(content)` and
`importContentWorkbook(bytes, currentContent, { resolveKey })`. Import returns
a candidate model and report; it never saves or overwrites files on its own.

Texts opens first with readable context/field labels and formatted language
columns. Keep the hidden key column and very-hidden TextFormatting sheet.
Unchanged cells restore their original strings. Supported style edits become
application rich text. Changes that would discard unsupported layout are
rejected. Media files are referenced, not embedded. Old English/Serbian schema
names remain importable. The historical rich-text marker and schema format ID
remain unchanged for existing-data compatibility; they are not host imports.

## Compatibility with earlier local installations

Version 0.4.0 retains the public export paths, content schema, saved IDs,
translations, revisions, media paths, rich-text marker and XLSX format ID.
The two historical wire identifiers are isolated in src/compatibility.mjs;
changing them would prevent earlier consumers from reading newly saved data.
They are format identifiers and do not import or configure a host application.

Installed copies are not updated automatically. Keep an existing consumer on
its installed version until you explicitly choose to upgrade. The new registry
name requires updating imports or using an npm alias under the old dependency
key, as explained in [migration notes](docs/MIGRATION.md).

## Development

Application work normally uses the installed copy. Module-source changes do
not magically update that copy: reinstall from the package directory or registry, then restart the
host yourself. For fast package development, use a disposable consumer with
`npm install --no-install-links /absolute/path/to/content-editor` instead. Install this
module's own dependencies first (`npm install` in its root). A source symlink
exposes changes directly but still requires a Node server restart for cached
backend imports; refresh the browser for vanilla JS/CSS changes. Do not use
that symlink workflow as the distribution setup. React hosts may need their
bundler's React deduplication setting with symlinks; regular copied installs
avoid that issue.

Run `npm test` in the module for automated integration checks. They use temporary
directories and short-lived ephemeral test servers, which close at completion.
No build or dev server is part of installing the module. Browser core modules
contain no editor, Excel or Node imports; the server imports Excel tools only
when an XLSX request arrives. Installation still includes those dependencies.

## Publication status and licensing

The source is public at [LazarAndric/content-editor](https://github.com/LazarAndric/content-editor).
The public npm package is [`@unla4ky/content-editor`](https://www.npmjs.com/package/@unla4ky/content-editor).

The package source is licensed under [MIT](LICENSE). The local rich-text editor
uses SunEditor (MIT), with no API key, account or external CDN. Existing HTML
strings retain their saved format; opening the editor does not rewrite them.
See [third-party notices](THIRD-PARTY-NOTICES.md) and
[release steps](docs/RELEASING.md).
