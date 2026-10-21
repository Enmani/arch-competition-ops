#!/usr/bin/env node
// Fixed entry point for the offline preview generator. The Python worker and the npm scripts
// call exactly this file with plain argv; no Node source is ever composed at runtime.
// The sources are TypeScript, loaded through tsx (a dependency of this package).
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/cli.ts");
process.exitCode = await main(process.argv.slice(2), process.env);
