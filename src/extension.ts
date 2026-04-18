import * as vscode from "vscode";
import { TodooTestController } from "./testController";
import { ServerManager } from "./serverManager";
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
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const config = getConfig();

  serverManager = new ServerManager();
  testController = new TodooTestController(context, config);

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

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("todoo")) {
        testController?.updateConfig(getConfig());
      }
    }),

    { dispose: () => serverManager?.dispose() }
  );
}

export function deactivate(): void {
  testController?.dispose();
  serverManager?.dispose();
}
