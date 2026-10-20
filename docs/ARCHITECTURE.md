# Waypoint architecture

```
┌──────────────────────────── Waypoint.exe (WPF, .NET 10) ────────────────────────────┐
│                                                                                       │
│  UI thread (STA)                          Runtime thread (MTA, actor)                 │
│  ┌──────────────┐  JSON   ┌───────────┐   ┌──────────────────────┐  COM  ┌──────────┐ │
│  │ WebView2     │◀──────▶│ UiBridge   │──▶│ WaypointRuntime       │◀─────▶│CoreAudio │ │
│  │ React UI     │ post-   └───────────┘   │  └ PriorityController │       │ System   │ │
│  └──────────────┘ Message ┌───────────┐   │     (mode rules)      │       └──────────┘ │
│  MainWindow (borderless)  │ Tray      │──▶│  SettingsStore        │  IMMDeviceEnumerator│
│  SingleInstance           │ NotifyIcon│   │  ActivityLog          │  IMMNotificationClient
│                           └───────────┘   └──────────────────────┘  IPolicyConfig      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

## Projects

| Project | Responsibility |
|---|---|
| `src/Waypoint.Core` | Everything that isn't UI: Core Audio interop, endpoint classification, the priority engine and controller, settings/log persistence, startup registration. No WPF dependency. |
| `src/Waypoint.App` | Composition root, borderless WPF window hosting WebView2, the JSON bridge, tray icon, single-instance handling. Embeds `ui/dist`. |
| `src/Waypoint.Cli` | `waypoint-cli` diagnostics built on Core. |
| `tests/Waypoint.Core.Tests` | xUnit tests with a fake audio system and a deterministic scheduler. |
| `ui/` | React 19 + TypeScript + Vite, Tailwind CSS v4 tokens, Motion, dnd-kit, Radix primitives, Zustand. |
| `ui/site` | The marketing website (separate Vite entry, `vite.site.config.ts`). Reuses the pals and riso styles; a build alias swaps the app store for `site/stubs/store.ts`, so no Windows bridge code ships with it. Builds to `ui/dist-site`. |

## Audio layer (`Core/Audio`)

- `Interop/CoreAudioInterop.cs` — hand-written `[ComImport]` definitions for the documented MMDevice API.
- `Interop/PolicyConfig.cs` — the undocumented `IPolicyConfig` (Win7+) with an `IPolicyConfigVista` fallback.
  Only `SetDefaultEndpoint` is called; preceding vtable slots exist only to keep the slot index right.
- `CoreAudioSystem` — enumerates render endpoints (all states), reads friendly/adapter names, form factor and the
  PnP enumerator (`BTHENUM`, `BTHHFENUM`, `USB`, `HDAUDIO`…) to classify transport and kind. `SetDefault` sets the
  requested roles and then **polls `GetDefaultAudioEndpoint` for up to 2 s**; only a matching read is a success.
  Also provides the live peak meter (`IAudioMeterInformation`).
- Notification callbacks never call back into COM; they just enqueue work for the runtime thread (per Microsoft's guidance).

## Runtime (`Core/Engine`)

`WaypointRuntime` owns one MTA thread and a work queue. COM notifications, timers (via `IRuntimeScheduler`), meter
sampling and UI commands are all marshalled onto it, so the engine is lock-free single-threaded code.

`WaypointService` owns two `PriorityController`s — one for outputs (render), one for microphones (capture) — plus
profiles, per-device volume, hotkey actions, global settings and the combined `RuntimeSnapshot`. Snapshot publishing
is coalesced so a burst of changes produces one update.

- **Profiles**: `AppSettings.Output`/`Input` are the live rankings; the active `Profile` mirrors them on every save.
  Switching copies the target profile into the live objects and calls `OnSettingsReplaced` on both controllers.
- **Volume**: `IAudioEndpointVolume` (documented). A device's optional `SwitchVolume` is applied right after a
  *verified* switch and the level read back is what gets logged.
- **Hotkeys**: the host registers combinations with `RegisterHotKey` on a message-only window and reports per-action
  status (registered / conflict) back into the snapshot; presses call `WaypointService.ExecuteHotkey`, which emits an
  `OsdMessage` for the on-screen indicator.

`PriorityController` implements the rules for its flow:

1. **Topology change** (debounced 250 ms): diff endpoint availability, log connects/disconnects, append unknown
   devices to the bottom of the priority list, update override lifecycle, then schedule an evaluation —
   after the *settle delay* for connects, 400 ms for disconnects.
2. **Default change** (debounced 300 ms): ignore our own echo; if a topology change happened in the last 4 s it's
   Windows reacting, so just re-evaluate; otherwise OFF logs it, BALANCED records an *external override*, STRICT
   reverts it (subject to the loop guard).
3. **Evaluate**: target = pinned override if still available, else first eligible (available, not excluded, not an
   auto-ignored Hands-Free/virtual endpoint) device in priority order. Switch only if the managed roles differ.
4. Failed switches after connects are retried twice (1.5 s apart) — Bluetooth sometimes rejects the first attempt.

`PriorityEngine` holds the pure functions (target selection, merging new devices, reordering), all unit-tested.

## Host (`Waypoint.App`)

- **Window**: `WindowStyle=None` + `WindowChrome`; DWM rounded corners and dark border. The web title bar and
  invisible resize edges send `drag` messages; the host replies with `WM_NCLBUTTONDOWN` (HTCAPTION / HTLEFT…) so
  Windows runs its native move/size loop (Aero Snap works). `WM_GETMINMAXINFO` keeps maximize inside the work area.
- **WebView2** is created on first show (start-in-tray costs no browser memory), serves the embedded bundle from
  `https://waypoint.local/` via `WebResourceRequested`, blocks external navigation, disables context menus, zoom,
  autofill and (in Release) DevTools. When hidden to the tray the WebView is suspended and the meter stops.
- **Bridge**: typed messages documented in `ui/src/bridge/protocol.ts`. The host pushes full snapshots after every
  change; the UI applies optimistic updates for mode/reorder/settings and is reconciled by the next snapshot.
- **Tray**: dark `ContextMenuStrip` built on open from the last snapshot — mode, quick switch, restore, quit.
  Balloon notifications for verified switches and for failures.

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
  keeps a silent shared-mode capture stream on the default mic (`IAudioSystem.SetCaptureMonitor`; nothing is read).
- Page changes slide in like a sheet of paper; headings ease their pink plate into place; the art plates slide
  together and the connection stamp thunks down; setlist rows stagger in and the playing device gets a highlighter
  swipe; pixel bursts on mode changes and device switches.
- Drag-and-drop uses dnd-kit with pointer **and keyboard** sensors and custom screen-reader announcements; the lifted
  row becomes a tilted paper card, the empty slot a dashed pink outline, and hidden (disconnected) devices keep their
  absolute positions when the visible subset is reordered (`lib/order.ts`).

Theming: `AppSettings.Theme` ("system" | "light" | "dark") is owned by the host. The page sets `data-theme` on
`<html>`; light mode overrides the paper/ink tokens. Accent *text/borders* use separate `tx-*` tokens (deepened on
light for contrast) and text on fills uses `on-accent`. Theme changes animate with a soft circular wipe (View
Transitions) from the clicked control. The host resolves "system" from `AppsUseLightTheme`, listens for Windows
changes, and themes the DWM frame, pre-paint background, on-screen indicator and tray menu to match.

Creatures: the cast is original pixel art drawn procedurally by `scripts/pals/build-pals.mjs` (shapes → 1px ink
outline → swappable faces), which writes `ui/src/pals/data.ts`. Every creature gets the same poses (idle, blink, sleep,
cheer, worried, alarm; Mikey the microphone also has sing / look / hush). `pals/Critter.tsx` plays clips at each
creature's frame rate with random blinks; `pals/Scenes.tsx` holds Mikey, who sings along to the real mic level.

The app icon (`scripts/make-icon.ps1`) and the WPF on-screen indicator use the same 16×16 pixel mark and inks.
