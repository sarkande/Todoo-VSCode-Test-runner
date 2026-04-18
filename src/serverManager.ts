import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";

export class ServerManager {
  private process: ChildProcess | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Todoo Server");
  }

  async start(port: number, host: string): Promise<void> {
    if (this.process) {
      vscode.window.showInformationMessage("Todoo server is already running.");
      return;
    }

    const args = ["--port", String(port), "--host", host];

    this.outputChannel.appendLine(`Starting todoo server on ${host}:${port}...`);
    this.outputChannel.show(true);

    this.process = spawn("todoo", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.process.on("exit", (code) => {
      this.outputChannel.appendLine(`\nServer exited with code ${code}`);
      this.process = null;
    });

    // Wait a bit for the server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
      this.outputChannel.appendLine("Server stopped.");
    }
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
  }
}
