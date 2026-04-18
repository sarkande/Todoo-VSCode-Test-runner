import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { TodooClient } from "./todooClient";

export interface ComposeContainer {
  id: string;
  name: string;
  service: string;
  state: string;
}

export interface DebugInfo {
  containerId: string;
  containerName: string;
  hostPort: number;
}

const COMPOSE_FILENAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

export function findComposeFile(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return null;

  for (const folder of folders) {
    let dir = folder.uri.fsPath;

    for (let i = 0; i < 5; i++) {
      for (const name of COMPOSE_FILENAMES) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return null;
}

export async function getComposeContainers(
  composeFilePath: string
): Promise<ComposeContainer[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["compose", "-f", composeFilePath, "ps", "--format", "json"],
      { timeout: 10000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`docker compose ps failed: ${stderr || err.message}`)
          );
          return;
        }

        const containers: ComposeContainer[] = [];
        const lines = stdout.trim().split("\n");

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            containers.push({
              id: obj.ID,
              name: obj.Name,
              service: obj.Service,
              state: obj.State,
            });
          } catch {
            // skip unparseable lines
          }
        }

        resolve(containers);
      }
    );
  });
}

export function pickTargetContainer(
  containers: ComposeContainer[],
  preferredService: string = "web"
): ComposeContainer | null {
  const running = containers.filter((c) => c.state === "running");
  return running.find((c) => c.service === preferredService) ?? null;
}

/**
 * Get the host port mapped to an internal container port via `docker port`.
 */
export async function getHostPort(
  containerName: string,
  internalPort: number
): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      ["port", containerName, String(internalPort)],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        // Output format: "0.0.0.0:5831" or ":::5831"
        const match = stdout.trim().match(/:(\d+)$/m);
        resolve(match ? parseInt(match[1], 10) : null);
      }
    );
  });
}

/**
 * Resolve the debug container and its debugpy host port.
 */
export async function resolveDebugInfo(
  debugService: string = "debug"
): Promise<DebugInfo | null> {
  const composeFile = findComposeFile();
  if (!composeFile) return null;

  try {
    const containers = await getComposeContainers(composeFile);
    const debugContainer = pickTargetContainer(containers, debugService);
    if (!debugContainer) return null;

    const hostPort = await getHostPort(debugContainer.name, 5678);
    if (!hostPort) return null;

    return {
      containerId: debugContainer.id,
      containerName: debugContainer.name,
      hostPort,
    };
  } catch {
    return null;
  }
}

export async function autoResolveContainer(
  client: TodooClient,
  preferredService: string = "web"
): Promise<boolean> {
  const composeFile = findComposeFile();
  if (!composeFile) {
    return false;
  }

  try {
    const containers = await getComposeContainers(composeFile);
    const target = pickTargetContainer(containers, preferredService);
    if (!target) {
      return false;
    }

    await client.selectContainer(target.id);
    return true;
  } catch {
    return false;
  }
}
