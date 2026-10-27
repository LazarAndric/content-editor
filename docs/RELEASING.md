# Releasing @unla4ky/content-editor

The source repository and npm package are public. Sources are MIT-licensed.
The package name is @unla4ky/content-editor; the unscoped name belongs to
another project. Both content-editor and content-kit executables are included.

1. Set the intended new version in package.json. Never overwrite an existing
   registry version. Keep name, license and public publishConfig unchanged.
2. Run npm install --package-lock-only, then npm ci and npm test.
3. Run npm pack --dry-run and inspect its file allowlist. The archive should
   contain sources, editor, templates, public docs and licenses.
4. Install the archive in a disposable consumer and check CLI initialization,
   browser modules, editor assets, content saves and XLSX use.
5. Commit and push the release sources to GitHub.
6. Enable two-factor authentication in the npm account settings before the first
   release. Run npm login and verify npm whoami returns unla4ky.
7. Run npm publish --access public and complete npm's authentication challenge.
8. Verify npm view @unla4ky/content-editor@<version> and install that exact
   registry version into a disposable consumer.
9. Tag the verified release v<version> and push the tag.

The prepublishOnly script runs the tests. Installation has no build scripts or
automatic application/content updates. Do not commit .npmrc tokens.

## Optional GitHub Actions setup

The checked-in docs/ci.yml.example is ready to copy to .github/workflows/ci.yml.
The Git credential used for the initial push lacked the workflow permission, so
the repository includes the configuration as a template instead of an active
workflow. Enable it later using a GitHub credential with workflow access. It
runs clean installs, tests and npm packing on Windows/Linux and Node 22/24.
