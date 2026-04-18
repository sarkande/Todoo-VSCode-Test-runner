export interface TodooConfig {
  serverHost: string;
  serverPort: number;
  container: string;
  dbName: string;
  dbHost: string;
  dbPassword: string;
  odooPort: number;
  autoStart: boolean;
  preferredService: string;
  debugPort: number;
}

export interface TestFile {
  name: string;
  classes: string[];
}

export interface ModuleInfo {
  name: string;
  path: string;
  test_files: TestFile[];
  test_count: number;
  class_count: number;
}

export interface TestResult {
  module: string;
  test_class: string;
  test_method: string;
  status: "passed" | "failed" | "error" | "running";
  timestamp?: string;
  duration_ms?: number;
  queries?: number;
  error_message?: string;
  log_lines: string[];
  error_log_count: number;
  warning_log_count: number;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
}

export interface WsMessage {
  type: "log" | "test_result" | "complete" | "error" | "debug_ready";
  line?: string;
  result?: TestResult;
  status?: string;
  summary?: TestSummary;
  message?: string;
  port?: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
}

export interface TestParams {
  test_tags: string;
  db_name: string;
  db_host: string;
  db_password: string;
  http_port: number;
  with_coverage: boolean;
  debug?: boolean;
  debug_port?: number;
}
