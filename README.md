# Waypoint

**Audio-priority manager for Windows.** Rank your earbuds, headphones, speakers and monitors once — Waypoint keeps
the best available one as the Windows default output, switching automatically when devices connect or disconnect.

- Real-time device detection through the Windows Core Audio API (`IMMNotificationClient`)
- Drag-and-drop (and keyboard) priority ranking, per-device exclusions and renaming
- Three modes — **Off** (monitor), **Balanced** (switch on connect/disconnect, respect manual changes), **Strict** (always enforce)
- **Microphones** get their own priority list and mode (Off by default)
- **Profiles** ("Work", "Gaming"…) each keep their own output + microphone rankings and modes — switch from the
  Devices page, the tray, or a hotkey
- **A cast of original pixel creatures**: every profile gets a pal you pick (awake when active, dozing otherwise), a
  mascot on each switching mode, and Mikey the microphone, who sings along to your mic
- **Light, Dark or System theme** (System follows Windows live) — title-bar switch or Settings → Appearance
- **Volume per device**: live volume/mute for every connected device, plus an optional volume Waypoint applies whenever it switches to that device
- **Global shortcuts** (rebindable) with an on-screen indicator: next/previous output, restore priority, mute mic, cycle mode, next profile, show window
- Manual "Use now" selection, **Restore priority**, fallback on disconnect
- Every switch is **verified** by re-reading the default endpoint; failures are reported, never hidden
- Live level bars for the speakers and the microphone, activity timeline with export, tray menu, Start with Windows,
  single instance
- A risograph-zine look: pink, blue and yellow inks on cream paper (or plum in dark mode), with a masthead whose
  letters dance to what's playing

## Download and run

Waypoint is a single portable `.exe` — no installer. Each release has two downloads; both contain the same app:

| Download | Size | Use it if |
|---|---|---|
| `Waypoint-<version>-win-x64.zip` | about 60 MB | you're not sure — it has everything built in and runs on any PC |
| `Waypoint-<version>-win-x64-lite.zip` | under 1 MB | you already have the [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0) (if you don't, Windows offers to download it the first time you open Waypoint) |

1. **Check your PC**: Windows 10 (version 1809 or newer) or Windows 11, 64-bit. Waypoint draws its window with
   Microsoft Edge WebView2, which is already on Windows 11 and on almost every up-to-date Windows 10 PC. If Waypoint
   says it's missing, install the free
   [Evergreen WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) and start it again.
2. **Download** one of the zips above from the [latest release](https://github.com/Anish-Juyal-01/waypoint/releases/latest)
   (under **Assets**), then right-click it → **Extract All**. Inside is `Waypoint.exe`.
3. **Give it a permanent home** (optional, but do it if you'll use *Start with Windows*): make a folder such as
   `C:\Users\<you>\AppData\Local\Programs\Waypoint` or `C:\Tools\Waypoint` and move `Waypoint.exe` into it.
   *Start with Windows* remembers the exe's location, so it shouldn't stay in Downloads if you tidy that folder.
4. **Double-click `Waypoint.exe`.** The app isn't code-signed yet, so Windows SmartScreen may say
   *"Windows protected your PC"*. Click **More info → Run anyway** (only needed the first time). Some antivirus tools
   are suspicious of new unsigned single-file apps; the release notes list the file's SHA-256 so you can check it's the
   genuine build (`Get-FileHash .\Waypoint.exe` in PowerShell).
5. **Find it later**: Waypoint adds itself to the Start menu on first run, so typing "Waypoint" in Windows search
   opens it (turn this off in **Settings → Show in Start menu**).
6. **Rank your devices**: drag them into order on the **Devices** page. Waypoint switches to the highest one that's
   connected and keeps it that way. Do the same for mics on **Microphones** (mic switching starts **Off**).
7. Want it always running? **Settings → Start with Windows** (it adds a sign-in task in Task Scheduler, so it won't
   appear in Task Manager's *Startup apps* list). Closing the window keeps Waypoint in the tray (bottom
   right, near the clock); right-click the tray icon to switch output, profile or mode, or **Quit Waypoint**.

**Updating**: right-click the tray icon → **Quit Waypoint**, replace `Waypoint.exe` with the one from the new zip, start it again. Your rankings,
profiles and history live in `%APPDATA%\Waypoint` and are kept.

**Uninstalling**: turn off *Start with Windows* and *Show in Start menu*, quit from the tray, delete `Waypoint.exe`, and delete
`%APPDATA%\Waypoint` and `%LOCALAPPDATA%\Waypoint` if you also want your settings gone.

## Build from source

You only need this to change the code. Requirements: Windows 10/11 x64, .NET SDK 10, Node.js 20+.

```powershell
# Full pipeline: UI build + tests + publish → dist\Waypoint.exe, dist\lite\Waypoint.exe and the release zips in dist\release
./scripts/build.ps1

# Day-to-day development
dotnet run --project src/Waypoint.App          # builds the UI automatically if ui/dist is missing

# UI with hot reload inside the real app
cd ui; npm install; npm run dev                 # terminal 1
$env:WAYPOINT_DEV_URL = "http://localhost:5173"
dotnet run --project src/Waypoint.App -p:SkipUiBuild=true   # terminal 2
```

Opening `http://localhost:5173` in a normal browser shows the UI with **sample data** (clearly bannered as a preview);
it is only for design work and is never used inside the app.

### Website

The landing page lives in `ui/site`. It reuses the app's pixel pals and riso styles, but nothing from it ships
inside `Waypoint.exe`.

```powershell
cd ui
npm run dev:site            # http://localhost:5176 with hot reload
npm run build:site          # static site in ui/dist-site
```

To host it on Vercel, import the repo and set the project's root directory to `ui`. `ui/vercel.json` has the build
settings. The site's download buttons point at `releases/latest/download/Waypoint.exe`, so every release needs an
asset named exactly `Waypoint.exe` alongside the zips.

### Tests

```powershell
dotnet test                 # engine rules, persistence, classifier (xUnit)
cd ui; npm test             # reorder logic (Vitest)
```

### Diagnostics CLI

`waypoint-cli` (published to `dist\tools`) talks to the same audio layer and is handy for verifying behaviour
independently of the UI:

```powershell
waypoint-cli list               # endpoints, state, transport, current default per role
waypoint-cli switch 5 --comm    # set default (verified), including the Communications role
waypoint-cli props 5            # dump an endpoint's property store
waypoint-cli volume 5 40        # read or set volume (or: mute / unmute)
waypoint-cli watch              # stream endpoint notifications
```

Add `--input` to any command to work with microphones.

## Default shortcuts

| Action | Shortcut |
|---|---|
| Next / previous output | Ctrl+Alt+F9 / Ctrl+Alt+F8 |
| Restore priority | Ctrl+Alt+F10 |
| Mute / unmute microphone | Ctrl+Alt+F11 |
| Cycle mode (Off → Balanced → Strict) | Ctrl+Alt+F7 |
| Next profile | Ctrl+Alt+F6 |
| Show / hide Waypoint | not set |

Change them in **Settings → Keyboard shortcuts** (click a shortcut, press the new keys; Backspace clears). If another
program already owns a combination, Windows refuses it and Waypoint shows **In use** instead of pretending it works.

## How the modes work

| Mode | Device connects | Device disconnects | You change output elsewhere | You pick in Waypoint |
|---|---|---|---|---|
| **Off** | nothing | nothing | logged | switches once |
| **Balanced** | switch to best (after settle delay) | fall back to next best | respected until the next device connects | held until the next device connects |
| **Strict** | switch to best | fall back to next best | **reverted** | pinned until *Restore priority* or that device disconnects |

- **Settle delay** (default 1.5 s): Bluetooth endpoints report *active* before audio is ready; Waypoint waits before switching.
- **Hands-Free endpoints** (`Headset (… Hands-Free)`) are ignored by default — they're the low-quality call profile of the same earbuds.
- **Loop protection**: if another program changes the output more than 5 times in 30 s, Strict pauses for 60 s instead of fighting it.
- When Windows changes the default *because* a device connected or disconnected, Waypoint treats it as a system reaction, not a manual choice.
- **Microphones**: Bluetooth earbuds/headsets only expose their mic through the Hands-Free profile, and using it switches
  their playback to low-quality call audio. Microphone switching is therefore Off by default; rank a USB or built-in mic first.

## Apps that don't follow (Discord, Teams, Zoom…)

Waypoint changes the Windows default device. Apps whose audio setting is **Default** follow it instantly (browsers,
YouTube, most games). Apps that picked a **specific** device in their own settings keep using it — Windows can't move
them. A few seconds after every switch Waypoint checks which apps are still playing (or recording) on another device
and shows them on the Devices page:

- **Chosen inside the app** (e.g. Discord → User Settings → Voice & Video → Output Device = a specific device): Waypoint
  shows the exact steps. Set it to **Default** once and the app follows Waypoint from then on.
- **Pinned by Windows' per-app setting** (Settings → System → Sound → Volume mixer): click **Let it follow** to clear
  the pin (uses the same per-app routing API as EarTrumpet; the result is read back and re-checked).

`waypoint-cli sessions` lists which app is on which device and whether Windows pins it.

## Data & privacy

Everything stays on the PC:

- `%APPDATA%\Waypoint\settings.json` — modes, priority lists, profiles, exclusions, names, switch volumes, shortcuts
- `%APPDATA%\Waypoint\activity.jsonl` — activity log (last 2000 entries)
- `%LOCALAPPDATA%\Waypoint\WebView2` — UI cache
- Start with Windows: a per-user Task Scheduler task named **Waypoint** that runs at sign-in (no admin rights).
  Windows' older "Run" registry list can skip newly added apps for days, so Waypoint doesn't use it.
- Microphone: Windows only reports a mic's level while some app has it open, so while the **Microphones** page is on
  screen Waypoint opens the default mic silently to draw its level bars (Windows shows its "microphone in use" icon).
  Nothing is recorded or saved, and it's closed as soon as you leave the page or hide the window.

## Known limitations

- Changing the default device relies on `IPolicyConfig`, an **undocumented** Windows interface (the same one the Sound
  control panel uses). It has been stable since Windows 7, but if a future Windows build breaks it Waypoint detects
  the failure, shows *Switching unavailable*, and keeps monitoring — it never reports a switch it couldn't verify.
- Per-app output routing (Settings › Volume mixer) is not managed; Waypoint sets the system default for the
  Console, Multimedia and (optionally) Communications roles.
- Bluetooth battery levels are not shown (no public API for all devices).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## License

MIT — see [LICENSE](LICENSE). Third-party libraries and fonts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
