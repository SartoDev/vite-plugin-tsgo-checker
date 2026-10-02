// Browser badge + overlay, served by the plugin as a virtual module. `OPTIONS` (`ClientOptions`) is
// prepended by the plugin; diagnostics arrive as `CheckerPayload` over Vite's HMR socket.

/* global OPTIONS */

const EVENT = 'tsgo-checker';
const TAG = 'tsgo-checker-overlay';

const LABELS = { tsgo: 'TypeScript', oxlint: 'Oxlint' };

const POSITIONS = {
    tl: 'top:12px;left:12px;',
    tr: 'top:12px;right:12px;',
    bl: 'bottom:12px;left:12px;',
    br: 'bottom:12px;right:12px;',
};

const STYLE = `
:host {
    position: fixed; inset: 0; z-index: 99999; overflow-y: auto;
    background: rgba(0, 0, 0, 0.66);
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.window {
    max-width: 1100px; margin: 40px auto; padding: 8px 24px 16px;
    background: #181818; color: #d8d8d8; border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; border-bottom: 1px solid #333; color: #999;
}
.close { background: none; border: 0; color: #999; font-size: 20px; cursor: pointer; }
.close:hover { color: #fff; }
.diagnostic { padding: 14px 0; border-bottom: 1px dotted #666; }
.diagnostic:last-child { border-bottom: 0; }
.source { color: #8e90ff; }
.message { color: #ff5555; white-space: pre-wrap; }
.warning .message { color: #e2b93d; }
.file { display: block; margin-top: 2px; color: #2dd9da; text-decoration: underline; cursor: pointer; }
.frame { margin: 12px 0 0; padding: 0 0 0 12px; color: #e2c08d; overflow-x: auto; white-space: pre; }
`;

const badge = document.createElement('button');
badge.title = 'Errors and warnings (click to open)';
document.body.appendChild(badge);

// `badgeStyle` goes last so a user `display: none;` wins over the computed display.
const styleBadge = (data) => {
    const background = data?.errors ? '#e5484d' : '#d97706';
    badge.style.cssText = `position:fixed;${POSITIONS[OPTIONS.position]}z-index:99998;display:${data ? 'flex' : 'none'};gap:12px;align-items:center;padding:10px;border:0;border-radius:6px;background:${background};color:#fff;font:400 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);${OPTIONS.badgeStyle}`;
};
styleBadge(null);

const element = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
};

// Same endpoint Vite's own error overlay uses to open a file in the editor.
const openInEditor = (location) =>
    fetch(
        `${import.meta.env?.BASE_URL ?? '/'}__open-in-editor?file=${encodeURIComponent(location)}`
    );

const renderDiagnostic = (d) => {
    const block = element('div', `diagnostic ${d.severity}`);
    const title = element('div');
    title.append(
        element('span', 'source', `[${LABELS[d.source] ?? d.source}] `),
        element('span', 'message', d.code ? `${d.message} (${d.code})` : d.message)
    );
    const location = `${d.absoluteFile}:${d.line}:${d.column}`;
    const link = element('a', 'file', location);
    link.onclick = () => openInEditor(location);
    block.append(title, link);
    if (d.frame) block.append(element('pre', 'frame', d.frame));
    return block;
};

class CheckerOverlay extends HTMLElement {
    constructor(data) {
        super();
        const root = this.attachShadow({ mode: 'open' });
        const style = element('style', '', STYLE);
        const panel = element('div', 'window');
        panel.style.cssText = OPTIONS.panelStyle;
        panel.addEventListener('click', (event) => event.stopPropagation());

        const header = element('header');
        const closeButton = element('button', 'close', '×');
        closeButton.title = 'Close (Esc)';
        closeButton.onclick = () => this.close();
        header.append(
            element(
                'span',
                '',
                `❗ ${data.errors} error${data.errors !== 1 ? 's' : ''} · ⚠️ ${data.warnings} warning${data.warnings !== 1 ? 's' : ''}`
            ),
            closeButton
        );

        panel.append(header, ...data.diagnostics.map(renderDiagnostic));
        root.append(style, panel);

        this.addEventListener('click', () => this.close());
        this.onKeydown = (event) => event.key === 'Escape' && this.close();
        document.addEventListener('keydown', this.onKeydown);
    }

    close() {
        document.removeEventListener('keydown', this.onKeydown);
        this.remove();
    }
}

if (!customElements.get(TAG)) customElements.define(TAG, CheckerOverlay);

let last = null;

const close = () => document.querySelectorAll(TAG).forEach((el) => el.close());

const open = () => {
    if (!last) return;
    close();
    document.body.appendChild(new CheckerOverlay(last));
};

badge.onclick = open;

// Auto-open only when the list of diagnostics changes, not on every re-check.
const signature = (data) =>
    JSON.stringify(data?.diagnostics.map((d) => [d.source, d.file, d.line, d.column, d.code]));

import.meta.hot.on(EVENT, (data) => {
    const changed = signature(data) !== signature(last);
    last = data;
    styleBadge(data);
    if (!data) {
        close();
        return;
    }
    badge.innerHTML = `<span>❗ ${data.errors}</span><span>⚠️ ${data.warnings}</span>`;
    const autoOpen =
        OPTIONS.initialIsOpen === true || (OPTIONS.initialIsOpen === 'error' && data.errors > 0);
    if (changed && autoOpen) open();
    else if (document.querySelector(TAG)) open(); // refresh an overlay that is already open
});

// The socket connects before this module runs, so ask for the latest result.
import.meta.hot.send(`${EVENT}:sync`);
