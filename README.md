# Todoo - VS Code Extension

VS Code extension for [Todoo](https://github.com/sarkande/todoo), the Odoo Test Runner. Run, visualize, and navigate Odoo tests directly from the VS Code Test Explorer.

## Features

- **Test Explorer integration** — your Odoo tests appear in the VS Code Testing sidebar with module > class > method hierarchy
- **Gutter play buttons** — run a single test method or class directly from the editor gutter
- **Click to navigate** — click any test in the explorer to jump to its source code
- **Real-time results** — test execution streams results via WebSocket as they complete (pass/fail/error)
- **Per-test logs** — view Odoo logs, error messages, ERROR/WARNING counts for each test
- **Container selection** — pick your Docker container from the command palette
- **Auto-refresh** — file watcher updates the test tree when you modify test files

## Requirements

- [Todoo](https://github.com/sarkande/todoo) installed (`pip install odoo-test-runner` or `pipx install odoo-test-runner`)
- A running Docker container with Odoo
- VS Code 1.85+

## Getting Started

1. Install the extension from the `.vsix` file:
   ```
   code --install-extension todoo-vscode-0.2.2.vsix
   ```

2. Start the Todoo server:
   ```
   todoo
   ```
   Or use the command palette: `Todoo: Start Server`

3. Select your Docker container: `Cmd+Shift+P` > `Todoo: Select Docker Container`

4. Open the Testing sidebar (`Cmd+Shift+T`) — your tests are there

5. Click the play button next to any module, class, or method to run it

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

## How It Works

The extension uses a hybrid approach for test discovery:

1. **API discovery** — fetches modules and test classes from the Todoo server (which scans the Docker container filesystem)
2. **Local file parsing** — scans `**/tests/test_*.py` files in your workspace to find source locations (line numbers)
3. **Matching** — enriches API-discovered tests with local file URIs and ranges for navigation and gutter buttons

Test execution happens over WebSocket (`/ws/run-tests`), streaming results in real-time as each test completes.

## Development

```bash
npm install
npm run build
vsce package --allow-missing-repository
```
