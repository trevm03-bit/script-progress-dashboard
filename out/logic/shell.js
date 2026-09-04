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
exports.commandForFile = commandForFile;
// Building the shell command for "Run with Script Progress". PURE - no vscode import - because
// the rules here are platform-specific and got both platforms subtly wrong for a long time, and
// a rule you cannot test on the other platform is a rule you cannot fix.
const path = __importStar(require("path"));
/**
 * Quote a path for the shell that will actually receive it.
 *
 * 🔴 The two families need different rules, and the old single rule was wrong for both edges.
 * On POSIX only a space triggered quoting, so `report(v2).py` went through raw and bash rejected
 * it, while `run$(id).py` ran a command substitution; and even when it DID quote, a POSIX double
 * quote still expands $, backtick and backslash. On cmd, `\"` is not an escape at all - a literal
 * double quote has to be doubled.
 *
 * Single quotes on POSIX are literal in every shell (bash, zsh, sh, fish), and `'\''` is the
 * standard way to embed one. That is why they are used here rather than double quotes.
 */
function quoteIfNeeded(p, platform = process.platform) {
    if (platform === 'win32') {
        return /[\s"&|<>^%]/.test(p) ? `"${p.replace(/"/g, '""')}"` : p;
    }
    return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}
/** The command 'Run with Script Progress' builds for a file, from the interpreters map. */
function commandForFile(file, interpreters, platform = process.platform) {
    const ext = path.extname(file);
    const key = Object.keys(interpreters).find(k => k.toLowerCase() === ext.toLowerCase());
    if (key === undefined)
        return null;
    const prefix = defaultInterpreter(interpreters[key] || '', ext, platform).trim();
    return prefix ? `${prefix} ${quoteIfNeeded(file, platform)}` : quoteIfNeeded(file, platform);
}
/**
 * Translate the two Windows-shaped defaults when running anywhere else.
 *
 * macOS has shipped no `python` binary since 12.3 and most Linux distributions ship only
 * `python3`, so the packaged default failed on this extension's own primary language on a stock
 * Mac. `powershell` likewise does not exist off Windows - it is `pwsh`, and -ExecutionPolicy is a
 * Windows-only switch that errors there. Only the UNCHANGED defaults are translated: the moment
 * someone sets their own interpreter, theirs is used verbatim.
 */
function defaultInterpreter(configured, ext, platform) {
    if (platform === 'win32')
        return configured;
    const lower = ext.toLowerCase();
    if (lower === '.py' && configured.trim() === 'python')
        return 'python3';
    if (lower === '.ps1' && /^powershell\b/i.test(configured.trim()))
        return 'pwsh -NoProfile -File';
    return configured;
}
//# sourceMappingURL=shell.js.map