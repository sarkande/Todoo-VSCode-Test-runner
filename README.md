# Todoo - VS Code Extension

VS Code extension for [Todoo](https://github.com/sarkande/todoo), the Odoo Test Runner. Run, debug, and navigate Odoo tests directly from the VS Code Test Explorer.

## Features

- **Test Explorer integration** — your Odoo tests appear in the VS Code Testing sidebar with module > class > method hierarchy
- **Gutter play buttons** — run a single test method or class directly from the editor gutter
- **Click to navigate** — click any test in the explorer to jump to its source code
- **Real-time results** — test execution streams results via WebSocket as they complete (pass/fail/error)
- **Per-test logs** — view Odoo logs, error messages, ERROR/WARNING counts for each test
- **Colorized log output** — ERROR (red), WARNING (orange), INFO, DEBUG levels in the output panel
- **Auto-resolve container** — automatically detects and selects the Docker container from your `docker-compose.yml`
- **Debug tests** — set breakpoints and debug Odoo tests with debugpy integration
- **Auto-refresh** — file watcher updates the test tree when you modify test files

## Requirements

- [Todoo](https://github.com/sarkande/todoo) installed (`pip install odoo-test-runner` or `pipx install odoo-test-runner`)
- A running Docker container with Odoo
- VS Code 1.85+
- Python/debugpy VS Code extension (for debugging)

## Getting Started

1. Install the extension from the `.vsix` file:
   ```
   code --install-extension todoo-vscode-0.3.0.vsix
   ```

2. Start the Todoo server:
   ```
   todoo
   ```
   Or use the command palette: `Todoo: Start Server`

3. If you have a `docker-compose.yml` in your project, the "web" container is auto-selected. Otherwise: `Cmd+Shift+P` > `Todoo: Select Docker Container`

4. Open the Testing sidebar (`Cmd+Shift+T`) — your tests are there

5. Click the play button next to any module, class, or method to run it

## Debugging Tests

1. Ensure port 5678 is exposed in your `docker-compose.yml`:
   ```yaml
   web:
     ports:
       - "5678:5678"
   ```

2. Set breakpoints in your test files

3. In the Test Explorer, use the "Debug Tests" profile (dropdown next to the play button) or right-click a test > "Debug Test"

4. The extension will install debugpy in the container, start the test with `--wait-for-client`, and auto-attach VS Code's debugger

Path mappings are auto-detected from your workspace folders, or you can configure them manually via `todoo.pathMappings`.

## Commands

| Command | Description |
|---------|-------------|
| `Todoo: Select Docker Container` | Pick which container to run tests in |
| `Todoo: Refresh Tests` | Re-discover tests from the server and local files |
| `Todoo: Start Server` | Start the Todoo server |
| `Todoo: Stop Server` | Stop the Todoo server |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `todoo.serverHost` | `127.0.0.1` | Todoo server host |
| `todoo.serverPort` | `8080` | Todoo server port |
| `todoo.container` | | Docker container name or ID |
| `todoo.dbName` | `odoo` | Odoo database name |
| `todoo.dbHost` | `db` | Database host |
| `todoo.dbPassword` | `odoo` | Database password |
| `todoo.odooPort` | `8070` | Odoo HTTP port inside the container |
| `todoo.autoStart` | `true` | Auto-start todoo server when running tests |
| `todoo.preferredService` | `web` | Docker Compose service to auto-select |
| `todoo.debugPort` | `5678` | debugpy port inside the container |
| `todoo.pathMappings` | `[]` | Custom local-to-container path mappings for debug |

## How It Works

**Test discovery** uses a hybrid approach:
1. **API discovery** — fetches modules and test classes from the Todoo server (scans Docker container filesystem)
2. **Local file parsing** — scans `**/tests/test_*.py` in your workspace for source locations
3. **Matching** — enriches API-discovered tests with local file URIs and ranges for navigation and gutter buttons

**Container auto-resolve**: Finds `docker-compose.yml` by walking up from workspace folders, runs `docker compose ps --format json`, and selects the configured service (default: "web").

**Test execution** happens over WebSocket (`/ws/run-tests`), streaming results in real-time.

**Debug mode** wraps the Odoo command with `debugpy --listen --wait-for-client`, signals readiness via WebSocket, and the extension auto-attaches VS Code's debugger with path mappings.

## Development

```bash
npm install
npm run build
vsce package --allow-missing-repository
```
