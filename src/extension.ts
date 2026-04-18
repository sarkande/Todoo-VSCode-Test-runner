import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { TodooTestController } from "./testController";
import { ServerManager } from "./serverManager";
import { autoResolveContainer, resolveDebugInfo, findComposeFile } from "./containerResolver";
import { TodooConfig } from "./types";

let testController: TodooTestController | undefined;
let serverManager: ServerManager | undefined;

function getConfig(): TodooConfig {
  const cfg = vscode.workspace.getConfiguration("todoo");
  return {
    serverHost: cfg.get("serverHost", "127.0.0.1"),
    serverPort: cfg.get("serverPort", 8080),
    container: cfg.get("container", ""),
    dbName: cfg.get("dbName", "odoo"),
    dbHost: cfg.get("dbHost", "db"),
    dbPassword: cfg.get("dbPassword", "odoo"),
    odooPort: cfg.get("odooPort", 8070),
    autoStart: cfg.get("autoStart", true),
    preferredService: cfg.get("preferredService", "web"),
    debugPort: cfg.get("debugPort", 5678),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = getConfig();

  serverManager = new ServerManager();
  testController = new TodooTestController(context, config);

  // Auto-resolve container from docker-compose
  const client = testController.getClient();
  const serverRunning = await client.isServerRunning();
  if (serverRunning) {
    const resolved = await autoResolveContainer(client, config.preferredService);
    if (resolved) {
      await testController.discoverTests();
    }
  }

  // Auto-generate launch.json with correct debug port (silent at activation)
  await generateLaunchConfig(true);

  context.subscriptions.push(
    vscode.commands.registerCommand("todoo.refreshTests", async () => {
      await testController?.discoverTests();
    }),

    vscode.commands.registerCommand("todoo.selectContainer", async () => {
      const client = testController?.getClient();
      if (!client) return;

      const running = await client.isServerRunning();
      if (!running) {
        vscode.window.showErrorMessage("Todoo server is not running.");
        return;
      }

      try {
        const containers = await client.getContainers();
        if (containers.length === 0) {
          vscode.window.showWarningMessage("No running Docker containers found.");
          return;
        }

        const picks = containers.map((c) => ({
          label: c.name,
          description: `${c.image} (${c.status})`,
          id: c.id,
        }));

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: "Select a Docker container for Odoo testing",
        });

        if (selected) {
          await client.selectContainer(selected.id);
          vscode.window.showInformationMessage(
            `Container '${selected.label}' selected.`
          );
          await testController?.discoverTests();
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to list containers: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("todoo.startServer", async () => {
      const cfg = getConfig();
      await serverManager?.start(cfg.serverPort, cfg.serverHost);
    }),

    vscode.commands.registerCommand("todoo.stopServer", () => {
      serverManager?.stop();
    }),

    vscode.commands.registerCommand("todoo.setupDebugConfig", async () => {
      await generateLaunchConfig();
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("todoo")) {
        testController?.updateConfig(getConfig());
      }
    }),

    { dispose: () => serverManager?.dispose() }
  );
}

async function generateLaunchConfig(silent: boolean = false): Promise<void> {
  const debugInfo = await resolveDebugInfo("debug");
  if (!debugInfo) {
    if (!silent) {
      vscode.window.showWarningMessage(
        "Todoo: Could not detect debug container port. Is the debug service running?"
      );
    }
    return;
  }

  // Find the project root (where docker-compose.yml is)
  const composeFile = findComposeFile();
  if (!composeFile) return;
  const projectRoot = path.dirname(composeFile);
  const vscodePath = path.join(projectRoot, ".vscode");
  const launchPath = path.join(vscodePath, "launch.json");

  // Build path mappings from workspace
  const mappings: Array<{ localRoot: string; remoteRoot: string }> = [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const name = folder.name.toLowerCase();
    if (
      name.includes("custom") ||
      name.includes("extra-addons") ||
      name.includes("addons")
    ) {
      mappings.push({
        localRoot: folder.uri.fsPath,
        remoteRoot: "/mnt/extra-addons",
      });
    } else if (name === "odoo") {
      mappings.push({
        localRoot: folder.uri.fsPath,
        remoteRoot: "/usr/lib/python3/dist-packages/odoo",
      });
    } else if (name === "enterprise") {
      mappings.push({
        localRoot: folder.uri.fsPath,
        remoteRoot: "/mnt/enterprise",
      });
    }
  }

  if (mappings.length === 0) {
    mappings.push({
      localRoot: "${workspaceFolder}",
      remoteRoot: "/mnt/extra-addons",
    });
  }

  const todooConfig = {
    name: "Todoo: Remote Attach",
    type: "debugpy",
    request: "attach",
    connect: {
      host: "localhost",
      port: debugInfo.hostPort,
    },
    pathMappings: mappings,
    justMyCode: true,
  };

  if (!fs.existsSync(vscodePath)) {
    fs.mkdirSync(vscodePath, { recursive: true });
  }

  let launch: any;
  if (fs.existsSync(launchPath)) {
    try {
      const raw = fs.readFileSync(launchPath, "utf-8");
      // Strip comments for JSON parsing (simple approach)
      const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      launch = JSON.parse(stripped);
    } catch {
      launch = { version: "0.2.0", configurations: [] };
    }
  } else {
    launch = { version: "0.2.0", configurations: [] };
  }

  // Update or add the Todoo config
  const idx = launch.configurations.findIndex(
    (c: any) => c.name === "Todoo: Remote Attach"
  );
  if (idx >= 0) {
    launch.configurations[idx] = todooConfig;
  } else {
    launch.configurations.push(todooConfig);
  }

  fs.writeFileSync(launchPath, JSON.stringify(launch, null, 2) + "\n");
  vscode.window.showInformationMessage(
    `Todoo: launch.json updated with debug port ${debugInfo.hostPort}`
  );
}

export function deactivate(): void {
  testController?.dispose();
  serverManager?.dispose();
}
