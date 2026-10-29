import type { Plugin, Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types & Config
// ---------------------------------------------------------------------------

interface PluginConfig {
  workerUrl?: string;
  contextCacheMs?: number;
  maxToolResponseLen?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeoutMs?: number;
}

interface ClaudeMemSettings {
  CLAUDE_MEM_DATA_DIR?: string;
  CLAUDE_MEM_WORKER_PORT?: string;
  CLAUDE_MEM_WORKER_HOST?: string;
}

interface OpencodeSession {
  id: string;
  lastInit?: Promise<boolean>;
  observations?: Promise<void>;
  anchored: boolean;
  excluded: boolean;
}

// ---------------------------------------------------------------------------
// Config Resolution
// ---------------------------------------------------------------------------

export function readClaudeMemSettings(): ClaudeMemSettings {
  const dataDir = process.env.CLAUDE_MEM_DATA_DIR || join(homedir(), ".claude-mem");
  const settingsPath = join(dataDir, "settings.json");
  try {
    if (existsSync(settingsPath)) {
      const doc = JSON.parse(readFileSync(settingsPath, "utf8").replace(/^\uFEFF/, ""));
      const env = doc?.env;
      const nested = env !== null && typeof env === "object" && !Array.isArray(env)
        && Object.keys(env).some(key => key.startsWith("CLAUDE_MEM_"));
      return nested ? env : (doc ?? {});
    }
  } catch {}
  return {};
}

// Auto-detect worker port by probing common ports
async function detectWorkerPort(): Promise<number | null> {
  const ports = [37777, 37700, 37778, 37779, 37780];
  for (const port of ports) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return port;
    } catch {}
  }
  return null;
}

export async function resolveWorkerUrl(config: PluginConfig): Promise<string> {
  // Priority: plugin config > env > settings.json > auto-detect > default
  if (config.workerUrl) return config.workerUrl;
  
  const envUrl = process.env.CLAUDE_MEM_WORKER_URL;
  if (envUrl) return envUrl;
  
  const settings = readClaudeMemSettings();
  const host = process.env.CLAUDE_MEM_WORKER_HOST || settings.CLAUDE_MEM_WORKER_HOST || "127.0.0.1";
  const port = process.env.CLAUDE_MEM_WORKER_PORT || settings.CLAUDE_MEM_WORKER_PORT;
  
  if (port) {
    const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `http://${urlHost}:${port}`;
  }
  
  // Auto-detect running worker
  const detectedPort = await detectWorkerPort();
  if (detectedPort) {
    console.log(`[claude-mem] Auto-detected worker at port ${detectedPort}`);
    const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `http://${urlHost}:${detectedPort}`;
  }
  
  // Fallback to default
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${urlHost}:37700`;
}

async function getConfig(config: PluginConfig | undefined): Promise<Required<PluginConfig>> {
  return {
    workerUrl: await resolveWorkerUrl(config ?? {}),
    contextCacheMs: config?.contextCacheMs ?? 60_000,
    maxToolResponseLen: config?.maxToolResponseLen ?? 1000,
    circuitBreakerThreshold: config?.circuitBreakerThreshold ?? 3,
    circuitBreakerTimeoutMs: config?.circuitBreakerTimeoutMs ?? 30_000,
  };
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

class CircuitBreaker {
  private tripCount = 0;
  private openUntil = 0;
  private readonly threshold: number;
  private readonly timeout: number;

  constructor(threshold: number, timeout: number) {
    this.threshold = threshold;
    this.timeout = timeout;
  }

  isOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  recordSuccess(): void {
    this.tripCount = 0;
    this.openUntil = 0;
  }

  recordFailure(): void {
    this.tripCount++;
    if (this.tripCount >= this.threshold) {
      this.openUntil = Date.now() + this.timeout;
      this.tripCount = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP Client
// ---------------------------------------------------------------------------

async function request(url: string, path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  
  try {
    const r = await fetch(`${url}${path}`, { 
      ...init, 
      signal: controller.signal 
    });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r;
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(url: string, path: string, body: unknown): Promise<Response> {
  return request(url, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(url: string, path: string, body: unknown): Promise<void> {
  await postJson(url, path, body);
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

let session: OpencodeSession | undefined;
let ctxCache: { at: number; cwd: string; md: string } | null = null;
let lastAssistant = "";
let breaker: CircuitBreaker;
let cfg: Required<PluginConfig>;

function newSession(): OpencodeSession {
  session = { 
    id: `opencode-${process.pid}-${randomUUID()}`, 
    anchored: false, 
    excluded: false 
  };
  return session;
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(c => (c && typeof c === "object" && "type" in c && c.type === "text" ? String(c.text ?? "") : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function sendPrompt(target: OpencodeSession, cwd: string | undefined, prompt: string): void {
  const body: Record<string, unknown> = { 
    contentSessionId: target.id, 
    prompt, 
    platformSource: "opencode" 
  };
  if (cwd) body.cwd = cwd;
  target.lastInit = (target.lastInit ?? Promise.resolve(true)).then(() => recordPrompt(target, body));
}

async function recordPrompt(target: OpencodeSession, body: Record<string, unknown>): Promise<boolean> {
  if (target.excluded || breaker.isOpen()) return false;
  try {
    const r = await postJson(cfg.workerUrl, "/api/sessions/init", body);
    const reply = (await r.json()) as { reason?: unknown } | null;
    breaker.recordSuccess();
    if (reply?.reason === "project_excluded") {
      target.excluded = true;
      return false;
    }
    target.anchored = true;
    return true;
  } catch {
    breaker.recordFailure();
    return false;
  }
}

function finalize(target: OpencodeSession | undefined, assistantMessage: string): void {
  if (!target) return;
  void Promise.all([target.lastInit ?? Promise.resolve(false), target.observations]).then(() => {
    if (!target.anchored || target.excluded) return;
    post(cfg.workerUrl, "/api/sessions/summarize", {
      contentSessionId: target.id,
      last_assistant_message: assistantMessage,
      platformSource: "opencode",
    }).catch(() => breaker.recordFailure());
  });
}

async function recordObservation(target: OpencodeSession, body: Record<string, unknown>): Promise<void> {
  if (target.excluded || breaker.isOpen()) return;
  try {
    await post(cfg.workerUrl, "/api/sessions/observations", body);
    breaker.recordSuccess();
  } catch {
    breaker.recordFailure();
  }
}

async function fetchContext(cwd: string): Promise<string> {
  if (breaker.isOpen()) return "";
  try {
    const r = await request(cfg.workerUrl, `/api/context/inject?cwd=${encodeURIComponent(cwd)}&platformSource=opencode`);
    const md = (await r.text()) ?? "";
    breaker.recordSuccess();
    return md;
  } catch {
    breaker.recordFailure();
    return "";
  }
}

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

export default async function claudeMemPlugin(
  _input: PluginInput, 
  options?: PluginOptions
): Promise<Hooks> {
  // Initialize config and breaker
  cfg = await getConfig(options as PluginConfig | undefined);
  breaker = new CircuitBreaker(cfg.circuitBreakerThreshold, cfg.circuitBreakerTimeoutMs);
  
  // Initialize session
  newSession();

  return {
    // Capture user prompts
    async "chat.message"(input: any, _output: any) {
      const prompt = input.parts?.[0]?.text ?? input.message?.content ?? "";
      if (prompt && session) {
        sendPrompt(session, input.sessionID, prompt);
      }
      
      // Capture assistant responses for session summary
      if (input.message?.role === "assistant") {
        lastAssistant = textFromContent(input.message.content);
      }
    },

    // Record tool observations
    async "tool.execute.after"(input: any, output: any) {
      const target = session ?? newSession();
      if (target.excluded) return;

      const body: Record<string, unknown> = {
        contentSessionId: target.id,
        tool_name: input.tool,
        tool_input: input.args,
        tool_response: output.output?.slice(0, cfg.maxToolResponseLen),
        platformSource: "opencode",
      };
      if (input.sessionID) body.cwd = input.sessionID;

      const recorded = target.lastInit ?? Promise.resolve(true);
      target.observations = Promise.all([
        target.observations ?? Promise.resolve(),
        recorded.then(r => r ? recordObservation(target, body) : Promise.resolve())
      ]).then(() => {});
    },

    // Inject context from worker
    async "experimental.chat.system.transform"(_input: any, output: any) {
      if (breaker.isOpen()) return;
      
      const cwd = process.cwd();
      const now = Date.now();

      // Check cache
      if (!ctxCache || ctxCache.cwd !== cwd || now - ctxCache.at > cfg.contextCacheMs) {
        const md = await fetchContext(cwd);
        if (md.trim()) {
          ctxCache = { at: now, cwd, md };
        } else {
          ctxCache = null;
        }
      }

      const injected = ctxCache?.md?.trim();
      if (injected) {
        output.system = [...(output.system ?? []), injected];
      }
    },

    // Cleanup on session end
    async dispose(): Promise<void> {
      finalize(session, lastAssistant);
    },
  };
}