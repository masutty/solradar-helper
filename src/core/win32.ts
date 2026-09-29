import { dlopen, FFIType } from "bun:ffi";
import { system32 } from "./commands";
import { parseRegValue } from "./env";

const MB_OKCANCEL = 0x1;
const MB_ICONINFORMATION = 0x40;
const IDOK = 1;

const wide = (s: string) => Buffer.from(s + "\0", "utf16le");

export function showMessageBox(title: string, text: string, buttons: "ok" | "okcancel" = "ok"): "ok" | "cancel" {
    const user32 = dlopen("user32.dll", {
        MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    });
    try {
        const flags = MB_ICONINFORMATION | (buttons === "okcancel" ? MB_OKCANCEL : 0);
        return user32.symbols.MessageBoxW(null, wide(text), wide(title), flags) === IDOK ? "ok" : "cancel";
    } finally {
        user32.close();
    }
}

export function parseWebView2Version(regOutput: string): string | undefined {
    const v = parseRegValue(regOutput, "pv");
    return v && v !== "0.0.0.0" ? v : undefined;
}

export const WEBVIEW2_KEYS = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
];

export function webView2Installed(): boolean {
    return WEBVIEW2_KEYS.some(key => {
        const r = Bun.spawnSync([system32("reg.exe"), "query", key, "/v", "pv"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
        return r.exitCode === 0 && !!parseWebView2Version(r.stdout.toString());
    });
}

export const explorer = () => system32("..\\explorer.exe");

// Bun kills direct children when the parent exits. These hand-off tools return quickly,
// so run them synchronously: the caller may exit right after.
export const HANDOFF_SPAWN_OPTIONS = { stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: false } as const;

function handOff(cmd: string[]) {
    // windowsHide must be false: explorer.exe and rundll32.exe are GUI tools that the user
    // expects to see (e.g., "Open logs", "reveal file"). Setting windowsHide: true hides
    // the window, making these operations appear to do nothing.
    Bun.spawnSync(cmd, HANDOFF_SPAWN_OPTIONS);
}

export function openUrl(url: string): void {
    handOff([system32("rundll32.exe"), "url.dll,FileProtocolHandler", url]);
}

export function openFolder(path: string): void {
    handOff([explorer(), path]);
}

export function revealFile(path: string): void {
    handOff([explorer(), `/select,${path}`]);
}

/** Gives the window the icon embedded in the compiled exe. Best effort; does nothing under `bun run` or on failure. */
export function setWindowIcon(hwnd: number | bigint | null | undefined, exePath: string = process.execPath): void {
    try {
        if (!hwnd || /^bun(\.exe)?$/i.test(exePath.split(/[\/]/).pop() ?? "")) return;
        const shell32 = dlopen("shell32.dll", {
            ExtractIconExW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
        });
        const user32 = dlopen("user32.dll", {
            SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.i64 },
        });
        try {
            const large = new BigUint64Array(1);
            const small = new BigUint64Array(1);
            if (shell32.symbols.ExtractIconExW(wide(exePath), 0, large, small, 1) === 0) return;
            const WM_SETICON = 0x0080;
            const target = hwnd as unknown as FFIType.ptr;
            if (small[0]) user32.symbols.SendMessageW(target, WM_SETICON, 0n, small[0]); // ICON_SMALL
            if (large[0]) user32.symbols.SendMessageW(target, WM_SETICON, 1n, large[0]); // ICON_BIG
        } finally {
            shell32.close();
            user32.close();
        }
    } catch {
        // The default icon stays; not worth failing startup.
    }
}
