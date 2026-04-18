import * as vscode from "vscode";
import { TodooClient } from "./todooClient";
import { ModuleInfo, TestResult, TodooConfig } from "./types";

export class TodooTestController {
  private ctrl: vscode.TestController;
  private client: TodooClient;
  private outputChannel: vscode.LogOutputChannel;
  private runProfiles: vscode.TestRunProfile[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;

  private static readonly ODOO_LOG_PATTERN =
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+\s+\d+\s+(ERROR|WARNING|INFO|DEBUG)/;

  private moduleItems = new Map<string, vscode.TestItem>();
  private classItems = new Map<string, vscode.TestItem>();
  private methodItems = new Map<string, vscode.TestItem>();

  // Local file index: "module.ClassName" -> { uri, classLine, methods: { name -> line } }
  private localIndex = new Map<
    string,
    {
      uri: vscode.Uri;
      classLine: number;
      methods: Map<string, number>;
    }
  >();

  constructor(
    private context: vscode.ExtensionContext,
    config: TodooConfig
  ) {
    this.ctrl = vscode.tests.createTestController("todoo", "Todoo - Odoo Tests");
    this.client = new TodooClient(config);
    this.outputChannel = vscode.window.createOutputChannel("Todoo", { log: true });

    this.runProfiles.push(
      this.ctrl.createRunProfile(
        "Run Tests",
        vscode.TestRunProfileKind.Run,
        (request, token) => this.runHandler(request, token),
        true
      ),
      this.ctrl.createRunProfile(
        "Debug Tests",
        vscode.TestRunProfileKind.Debug,
        (request, token) => this.debugHandler(request, token),
        false
      )
    );

    this.ctrl.resolveHandler = async (item) => {
      if (!item) {
        await this.discoverTests();
      }
    };

    this.watcher = vscode.workspace.createFileSystemWatcher("**/tests/test_*.py");
    this.watcher.onDidChange(() => this.buildLocalIndex());
    this.watcher.onDidCreate(() => this.buildLocalIndex());
    this.watcher.onDidDelete(() => this.buildLocalIndex());

    context.subscriptions.push(this.ctrl, this.outputChannel, this.watcher);
  }

  updateConfig(config: TodooConfig): void {
    this.client.updateConfig(config);
  }

  getClient(): TodooClient {
    return this.client;
  }

  private logLine(line: string): void {
    const match = line.match(TodooTestController.ODOO_LOG_PATTERN);
    if (match) {
      switch (match[1]) {
        case "ERROR":
          this.outputChannel.error(line);
          return;
        case "WARNING":
          this.outputChannel.warn(line);
          return;
        case "DEBUG":
          this.outputChannel.debug(line);
          return;
        default:
          this.outputChannel.info(line);
          return;
      }
    }
    // Traceback and error lines
    if (
      line.includes("Traceback") ||
      line.includes("AssertionError") ||
      line.includes("Error:")
    ) {
      this.outputChannel.error(line);
      return;
    }
    this.outputChannel.info(line);
  }

  async discoverTests(): Promise<void> {
    const running = await this.client.isServerRunning();
    if (!running) {
      vscode.window.showWarningMessage(
        "Todoo server is not running. Start it with 'Todoo: Start Server'."
      );
      return;
    }

    // Build local file index first, then fetch from API
    await this.buildLocalIndex();

    try {
      const modules = await this.client.getModules();
      this.buildTestTree(modules);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to discover tests: ${err.message}`);
    }
  }

  private async buildLocalIndex(): Promise<void> {
    this.localIndex.clear();

    const files = await vscode.workspace.findFiles(
      "**/tests/test_*.py",
      "**/{node_modules,.git,__pycache__}/**"
    );

    for (const uri of files) {
      const moduleName = this.getModuleName(uri);
      if (!moduleName) continue;

      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const lines = text.split("\n");
        let currentClass: string | null = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          const classMatch = line.match(/^class\s+(\w+)\s*[\(:]/);
          if (classMatch) {
            currentClass = classMatch[1];
            const key = `${moduleName}.${currentClass}`;
            this.localIndex.set(key, {
              uri,
              classLine: i,
              methods: new Map(),
            });
            continue;
          }

          if (currentClass) {
            const methodMatch = line.match(/^\s+def\s+(test_\w+)\s*\(/);
            if (methodMatch) {
              const key = `${moduleName}.${currentClass}`;
              this.localIndex.get(key)?.methods.set(methodMatch[1], i);
            }
            if (/^class\s+/.test(line) || (/^def\s+/.test(line) && !line.startsWith(" "))) {
              currentClass = null;
            }
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  private getModuleName(uri: vscode.Uri): string | null {
    const parts = uri.path.split("/");
    const testsIdx = parts.lastIndexOf("tests");
    if (testsIdx < 1) return null;
    return parts[testsIdx - 1];
  }

  private buildTestTree(modules: ModuleInfo[]): void {
    this.ctrl.items.replace([]);
    this.moduleItems.clear();
    this.classItems.clear();
    this.methodItems.clear();

    for (const mod of modules) {
      const moduleId = `module:${mod.name}`;
      const moduleItem = this.ctrl.createTestItem(moduleId, mod.name);
      moduleItem.description = `${mod.test_count} tests, ${mod.class_count} classes`;
      moduleItem.canResolveChildren = false;

      for (const file of mod.test_files) {
        for (const className of file.classes) {
          const classId = `class:${mod.name}.${className}`;
          const localKey = `${mod.name}.${className}`;
          const local = this.localIndex.get(localKey);

          const classItem = this.ctrl.createTestItem(
            classId,
            className,
            local?.uri
          );
          classItem.description = file.name;

          if (local) {
            classItem.range = new vscode.Range(local.classLine, 0, local.classLine, 0);

            // Add method-level items from local parsing
            for (const [methodName, line] of local.methods) {
              const methodId = `method:${mod.name}.${className}.${methodName}`;
              const methodItem = this.ctrl.createTestItem(
                methodId,
                methodName,
                local.uri
              );
              methodItem.range = new vscode.Range(line, 0, line, 0);
              classItem.children.add(methodItem);
              this.methodItems.set(methodId, methodItem);
            }
          }

          moduleItem.children.add(classItem);
          this.classItems.set(classId, classItem);
        }
      }

      this.ctrl.items.add(moduleItem);
      this.moduleItems.set(moduleId, moduleItem);
    }
  }

  private async runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.ctrl.createTestRun(request);
    const config = vscode.workspace.getConfiguration("todoo");

    const running = await this.client.isServerRunning();
    if (!running) {
      vscode.window.showErrorMessage("Todoo server is not running.");
      run.end();
      return;
    }

    const testTags = this.resolveTestTags(request);
    if (!testTags) {
      vscode.window.showErrorMessage("Could not determine test tags to run.");
      run.end();
      return;
    }

    const includedItems = this.collectTestItems(request);
    for (const item of includedItems) {
      run.enqueued(item);
    }

    const params = {
      test_tags: testTags,
      db_name: config.get<string>("dbName", "odoo"),
      db_host: config.get<string>("dbHost", "db"),
      db_password: config.get<string>("dbPassword", "odoo"),
      http_port: config.get<number>("odooPort", 8070),
      with_coverage: false,
    };

    this.outputChannel.appendLine(`\n--- Running: ${testTags} ---`);
    this.outputChannel.show(true);

    const activeItems = new Map<string, vscode.TestItem>();

    try {
      await this.client.runTests(
        params,
        {
          onLog: (line) => {
            this.logLine(line);
          },
          onResult: (result) => {
            this.handleTestResult(run, result, activeItems);
          },
          onComplete: (status, summary) => {
            this.outputChannel.appendLine(
              `\n--- Complete: ${status} | ${summary?.total ?? 0} tests, ` +
                `${summary?.passed ?? 0} passed, ${summary?.failed ?? 0} failed, ` +
                `${summary?.errors ?? 0} errors ---`
            );
          },
          onError: (message) => {
            this.outputChannel.error(message);
            for (const item of includedItems) {
              run.errored(item, new vscode.TestMessage(message));
            }
          },
        },
        token
      );
    } catch (err: any) {
      this.outputChannel.error(`Connection error: ${err.message}`);
      vscode.window.showErrorMessage(`Todoo: ${err.message}`);
    }

    run.end();
  }

  private async debugHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken
  ): Promise<void> {
    const run = this.ctrl.createTestRun(request);
    const config = vscode.workspace.getConfiguration("todoo");
    const debugPort = config.get<number>("debugPort", 5678);

    const running = await this.client.isServerRunning();
    if (!running) {
      vscode.window.showErrorMessage("Todoo server is not running.");
      run.end();
      return;
    }

    const testTags = this.resolveTestTags(request);
    if (!testTags) {
      vscode.window.showErrorMessage("Could not determine test tags to run.");
      run.end();
      return;
    }

    const includedItems = this.collectTestItems(request);
    for (const item of includedItems) {
      run.enqueued(item);
    }

    const params = {
      test_tags: testTags,
      db_name: config.get<string>("dbName", "odoo"),
      db_host: config.get<string>("dbHost", "db"),
      db_password: config.get<string>("dbPassword", "odoo"),
      http_port: config.get<number>("odooPort", 8070),
      with_coverage: false,
      debug: true,
      debug_port: debugPort,
    };

    this.outputChannel.info(`Debug: ${testTags}`);
    this.outputChannel.show(true);

    const activeItems = new Map<string, vscode.TestItem>();

    try {
      await this.client.runTests(
        params,
        {
          onLog: (line) => {
            this.logLine(line);
          },
          onResult: (result) => {
            this.handleTestResult(run, result, activeItems);
          },
          onDebugReady: async (port) => {
            const pathMappings = this.buildPathMappings();
            await vscode.debug.startDebugging(undefined, {
              name: "Todoo: Debug Odoo Test",
              type: "debugpy",
              request: "attach",
              connect: {
                host: config.get<string>("serverHost", "127.0.0.1"),
                port: port,
              },
              pathMappings: pathMappings,
              justMyCode: true,
            });
          },
          onComplete: (status, summary) => {
            this.outputChannel.info(
              `Debug complete: ${status} | ${summary?.total ?? 0} tests, ` +
                `${summary?.passed ?? 0} passed, ${summary?.failed ?? 0} failed, ` +
                `${summary?.errors ?? 0} errors`
            );
          },
          onError: (message) => {
            this.outputChannel.error(message);
            for (const item of includedItems) {
              run.errored(item, new vscode.TestMessage(message));
            }
          },
        },
        token
      );
    } catch (err: any) {
      this.outputChannel.error(`Connection error: ${err.message}`);
      vscode.window.showErrorMessage(`Todoo: ${err.message}`);
    }

    run.end();
  }

  private buildPathMappings(): Array<{
    localRoot: string;
    remoteRoot: string;
  }> {
    const config = vscode.workspace.getConfiguration("todoo");
    const custom = config.get<
      Array<{ localRoot: string; remoteRoot: string }>
    >("pathMappings", []);
    if (custom.length > 0) return custom;

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

    return mappings;
  }

  private handleTestResult(
    run: vscode.TestRun,
    result: TestResult,
    activeItems: Map<string, vscode.TestItem>
  ): void {
    const classId = `class:${result.module}.${result.test_class}`;
    const methodId = `method:${result.module}.${result.test_class}.${result.test_method}`;

    let methodItem = this.methodItems.get(methodId) ?? activeItems.get(methodId);

    if (!methodItem) {
      let classItem = this.classItems.get(classId);
      if (!classItem) {
        const moduleId = `module:${result.module}`;
        let moduleItem = this.moduleItems.get(moduleId);
        if (!moduleItem) {
          moduleItem = this.ctrl.createTestItem(moduleId, result.module);
          this.ctrl.items.add(moduleItem);
          this.moduleItems.set(moduleId, moduleItem);
        }
        classItem = this.ctrl.createTestItem(classId, result.test_class);
        moduleItem.children.add(classItem);
        this.classItems.set(classId, classItem);
      }

      const localKey = `${result.module}.${result.test_class}`;
      const local = this.localIndex.get(localKey);
      const methodLine = local?.methods.get(result.test_method);

      methodItem = this.ctrl.createTestItem(
        methodId,
        result.test_method,
        local?.uri
      );
      if (methodLine != null) {
        methodItem.range = new vscode.Range(methodLine, 0, methodLine, 0);
      }
      classItem.children.add(methodItem);
      activeItems.set(methodId, methodItem);
      this.methodItems.set(methodId, methodItem);
    }

    const duration = result.duration_ms;

    // Per-test logs in the test output panel
    if (result.log_lines && result.log_lines.length > 0) {
      run.appendOutput(
        `\r\n--- ${result.test_class}.${result.test_method} ---\r\n`
      );
      for (const line of result.log_lines) {
        run.appendOutput(line.replace(/\n/g, "\r\n") + "\r\n");
      }
    }

    switch (result.status) {
      case "running":
        run.started(methodItem);
        break;
      case "passed":
        run.passed(methodItem, duration);
        break;
      case "failed":
      case "error": {
        const lines: string[] = [];
        if (result.error_message) {
          lines.push(result.error_message);
        }
        if (result.error_log_count > 0) {
          lines.push(`${result.error_log_count} ERROR log(s) during execution`);
        }
        if (result.warning_log_count > 0) {
          lines.push(`${result.warning_log_count} WARNING log(s) during execution`);
        }
        if (result.log_lines && result.log_lines.length > 0) {
          lines.push("", "--- Odoo Logs ---", ...result.log_lines);
        }

        const msg = new vscode.TestMessage(
          new vscode.MarkdownString(
            "```\n" +
              (lines.length > 0 ? lines.join("\n") : `Test ${result.status}`) +
              "\n```"
          )
        );

        if (result.status === "error") {
          run.errored(methodItem, msg, duration);
        } else {
          run.failed(methodItem, msg, duration);
        }
        break;
      }
    }
  }

  private resolveTestTags(request: vscode.TestRunRequest): string | null {
    if (!request.include || request.include.length === 0) {
      const moduleTags: string[] = [];
      this.ctrl.items.forEach((item) => {
        moduleTags.push(`/${item.id.replace("module:", "")}`);
      });
      return moduleTags.length > 0 ? moduleTags.join(",") : null;
    }

    const tags: string[] = [];
    for (const item of request.include) {
      if (item.id.startsWith("module:")) {
        tags.push(`/${item.id.replace("module:", "")}`);
      } else if (item.id.startsWith("class:")) {
        const parts = item.id.replace("class:", "").split(".");
        tags.push(`/${parts[0]}:${parts[1]}`);
      } else if (item.id.startsWith("method:")) {
        const parts = item.id.replace("method:", "").split(".");
        tags.push(`/${parts[0]}:${parts[1]}.${parts[2]}`);
      }
    }

    return tags.join(",") || null;
  }

  private collectTestItems(request: vscode.TestRunRequest): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];

    const collectChildren = (item: vscode.TestItem) => {
      items.push(item);
      item.children.forEach((child) => collectChildren(child));
    };

    if (!request.include || request.include.length === 0) {
      this.ctrl.items.forEach((item) => collectChildren(item));
    } else {
      for (const item of request.include) {
        collectChildren(item);
      }
    }

    return items;
  }

  dispose(): void {
    this.runProfiles.forEach((p) => p.dispose());
    this.ctrl.dispose();
    this.outputChannel.dispose();
  }
}
