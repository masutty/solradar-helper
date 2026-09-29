import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

export type Commit = { subject: string; body: string };
export type Bump = "major" | "minor" | "patch" | "none";

const BREAKING_SUBJECT = /^\w+(\([^)]*\))?!:/;
const BREAKING_BODY = /^BREAKING[ -]CHANGE:/m;
const FEAT_SUBJECT = /^feat(\([^)]*\))?:/;

/** Commits made by the release job itself. They must not count as changes. */
export function filterReleaseCommits(commits: Commit[]): Commit[] {
    return commits.filter((c) => !c.subject.startsWith("chore(release):"));
}

/** Split `git log --format=%s%n%b%x1e` output into commits. */
export function parseGitLog(raw: string): Commit[] {
    return raw
        .split("\x1e")
        .map((chunk) => chunk.replace(/^\n+/, ""))
        .filter((chunk) => chunk.trim() !== "")
        .map((chunk) => {
            const nl = chunk.indexOf("\n");
            return nl === -1
                ? { subject: chunk.trim(), body: "" }
                : { subject: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1).trim() };
        });
}

/**
 * Compute the next version from Conventional Commits.
 *
 * Pre-1.0 rule: while the major number is 0, a breaking change bumps MINOR
 * (0.x.y -> 0.(x+1).0) and not major. A feat also bumps minor. From 1.0.0 on,
 * a breaking change bumps major, a feat bumps minor, and every other commit
 * bumps patch. No commits means no bump.
 */
export function nextVersion(current: string, commits: Commit[]): { version: string; bump: Bump } {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
    if (!m) throw new Error(`Invalid version: ${current}`);
    let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];

    if (commits.length === 0) return { version: `${major}.${minor}.${patch}`, bump: "none" };

    const breaking = commits.some((c) => BREAKING_SUBJECT.test(c.subject) || BREAKING_BODY.test(c.body));
    const feat = commits.some((c) => FEAT_SUBJECT.test(c.subject));

    let bump: Bump;
    if (breaking) bump = major === 0 ? "minor" : "major";
    else if (feat) bump = "minor";
    else bump = "patch";

    if (bump === "major") [major, minor, patch] = [major + 1, 0, 0];
    else if (bump === "minor") [minor, patch] = [minor + 1, 0];
    else patch += 1;

    return { version: `${major}.${minor}.${patch}`, bump };
}

function git(args: string[]): { ok: boolean; out: string } {
    const p = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
    return { ok: p.exitCode === 0, out: p.stdout.toString() };
}

function setJsonVersion(path: string, version: string): void {
    const raw = readFileSync(path, "utf8");
    const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
    writeFileSync(path, updated);
}

function main(): void {
    const dryRun = process.argv.includes("--dry-run");
    const current: string = JSON.parse(readFileSync("version.json", "utf8")).version;

    const tag = git(["describe", "--tags", "--abbrev=0", "--match", "v*"]);
    let version = current;
    let release: boolean;
    let bump: Bump = "none";

    if (!tag.ok || !/^v\d+\.\d+\.\d+$/.test(tag.out.trim())) {
        release = true; // First release: keep the current version.
    } else {
        const range = `${tag.out.trim()}..HEAD`;
        const log = git(["log", range, "--format=%s%n%b%x1e"]);
        const commits = filterReleaseCommits(parseGitLog(log.out));
        ({ version, bump } = nextVersion(current, commits));
        release = commits.length > 0;
    }

    if (dryRun) {
        console.log(`dry-run: bump=${bump} version=${version} release=${release} (no files written)`);
        return;
    }

    if (version !== current) {
        setJsonVersion("version.json", version);
        setJsonVersion("package.json", version);
    }

    const lines = `version=${version}\nrelease=${release}\n`;
    const out = process.env.GITHUB_OUTPUT;
    if (out) appendFileSync(out, lines);
    else process.stdout.write(lines);
}

if (import.meta.main) main();
