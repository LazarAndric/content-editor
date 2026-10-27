# Integration recipes — 0.4.0

Replace `YOUR_NPM_USERNAME` with the eventual npm owner. These registry
commands apply after publication; before then, install the local directory.

## 1. New vanilla project

```powershell
npx --package=@YOUR_NPM_USERNAME/content-editor@0.4.0 content-editor init --dir ./my-demo
cd my-demo
npm install
npm run dev
```

One Node process serves the site at `/` and editor at `/editor` on port 8012.
The complete files are in templates/vanilla. Change a text, select a nested
item and switch language: the same state drives navigation, blocks and page
bindings. Stop the process yourself with Ctrl+C. Python is not required.

## 2. Existing site, existing DOM and CSS

Install into the site's project directory:

```powershell
npm install @YOUR_NPM_USERNAME/content-editor@0.4.0
```

Keep the browser files in a dedicated site folder. It may be called dist if
that is already the site's source folder; do not use the same folder for export.
The complete configuration can be:

```js
// content-kit.config.mjs
export default {
  siteDirectory: './dist',
  directory: './content',
  outDirectory: './site-export-001',
  definition: {
    title: 'My site',
    groups: {main: {label: 'Categories', parentId: null}},
    textFields: [{key: 'home.title', label: 'Home heading', type: 'plain'}],
    icons: [{id: 'travel', label: 'Travel'}],
    itemTypes: [{id: 'article', label: 'Article / card'}],
  },
};
```

Keep your existing stylesheet. Add data attributes only to the text element
that should be replaced, not a wrapper containing unrelated controls/icons:

```html
<h1 data-content-text="home.title"></h1>
<select id="language" aria-label="Language"></select>
<nav id="categories" aria-label="Categories"></nav>
<article id="content"></article>
<script type="module" src="./content-app.mjs"></script>
```

This complete content-app.mjs preserves div-based menu wrappers:

```js
import {
  createContentClient, createContentNavigation, mountContentTree,
  mountContentBlocks, bindContent, mountLanguageSwitcher,
} from './content-kit/browser.mjs';
import {contentOptions} from './content-kit/runtime.mjs';

let client, navigation, tree, blocks, texts, languages;
try {
  client = await createContentClient({...contentOptions, missingText: ''});
  const {store} = client;
  navigation = createContentNavigation({store, group: 'main'});
  texts = bindContent({root: document, store, navigation,
    onDiagnostic: issue => console.warn('Content binding:', issue)});
  languages = mountLanguageSwitcher({
    select: document.querySelector('#language'), navigation,
    persistKey: 'my-site-language',
  });
  tree = mountContentTree({
    container: document.querySelector('#categories'), navigation,
    semantics: 'buttons',
    createTree: () => document.createDocumentFragment(),
    createItem: () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'category-group'; return wrapper;
    },
    createGroup: () => {
      const group = document.createElement('div');
      group.className = 'subcategories'; return group;
    },
    renderItem: ({item, depth, active, selected}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = depth ? 'subcategory-button' : 'category-button';
      button.classList.toggle('active', depth ? selected : active);
      button.textContent = item.label;
      // Add project-owned icons from a whitelist keyed by item.meta.icon.
      return button;
    },
  });
  blocks = mountContentBlocks({
    container: document.querySelector('#content'), store, navigation,
    classNames: {image: 'article-image', text: 'article-copy'},
  });
} catch (error) {
  console.error('Content integration failed:', error);
}
window.addEventListener('pagehide', () => {
  blocks?.destroy(); tree?.destroy(); texts?.destroy(); languages?.destroy();
  navigation?.destroy(); client?.close();
}, {once: true});
```

Run `npx content-kit dev`. In Shared texts, create home.title and fill its
translations, or explicitly register its declaration. Changing text or language
updates the existing h1. The site retains its CSS, menus and non-content code.

Do not disable an entire legacy script just to replace its demo content.
Separate demo data/rendering from independent dialog, logo, modal and other
UI handlers. Only one renderer should own a given menu/container. Test the
actual path from category click through content and dialog, including mobile
filters when the sidebar hides children. Use one navigation controller for
all those views. navigation.subscribe updates every attached view.

### Completely custom markup, same behavior

bindContentNavigation({container, navigation, render}) calls the project's
render function and adds delegated actions, keyboard handling and focus
restoration. Each focusable row needs data-content-id. Optional
data-content-action values are select, toggle and activate. Call destroy on
unmount. By default semantics are ordinary buttons; semantics: 'tree' adds
tree-item ARIA state and roving tabIndex when the host supplies a tree layout.
The adapter cannot infer CSS visibility or replace a separate mobile view.

For separate actions, use sibling buttons inside a wrapper, never a button
inside a button:

```js
renderItem: ({item, hasChildren}) => {
  const row = document.createElement('div'); row.tabIndex = 0;
  const name = document.createElement('button'); name.type = 'button';
  name.dataset.contentAction = 'select'; name.textContent = item.label;
  row.append(name);
  if (hasChildren) {
    const toggle = document.createElement('button'); toggle.type = 'button';
    toggle.dataset.contentAction = 'toggle'; toggle.textContent = '+';
    toggle.setAttribute('aria-label', `Toggle ${item.label}`);
    row.append(toggle);
  }
  return row;
}
```

Translate toggle labels through your shared keys. For a combined action use
the default activate behavior. action: 'select' makes the ordinary click always
select/open content while the explicit toggle controls expansion only.

## 3. Localization only

No categories or block renderer are necessary. Use this configuration:

```js
// content-kit.config.mjs
import {createContent} from '@YOUR_NPM_USERNAME/content-editor';
import {applyTextFields} from '@YOUR_NPM_USERNAME/content-editor/fields';
const definition = {textFields: [{
  key: 'home.title', label: 'Main heading', type: 'message', required: true,
  components: ['accent'],
  initialValues: {
    en: 'Discover {accent}something new{/accent}',
    sr: '{accent}Nešto novo{/accent} te čeka',
  },
}]};
export default {
  directory: './content', siteDirectory: './public',
  outDirectory: './site-export-001', definition,
  initialContent: applyTextFields(createContent({languages: [
    {code: 'en', label: 'English'}, {code: 'sr', label: 'Srpski'},
  ]}), definition),
};
```

```html
<!-- public/index.html: keep your stylesheet and other UI scripts. -->
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example</title></head>
<body><h1 data-content-message="home.title"></h1>
<select id="language" aria-label="Language"></select>
<script type="module" src="./app.mjs"></script></body></html>
```

```js
// public/app.mjs
import {createContentClient, createContentNavigation, bindContent,
  mountLanguageSwitcher} from './content-kit/browser.mjs';
import {contentOptions} from './content-kit/runtime.mjs';
const client = await createContentClient(contentOptions);
const navigation = createContentNavigation({store: client.store, selectFirst: false});
const binding = bindContent({root: document, store: client.store, navigation,
  components: {accent: document => document.createElement('em')},
  onDiagnostic: issue => console.warn('Content binding:', issue),
});
const languages = mountLanguageSwitcher({select: document.querySelector('#language'),
  navigation, persistKey: 'my-language'});
window.addEventListener('pagehide', () => {
  binding.destroy(); languages.destroy(); navigation.destroy(); client.close();
}, {once: true});
```

Run `npx content-kit dev`. Change the full heading in Shared texts and switch
languages. The translator can move {accent} without changing markup. Named
components are project-supplied factories; there is no arbitrary HTML parsing.
{br} creates a project-approved line break when the br component returns a br.
Use CSS wrapping when a forced line break is not part of the content.

## Shared fields, registration and missing values

Shared texts can be created with a stable key, label, group, description, type,
required flag and all translations through the editor. Configuration declarations
use textFields: [{key,label,group,description,type,required,initialValues,components}].
Types are plain, rich or message. Declared fields appear even with no saved text;
editing an empty declaration writes the user's value through the normal save.

Registration is separate and explicit. The editor shows a plan and Apply button.
CLI equivalents (stop the dev process first for offline CLI writes):

```sh
npx content-kit fields
npx content-kit fields --apply
```

applyTextFields and planTextFields from /fields expose the same behavior to Node
or an embedded host. Only missing text records receive initial values; existing
translations, including deliberately blank values, are never overwritten. Missing
metadata is registered separately. initialContent still applies only to a new
content directory. No restart silently migrates saved content.

protectedTextKeys only protects keys from cleanup; it does not create fields.
Registered/declared fields are also protected. Declared field metadata comes
from configuration; manually created field metadata can be edited in Shared
texts. Deleting manual shared text is explicit, warns about undiscoverable HTML
uses and is blocked for known category/media/config references. A remaining
HTML binding reports missing-key and uses its configured fallback.

## Binding and diagnostics contract

- data-content-text uses textContent.
- data-content-rich explicitly enables sanitized rich text.
- data-content-message uses named components and rejects unknown/unbalanced
  markers. Only component factories supplied by the host can create elements.
- data-content-attr="placeholder:key; title:key; alt:key; aria-label:key" supports
  only those four safe attributes. It never sets URLs, event handlers or style.
- data-content-fallback selects an element-specific missing-value replacement.
  The default binder fallback is empty; fallback may also be a callback.

bindContent accepts a manifest as bindings: [{selector,key,type,attribute}].
Missing selectors produce missing-element diagnostics; attributes discover
bindings on elements that actually exist. Call refresh after adding dynamic
HTML. getReport/onReport expose a batch; onDiagnostic receives individual issues.
There is no DOM MutationObserver or automatic analysis of arbitrary JavaScript.

Core missing-key strings remain backward compatible. For a visitor-facing
policy, createContentStore/createContentClient accept missingText (string or
callback) and onMissingText({code,key,language}). Logs and visitor fallback are
separate choices. An HTML binding reports its own diagnostics independently.

The editor Diagnostics tab and `npx content-kit doctor` report incomplete text,
declared required fields, malformed named messages, image descriptions, media
files and HTML keys. doctor is read-only; it also reports the package version
and outstanding registration plan. CLI required errors set a nonzero exit code.
Runtime bindContent is the check for missing elements and explicit selectors.

Static export rejects missing required translations and invalid required named
messages for every configured language; shared Default values satisfy fallback.
Explicitly nondecorative images require a description. Optional text warnings
remain visible in diagnostics and do not block export. This does not validate
arbitrary custom JS/renderers, CSS layouts or every possible translated sentence.

## Language state

mountLanguageSwitcher({select,navigation,persistKey}) uses the same state as
menus, blocks and bindings. Initial language comes from content.defaultLanguage;
an optional saved user preference takes precedence if still available. Removing
a language selects the current default. The helper sets html.lang and html.dir.
Set an explicit dir (ltr, rtl or auto) in the Languages editor for other cases;
the default RTL-language heuristic is deliberately small. Storage access is
optional and storage failures are caught. Editor preview language is independent
from a visitor's language preference.

## Blocks, media and cards

The media editor supports a translated description key and an explicit decorative
flag. Decorative images use empty alt; descriptions otherwise resolve through
the same locale/shared fallback. Legacy images without a declared description
still render with empty alt and generate a diagnostic warning.

mountContentBlocks supports classNames by block type, wrapBlock and afterRender.
These hooks receive a safely created element and context. A custom renderers
callback replaces that type completely: it owns sanitization, media load errors,
accessibility and playback policy. messages values may be strings or callbacks
receiving item/block/language context, including missing-media on load failure.

Unchanged block IDs and resolved values retain their actual DOM elements across
unrelated updates. Expansion-only notifications do not redraw content. Changing
a block's media URL or language may intentionally replace it. Changing selection
or destroying the mount discards its media state. Custom renderers depending on
the whole item are refreshed when that item changes. Call render() to explicitly
rebuild after changing renderer options. Each ID must remain stable and unique.

For an article, mount all its blocks. For cards, assign explicit semantic roles
in the editor: cover (media), excerpt (text), tag (text), body (article content).
contentCard(item, {cover:'cover',excerpt:'excerpt',tag:'tag'}) resolves these roles
and rejects duplicate role matches. Its result has title, cover, excerpt and tag;
it never guesses which arbitrary image or text represents a card. The project
creates its own card/featured wrappers and decides which items are articles,
for example item.meta.contentType === 'article'. Optional itemTypes and icons in
configuration expose editor selectors, storing stable IDs in node.meta. The
project supplies its icon SVG whitelist and defines count semantics explicitly.
Do not treat child count, block count and article count as interchangeable.

Full XLSX round-trips preserve shared-field metadata, media descriptions,
semantic roles, item metadata and language directions in optional English
metadata sheets. Existing older full/translation imports remain supported.

## Development and static export

Content saves stream live. Editing configuration or project-root mjs files logs
a restart notice; it does not reload project code or overwrite editor data.
Copy installations require reinstallation after changing module sources; see
the README for optional source-symlink development. No server starts on install.

Use `npx content-kit export --out site-export-001`, or configure outDirectory
and run `npx content-kit export`. The destination must be fresh and separate
from sources. The command never deletes a previous export. Its conflict message
explains which path to change. Upload the entire output folder, including
content.json, content-kit/ and content-media/. The documented runtime import
selects static mode without localhost/SSE access. Changing content afterward
requires a new explicitly requested export.

Manual acceptance: test initial load, deep category selection, mobile filters,
language changes, editor live updates, missing media, dialogs/Back/keyboard and
the published static site. Automated checks complement those design checks.
