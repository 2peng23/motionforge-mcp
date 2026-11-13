import { chmodSync } from "node:fs";
chmodSync("dist/server/cli.js", 0o755);
