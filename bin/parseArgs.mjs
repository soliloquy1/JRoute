// bin/parseArgs.mjs
//
// Pure argv parsing, split out of jroute.js specifically so it's unit-testable without
// triggering jroute.js's own top-level side effects (spawning processes, calling
// process.exit) just by importing the file.
export const KNOWN_COMMANDS = new Set(["start", "dev", "build"]);

/**
 * @param {string[]} rawArgs - process.argv.slice(2)
 * @returns {{ shouldOpenBrowser: boolean, command: string, passthroughArgs: string[] }}
 */
export function parseArgs(rawArgs) {
  // `--no-open` is stripped before command detection, not left for `next dev`/`start`'s own
  // arg parsing to trip over, and not counted against `start`'s "no passthrough flags" rule.
  const shouldOpenBrowser = !rawArgs.includes("--no-open");
  const filteredArgs = rawArgs.filter((a) => a !== "--no-open");

  const [rawCommand, ...rest] = filteredArgs;
  const command = KNOWN_COMMANDS.has(rawCommand) ? rawCommand : "start";
  const passthroughArgs = KNOWN_COMMANDS.has(rawCommand) ? rest : filteredArgs;

  return { shouldOpenBrowser, command, passthroughArgs };
}
