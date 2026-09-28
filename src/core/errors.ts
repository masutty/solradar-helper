export type ErrorKind =
    | "missing-dependency"
    | "discord-not-found"
    | "discord-running"
    | "checkout-modified"
    | "network"
    | "build"
    | "inject"
    | "cancelled"
    | "unknown";

// message: short, human, shown in the UI. technical: goes to the log only.
export class HelperError extends Error {
    constructor(readonly kind: ErrorKind, message: string, readonly technical?: string) {
        super(message);
    }
}

export function toHelperError(e: unknown): HelperError {
    if (e instanceof HelperError) return e;
    const technical = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    return new HelperError("unknown", "Something unexpected went wrong. Open the log for details.", technical);
}
