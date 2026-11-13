import { it, expect } from "vitest";
import { mkdtemp, writeFile, symlink, link, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Policy } from "../src/security/policy.js";
it("rejects dangling symlink destinations and hard-linked read aliases", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "motionforge-alias-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "motionforge-outside-"));
  try {
    const policy = new Policy([directory]);
    await symlink(
      path.join(outside, "future-output.mp4"),
      path.join(directory, "dangling.mp4"),
    );
    await expect(
      policy.resolve(path.join(directory, "dangling.mp4"), true),
    ).rejects.toThrow("Dangling symlink");
    await writeFile(
      path.join(outside, "outside.txt"),
      "private data outside authorization",
    );
    await link(
      path.join(outside, "outside.txt"),
      path.join(directory, "alias.txt"),
    );
    await expect(
      policy.text(path.join(directory, "alias.txt")),
    ).rejects.toThrow("Hard-linked");
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
