# Waypoint architecture

```
┌──────────────────────────────── Waypoint.exe (Rust, Tauri 2) ────────────────────────────────┐
│                                                                                               │
│  Main thread (Tauri)                    Runtime thread (MTA, owns the engine)                 │
│  ┌──────────────┐ invoke  ┌──────────┐  jobs  ┌───────────────────────┐  COM  ┌────────────┐  │
│  │ WebView2     │────────▶│ bridge.rs │──────▶│ Service                │◀────▶│ CoreAudio  │  │
│  │ React UI     │◀────────│ host/     │◀──────│  ├ Controller (output) │       │ System     │  │
│  └──────────────┘ "host"  └──────────┘ events │  ├ Controller (mics)   │       └────────────┘  │
│  window (on demand)        tray.rs            │  ├ settings, log       │  IMMDeviceEnumerator  │
│  single instance                              │  └ startup, shortcut   │  IMMNotificationClient│
│                                               └───────────────────────┘  IPolicyConfig        │
│  Native thread: hidden window → RegisterHotKey, resume-from-sleep, on-screen indicator (D2D)  │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Layout

| Path | Responsibility |
|---|---|
| `src-tauri/src/audio` | Core Audio through the `windows` crate: endpoint enumeration and classification, notifications, verified default switching (`IPolicyConfig`), volume, peak meters, the silent mic monitor, app sessions and per-app routing. `AudioSystem` is the trait the engine talks to. |
| `src-tauri/src/engine` | Everything Waypoint decides: the priority rules (`priority.rs`), one `Controller` per flow, the `Service` (profiles, hotkey actions, settings, snapshot) and the runtime thread. Tests use a fake audio system and a manual clock (`testing.rs`, `tests.rs`). |
| `src-tauri/src/persistence` | `settings.json` and `activity.jsonl` in `%APPDATA%\Waypoint` (the same format the earlier .NET app wrote, so updates keep everything), plus the one-time move from the old EchoLock folder. |
| `src-tauri/src/platform` | The sign-in task (Task Scheduler COM), the Start menu shortcut (`IShellLinkW`), and the native thread for hotkeys, power broadcasts and the on-screen indicator. |
| `src-tauri/src/host` | The Tauri app: window lifecycle, the UI bridge, the tray, notifications. |
| `ui/` | React 19 + TypeScript + Vite, Tailwind CSS v4 tokens, Motion, dnd-kit, Radix primitives, Zustand. |
| `ui/site` | The marketing website (separate Vite entry, `vite.site.config.ts`). Reuses the pals and riso styles; a build alias swaps the app store for `site/stubs/store.ts`, so no Windows bridge code ships with it. Builds to `ui/dist-site`. |

## Audio layer (`audio/`)

- `interop.rs` declares the undocumented `IPolicyConfig` (with an `IPolicyConfigVista` fallback) and the WinRT
  `IAudioPolicyConfigFactory` used for per-app routing. Only the slots Waypoint calls matter; the others exist to keep
  vtable indexes right.
- `CoreAudioSystem` enumerates endpoints in every state and reads names, form factor and the PnP enumerator
  (`BTHENUM`, `BTHHFENUM`, `USB`, `HDAUDIO`…) to classify transport and kind (`classifier.rs`). `set_default` sets the
  requested roles and then **polls `GetDefaultAudioEndpoint` for up to 2 s**; only a matching read counts as success.
- The `IMMNotificationClient` callback never calls back into COM. It copies the event and sends it to the runtime
  thread, as Microsoft's guidance requires.

## Runtime (`engine/`)

`Runtime` owns one MTA thread. COM notifications, timers, meter sampling (about 30 Hz, only while the window is
visible) and UI commands all run on it as messages, so the engine is single-threaded code with no locks. Delayed work
(debounces, settle delays, retries) is scheduled as plain `Task` values that come back to the service when due. That
is what lets the tests drive the engine with a manual clock.

`Service` owns two `Controller`s, one for outputs (render) and one for microphones (capture). It also owns profiles,
per-device volume, hotkey actions, global settings and the combined `RuntimeSnapshot`. Publishing is coalesced, so a
burst of changes produces one snapshot.

- **Profiles**: `settings.output`/`input` are the live rankings, and the active profile mirrors them on every save.
  Switching copies the target profile into the live settings and tells both controllers.
- **Volume**: `IAudioEndpointVolume`. A device's optional switch volume is applied right after a *verified* switch,
  and the level read back is what gets logged.
- **Hotkeys**: the native thread registers combinations and reports per-action status (registered / conflict) back
  into the snapshot. Presses call `Service::execute_hotkey`, which emits an `OsdMessage` for the on-screen indicator.

`Controller` implements the rules for its flow:

1. **Topology change** (debounced 250 ms): diff endpoint availability, log connects and disconnects, append unknown
   devices to the bottom of the priority list, and update the override lifecycle. Then schedule an evaluation: after
   the *settle delay* for connects, 400 ms for disconnects.
2. **Default change** (debounced 300 ms): ignore our own echo. If a topology change happened in the last 4 s it's
   Windows reacting, so just re-evaluate. Otherwise OFF logs it, BALANCED records an *external override*, and STRICT
   reverts it (subject to the loop guard).
3. **Evaluate**: the target is the pinned override if it's still available. Otherwise it's the first eligible device
   in priority order: available, not excluded, and not an auto-ignored Hands-Free or virtual endpoint. Switch only if
   the managed roles differ.
4. Failed switches after connects are retried twice, 1.5 s apart, because Bluetooth sometimes rejects the first attempt.

## Host (`host/`, `platform/`)

- **Window**: borderless. The web title bar and the invisible resize edges send `drag` messages. The caption uses
  Tauri's native drag; edges post `WM_NCLBUTTONDOWN` with the matching hit-test code on the UI thread, so Windows
  runs its own move and size loops (Aero Snap works).
- **Memory**: the window and its webview are created on first show (starting in the tray costs no browser memory).
  Closing to the tray *destroys* the webview and trims the working set, so the idle app is a few MB.
- **Bridge**: typed messages documented in `ui/src/bridge/protocol.ts`. The UI calls one command (`ui_message`). The
  host pushes `host` events: full snapshots after every change, activity entries, switch results and levels. The UI
  applies optimistic updates for mode, reorder and settings, and the next snapshot reconciles them.
- **Threads**: the runtime thread's output callback never waits on the main thread, which may itself be waiting on
  the runtime during startup. Window state it needs (focused, maximized) is mirrored in atomics, and tray updates are
  posted to the main thread.
- **Tray**: Tauri tray icon with a native menu covering open, profile, mode, quick switch, mic mute, restore and
  quit. It is rebuilt only when what it shows changes.
- **On-screen indicator**: a click-through layered window drawn with Direct2D and DirectWrite on the native thread. A
  webview just for this would cost about 100 MB while the app sits in the tray. Its resources are released after
  each fade-out.
- **Notifications**: Windows toasts under the AppUserModelID `app.waypoint.desktop`, which the host registers at
  startup (an unpackaged app's toasts are dropped otherwise).
- **Start with Windows**: a per-user Task Scheduler sign-in task named `Waypoint`, created through the COM API.
  Older Run-key entries are migrated.

## UI

Design language ("risograph zine"), defined as tokens in `ui/src/styles/index.css`:

- Layout: a masthead (the wordmark, an "issue" line with profile · mode · device, theme switch, window controls) with
  paper tabs on its rule for Devices / Microphones / Activity / Settings. Device pages open with the profile row, then
  the now-playing panel (the pal on a halftone sun and an ink disc, next to a paper card with the device name, a
  rubber-stamped connection, volume with live level bars, and the mode coins), then the "Setlist" priority list with
  big outlined rank numbers and dotted rules.
- Look: fluoro pink, federal blue and sunflower inks on cream paper (light) or plum stock (dark), a static paper grain,
  a faint halftone backdrop, and hard shadows offset like slightly misregistered plates. Token names (`lime` etc.) are
  kept from an earlier palette; `lime` is now the pink accent.
- Type: Bricolage Grotesque for display headings (clean ink with a soft pink offset plate), DM Sans for text, DM Mono
  for small uppercase labels. All fonts are bundled (no network).
- Sprites are re-inked to the theme: `Sprite` maps every artwork colour by lightness onto the line / paper / yellow /
  pink / blue inks (CSS variables, so they follow light and dark), and large sprites get a faint off-register plate.

Motion (Motion + CSS, all honouring `prefers-reduced-motion`; shared presets in `ui/src/lib/motion.ts`):

- **The wordmark** (`components/Wordmark.tsx`): tilted letters drop in one by one, then wave with an amplitude driven
  by the real output level; hover makes them jump and swap colours.
- **The pal** (`components/Pixel.tsx`): reads the real peak level outside React (rAF), bobbing and squashing while
  audio plays, blinking at random, dozing after 12 s of silence, zipping its mouth when muted and looking sad with no
  device; it hops when the device changes.
- **Level bars** (`components/LevelBars.tsx`): a scrolling history of the real peak level of the speakers or the mic.
  Windows only meters a microphone while something has it open, so while the Microphones page is visible the host
  keeps a silent shared-mode capture stream on the default mic (`AudioSystem::set_capture_monitor`; nothing is read).
- Page changes slide in like a sheet of paper; headings ease their pink plate into place; the art plates slide
  together and the connection stamp thunks down; setlist rows stagger in and the playing device gets a highlighter
  swipe; pixel bursts on mode changes and device switches.
- Drag-and-drop uses dnd-kit with pointer **and keyboard** sensors and custom screen-reader announcements; the lifted
  row becomes a tilted paper card, the empty slot a dashed pink outline, and hidden (disconnected) devices keep their
  absolute positions when the visible subset is reordered (`lib/order.ts`).

Theming: the `theme` setting ("system" | "light" | "dark") is owned by the host. The page sets `data-theme` on
`<html>`; light mode overrides the paper/ink tokens. Accent *text/borders* use separate `tx-*` tokens (deepened on
light for contrast) and text on fills uses `on-accent`. Theme changes animate with a soft circular wipe (View
Transitions) from the clicked control. The host resolves "system" from `AppsUseLightTheme` for the on-screen indicator; the page follows
`prefers-color-scheme` live.

Creatures: the cast is original pixel art drawn procedurally by `scripts/pals/build-pals.mjs` (shapes → 1px ink
outline → swappable faces), which writes `ui/src/pals/data.ts`. Every creature gets the same poses (idle, blink, sleep,
cheer, worried, alarm; Mikey the microphone also has sing / look / hush). `pals/Critter.tsx` plays clips at each
creature's frame rate with random blinks; `pals/Scenes.tsx` holds Mikey, who sings along to the real mic level.

The app icon (`scripts/make-icon.ps1`) and the on-screen indicator use the same 16×16 pixel mark and inks.
