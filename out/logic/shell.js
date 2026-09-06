"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.shellKindFor = shellKindFor;
exports.quoteForShell = quoteForShell;
exports.shellHazard = shellHazard;
exports.commandForFile = commandForFile;
// Building the shell command for "Run with Script Progress". PURE - no vscode import - because
// the rules here are platform-specific and got both platforms subtly wrong for a long time, and
// a rule you cannot test on the other platform is a rule you cannot fix.
const path = __importStar(require("path"));
/** Classify a shell executable path (vscode.env.shell) into the family whose rules apply. */
function shellKindFor(shellPath, platform = process.platform) {
    // Split on BOTH separators rather than path.basename, which is host-specific: on Linux it
    // does not treat a backslash as a separator, so a Windows shell path came back whole and was
    // classified as posix. What the string describes should not depend on where we read it.
    const name = String(shellPath || '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
    if (name === 'pwsh' || name === 'powershell')
        return 'powershell';
    if (name === 'cmd')
        return 'cmd';
    if (name)
        return 'posix'; // bash, zsh, fish, sh, git-bash and wsl on Windows too
    // Nothing to go on. On Windows VS Code's default profile is PowerShell, and that guess is also
    // the SAFE direction to be wrong in: PowerShell's rules quote more strictly, so a wrong guess
    // shows the user a "file not found" they can see and report, while guessing cmd and being
    // wrong hands PowerShell a string it will happily expand.
    return platform === 'win32' ? 'powershell' : 'posix';
}
// Characters that need no quoting anywhere. Deliberately narrow: everything a shell might treat
// as syntax is excluded, including % (cmd variable expansion) and $ ` ' ( ) ; { } (PowerShell).
const POSIX_SAFE = /^[A-Za-z0-9_@+=:,./-]+$/;
const WINDOWS_SAFE = /^[A-Za-z0-9_:.\\/-]+$/;
/**
 * Quote a path for the shell that will actually receive it.
 *
 * Single quotes are the answer on both POSIX and PowerShell, for the same reason: they are the
 * only string form that is literal all the way through. POSIX escapes an embedded quote as
 * `'\''`; PowerShell doubles it. cmd.exe has only double quotes, and a `"` cannot occur in a
 * Windows path anyway, so nothing inside needs escaping there.
 */
function quoteForShell(p, kind) {
    const s = String(p);
    if (kind === 'posix')
        return POSIX_SAFE.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
    if (kind === 'powershell')
        return WINDOWS_SAFE.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
    return WINDOWS_SAFE.test(s) ? s : `"${s.replace(/"/g, '')}"`;
}
/**
 * A path this shell cannot be given safely, in words the user can act on, or null.
 *
 * Only one case survives correct quoting: cmd.exe expands %NAME% inside double quotes and offers
 * no escape for it on the command line, so `run_%DATE%.py` reaches the interpreter as a filename
 * that does not exist on disk. Quoting cannot fix it; saying so can.
 */
function shellHazard(file, kind) {
    if (kind === 'cmd' && /%[^%\s]+%/.test(String(file))) {
        return 'cmd.exe replaces %NAME% with an environment variable even inside quotes, so this file '
            + 'name cannot be passed through it unchanged. Switch the terminal to PowerShell, or rename the file.';
    }
    return null;
}
/** The command 'Run with Script Progress' builds for a file, from the interpreters map. */
function commandForFile(file, interpreters, opts = {}) {
    const o = typeof opts === 'string' ? { platform: opts } : (opts || {});
    const platform = o.platform || process.platform;
    const kind = o.shell || shellKindFor(undefined, platform);
    const ext = path.extname(file);
    const key = Object.keys(interpreters).find(k => k.toLowerCase() === ext.toLowerCase());
    if (key === undefined)
        return null;
    // 🔴 A number or an array typed into settings.json reaches here as-is - VS Code squiggles it but
    // get() still returns it - and `configured.trim()` threw an unhandled TypeError out of the
    // command handler, leaving the user a generic "command failed" toast that named no setting.
    const raw = interpreters[key];
    const configured = typeof raw === 'string' ? raw : '';
    const userSet = (o.userConfigured || []).some(k => k.toLowerCase() === ext.toLowerCase());
    const prefix = (userSet ? configured : translateDefault(configured, ext, platform)).trim();
    const quoted = quoteForShell(file, kind);
    if (!prefix) {
        // No interpreter - .cmd and .bat ship with an empty prefix, so the path IS the command.
        // 🔴 In PowerShell a bare quoted string is an EXPRESSION, not a command: it prints the path
        // and exits 0. "Run with Script Progress" on any .cmd under a folder with a space in it
        // therefore echoed the filename and never ran the batch file - no error, exit code 0, so the
        // extension's own exit-code hook stayed quiet and the user believed it had run. The call
        // operator is what makes it a command.
        return kind === 'powershell' ? `& ${quoted}` : quoted;
    }
    // A user whose interpreter is itself a quoted path needs the call operator for the same reason.
    return kind === 'powershell' && /^["']/.test(prefix) ? `& ${prefix} ${quoted}` : `${prefix} ${quoted}`;
}
/** The two defaults that are Windows-shaped, exactly as package.json ships them. */
const PACKAGED_DEFAULTS = {
    '.py': 'python',
    '.ps1': 'powershell -ExecutionPolicy Bypass -File',
};
/**
 * Translate the two Windows-shaped defaults when running anywhere else.
 *
 * macOS has shipped no `python` binary since 12.3 and most Linux distributions ship only
 * `python3`, so the packaged default failed on this extension's own primary language on a stock
 * Mac. `powershell` likewise does not exist off Windows - it is `pwsh`, and -ExecutionPolicy is a
 * Windows-only switch that errors there.
 *
 * 🔴 Only a value that EXACTLY equals what package.json ships is translated, and the caller tells
 * us which extensions the user set for themselves. This used to match `.ps1` with
 * /^powershell\b/i, so any user value merely beginning with the word - `powershell.exe -File`
 * for working WSL interop, `powershell -NoProfile -NonInteractive -File`, `powershell-lts -File` -
 * was thrown away and replaced wholesale. The setting existed, the user edited it, and nothing
 * they typed reached the terminal.
 */
function translateDefault(configured, ext, platform) {
    if (platform === 'win32')
        return configured;
    const lower = ext.toLowerCase();
    const packaged = PACKAGED_DEFAULTS[lower];
    if (packaged === undefined || configured.trim() !== packaged)
        return configured;
    return lower === '.py' ? 'python3' : 'pwsh -NoProfile -File';
}
//# sourceMappingURL=shell.js.map