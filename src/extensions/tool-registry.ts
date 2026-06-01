import type { LoadedExtension } from "./loader.ts";

/** A dispatchable extension tool: its handler bound to its context. */
export type ToolDispatch = Map<string, (input: unknown) => Promise<unknown>>;

/**
 * Build a tool-name → handler dispatch map from the loaded extensions
 * (Variante A, §9.1). The CLI's switch default-case consults this map so an
 * extension tool like `billing_import` is callable as `agent-memory billing_import …`.
 * Each handler is bound to its own extension's context.
 */
export function buildExtensionDispatch(
  loaded: LoadedExtension[],
): ToolDispatch {
  const dispatch: ToolDispatch = new Map();
  for (const l of loaded) {
    for (const tool of l.tools) {
      dispatch.set(tool.name, (input: unknown) =>
        tool.handler(input, l.context),
      );
    }
  }
  return dispatch;
}
