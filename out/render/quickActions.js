"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderQuickActions = renderQuickActions;
const html_1 = require("./html");
function renderQuickActions(settings, trusted) {
    if (settings.buttons.length === 0) {
        return (0, html_1.section)('quickActions', 'Quick Actions', (0, html_1.empty)('No buttons configured. Add them under scriptProgress.quickActions.buttons.'));
    }
    const groups = new Map();
    settings.buttons.forEach((b, index) => {
        const g = b.group || '';
        if (!groups.has(g))
            groups.set(g, []);
        groups.get(g).push({ index, label: b.label, icon: b.icon, confirm: b.confirm !== false, command: b.command });
    });
    let body = '';
    for (const [group, buttons] of groups) {
        if (group)
            body += `<div class="btn-group-label">${(0, html_1.esc)(group)}</div>`;
        body += `<div class="btn-row">`;
        for (const b of buttons) {
            body += `<button class="btn" data-action="${b.index}" title="${(0, html_1.esc)(b.command)}" ${trusted ? '' : 'disabled'}>${(0, html_1.icon)(b.icon)}<span>${(0, html_1.esc)(b.label)}</span>${b.confirm ? '' : (0, html_1.icon)('zap', 'btn-hint')}</button>`;
        }
        body += `</div>`;
    }
    if (!trusted)
        body += `<div class="muted small">${(0, html_1.icon)('shield')} Workspace is not trusted — buttons are disabled until you trust it.</div>`;
    return (0, html_1.section)('quickActions', 'Quick Actions', body);
}
//# sourceMappingURL=quickActions.js.map