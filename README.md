# SolRadar Helper

> **Unofficial tool.** SolRadar Helper is not made by, affiliated with, or endorsed by Vencord or Discord.

SolRadar Helper installs, updates and removes [SolRadar](https://gitlab.com/masutty/solradar), a Vencord plugin, for people who don't want to use a terminal.

Vencord only supports custom plugins through a source build. This Helper automates that workflow:

1. It downloads Vencord's official source code.
2. It adds SolRadar to it.
3. It builds Vencord.
4. It patches Discord using Vencord's own installer.

## Download and first launch

1. Download `SolRadarHelper.exe` from the [latest release](https://github.com/masutty/solradar-helper/releases/latest).
2. Open it.
   - Windows may show **"Windows protected your PC"**, because the Helper is not code-signed. Click **More info**, then **Run anyway**.
3. Follow the screen.
   - If Git or Node.js is missing, click **Install automatically**. Windows may ask for permission; click **Yes**.
   - You can also follow the manual steps shown for each requirement.

## What it does to your computer

- It keeps its files in `%LOCALAPPDATA%\SolRadarHelper`: a copy of Vencord's source with SolRadar inside, plus logs.
- It patches your Discord installation with Vencord's official installer, the same way `pnpm inject` does.
- **Uninstall removes Vencord from Discord completely**, not only SolRadar. To go back to regular Vencord, use the [official Vencord Installer](https://vencord.dev/download/).
- It never asks for, reads or stores your Discord account, token or password. It sends no telemetry.

## Getting help

Click **Generate a debug report** and send the resulting file when asked.
- **Hide personal information** is on by default. It removes your Windows user name, computer name, email addresses and anything that looks like a Discord token.

## Development

Requires [Bun](https://bun.sh) on Windows.

```sh
bun install
bun run dev        # run from source
bun test           # unit tests
bun run typecheck
bun run build      # → dist/SolRadarHelper.exe
```

Design notes live in `docs/` (not versioned).
