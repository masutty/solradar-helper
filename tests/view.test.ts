import { expect, test } from "bun:test";
import { deriveView } from "../src/app/view";
import type { Snapshot } from "../src/app/snapshot";
import type { UpdateInfo } from "../src/services/updates";

const stable = { branch: "stable" as const, label: "Discord", root: "C:\\L\\Discord", appDir: "C:\\L\\Discord\\app-1", exe: "Discord.exe" };
const ptb = { ...stable, branch: "ptb" as const, label: "Discord PTB" };

function snap(over: Partial<Snapshot> = {}): Snapshot {
    return {
        dependencies: [{ id: "git", state: "ok", version: "2.45.1" }, { id: "node", state: "ok", version: "24.21.0" }],
        wingetAvailable: true,
        discord: { installs: [stable], selected: stable, running: false, injection: "not-injected" },
        vencord: { state: "absent", built: false },
        solradar: { state: "absent" },
        ...over,
    };
}
const installed = (): Partial<Snapshot> => ({
    discord: { installs: [stable], selected: stable, running: false, injection: "injected" },
    vencord: { state: "ready", commit: "abc1234def", built: true },
    solradar: { state: "ready", commit: "p1", version: "1.3.6" },
});

test("fresh machine: not installed, Install enabled", () => {
    const v = deriveView(snap(), null);
    expect(v.headline).toBe("SolRadar is not installed");
    expect(v.actions).toEqual({ install: true, update: false, uninstall: false, repair: false });
});

test("missing dependency blocks Install and offers auto-install", () => {
    const v = deriveView(snap({ dependencies: [{ id: "git", state: "missing" }, { id: "node", state: "ok", version: "24.0.0" }] }), null);
    expect(v.actions.install).toBe(false);
    expect(v.subline).toContain("missing");
    expect(v.dependencies[0]).toMatchObject({ id: "git", state: "missing", canAutoInstall: true });
    expect(v.dependencies[1]!.canAutoInstall).toBe(false);
});

test("no winget: no auto-install button", () => {
    const v = deriveView(snap({ wingetAvailable: false, dependencies: [{ id: "git", state: "missing" }, { id: "node", state: "ok" }] }), null);
    expect(v.dependencies[0]!.canAutoInstall).toBe(false);
});

test("no Discord", () => {
    const v = deriveView(snap({ discord: { installs: [], running: false, injection: "not-injected" } }), null);
    expect(v.headline).toBe("Discord was not found");
    expect(v.tone).toBe("error");
    expect(v.actions.install).toBe(false);
});

test("fully installed, up to date", () => {
    const up: UpdateInfo = { vencord: { local: "abc1234def", remote: "abc1234def" }, solradar: { localCommit: "p1", remoteCommit: "p1", localVersion: "1.3.6", remoteVersion: "1.3.6" }, helper: { current: "0.1.0" }, failed: false };
    const v = deriveView(snap(installed()), up);
    expect(v.headline).toBe("SolRadar is installed");
    expect(v.installed).toBe(true);
    expect(v.solradar.label).toBe("Version 1.3.6");
    expect(v.actions).toEqual({ install: false, update: true, uninstall: true, repair: false });
});

test("update available shows versions; failed check still allows Update", () => {
    const u: UpdateInfo = { vencord: { local: "abc1234def", remote: "abc1234def" }, solradar: { localCommit: "p1", remoteCommit: "p2", localVersion: "1.3.6", remoteVersion: "1.4.0" }, helper: { current: "0.1.0", latest: "0.2.0" }, failed: false };
    const v = deriveView(snap(installed()), u);
    expect(v.headline).toBe("An update is available");
    expect(v.updateText).toBe("SolRadar 1.3.6 → 1.4.0");
    expect(v.helperUpdate).toEqual({ latest: "0.2.0", url: "https://github.com/masutty/solradar-helper" });

    const failed = deriveView(snap(installed()), { ...u, solradar: { localCommit: "p1" }, vencord: { local: "x" }, helper: { current: "0.1.0" }, failed: true });
    expect(failed.subline).toBe("Couldn't check for updates.");
    expect(failed.actions.update).toBe(true);
});

test("partial install and official Vencord", () => {
    expect(deriveView(snap({ vencord: { state: "ready", built: true } }), null).headline).toBe("SolRadar is not fully installed");
    const other = deriveView(snap({ discord: { installs: [stable], selected: stable, running: false, injection: "injected-elsewhere" } }), null);
    expect(other.headline).toBe("Discord is using a different Vencord");
    expect(other.actions.install).toBe(true);
    expect(other.actions.uninstall).toBe(false);
});

test("modified checkout needs repair and blocks install/update", () => {
    const v = deriveView(snap({ ...installed(), vencord: { state: "modified", built: true } }), null);
    expect(v.headline).toBe("SolRadar needs a repair");
    expect(v.actions).toMatchObject({ install: false, update: false, repair: true });
});

test("multiple Discord installs are listed for selection", () => {
    const v = deriveView(snap({ discord: { installs: [stable, ptb], selected: ptb, running: true, injection: "not-injected" } }), null);
    expect(v.discord.branches.map(b => b.branch)).toEqual(["stable", "ptb"]);
    expect(v.discord.selected).toBe("ptb");
    expect(v.discord.running).toBe(true);
    expect(v.discord.label).toBe("Discord PTB is running");
});

const upToDate = (): UpdateInfo => ({ vencord: { local: "abc1234def", remote: "abc1234def" }, solradar: { localCommit: "p1", remoteCommit: "p1", localVersion: "1.3.6", remoteVersion: "1.3.6" }, helper: { current: "0.1.0" }, failed: false });

test("update label: Reinstall only when installed and the check found nothing", () => {
    expect(deriveView(snap(installed()), upToDate()).updateLabel).toBe("Reinstall");
    const changed = { ...upToDate(), solradar: { ...upToDate().solradar, remoteCommit: "p2" } };
    expect(deriveView(snap(installed()), changed).updateLabel).toBe("Update");
    expect(deriveView(snap(installed()), { ...upToDate(), failed: true }).updateLabel).toBe("Update");
    expect(deriveView(snap(installed()), null).updateLabel).toBe("Update");
});

test("advanced tools: build needs the checkout, inject needs a built Vencord", () => {
    expect(deriveView(snap(), null).advanced).toEqual({ build: false, inject: false });
    expect(deriveView(snap(installed()), null).advanced).toEqual({ build: true, inject: true });
    const unbuilt = deriveView(snap({ vencord: { state: "ready", built: false }, solradar: { state: "ready" } }), null);
    expect(unbuilt.advanced).toEqual({ build: true, inject: false });
    const noDiscord = deriveView(snap({ ...installed(), discord: { installs: [], running: false, injection: "not-injected" } }), null);
    expect(noDiscord.advanced.inject).toBe(false);
});

test("strip values: compact versions for Vencord and SolRadar", () => {
    const fresh = deriveView(snap(), null);
    expect(fresh.vencord.short).toBe("not yet");
    expect(fresh.solradar).toMatchObject({ short: "not yet", latest: undefined });
    const u: UpdateInfo = { ...upToDate(), solradar: { localCommit: "p1", remoteCommit: "p2", localVersion: "1.3.6", remoteVersion: "1.4.0" } };
    const v = deriveView(snap(installed()), u);
    expect(v.vencord.short).toBe("abc1234");
    expect(v.solradar).toMatchObject({ short: "1.3.6 → 1.4.0", latest: "1.4.0", tone: "warn" });
    expect(deriveView(snap(installed()), upToDate()).solradar).toMatchObject({ short: "1.3.6", latest: undefined, tone: "ok" });
});
