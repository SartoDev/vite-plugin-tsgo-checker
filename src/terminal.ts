import path from 'node:path';
import { styleText } from 'node:util';

import { codeFrame } from './frame.js';
import type { CheckerDiagnostic } from './index.js';

export const LABELS: Record<CheckerDiagnostic['source'], string> = {
    tsgo: 'TypeScript',
    oxlint: 'Oxlint',
};

// Code frame rows (`> 8 | code`) and caret rows (`  | ^^^`), as built by `frame.ts`.
const FRAME_ROW = /^([> ])( +\d+ \|)(.*)$/;
const FRAME_CARET = /^(\s+\|)(\s*)(\^+)$/;

const colorFrame = (frame: string) =>
    frame
        .split('\n')
        .map((line) => {
            const caret = FRAME_CARET.exec(line);
            if (caret)
                return `${styleText('gray', caret[1])}${caret[2]}${styleText('red', caret[3])}`;
            const row = FRAME_ROW.exec(line);
            if (!row) return line;
            return `${row[1] === '>' ? styleText('red', '>') : ' '}${styleText('gray', row[2])}${row[3]}`;
        })
        .join('\n');

/** Label + message, `FILE` + path and code frame. Colors follow NO_COLOR/FORCE_COLOR. */
export const formatDiagnostic = (d: CheckerDiagnostic, root: string) => {
    const file = path.resolve(root, d.file);
    const isError = d.severity === 'error';
    const label = styleText(
        ['bold', 'white', isError ? 'bgRed' : 'bgYellow'],
        ` ${isError ? 'ERROR' : 'WARNING'}(${LABELS[d.source]}) `
    );
    const fileLabel = styleText(['bold', 'black', 'bgCyan'], ' FILE ');
    const frame = codeFrame(file, d.line, d.column, d.length);
    return [
        `${label} ${d.code ? `${d.message} (${d.code})` : d.message}`,
        `${fileLabel} ${file}:${d.line}:${d.column}`,
        ...(frame ? ['', colorFrame(frame), ''] : []),
    ].join('\n');
};

export const formatSummary = (source: CheckerDiagnostic['source'], list: CheckerDiagnostic[]) => {
    const errors = list.filter((d) => d.severity === 'error').length;
    const warnings = list.length - errors;
    const color = errors ? 'red' : warnings ? 'yellow' : 'green';
    return styleText(
        color,
        `[${LABELS[source]}] ${errors} error${errors !== 1 ? 's' : ''}, ${warnings} warning${warnings !== 1 ? 's' : ''}`
    );
};
