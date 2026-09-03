"use strict";
// Tiny HTML helpers shared by every section renderer. All user-provided text goes
// through esc() — task names, summaries and warnings come from files we do not control.
Object.defineProperty(exports, "__esModule", { value: true });
exports.esc = esc;
exports.icon = icon;
exports.section = section;
exports.empty = empty;
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/**
 * A codicon glyph. "sync~spin" means the sync icon with the spin modifier, the same
 * shorthand the status bar uses. Unknown names render as a blank glyph; no error.
 */
function icon(name, extraClass = '') {
    const [rawName, rawMod] = (name || '').split('~');
    const n = (rawName || '').replace(/[^a-z0-9-]/gi, '');
    if (!n)
        return '';
    const mod = (rawMod || '').replace(/[^a-z0-9-]/gi, '');
    const modClass = mod ? ` codicon-modifier-${mod}` : '';
    return `<i class="codicon codicon-${n}${modClass}${extraClass ? ' ' + extraClass : ''}"></i>`;
}
/** A dashboard card with an uppercase section title. */
function section(id, title, body, extraClass = '') {
    return `<section class="card ${extraClass}" data-section="${esc(id)}">
  <div class="section-title">${esc(title)}</div>
  ${body}
</section>`;
}
/** Small muted line used for "nothing to show" states. */
function empty(text) {
    return `<div class="empty">${esc(text)}</div>`;
}
//# sourceMappingURL=html.js.map