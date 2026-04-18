import * as vscode from "vscode";
import WebSocket from "ws";
import {
  ContainerInfo,
  ModuleInfo,
  TestParams,
  TestResult,
  TodooConfig,
  WsMessage,
} from "./types";

export class TodooClient {
  private baseUrl: string;
  private wsUrl: string;

  constructor(private config: TodooConfig) {
    this.baseUrl = `http://${config.serverHost}:${config.serverPort}`;
    this.wsUrl = `ws://${config.serverHost}:${config.serverPort}`;
  }

  updateConfig(config: TodooConfig): void {
    this.config = config;
    this.baseUrl = `http://${config.serverHost}:${config.serverPort}`;
    this.wsUrl = `ws://${config.serverHost}:${config.serverPort}`;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, options);
    if (!res.ok) {
      throw new Error(`Todoo API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async isServerRunning(): Promise<boolean> {
    try {
      await fetch(`${this.baseUrl}/api/current-container`, {
        signal: AbortSignal.timeout(2000),
      });
      return true;
    } catch {
      return false;
    }
  }

  async getContainers(): Promise<ContainerInfo[]> {
    return this.fetch<ContainerInfo[]>("/api/containers");
  }

  async selectContainer(containerId: string): Promise<void> {
    await this.fetch("/api/select-container", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ container_id: containerId }),
    });
  }

  async getModules(): Promise<ModuleInfo[]> {
    const data = await this.fetch<{ modules: ModuleInfo[] }>("/api/modules");
    return data.modules;
  }

  runTests(
    params: TestParams,
    callbacks: {
      onLog?: (line: string) => void;
      onResult?: (result: TestResult) => void;
      onComplete?: (status: string, summary: any) => void;
      onError?: (message: string) => void;
    },
    token?: vscode.CancellationToken
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/ws/run-tests`);

      token?.onCancellationRequested(() => {
        ws.close();
        resolve();
      });

      ws.on("open", () => {
        ws.send(JSON.stringify(params));
      });

      ws.on("message", (data: Buffer) => {
        const msg: WsMessage = JSON.parse(data.toString());
        switch (msg.type) {
          case "log":
            callbacks.onLog?.(msg.line!);
            break;
          case "test_result":
            callbacks.onResult?.(msg.result!);
            break;
          case "complete":
            callbacks.onComplete?.(msg.status!, msg.summary);
            ws.close();
            resolve();
            break;
          case "error":
            callbacks.onError?.(msg.message!);
            ws.close();
            reject(new Error(msg.message));
            break;
        }
      });

      ws.on("error", (err) => {
        reject(
          new Error(`WebSocket connection failed: ${err.message}`)
        );
      });

      ws.on("close", () => {
        resolve();
      });
    });
  }
}
