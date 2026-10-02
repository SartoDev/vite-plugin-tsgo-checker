# @sarto/vite-plugin-tsgo-checker

Vite plugin that type-checks your project with **tsgo** (the native TypeScript 7 compiler) and lints it with **Oxlint**, showing the results in a browser overlay and in the terminal.

- `vite dev`: tsgo runs in watch mode and Oxlint re-lints only the files you save. A badge shows the error/warning count and opens an overlay with one block per diagnostic: message, rule, a link that opens the file in your editor and a code frame.
- `vite build`: optionally runs both checks once and fails the build on errors.

Both tools run as child processes, so the dev server is never blocked.

## Requirements

- Node.js **22** or later
- Vite **5** or later
- `@typescript/native-preview` installed in your project (provides `tsgo`)
- `oxlint` installed in your project, if you enable linting

## Installation

```sh
npm install -D @sarto/vite-plugin-tsgo-checker @typescript/native-preview oxlint
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import tsgoChecker from '@sarto/vite-plugin-tsgo-checker';

export default defineConfig({
    plugins: [
        tsgoChecker({
            oxlint: { paths: ['src'] },
        }),
    ],
});
```

Type checking uses your `tsconfig.json` and linting uses your Oxlint config (`.oxlintrc.json`), both resolved from `root`. For type-aware lint rules, enable `options.typeAware` in the Oxlint config and install `oxlint-tsgolint`.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `oxlint` | `false \| { paths: string[] }` | `false` | Folders/files linted by Oxlint, relative to `root`. |
| `overlay` | `boolean \| OverlayOptions` | `true` | Badge and overlay in the browser during `vite dev`. |
| `terminal` | `boolean` | `true` | Prints diagnostics in the terminal that started Vite. |
| `enableBuild` | `boolean` | `true` | Also checks during `vite build`, failing the build on errors. |
| `root` | `string` | Vite's root | Root of the checked project (tsconfig, Oxlint config and `oxlint.paths`). |

### `OverlayOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `initialIsOpen` | `boolean \| 'error'` | `true` | Opens the overlay automatically: `true` on errors or warnings, `'error'` only on errors, `false` only through the badge. |
| `position` | `'tl' \| 'tr' \| 'bl' \| 'br'` | `'bl'` | Corner of the badge. |
| `badgeStyle` | `string` | — | Extra CSS for the badge, e.g. `display: none;` hides it. |
| `panelStyle` | `string` | — | Extra CSS for the overlay panel, e.g. `opacity: 0.8;`. |

The overlay closes with `Esc`, a click outside it or the `×` button; the badge reopens it.

## Notes

- If your build script already runs `tsgo` and your CI already runs `oxlint`, set `enableBuild: false` to avoid checking twice.
- Colors in the terminal follow `NO_COLOR` and `FORCE_COLOR`.
- tsgo does not report the length of a diagnostic span, so the `^^^` marker in its code frames covers the token at the reported column. Oxlint frames use the exact span.

## License

[ISC](./LICENSE)
