import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Plugin } from 'vite';

import { codeFrame } from './frame.js';
import { lintOnce, watchOxlint } from './oxlint.js';
import { formatDiagnostic, formatSummary } from './terminal.js';

export type CheckerDiagnostic = {
    source: 'tsgo' | 'oxlint';
    /** Relative to `root`. */
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning';
    code: string;
    message: string;
    /** Length of the reported span, when the tool provides it (tsgo does not). */
    length?: number;
};

export type OverlayOptions = {
    /**
     * Opens the overlay automatically.
     * - `true`: when there are errors or warnings
     * - `'error'`: only when there are errors
     * - `false`: only through the badge
     * @default true
     */
    initialIsOpen?: boolean | 'error';
    /**
     * Corner of the badge that opens the overlay.
     * @default 'bl'
     */
    position?: 'tl' | 'tr' | 'bl' | 'br';
    /** Extra CSS for the badge (`HTMLElement.style` format), e.g. `display: none;` hides it. */
    badgeStyle?: string;
    /** Extra CSS for the overlay panel (`HTMLElement.style` format), e.g. `opacity: 0.8;`. */
    panelStyle?: string;
};

export type TsgoCheckerOptions = {
    /**
     * Folders/files linted by Oxlint, relative to `root`, using the project's own config
     * (`.oxlintrc.json`). `false` disables Oxlint.
     * @default false
     */
    oxlint?: false | { paths: string[] };
    /**
     * Badge + overlay in the browser during `vite dev`. `false` disables it.
     * @default true
     */
    overlay?: boolean | OverlayOptions;
    /**
     * Prints diagnostics in the terminal that started Vite.
     * @default true
     */
    terminal?: boolean;
    /**
     * Also checks during `vite build`, failing the build on errors.
     * @default true
     */
    enableBuild?: boolean;
    /**
     * Root of the checked project (tsconfig, Oxlint config and `oxlint.paths`).
     * @default Vite's root
     */
    root?: string;
};

export type ClientOptions = Required<OverlayOptions>;

export type ClientDiagnostic = CheckerDiagnostic & { absoluteFile: string; frame: string };

export type CheckerPayload = {
    errors: number;
    warnings: number;
    diagnostics: ClientDiagnostic[];
} | null;

const EVENT = 'tsgo-checker';
const CLIENT_ID = '/@tsgo-checker/client';
const TSGO_DIAGNOSTIC = /^(.+)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
const TSGO_SUMMARY = /Found \d+ errors?/;

const countErrors = (list: CheckerDiagnostic[]) =>
    list.filter((d) => d.severity === 'error').length;

type Log = { error(msg: string): void; warn(msg: string): void; info(msg: string): void };

const report = (
    log: Log,
    root: string,
    source: CheckerDiagnostic['source'],
    list: CheckerDiagnostic[]
) => {
    list.forEach((d) => log[d.severity === 'error' ? 'error' : 'warn'](formatDiagnostic(d, root)));
    log.info(formatSummary(source, list));
};

// Spawns the platform binary directly: killing the `bin/tsgo` Node wrapper would orphan it.
const resolveTsgo = (root: string) =>
    path.join(
        path.dirname(
            createRequire(path.join(root, 'package.json')).resolve(
                `@typescript/native-preview-${process.platform}-${process.arch}/package.json`
            )
        ),
        `lib/tsgo${process.platform === 'win32' ? '.exe' : ''}`
    );

const runTsgo = (
    root: string,
    args: string[],
    onRound: (diagnostics: CheckerDiagnostic[]) => void
) => {
    // `--pretty false`: with FORCE_COLOR set, tsgo switches to its pretty format, which
    // TSGO_DIAGNOSTIC does not parse.
    const tsgo = spawn(resolveTsgo(root), ['--noEmit', '--pretty', 'false', ...args], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    let round: CheckerDiagnostic[] = [];
    const lines = createInterface({ input: tsgo.stdout });
    lines.on('line', (line) => {
        const match = TSGO_DIAGNOSTIC.exec(line);
        if (match) {
            const [, file, row, column, severity, code, message] = match;
            round.push({
                source: 'tsgo',
                file,
                line: Number(row),
                column: Number(column),
                severity: severity as CheckerDiagnostic['severity'],
                code,
                message,
            });
        } else if (/^\s/.test(line) && round.length) {
            round[round.length - 1].message += `\n${line}`;
        } else if (TSGO_SUMMARY.test(line) && args.includes('--watch')) {
            onRound(round);
            round = [];
        }
    });
    if (!args.includes('--watch')) lines.on('close', () => onRound(round));
    return tsgo;
};

export default function tsgoChecker(options: TsgoCheckerOptions = {}): Plugin {
    const { oxlint = false, overlay = true, terminal = true, enableBuild = true } = options;
    const overlayOptions: ClientOptions | null = overlay
        ? {
              initialIsOpen: true,
              position: 'bl',
              badgeStyle: '',
              panelStyle: '',
              ...(overlay === true ? {} : overlay),
          }
        : null;

    let root = '';
    let isServe = false;

    return {
        name: 'tsgo-checker',
        configResolved(config) {
            root = options.root ? path.resolve(config.root, options.root) : config.root;
            isServe = config.command === 'serve';
        },
        resolveId: (id) => (id === CLIENT_ID ? id : undefined),
        load: (id) =>
            id === CLIENT_ID && overlayOptions
                ? `const OPTIONS = ${JSON.stringify(overlayOptions)};\n${fs.readFileSync(
                      new URL('./client.js', import.meta.url),
                      'utf8'
                  )}`
                : undefined,
        transformIndexHtml: () =>
            isServe && overlayOptions
                ? [{ tag: 'script', attrs: { type: 'module', src: CLIENT_ID }, injectTo: 'body' }]
                : undefined,

        configureServer(server) {
            const { logger } = server.config;
            const bySource: Record<CheckerDiagnostic['source'], CheckerDiagnostic[]> = {
                tsgo: [],
                oxlint: [],
            };

            // Tabs opened or reloaded after a check ask for the latest result.
            let last: CheckerPayload = null;
            server.ws.on(`${EVENT}:sync`, (_data, client) => last && client.send(EVENT, last));

            const publish = () => {
                if (!overlayOptions) return;
                const all = Object.values(bySource).flat();
                const payload: CheckerPayload = all.length
                    ? {
                          errors: countErrors(all),
                          warnings: all.length - countErrors(all),
                          diagnostics: all.map((d) => {
                              const absoluteFile = path.resolve(root, d.file);
                              return {
                                  ...d,
                                  absoluteFile,
                                  frame: codeFrame(absoluteFile, d.line, d.column, d.length),
                              };
                          }),
                      }
                    : null;
                if (payload || last) server.ws.send(EVENT, payload);
                last = payload;
            };

            const tsgo = runTsgo(root, ['--watch', '--preserveWatchOutput'], (round) => {
                bySource.tsgo = round;
                if (terminal) report(logger, root, 'tsgo', round);
                publish();
            });

            const oxlintWatch = oxlint
                ? watchOxlint(
                      root,
                      oxlint.paths,
                      (diagnostics) => {
                          bySource.oxlint = diagnostics;
                          if (terminal) report(logger, root, 'oxlint', diagnostics);
                          publish();
                      },
                      (error) => logger.error(`[oxlint] ${error.message}`)
                  )
                : undefined;
            if (oxlintWatch) {
                server.watcher.on('add', oxlintWatch.change);
                server.watcher.on('change', oxlintWatch.change);
                server.watcher.on('unlink', oxlintWatch.unlink);
            }

            const stop = () => {
                tsgo.kill();
                oxlintWatch?.stop();
            };
            server.httpServer?.once('close', stop);
            process.once('exit', stop);
        },

        async buildStart() {
            if (isServe || !enableBuild) return;
            const [tsgoDiagnostics, oxlintDiagnostics] = await Promise.all([
                new Promise<CheckerDiagnostic[]>((resolve) => {
                    runTsgo(root, [], resolve);
                }),
                oxlint ? lintOnce(root, oxlint.paths) : Promise.resolve([]),
            ]);
            // Plain console: Rollup's `this.warn` would prefix every line of the block.
            const log: Log = { error: console.error, warn: console.warn, info: console.log };
            if (terminal) {
                report(log, root, 'tsgo', tsgoDiagnostics);
                if (oxlint) report(log, root, 'oxlint', oxlintDiagnostics);
            }
            const errors = countErrors(tsgoDiagnostics) + countErrors(oxlintDiagnostics);
            if (errors) this.error(`tsgo-checker: found ${errors} type/lint error(s)`);
        },
    };
}
