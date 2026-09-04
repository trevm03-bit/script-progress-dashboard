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
exports.EVENT_FILE = void 0;
exports.writeEvent = writeEvent;
// Optional: write the last notable run transition to a file, so something outside VS Code can
// react to it — an agent, a watcher, a shell loop.
//
// This is the ONLY thing in the extension that writes into the logs folder, and it is off by
// default. That matters: everything else here reads. Turning it on is a deliberate choice to
// let this tool produce a file, and it writes exactly one, named so it can never collide with
// the reporter's four.
//
// It is a FILE and not an HTTP webhook on purpose. "Nothing leaves the machine — no network, no
// telemetry" is the reason this extension is installable in places that forbid the alternatives;
// it is stated in the Marketplace description, a README badge and the privacy section. A local
// file gives the same integration with nothing to trust.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.EVENT_FILE = 'last_event.json';
/**
 * Replace the event file. Best-effort by design: a failure here must never interrupt the
 * dashboard, and never produces a dialog — the user asked for a side file, not for a new way
 * for their editor to complain at them.
 */
/**
 * @param trusted the caller's workspace-trust decision. 🔴 Pass it — do not default it. `logsPath`
 * comes from settings, which a cloned repo can supply, and it may name any absolute folder, so an
 * untrusted workspace must not be able to have the extension create a directory and write a file
 * wherever it likes. Both keys are declared restricted in the manifest too; this is the belt to
 * that pair of braces. It is a parameter rather than a `vscode` import so this module stays pure
 * and testable in plain Node, which is how the rest of the codebase is arranged.
 */
function writeEvent(logsDir, event, trusted) {
    if (!trusted)
        return;
    try {
        fs.mkdirSync(logsDir, { recursive: true });
        const file = path.join(logsDir, exports.EVENT_FILE);
        const tmp = `${file}.${process.pid}.tmp`;
        // Same atomic write the reporter uses: a watcher must never read half a file.
        fs.writeFileSync(tmp, JSON.stringify(event, null, 2), 'utf-8');
        try {
            fs.renameSync(tmp, file);
        }
        catch {
            try {
                fs.unlinkSync(tmp);
            }
            catch { /* nothing more to do */ }
        }
    }
    catch {
        /* the event file is a convenience; never let it break a refresh */
    }
}
//# sourceMappingURL=eventFile.js.map