import { runLocalApp } from "./local-launcher.mjs";

try {
  process.exitCode = await runLocalApp({ production: process.argv.includes("--production") });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
