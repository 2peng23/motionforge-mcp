#!/usr/bin/env node
import path from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { cancelActiveCapture } from "../services/capture.js";
import { cancelActiveRender } from "../services/video.js";
import { cancelMediaProcesses, Policy } from "../security/policy.js";
import { createServer } from "../tools/registry.js";
try {
  const roots = (process.env.MOTIONFORGE_ROOTS ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const policy = new Policy(roots);
  const handle = serveStdio(() => createServer(policy));
  const shutdown = () => {
    cancelActiveRender();
    cancelActiveCapture();
    cancelMediaProcesses();
    void handle.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
