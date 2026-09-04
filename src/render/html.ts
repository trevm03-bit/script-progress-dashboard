// Tiny HTML helpers shared by every section renderer. All user-provided text goes
// through esc() — task names, summaries and warnings come from files we do not control.

export function esc(value: unknown): string {
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
export function icon(name: string | undefined, extraClass = ''): string {
  const [rawName, rawMod] = (name || '').split('~');
  const n = (rawName || '').replace(/[^a-z0-9-]/gi, '');
  if (!n) return '';
  const mod = (rawMod || '').replace(/[^a-z0-9-]/gi, '');
  const modClass = mod ? ` codicon-modifier-${mod}` : '';
  return `<i class="codicon codicon-${n}${modClass}${extraClass ? ' ' + extraClass : ''}"></i>`;
}

export interface SectionOpts {
  /** Extra classes on the card. */
  cls?: string;
  /** Collapsed state (content hidden, title still shown). */
  collapsed?: boolean;
  /** Whether the title is a toggle. */
  collapsible?: boolean;
  /** Small text on the right of the title (counts, hints). */
  aside?: string;
  /** Codicon shown before the title. */
  icon?: string;
}

/** A dashboard card with an uppercase section title. */
export function section(id: string, title: string, body: string, opts: SectionOpts = {}): string {
  const collapsed = !!opts.collapsed;
  const collapsible = opts.collapsible !== false;
  const classes = ['card', opts.cls, collapsed ? 'collapsed' : ''].filter(Boolean).join(' ');
  return `<section class="${classes}" data-section="${esc(id)}">
  <div class="section-title${collapsible ? ' toggle' : ''}" ${collapsible ? `role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}"` : ''}>
    ${collapsible ? `<i class="codicon codicon-chevron-${collapsed ? 'right' : 'down'} chev"></i>` : ''}${opts.icon ? icon(opts.icon, 'section-icon') : ''}<span class="section-name">${esc(title)}</span>${opts.aside ? `<span class="section-aside">${opts.aside}</span>` : ''}
  </div>
  <div class="section-body"${collapsed ? ' hidden' : ''}>${body}</div>
</section>`;
}

/** Small muted line used for "nothing to show" states. */
export function empty(text: string, action?: { msg: string; label: string; icon?: string }): string {
  return `<div class="empty">${esc(text)}${action ? ` <button class="link-btn" data-msg="${esc(action.msg)}">${icon(action.icon)}${esc(action.label)}</button>` : ''}</div>`;
}

/**
 * Configuration that will not behave as written, shown in the section it belongs to.
 * Silence here is the bug this replaces: a malformed entry used to be dropped without a word.
 */
export function problemList(problems: { index?: number; label?: string; message: string }[]): string {
  if (!problems.length) return '';
  const li = problems.map(p => {
    const who = p.index !== undefined ? `Entry ${p.index}${p.label ? ` (“${p.label}”)` : ''}` : p.label ? `“${p.label}”` : 'This setting';
    return `<li>${esc(`${who} ${p.message}`)}</li>`;
  }).join('');
  return `<div class="problems" role="status">
  <div class="problems-h">${icon('alert')}${problems.length === 1 ? 'One setting needs attention' : `${problems.length} settings need attention`}</div>
  <ul>${li}</ul>
  <button class="link-btn" data-msg="settings">${icon('settings-gear')}Open Settings</button>
</div>`;
}

/** A tiny inline metric chip: label + value. */
export function chip(label: string, value: string, cls = ''): string {
  return `<span class="chip ${cls}"><span class="chip-k">${esc(label)}</span><span class="chip-v">${esc(value)}</span></span>`;
}

/** Format a metric value that may be a number or a string. */
export function metricText(v: number | string): string {
  if (typeof v === 'number') {
    if (!isFinite(v)) return '—';
    if (Number.isInteger(v)) return v.toLocaleString('en-US');
    return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  return String(v);
}
