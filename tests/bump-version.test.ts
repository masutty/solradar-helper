import { expect, test } from "bun:test";
import { filterReleaseCommits, nextVersion, parseGitLog } from "../scripts/bump-version";
import { HELPER_VERSION } from "../src/core/constants";
import versionFile from "../version.json";

const c = (subject: string, body = "") => ({ subject, body });

test("HELPER_VERSION equals version.json", () => {
    expect(HELPER_VERSION).toBe(versionFile.version);
});

test("fix bumps patch", () => {
    expect(nextVersion("1.2.3", [c("fix(ui): stop crash")])).toEqual({ version: "1.2.4", bump: "patch" });
});

test("other commit types bump patch", () => {
    expect(nextVersion("1.2.3", [c("chore: tidy"), c("docs: text"), c("random message")]).bump).toBe("patch");
});

test("feat bumps minor", () => {
    expect(nextVersion("1.2.3", [c("fix: a"), c("feat(core): b")])).toEqual({ version: "1.3.0", bump: "minor" });
});

test("bang in subject bumps major", () => {
    expect(nextVersion("1.2.3", [c("feat!: drop api")])).toEqual({ version: "2.0.0", bump: "major" });
    expect(nextVersion("1.2.3", [c("fix(core)!: change")]).bump).toBe("major");
});

test("BREAKING CHANGE in body bumps major", () => {
    const r = nextVersion("1.2.3", [c("refactor: x", "- note\n\nBREAKING CHANGE: new format")]);
    expect(r).toEqual({ version: "2.0.0", bump: "major" });
});

test("pre-1.0: breaking bumps minor, feat bumps minor, fix bumps patch", () => {
    expect(nextVersion("0.1.0", [c("feat!: x")])).toEqual({ version: "0.2.0", bump: "minor" });
    expect(nextVersion("0.1.4", [c("fix: x", "BREAKING CHANGE: y")])).toEqual({ version: "0.2.0", bump: "minor" });
    expect(nextVersion("0.1.4", [c("feat: x")])).toEqual({ version: "0.2.0", bump: "minor" });
    expect(nextVersion("0.1.4", [c("fix: x")])).toEqual({ version: "0.1.5", bump: "patch" });
});

test("no commits gives no bump", () => {
    expect(nextVersion("0.1.0", [])).toEqual({ version: "0.1.0", bump: "none" });
});

test("invalid version throws", () => {
    expect(() => nextVersion("abc", [])).toThrow();
});

test("filterReleaseCommits skips release commits", () => {
    const list = [c("chore(release): v0.2.0 [skip ci]"), c("fix: a")];
    expect(filterReleaseCommits(list)).toEqual([c("fix: a")]);
});

test("parseGitLog splits records into subject and body", () => {
    const raw = "feat: a\n- one\n\x1e\nfix: b\n\n\x1e\n";
    expect(parseGitLog(raw)).toEqual([c("feat: a", "- one"), c("fix: b")]);
});
