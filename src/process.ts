import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface CommandOptions {
  cwd: string;
  timeoutMs?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ALL_PROXY: "",
    all_proxy: "",
    HTTP_PROXY: "",
    http_proxy: "",
    HTTPS_PROXY: "",
    https_proxy: "",
    NO_PROXY: "*",
    no_proxy: "*",
  };
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: sanitizedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      child.kill("SIGKILL");
      reject(
        new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(
            [`Command failed: ${command} ${args.join(" ")}`, stdout.trim(), stderr.trim()]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export async function resolveExecutablePath(command: string): Promise<string> {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    throw new Error("PATH is not available in the current process.");
  }

  for (const directory of pathValue.split(":")) {
    const candidate = `${directory}/${command}`;
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to locate executable on PATH: ${command}`);
}

export async function reservePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to reserve a port for Anvil."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}
