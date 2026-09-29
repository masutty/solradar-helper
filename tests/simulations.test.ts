import { expect, test } from "bun:test";
import type { Snapshot } from "../src/app/snapshot";
import { applySimulations, bumpPatch } from "../src/app/simulations";
import { deriveView } from "../src/app/view";
import type { UpdateInfo } from "../src/services/updates";

const stable = { branch: "stable" as const, label: "Discord", root: "C:\L\Discord", appDir: "C:\L\Discord\app-1", exe: "Discord.exe" };
const snap = (): Snapshot => ({
    dependencies: [{ id: "git", state: "ok", version: "2.45.1" }, { id: "node", state: "ok", version: "24.21.0" }],
    wingetAvailable: true,
    discord: { installs: [stable], selected: stable, running: false, injection: "injected" },
    vencord: { state: "ready", commit: "abc1234def", built: true },
    solradar: { state: "ready", commit: "p1", version: "1.3.6" },
});
const upd = (): UpdateInfo => ({
    vencord: { local: "abc1234def", remote: "abc1234def" },
    solradar: { localCommit: "p1", remoteCommit: "p1", localVersion: "1.3.6", remoteVersion: "1.3.6" },
    helper: { current: "0.1.0" }, failed: false,
});

test("no simulations changes nothing", () => {
    const s = snap(), u = upd();
    expect(applySimulations(s, u, new Set())).toEqual({ snapshot: s, updates: u });
});

test("SolRadar update available bumps the remote version; input is not mutated", () => {
    const s = snap(), u = upd();
    const r = applySimulations(s, u, new Set(["solradar-update"]));
    expect(r.updates!.solradar).toMatchObject({ remoteCommit: "simulated", remoteVersion: "1.3.7" });
    expect(u.solradar.remoteCommit).toBe("p1");
    expect(deriveView(r.snapshot, r.updates).updateText).toBe("SolRadar 1.3.6 → 1.3.7");
});

test("update simulations work even before the real check finished", () => {
    const r = applySimulations(snap(), null, new Set(["vencord-update"]));
    expect(r.updates!.vencord.remote).not.toBe(r.updates!.vencord.local);
    expect(deriveView(r.snapshot, r.updates).headline).toBe("An update is available");
});

test("new Helper version bumps the patch number", () => {
    const r = applySimulations(snap(), upd(), new Set(["helper-update"]));
    expect(r.updates!.helper.latest).toBe("0.1.1");
    expect(deriveView(r.snapshot, r.updates).helperUpdate?.latest).toBe("0.1.1");
});

test("failed update check clears the remotes and wins over update simulations", () => {
    const r = applySimulations(snap(), upd(), new Set(["solradar-update", "update-failed"]));
    expect(r.updates).toMatchObject({ failed: true, vencord: { remote: undefined }, solradar: { remoteCommit: undefined, remoteVersion: undefined } });
    expect(deriveView(r.snapshot, r.updates).updateLabel).toBe("Update");
});

test("dependency simulations override the status", () => {
    const r = applySimulations(snap(), upd(), new Set(["git-missing", "node-old"]));
    expect(r.snapshot.dependencies).toEqual([{ id: "git", state: "missing" }, expect.objectContaining({ id: "node", state: "outdated" })]);
    expect(deriveView(r.snapshot, r.updates).actions.update).toBe(false);
});

test("Discord simulations", () => {
    expect(applySimulations(snap(), null, new Set(["discord-missing"])).snapshot.discord).toMatchObject({ installs: [], selected: undefined, running: false });
    expect(applySimulations(snap(), null, new Set(["discord-running"])).snapshot.discord.running).toBe(true);
});

test("bumpPatch", () => {
    expect(bumpPatch("1.3.6")).toBe("1.3.7");
    expect(bumpPatch("2.0.0")).toBe("2.0.1");
    expect(bumpPatch("v0.1.9")).toBe("0.1.10");
    expect(bumpPatch(undefined)).toBe("999.999.999");
    expect(bumpPatch("weird")).toBe("999.999.999");
});
