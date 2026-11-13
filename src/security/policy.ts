import { constants } from "node:fs";
import { realpath, stat, lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const privatePath =
  /(?:^|\/)(?:\.env(?:\.[^/]+)?|\.git|\.ssh|\.aws|\.npmrc|\.netrc|credentials(?:\.json)?|id_rsa|id_ed25519|[^/]*\.(?:pem|key|p12|pfx))(?:$|\/)/i;

function checkPrivatePath(candidate: string): void {
  if (privatePath.test(candidate.replaceAll("\\", "/"))) {
    throw new Error(
      "Credential files and repository metadata are excluded from filesystem access.",
    );
  }
}

export class Policy {
  constructor(readonly roots: string[]) {
    if (!roots.length) {
      throw new Error(
        "Set MOTIONFORGE_ROOTS to explicitly authorized directories (separated by the platform path delimiter).",
      );
    }
  }

  async resolve(input: string, write = false): Promise<string> {
    const target = path.resolve(input);
    checkPrivatePath(target);
    const roots = await Promise.all(
      this.roots.map((root) => realpath(path.resolve(root))),
    );
    let existing = target;
    const missing: string[] = [];
    while (true) {
      try {
        const canonical = await realpath(existing);
        const candidate = path.join(canonical, ...missing.slice().reverse());
        checkPrivatePath(candidate);
        if (
          !roots.some(
            (root) =>
              candidate === root || candidate.startsWith(root + path.sep),
          )
        ) {
          throw new Error("Path is outside authorized roots.");
        }
        if (write && roots.includes(candidate))
          throw new Error("Cannot replace an authorized root.");
        if (!write) {
          const information = await stat(candidate);
          if (information.isFile() && information.nlink > 1)
            throw new Error(
              "Hard-linked input files are excluded from authorized filesystem access.",
            );
        }
        return candidate;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          existing === path.dirname(existing)
        )
          throw error;
        try {
          const information = await lstat(existing);
          if (information.isSymbolicLink())
            throw new Error("Dangling symlink paths cannot be authorized");
        } catch (linkError) {
          if ((linkError as NodeJS.ErrnoException).code !== "ENOENT")
            throw linkError;
        }
        missing.push(path.basename(existing));
        existing = path.dirname(existing);
      }
    }
  }

  async text(input: string): Promise<string> {
    const target = await this.resolve(input);
    const information = await stat(target);
    if (!information.isFile()) throw new Error("Expected a regular text file.");
    if (information.size > 2_000_000)
      throw new Error("Text file exceeds 2 MB.");
    return readFile(target, "utf8");
  }

  async write(
    input: string,
    content: string | Buffer,
    overwrite = false,
  ): Promise<string> {
    if (Buffer.byteLength(content) > 64_000_000)
      throw new Error("Artifact exceeds the 64 MB write limit.");
    const target = await this.resolve(input, true);
    await mkdir(path.dirname(target), { recursive: true });
    await this.resolve(path.dirname(target));
    const verified = await this.resolve(target, true);
    if (verified !== target)
      throw new Error("Artifact destination changed during authorization.");
    // O_EXCL prevents clobbering existing files; O_NOFOLLOW closes final-component symlink races where supported.
    const flags =
      constants.O_WRONLY |
      constants.O_CREAT |
      (overwrite ? 0 : constants.O_EXCL) |
      (constants.O_NOFOLLOW ?? 0);
    const handle = await open(target, flags, 0o600);
    try {
      const information = await handle.stat();
      if (!information.isFile() || information.nlink > 1)
        throw new Error("Artifact must be a regular file without hard links.");
      if (overwrite) await handle.truncate(0);
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return target;
  }
}

export function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[\w.+\/-]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)[^\s,;"'<>]+/gi,
      "$1[REDACTED]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\bsk[-_][a-z0-9_-]{12,}\b/gi, "[REDACTED]");
}

const activeProcesses = new Set<ChildProcess>();
export function cancelMediaProcesses(): void {
  for (const child of activeProcesses) child.kill("SIGKILL");
}

export async function processMedia(
  command: "ffmpeg" | "ffprobe",
  argumentsList: string[],
  timeout = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  if (!["ffmpeg", "ffprobe"].includes(command))
    throw new Error("Executable is not allowlisted.");
  if (activeProcesses.size >= 3)
    throw new Error("Media process concurrency limit reached.");
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 1_800_000)
    throw new Error("Media timeout must be between 1 ms and 30 minutes.");
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      shell: false,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        TEMP: process.env.TEMP ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeProcesses.add(child);
    let stdout = "";
    let stderr = "";
    let terminalError: Error | undefined;
    const timer = setTimeout(() => {
      terminalError = new Error(`${command} exceeded its execution limit.`);
      child.kill("SIGKILL");
    }, timeout);
    child.stdout!.on("data", (chunk) => {
      if (terminalError) return;
      stdout += String(chunk);
      if (stdout.length > 4_000_000) {
        terminalError = new Error(`${command} exceeded its output limit.`);
        stdout = "";
        child.kill("SIGKILL");
      }
    });
    child.stderr!.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-200_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      activeProcesses.delete(child);
      reject(
        new Error(
          `${command}: ${redact(error.message)}. Install FFmpeg and ensure it is on PATH.`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeProcesses.delete(child);
      if (terminalError) reject(terminalError);
      else if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} failed (${code}): ${redact(stderr.slice(-2000))}`,
          ),
        );
    });
  });
}
