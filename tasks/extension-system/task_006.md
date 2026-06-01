# Task 006: Phase 2 — CLI-Commands + Tool-Dispatch (Variante A)

## Dependencies
- Requires: 005

## Description
(aus Ext-PRD §9, §9.1, §11)

**Entschieden (C5): Variante A — CLI-Subcommands.** Der Core hat keinen Agent-SDK-/MCP-Tool-Host; der einzige Einstiegspunkt ist der CLI-`switch` (`src/cli.ts:160`). Extension-Tools werden als CLI-Kommandos dispatcht. Kein SDK in v1 (Variante B ist in §16.2 als spätere Option dokumentiert).

**buildExtensionDispatch** (`src/extensions/tool-registry.ts`):

```typescript
export function buildExtensionDispatch(loadedExtensions: LoadedExtension[]): Map<string, (input: unknown) => Promise<unknown>> {
  const dispatch = new Map();
  for (const loaded of loadedExtensions)
    for (const tool of loaded.tools)
      dispatch.set(tool.name, (input) => tool.handler(input, loaded.context));
  return dispatch;
}
// CLI: default-case im switch prüft dispatch.get(command) und ruft den Handler mit geparsten Flags als input.
```

**Extension-Management-Commands** (§11):
```
agent-memory extensions list                 # verfügbare Extensions + Installationsstatus
agent-memory extensions install <name>
agent-memory extensions uninstall <name>     # mit Bestätigung
agent-memory extensions status <name>        # Version, installed_at, Tabelle, Tools
```

## Expected Outcome
- `buildExtensionDispatch()` baut die Tool-Map; der CLI-`switch` konsultiert sie im default-case und ruft den Handler mit den geparsten Flags.
- `extensions list/install/uninstall/status` funktionieren über die CLI.
- Extension-Tools (z.B. `agent-memory billing import --csv …`) sind als CLI-Subcommands aufrufbar.
- Tests: Dispatch lädt Tools korrekt; CLI-Commands rufen Manager/Loader korrekt.

## Agent Context
Baut auf den geladenen Zustand aus Task 005 auf. Setzt die Scope-Entscheidung „Variante A (CLI)" um — keine Agent-SDK-Integration. Damit sind Extensions installier-, deinstallier- und ihre Tools aufrufbar.
