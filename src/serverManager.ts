import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";

export class ServerManager {
  private process: ChildProcess | null = null;
  private outputChannel: vscode.LogOutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Todoo Server", {
      log: true,
    });
  }

  async start(port: number, host: string): Promise<void> {
    if (this.process) {
      vscode.window.showInformationMessage("Todoo server is already running.");
      return;
    }

    const args = ["--port", String(port), "--host", host];

    this.outputChannel.info(`Starting todoo server on ${host}:${port}...`);
    this.outputChannel.show(true);

    this.process = spawn("todoo", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        if (line.trim()) this.outputChannel.info(line);
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        if (line.trim()) this.outputChannel.warn(line);
      }
    });

    this.process.on("exit", (code) => {
      this.outputChannel.info(`Server exited with code ${code}`);
      this.process = null;
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
      this.outputChannel.info("Server stopped.");
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
