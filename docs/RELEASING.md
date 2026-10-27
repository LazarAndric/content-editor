# Release 0.4.0

The source repository is public, but npm publication is blocked
until the maintainer chooses an npm account/scope. The source is MIT-licensed. The
unscoped name `content-editor` is owned by another project. Keep `private: true`
until the npm scope is resolved.

1. Create an npm account and enable the publishing authentication it requires.
2. Set package.json `name` to `@YOUR_NPM_USERNAME/content-editor`, review
   the MIT LICENSE file and THIRD-PARTY-NOTICES.md. SunEditor is MIT-licensed.
3. Replace the scope placeholders in the documentation. The initializer takes
   the actual package name from package.json automatically.
4. Set `private` to false and run `npm install --package-lock-only`.
5. Run `npm ci`, `npm test` and `npm pack --dry-run`. Inspect the archive contents:
   only package sources, editor, templates, public docs and licenses belong there.
6. Commit the release and push the public repository after the checks pass.
7. Run `npm login`, then `npm publish --access public`. Complete npm's
   authentication challenge in your browser when requested.
8. Verify `npm view @YOUR_NPM_USERNAME/content-editor@0.4.0` and install it into
   a disposable consumer. Check initialization, CLI, editor and spreadsheet use.
9. Tag the verified release `v0.4.0` and push the tag.

The `prepublishOnly` script runs the test suite. There are no install-time build
scripts or automatic application/content updates. Do not commit .npmrc tokens;
the repository ignores .npmrc and uses an explicit npm file allowlist.

## Optional GitHub Actions setup

The checked-in docs/ci.yml.example is ready to copy to .github/workflows/ci.yml.
The Git credential used for the initial push lacked the workflow permission, so
the repository includes the configuration as a template instead of an active
workflow. Enable it later using a GitHub credential with workflow access. It
runs clean installs, tests and npm packing on Windows/Linux and Node 22/24.
