# Publishing to the VS Code Marketplace

Everything in this repo is ready for a Marketplace listing. Two steps need **you** (they involve an
account and a token, which nobody else should hold); the rest is prepared.

## 1. One-time: create a publisher (you)

1. Sign in at https://marketplace.visualstudio.com/manage with a Microsoft account (a personal one is
   fine; it is what appears as the publisher's owner).
2. **Create Publisher** → choose the ID that matches `package.json` → `"publisher": "trevor-marshall"`.
   If that ID is taken, pick another and change the `publisher` field here to match before packaging;
   the extension's Marketplace URL becomes `https://marketplace.visualstudio.com/items?itemName=<publisher>.script-progress-dashboard`.
3. Fill in the display name (the name that appears on every listing) and, optionally, a website.

## 2. Publish (either route)

**Route A — upload in the browser (simplest, no token):**
`https://marketplace.visualstudio.com/manage/publishers/<publisher>` → **New extension → Visual
Studio Code** → drop `dist/script-progress-dashboard-1.1.0.vsix`. The listing goes live in a few
minutes after an automated scan.

**Route B — command line:**
1. In Azure DevOps (`https://dev.azure.com/<any org>/_usersSettings/tokens`) create a Personal Access
   Token with **Organization: All accessible organizations**, **Scopes: Marketplace → Manage**.
2. Run, in this folder:
   ```
   npx @vscode/vsce login <publisher>       # pastes the token once, stored locally
   npm run compile && npm test
   npx @vscode/vsce publish                 # or: npx @vscode/vsce publish minor
   ```
Never paste the token into a chat, a file in this repo, or a settings file.

## 3. What the listing shows, and where it comes from

| Listing element | Source in this repo |
|---|---|
| Name, description, categories, keywords | `package.json` |
| Icon | `media/icon.png` (128×128) |
| Banner colour | `package.json` → `galleryBanner` |
| Overview page | `README.md` (relative image links must become absolute URLs — see below) |
| Changelog tab | `CHANGELOG.md` |
| License | `LICENSE` (MIT) |
| Version | `package.json` → `version` |

**Screenshots in the README:** the Marketplace renders `README.md` but only shows images with
**absolute HTTPS URLs**. `npm run package` rewrites the README's `docs/*.png` links to
`https://raw.githubusercontent.com/trevm03-bit/script-progress-dashboard/main/docs/...` (the
`--baseImagesUrl` flag in `package.json`). They render on the listing once a **public GitHub
repository with that exact name** exists under your account and contains the `docs/` folder;
until then the listing shows broken image boxes, so create the repo (or change the URL in the
script) before publishing. Adding `"repository": {"type": "git", "url": "https://github.com/trevm03-bit/script-progress-dashboard.git"}`
to `package.json` at the same time lets `vsce` detect it and drops the `--allow-missing-repository` flag.

## 4. Before every release

```
npm run compile && npm test && python python/test_progress.py
npm run package            # dist/<name>-<version>.vsix
code --install-extension dist/<name>-<version>.vsix   # try it in a real window first
```
Bump `version` in `package.json` and add a `CHANGELOG.md` entry. Marketplace versions are immutable:
a re-upload needs a new version number.

## 5. Optional polish once it is live

- Add `"repository"` and `"bugs"` to `package.json` (public GitHub repo).
- Add a short animated GIF of a run to the README (Marketplace listings with one convert far better).
- Open VSX registry (for VSCodium / Gitpod users): `npx ovsx publish dist/<name>.vsix -p <token>`
  with a separate token from https://open-vsx.org — same `.vsix`.
- Turn on **Sponsor** / **Q&A** in the publisher settings if you want them.

## 6. Pre-publication check (what was verified for 1.1.0)

- No personal-data or employer references anywhere in the package (structural leak gate in the private
  build tooling; the author credit is the only name).
- No network calls, no telemetry, no runtime dependencies (`npm ls --prod` is empty).
- Works on VS Code ≥ 1.80; badge, task exit codes and shell-integration exit codes are feature-detected
  and degrade silently on older hosts.
- Light, dark and high-contrast themes; reduced-motion honoured.
