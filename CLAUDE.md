# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What it is

ioBroker adapter for Sony Bravia (Android) Smart-TVs. It talks to the TV's REST API
(`http://<ip>/sony/<service>`, authenticated with a Pre-Shared Key in the `X-Auth-PSK` header), polls power,
playing content and volume, and sends remote control (IRCC) codes when button states are written.

## Commands

```bash
npm run build              # build-backend + build-admin
npm run build-backend      # tsc -p tsconfig.build.json: src/ -> build/ (gitignored, common.nogit: true)
npm run build-admin        # tsx tasks.ts: src-admin/ (vite, module federation) -> admin/custom/ (gitignored)
npm run 0-clean|1-npm|2-build|3-copy   # single steps of build-admin
npm run check              # type check only
npm run lint               # eslint (@iobroker/eslint-config); fix with: npx eslint -c eslint.config.mjs --fix src
npm test                   # = test:package
npm run test:integration   # starts a real js-controller, fails if one is already running on the machine
npm run translate          # translate admin/i18n/en.json into the other languages
```

There is no `prepare` script on purpose: the build only runs via `npm run build` and in CI (`build: true`).
`tasks.ts` builds the custom JsonConfig component (the remote control) from `src-admin/` into `admin/custom/`.
`src-admin/` is not linted / type-checked by the root config; check it with `cd src-admin && npx tsc`.
The integration test caches the test installation in `%TEMP%/test-iobroker.sony-bravia`: after changing
`io-package.json` (e.g. `messagebox`) delete that folder, otherwise the old instance object is used.

## Architecture

- `src/main.ts` — `SonyBraviaAdapter extends utils.Adapter`, compact-mode export at the end.
  - `onReady`: only starts if `ip` (not `0.0.0.0`) and `psk` are set. Creates `Bravia`, subscribes `*`,
    polls `checkStatus()` every 10 s, writes `info.modelInformation`, and creates the dynamic objects
    `avContent.<scheme>.<snake_title>` (buttons, `native.uri`), `avContent.<scheme>Selection` (value list,
    `native[<snake_title>] = uri`) and `appControl.app.<snake_title>` (buttons, `native.uri`).
  - `checkStatus()`: system `ping` (`src/lib/ping.ts`) → `info.connection`; if alive: `info.powerStatusActive`,
    `info.playingContentInfo` and `audio.volume.<target>.{volume,mute}` (objects created on the fly).
  - `onStateChange` (only `ack: false`), dispatched by ID:
    `info.powerStatusActive` → setPowerStatus; `.avContent.` → setPlayContent; `.appControl.terminateApps`;
    `.appControl.app.` → setActiveApp; `.audio.volume.*.mute` / `.volume`; **everything else** is sent as IRCC
    code — the last ID segment is the code (the static button states in `io-package.json` → `instanceObjects`
    are named by their IRCC code, e.g. `function.AAAAAQAAAAEAAAAvAw==`).
    avContent / apps / volume / terminateApps only work while `info.powerStatusActive` is true.
- `src/lib/bravia.ts` — `Bravia`: REST client (`axios`). `jsonRequest()` for `/sony/<service>` JSON-RPC,
  `request()` for `/sony/IRCC` (SOAP) and `ServiceProtocol.invoke()`. `send()` accepts raw IRCC codes or names
  (resolved via `system/getRemoteControllerInfo`) and waits `delay` ms after every code.
  `discover()` (SSDP, `node-ssdp` + `xml2js`) is not used by the adapter.
- `src/lib/service-protocol.ts` — generic `/sony/<service>` invoker (`getVersions`, `getMethodTypes`, `invoke`).
- `src/lib/ping.ts` — spawns the OS ping command (Linux/Windows/macOS/FreeBSD).
  - `onMessage` (`common.messagebox: true`) serves the remote control: `remoteInfo` → `{ apps, inputs }` (from the
    objects `appControl.app.*` / `avContent.extInput.*`), `remote` `{ key }` (IRCC code), `power` `{ on }`,
    `launchApp` / `input` `{ id }`. Answers `{ result: 'ok' }` or `{ error }`.
- `src-admin/src/RemoteControlComponent.tsx` — remote control in the "Remote control" tab of the settings
  (custom JsonConfig component, `guiApi: 2` = `@iobroker/gui-components`, needs admin 8). Keys are the raw IRCC
  codes also used by the button states in `io-package.json`. Status via subscriptions of `info.connection`,
  `info.powerStatusActive`, `info.playingContentInfo`. Texts in `src-admin/src/i18n` (`custom_sonybravia_*`).
- `src/lib/types.ts` — API payloads. `src/lib/adapter-config.d.ts` — typed `this.config`; must match `native`
  in `io-package.json` and `admin/jsonConfig.json`.

## Conventions

- Object IDs, roles, `native` keys and defaults must not change — existing installations depend on them.
- Timers only via `this.setTimeout` / `this.setInterval` (in `Bravia` via `adapter.setTimeout`) so they are
  cleared on unload.
- HTTP requests use `timeout` **and** `signal: AbortSignal.timeout()`: axios' `timeout` does not cover the
  TCP connect, `request` did.
- `psk` is a plain text field stored unencrypted in `native` (was always like this).
- Volume states are `type: 'string'` and the object names are German (`Volumen`, `Stumm`) — kept for compatibility.

## Release

`npm run release-patch|minor|major` (`@alcalzone/release-script`, plugins `iobroker`, `license`, `manual-review`).
Add changelog lines under `### **WORK IN PROGRESS**` in `README.md`; do not edit `common.news` by hand.
