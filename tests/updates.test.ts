import { expect, test } from "bun:test";
import { isNewerVersion, updateAvailable, type UpdateInfo } from "../src/services/updates";

test("isNewerVersion compares numerically and ignores a v prefix", () => {
    expect(isNewerVersion("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("garbage", "0.1.0")).toBe(false);
});

test("updateAvailable when either repo's remote head differs", () => {
    const base: UpdateInfo = { vencord: { local: "a", remote: "a" }, solradar: { localCommit: "b", remoteCommit: "b" }, helper: { current: "0.1.0" }, failed: false };
    expect(updateAvailable(base)).toBe(false);
    expect(updateAvailable({ ...base, vencord: { local: "a", remote: "c" } })).toBe(true);
    expect(updateAvailable({ ...base, solradar: { localCommit: "b", remoteCommit: "d" } })).toBe(true);
    expect(updateAvailable({ ...base, vencord: { local: "a" } })).toBe(false); // unknown remote is not an update
});
