# Upgrading an existing consumer to 0.4.0

Existing installed copies continue to work. Publishing this package does not
change a consumer's package.json, lockfile, installed dependencies or saved data.
Local `file:` dependencies can install newer sources during a later reinstall;
keep the old package directory or a tarball if you need reproducible old installs.

The final registry name will be `@YOUR_NPM_USERNAME/content-editor`. The unscoped
name belongs to another project. Replace the scope in these examples after the
maintainer selects an npm account and publishes the release.

To adopt the new name, replace your old dependency and its import prefixes with
the new scoped name. All public subpaths remain available, including `/react`,
`/server`, `/format`, `/xlsx`, `/local`, `/client` and `/browser`.

To preserve existing imports, use npm's alias syntax under the original dependency
key. For example, when an application's old dependency key is `legacy-content`:

```json
{
  "dependencies": {
    "legacy-content": "npm:@YOUR_NPM_USERNAME/content-editor@0.4.0"
  }
}
```

Use the actual old dependency key, including its scope, in your application.
Then run npm install, commit the updated lockfile and restart the host process.
The existing `content-kit` command and `content-kit.config.mjs` filename remain
supported. A new `content-editor` executable runs the same CLI.

Content version 1, stable IDs, language codes, media paths, revisions, backups,
rich-text strings and workbook identifiers remain compatible with 0.3.0. No
automatic content migration runs during installation or editor startup. Earlier
versions can read the same baseline format; optional fields added after an older
version may require a newer consumer to retain all metadata.

Before upgrading, back up your content JSON and media folder and run the host's
tests against 0.4.0. Host definitions still own collection aliases, permanent
media entries, shared text fields, validation, preview behavior and custom tabs.
