import { expect, test } from "bun:test";
import { parseWebView2Version } from "../src/core/win32";

test("parseWebView2Version accepts real versions and rejects 0.0.0.0", () => {
    expect(parseWebView2Version("\n    pv    REG_SZ    129.0.2792.65\n")).toBe("129.0.2792.65");
    expect(parseWebView2Version("    pv    REG_SZ    0.0.0.0")).toBeUndefined();
    expect(parseWebView2Version("ERROR: The system was unable to find the specified registry key or value.")).toBeUndefined();
});
