import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { CheckerDiagnostic } from './index.js';

const DEBOUNCE_MS = 300;
const LINTABLE = /\.(c|m)?(j|t)sx?$/;

type OxlintOutput = {
    diagnostics: {
        message: string;
        code: string;
        severity: 'error' | 'warning' | 'advice';
        filename: string;
        labels?: { span: { line: number; column: number; length: number } }[];
    }[];
};

const resolveOxlint = (root: string) => {
    const require = createRequire(path.join(root, 'package.json'));
    const manifest = require.resolve('oxlint/package.json');
    const { bin } = require('oxlint/package.json') as { bin: Record<string, string> };
    return path.join(path.dirname(manifest), bin.oxlint);
};

// `eslint(no-var)` -> `no-var`; `react(jsx-key)` -> `react/jsx-key`.
const ruleName = (code: string) => {
    const [, plugin, rule] = /^(.+)\((.+)\)$/.exec(code) ?? [];
    if (!rule) return code;
    return plugin === 'eslint' ? rule : `${plugin}/${rule}`;
};

/** Runs Oxlint once on `targets` (relative to `root`). */
export const lintOnce = (root: string, targets: string[]) =>
    new Promise<CheckerDiagnostic[]>((resolve, reject) => {
        const oxlint = spawn(process.execPath, [resolveOxlint(root), '-f', 'json', ...targets], {
            cwd: root,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        oxlint.stdout.setEncoding('utf8').on('data', (chunk: string) => {
            stdout += chunk;
        });
        oxlint.stderr.setEncoding('utf8').on('data', (chunk: string) => {
            stderr += chunk;
        });
        oxlint.on('error', reject);
        oxlint.on('close', () => {
            try {
                const { diagnostics } = JSON.parse(stdout) as OxlintOutput;
                resolve(
                    diagnostics.map((d) => ({
                        source: 'oxlint',
                        file: d.filename.split(path.sep).join('/'),
                        line: d.labels?.[0]?.span.line ?? 1,
                        column: d.labels?.[0]?.span.column ?? 1,
                        severity: d.severity === 'error' ? 'error' : 'warning',
                        code: ruleName(d.code),
                        message: d.message,
                        length: d.labels?.[0]?.span.length,
                    }))
                );
            } catch {
                reject(new Error(stderr.trim() || stdout.trim() || 'oxlint produced no output'));
            }
        });
    });

/**
 * Lints `paths` once, then only the files passed to `change` (batched). `onUpdate` always receives
 * the diagnostics of every file.
 */
export const watchOxlint = (
    root: string,
    paths: string[],
    onUpdate: (diagnostics: CheckerDiagnostic[]) => void,
    onError: (error: Error) => void
) => {
    const byFile = new Map<string, CheckerDiagnostic[]>();
    const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
    const publish = () => onUpdate([...byFile.values()].flat());

    const store = (files: string[], diagnostics: CheckerDiagnostic[]) => {
        files.forEach((file) => byFile.delete(file));
        diagnostics.forEach((d) => byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]));
    };

    const inScope = (file: string) =>
        LINTABLE.test(file) &&
        paths.some((p) => {
            const dir = relative(path.resolve(root, p));
            return file === dir || file.startsWith(`${dir}/`);
        });

    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<void> = lintOnce(root, paths)
        .then((diagnostics) => {
            store([], diagnostics);
            publish();
        })
        .catch(onError);

    const flush = () => {
        const batch = [...pending];
        pending = new Set();
        // One batch at a time; each waits for the previous one (and for the initial full lint).
        running = running.then(async () => {
            try {
                store(batch, await lintOnce(root, batch));
                publish();
            } catch (error) {
                onError(error as Error);
            }
        });
    };

    return {
        change(absolute: string) {
            const file = relative(absolute);
            if (!inScope(file)) return;
            pending.add(file);
            clearTimeout(timer);
            timer = setTimeout(flush, DEBOUNCE_MS);
        },
        unlink(absolute: string) {
            const file = relative(absolute);
            pending.delete(file);
            if (byFile.delete(file)) publish();
        },
        stop() {
            clearTimeout(timer);
        },
    };
};
