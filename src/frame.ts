import fs from 'node:fs';

const LINES_BEFORE = 2;
const LINES_AFTER = 3;

// Without a span length (tsgo only reports line/column), the caret covers the token at the column:
// a string literal, an identifier or a single character.
const tokenLength = (rest: string) => /^(['"`]).*?\1|^[\w$]+/.exec(rest)?.[0].length ?? 1;

/** Code frame around a diagnostic; `''` when the file cannot be read. */
export const codeFrame = (absoluteFile: string, line: number, column: number, length?: number) => {
    let source: string[];
    try {
        source = fs.readFileSync(absoluteFile, 'utf8').split(/\r?\n/);
    } catch {
        return '';
    }
    const target = source[line - 1];
    if (target === undefined) return '';

    const start = Math.max(1, line - LINES_BEFORE);
    const end = Math.min(source.length, line + LINES_AFTER);
    const width = String(end).length;
    const rest = target.slice(column - 1);
    const caretLength = Math.max(1, Math.min(length ?? tokenLength(rest), rest.length || 1));
    // Keeps tabs so the caret lines up with the column.
    const padding = target.slice(0, column - 1).replace(/[^\t]/g, ' ');

    return source
        .slice(start - 1, end)
        .flatMap((code, index) => {
            const number = start + index;
            const gutter = `${number === line ? '>' : ' '} ${String(number).padStart(width)} |`;
            const row = `${gutter} ${code}`.trimEnd();
            return number === line
                ? [row, `  ${' '.repeat(width)} | ${padding}${'^'.repeat(caretLength)}`]
                : [row];
        })
        .join('\n');
};
