# opencode-claude-mem

**Shared session memory for opencode** — syncs your conversation history, tool observations, and context to the [claude-mem](https://github.com/thedotmack/claude-mem) worker, enabling persistent memory across **opencode**, **Claude Code**, and **Cursor**.

## Features

- 🔄 **Cross-agent memory** — Sessions persist across opencode, Claude Code, and Cursor
- 🧠 **Context injection** — Relevant past conversations automatically injected into new sessions
- 📝 **Tool observations** — All tool executions recorded for future reference
- ⚡ **Circuit breaker** — Automatic failover if worker is unavailable
- 🔒 **Privacy-first** — Local worker, your data never leaves your machine
- 🌐 **Cross-platform** — Works on Windows, macOS, and Linux

## Architecture

```
┌─────────────┐     HTTP/JSON      ┌──────────────────┐
│   opencode  │ ◄────────────────► │  claude-mem      │
│  (plugin)   │                    │  (worker)        │
└─────────────┘                    └────────┬─────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
            ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
            │  opencode   │         │ Claude Code │         │   Cursor    │
            │  (this)     │         │  (hooks)    │         │  (hooks)    │
            └─────────────┘         └─────────────┘         └─────────────┘
```

## Prerequisites

1. **Node.js ≥ 20**
2. **claude-mem worker** running locally (see [Worker Setup](#worker-setup))

## Installation

### Quick Install (Recommended)

```bash
# Install globally (available in all projects)
npm install -g opencode-claude-mem

# Or use npx for one-off
npx opencode-claude-mem install
```

### Manual Install

```bash
# Clone and build
git clone https://github.com/yourusername/opencode-claude-mem
cd opencode-claude-mem
npm install
npm run build

# Link to opencode config
opencode-claude-mem link
```

### Worker Setup

The plugin requires a **claude-mem worker** running on `http://127.0.0.1:37700` (default).

```bash
# Install worker globally
npm install -g @thedotmack/claude-mem

# Start worker (runs in background)
claude-mem worker start

# Or run in foreground for debugging
claude-mem worker
```

**Worker Configuration** (`~/.claude-mem/settings.json`):
```json
{
  "CLAUDE_MEM_WORKER_PORT": "37700",
  "CLAUDE_MEM_WORKER_HOST": "127.0.0.1",
  "CLAUDE_MEM_DATA_DIR": "~/.claude-mem"
}
```

## Configuration

Add to your opencode config (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-claude-mem", {
      "workerUrl": "http://127.0.0.1:37700",
      "contextCacheMs": 60000,
      "maxToolResponseLen": 1000,
      "circuitBreakerThreshold": 3,
      "circuitBreakerTimeoutMs": 30000
    }]
  ]
}
```

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `workerUrl` | `string` | `"http://127.0.0.1:37700"` | Worker HTTP endpoint |
| `contextCacheMs` | `number` | `60000` | Context injection cache TTL |
| `maxToolResponseLen` | `number` | `1000` | Max chars for tool response in observations |
| `circuitBreakerThreshold` | `number` | `3` | Failures before opening circuit |
| `circuitBreakerTimeoutMs` | `number` | `30000` | Time before circuit half-opens |

## Usage

### Automatic (No Changes Needed)

Once installed and configured, the plugin works automatically:

1. **Start opencode** — Plugin loads and connects to worker
2. **Chat normally** — Prompts, tool calls, and responses are recorded
3. **Context injection** — Relevant history appears as system messages
4. **Switch projects** — Memory follows you via working directory

### Commands

```bash
# Check plugin status
opencode-claude-mem status

# View current session info
opencode-claude-mem session

# Clear local cache
opencode-claude-mem clear-cache

# Uninstall from opencode
opencode-claude-mem unlink
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_MEM_WORKER_URL` | Override worker URL |
| `CLAUDE_MEM_DATA_DIR` | Override data directory |
| `CLAUDE_MEM_WORKER_PORT` | Override worker port |
| `CLAUDE_MEM_WORKER_HOST` | Override worker host |

## How It Works

### Session Lifecycle

```
session_start
    │
    ▼
before_agent_start (records user prompt)
    │
    ▼
tool_result (records tool observations)
    │
    ▼
agent_end (captures assistant response)
    │
    ▼
session_shutdown (finalizes session)
```

### Data Flow

1. **User prompt** → `/api/sessions/init` (creates/continues session)
2. **Tool execution** → `/api/sessions/observations` (records input/output)
3. **Context request** → `/api/context/inject` (fetches relevant history)
4. **Session end** → `/api/sessions/summarize` (generates summary)

### Privacy

- All data stored locally in `~/.claude-mem/`
- No external network calls
- Worker only binds to `127.0.0.1` by default
- Sessions tied to working directory (project isolation)

## Troubleshooting

### Plugin Not Loading

```bash
# Check opencode logs
opencode --log-level debug

# Verify plugin entry in config
cat ~/.config/opencode/opencode.jsonc
```

### Worker Connection Failed

```bash
# Check worker is running
curl http://127.0.0.1:37700/health

# Check worker logs
claude-mem worker logs

# Restart worker
claude-mem worker restart
```

### Context Not Injecting

- Verify `experimental.chat.system.transform` hook fires
- Check circuit breaker isn't open (3 consecutive failures)
- Ensure worker has indexed sessions for current directory

### Reset Everything

```bash
# Stop worker
claude-mem worker stop

# Clear all data (⚠️ destructive)
rm -rf ~/.claude-mem

# Restart worker
claude-mem worker start
```

## Development

```bash
# Install deps
npm install

# Watch mode
npm run dev

# Run tests
npm test

# Build
npm run build

# Link locally for testing
npm link
cd ~/.config/opencode
npm link opencode-claude-mem
```

## API Reference

### Worker Endpoints Used

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions/init` | Initialize/continue session |
| `POST` | `/api/sessions/observations` | Record tool observation |
| `POST` | `/api/sessions/summarize` | Finalize session with summary |
| `GET` | `/api/context/inject` | Fetch context for injection |
| `GET` | `/health` | Health check |

### Hook Events Handled

| Hook | Purpose |
|------|---------|
| `chat.message` | Capture user prompts & assistant responses |
| `tool.execute.after` | Record tool observations |
| `experimental.chat.system.transform` | Inject context from worker |
| `dispose` | Cleanup on session end |

## Contributing

1. Fork the repo
2. Create feature branch
3. Make changes with tests
4. Run `npm run build && npm test`
5. Submit PR

## License

MIT — see [LICENSE](LICENSE) for details.

## Related

- [claude-mem](https://github.com/thedotmack/claude-mem) — Core worker & hooks for Claude Code/Cursor
- [opencode](https://opencode.ai) — The AI coding agent
- [oh-my-pi](https://github.com/rebelytics/oh-my-pi) — Original hook implementation