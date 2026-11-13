# MCP client configurations

Use absolute paths. No application configuration was changed by this project. These examples follow official documentation; the automated test connects using the official SDK and does not prove that each application is installed/configured.

## Codex

Add to `~/.codex/config.toml` or your approved project configuration:

```toml
[mcp_servers.motionforge]
command = "node"
args = ["/absolute/motionforge-mcp/dist/server/cli.js"]
startup_timeout_sec = 30
tool_timeout_sec = 900

[mcp_servers.motionforge.env]
MOTIONFORGE_ROOTS = "/absolute/application:/absolute/video-output"
MOTIONFORGE_BROWSER_PATH = "/absolute/chrome"
```

On Windows use semicolon-delimited roots and escaped Windows paths. Long rendering requires a client tool timeout longer than the server render deadline (default600seconds); do not use Codex's default60seconds for full renders.

## Claude Code

Flags precede `--`; paths after it belong to the server command:

```bash
claude mcp add --transport stdio --scope project --env MOTIONFORGE_ROOTS=/absolute/project --env MOTIONFORGE_BROWSER_PATH=/absolute/chrome motionforge -- node /absolute/motionforge-mcp/dist/server/cli.js
```

Configure a suitable long-call timeout in your client for rendering.

## Cursor / VS Code portable configuration

Cursor project `.cursor/mcp.json`; VS Code portable project `.mcp.json`:

```json
{
  "mcpServers": {
    "motionforge": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/motionforge-mcp/dist/server/cli.js"],
      "env": {
        "MOTIONFORGE_ROOTS": "/absolute/application:/absolute/video-output",
        "MOTIONFORGE_BROWSER_PATH": "/absolute/chrome"
      }
    }
  }
}
```

Existing VS Code editor harness `.vscode/mcp.json` uses `servers` instead of `mcpServers`; consult your installed client version. Optional credentials should come from a secure local environment, never committed JSON. Start without ELEVENLABS_API_KEY if using local audio only.

Sources: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Cursor MCP](https://cursor.com/docs/mcp), [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).
