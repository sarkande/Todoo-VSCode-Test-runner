import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { TodooClient } from "./todooClient";

interface ComposeContainer {
  id: string;
  name: string;
  service: string;
  state: string;
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

    // Walk up to 5 levels
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
          reject(new Error(`docker compose ps failed: ${stderr || err.message}`));
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
  const match = running.find((c) => c.service === preferredService);
  return match ?? null;
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
