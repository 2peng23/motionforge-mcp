import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
it("discovers real tools, calls discovery, rejects unauthorized paths over stdio", async () => {
  const root = process.cwd();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "dist/server/cli.js")],
    env: { PATH: process.env.PATH ?? "", MOTIONFORGE_ROOTS: root },
  });
  const client = new Client({
    name: "motionforge-acceptance",
    version: "1.0.0",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.length).toBe(41);
    expect(
      tools.tools.find((tool) => tool.name === "render_video")?.inputSchema,
    ).toBeDefined();
    const result = await client.callTool({
      name: "analyze_project",
      arguments: { project: path.join(root, "examples/demo") },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("fieldnote-demo");
    const denied = await client.callTool({
      name: "analyze_project",
      arguments: { project: path.dirname(root) },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain("outside authorized roots");
    const invalid = await client.callTool({
      name: "render_video",
      arguments: { timeline: 2 },
    });
    expect(invalid.isError).toBe(true);
  } finally {
    await client.close();
  }
}, 30000);
