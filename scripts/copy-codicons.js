// Build step: copy the codicon font + CSS out of the @vscode/codicons devDependency into media/codicons/.
// The copied files are committed, so the extension runs (and installs unpacked) without node_modules.
// Codicons: code MIT, icons CC-BY-4.0 (attributed in README.md).
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist');
const dst = path.join(__dirname, '..', 'media', 'codicons');
if (!fs.existsSync(src)) {
  if (fs.existsSync(path.join(dst, 'codicon.ttf'))) {
    console.log('copy-codicons: node_modules missing, keeping committed media/codicons/');
    process.exit(0);
  }
  console.error('copy-codicons: @vscode/codicons not installed and no committed copy - run npm install');
  process.exit(1);
}
fs.mkdirSync(dst, { recursive: true });
for (const f of ['codicon.css', 'codicon.ttf']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('copy-codicons: media/codicons/ refreshed');
