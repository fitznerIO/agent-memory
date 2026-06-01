import type { Extension } from "./types.ts";

/**
 * All extensions known to this build (§6.2).
 *
 * Explicit and static — no folder scanning, no dynamic imports. Adding an
 * extension = one entry here. Installed/uninstalled state lives in the
 * `extensions` registry table; presence in this array only makes an extension
 * *available* to install.
 *
 * Billing and IdeaForge are appended by their own tasks.
 */
export const AVAILABLE_EXTENSIONS: Extension[] = [];
