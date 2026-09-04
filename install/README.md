# Installing without the Marketplace

For machines that cannot reach the Marketplace (air-gapped, proxy-blocked, or no `code` on the
path). Both routes need nothing but the files in this repository; there is no build step because
the compiled `out/` folder is committed.

## Route 1: the `.vsix` file

Download `script-progress-dashboard-<version>.vsix` from the GitHub release (or build it with
`npm run package`), copy it over, then either:

```
code --install-extension script-progress-dashboard-<version>.vsix
```

or, in VS Code: Extensions view → `…` menu → **Install from VSIX…** → pick the file.

## Route 2: an unpacked folder (no `code` command at all)

Copy the extension folder to:

```
%USERPROFILE%\.vscode\extensions\trevor-marshall.script-progress-dashboard-<version>\
```

You need `package.json`, `out/`, `media/`, `schemas/`, `snippets/`, `LICENSE` and `README.md`.
`node_modules`, `src/`, `test/` and `demo/` are not needed.

On VS Code 1.136 the folder alone is not enough: VS Code only loads folders that are listed in
`%USERPROFILE%\.vscode\extensions\extensions.json`, and an unlisted folder is quietly marked as
removed. Add an entry to that JSON array. The fields that matter are `identifier.id`
(`trevor-marshall.script-progress-dashboard`), `version`, `location.fsPath` / `location.path`
(the folder's absolute path) and `relativeLocation` (the folder name).
`extensions.json.template` next to this file is a filled-in example to copy the shape from.
Then run **Developer: Reload Window**.

## The reporter travels separately

The extension never needs to be on the same machine as the scripts it watches, but the reporter
does: copy `python/progress.py` (or `reporters/progress.js`) next to your scripts, or anywhere on
their import path, and point `scriptProgress.logsPath` at the folder the reporter writes to.
