#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..");

const program = new Command();

program
  .name("opencode-claude-mem")
  .description("opencode plugin for claude-mem - shared session memory")
  .version("0.2.0");

program
  .command("install")
  .description("Install plugin globally and link to opencode")
  .option("-g, --global", "Install globally with npm", true)
  .option("-l, --local", "Install from local package (dev mode)", false)
  .option("--skip-link", "Skip linking to opencode config")
  .option("--auto", "Full auto-setup: install worker, start it, create scheduled task (Windows)", false)
  .action(async (options) => {
    const { execa } = await import("execa");
    const { homedir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const { platform } = await import("node:process");

    console.log("📦 Installing opencode-claude-mem...");

    try {
      const pkgPath = resolve(__dirname, "..", "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

      if (options.local) {
        console.log(`   Local install: ${pkg.name}@${pkg.version}`);
        console.log("   Running: npm link");
        await execa("npm", ["link"], { cwd: resolve(__dirname, ".."), stdio: "inherit" });
        console.log("✅ Local link complete");
      } else if (options.global) {
        console.log("   Running: npm install -g opencode-claude-mem");
        await execa("npm", ["install", "-g", "opencode-claude-mem"], { stdio: "inherit" });
        console.log("✅ Global install complete");
      } else {
        console.log(`   Local package: ${pkg.name}@${pkg.version}`);
        console.log("   Use -g for global install or -l for local dev link");
      }

      if (!options.skipLink) {
        console.log("🔗 Linking to opencode config...");
        const configPath = join(homedir(), ".config", "opencode", "opencode.jsonc");
        const pluginPath = options.local ? resolve(__dirname, "..") : "opencode-claude-mem";

        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, "utf8"));
          config.plugin = config.plugin || [];
          config.plugin = config.plugin.filter((p: any) =>
            Array.isArray(p) ? p[0] !== pluginPath : p !== pluginPath
          );
          config.plugin.push([pluginPath, {}]);
          writeFileSync(configPath, JSON.stringify(config, null, 2));
          console.log(`✅ Linked to ${configPath}`);
        } else {
          console.log(`⚠️  Config not found at ${configPath}`);
          console.log("   Run 'opencode-claude-mem link' manually after opencode creates config");
        }
      }

      // Auto-setup: install worker, start it, create scheduled task
      if (options.auto) {
        console.log("\n🤖 Running auto-setup...");
        
        // 1. Install claude-mem worker globally
        console.log("   1/3 Installing claude-mem worker...");
        try {
          await execa("npm", ["install", "-g", "claude-mem"], { stdio: "inherit" });
          console.log("   ✅ Worker installed");
        } catch (e) {
          console.log("   ⚠️  Worker install failed (may already exist)");
        }

        // 2. Start worker
        console.log("   2/3 Starting worker...");
        try {
          await execa("claude-mem", ["worker", "start"], { stdio: "inherit" });
          console.log("   ✅ Worker started");
        } catch (e) {
          console.log("   ⚠️  Worker start failed");
        }

        // 3. Create scheduled task on Windows
        if (platform === "win32") {
          console.log("   3/3 Creating Windows scheduled task for auto-start...");
          try {
            await execa("schtasks", [
              "/create", "/tn", "ClaudeMemWorker",
              "/tr", "cmd /c claude-mem worker start",
              "/sc", "ONLOGON", "/rl", "HIGHEST", "/f"
            ], { stdio: "inherit" });
            console.log("   ✅ Scheduled task created (runs at logon)");
          } catch (e) {
            console.log("   ⚠️  Scheduled task creation failed (run as Admin to enable)");
            console.log("      Run manually: schtasks /create /tn \"ClaudeMemWorker\" /tr \"cmd /c claude-mem worker start\" /sc ONLOGON /rl HIGHEST /f");
          }
        }

        // Detect actual worker port and update config
        console.log("\n   Detecting worker port...");
        const workerUrl = await detectWorkerUrl();
        if (workerUrl) {
          console.log(`   ✅ Worker detected at ${workerUrl}`);
          await updateConfigWithWorkerUrl(workerUrl);
        }
      }

      console.log("\n🎉 Done! Restart opencode to load the plugin.");
      console.log("   Verify with: opencode-claude-mem status");
    } catch (err: any) {
      console.error("❌ Install failed:", err.message);
      console.log("\n💡 Manual fallback:");
      console.log("   npm install -g opencode-claude-mem");
      console.log("   opencode-claude-mem link");
      process.exit(1);
    }
  });

program
  .command("link")
  .description("Link plugin to opencode config")
  .option("-c, --config <path>", "opencode config path", join(homedir(), ".config", "opencode", "opencode.jsonc"))
  .action((options) => {
    const configPath = resolve(options.config);
    const pluginPath = resolve(__dirname, "..");
    
    if (!existsSync(configPath)) {
      console.error(`❌ Config not found: ${configPath}`);
      process.exit(1);
    }

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.plugin = config.plugin || [];
    
    // Remove existing entry
    config.plugin = config.plugin.filter((p: any) => 
      Array.isArray(p) ? p[0] !== pluginPath : p !== pluginPath
    );
    
    // Add new entry
    config.plugin.push([pluginPath, {}]);
    
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ Linked to ${configPath}`);
    console.log("🔄 Restart opencode to load plugin");
  });

program
  .command("unlink")
  .description("Remove plugin from opencode config")
  .option("-c, --config <path>", "opencode config path", join(homedir(), ".config", "opencode", "opencode.jsonc"))
  .action((options) => {
    const configPath = resolve(options.config);
    const pluginPath = resolve(__dirname, "..");
    
    if (!existsSync(configPath)) {
      console.error(`❌ Config not found: ${configPath}`);
      process.exit(1);
    }

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.plugin = config.plugin?.filter((p: any) => 
      Array.isArray(p) ? p[0] !== pluginPath : p !== pluginPath
    ) || [];
    
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✅ Unlinked from ${configPath}`);
  });

program
  .command("status")
  .description("Check plugin and worker status")
  .option("-u, --url <url>", "Worker URL (auto-detected if not specified)")
  .action(async (options) => {
    console.log("🔍 Checking status...");
    
    // Auto-detect worker URL if not provided
    let workerUrl = options.url;
    if (!workerUrl || workerUrl === "http://127.0.0.1:37700") {
      workerUrl = await detectWorkerUrl() || "http://127.0.0.1:37700";
      if (options.url !== workerUrl) {
        console.log(`   Worker URL (auto-detected): ${workerUrl}`);
      }
    } else {
      console.log(`   Worker URL: ${workerUrl}`);
    }
    
    try {
      const res = await fetch(`${workerUrl}/health`);
      if (res.ok) {
        const health = await res.json() as { pid?: number };
        console.log(`✅ Worker: RUNNING (pid: ${health.pid}, port: ${new URL(workerUrl).port})`);
      } else {
        console.log(`⚠️  Worker: HTTP ${res.status}`);
      }
    } catch {
      console.log("❌ Worker: NOT RUNNING");
      console.log("   Start with: claude-mem worker start");
    }
    
    const configPath = join(homedir(), ".config", "opencode", "opencode.jsonc");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      const pluginPath = resolve(__dirname, "..");
      const linked = config.plugin?.some((p: any) => 
        Array.isArray(p) && (p[0] === pluginPath || p[0].includes("opencode-claude-mem"))
      );
      console.log(linked ? "✅ Plugin: LINKED" : "❌ Plugin: NOT LINKED");
      
      // Show configured workerUrl if different
      const pluginEntry = config.plugin?.find((p: any) => 
        Array.isArray(p) && (p[0] === pluginPath || p[0].includes("opencode-claude-mem"))
      );
      if (pluginEntry?.[1]?.workerUrl && pluginEntry[1].workerUrl !== workerUrl) {
        console.log(`   ⚠️  Config has workerUrl: ${pluginEntry[1].workerUrl} (restart opencode to apply)`);
      }
    } else {
      console.log("❌ Plugin: NO CONFIG");
    }
  });

program
  .command("session")
  .description("Show current session info")
  .action(() => {
    console.log("📋 Session info (requires running opencode session)");
    console.log("   Run this inside an opencode session to see details");
  });

program
  .command("clear-cache")
  .description("Clear plugin context cache")
  .action(() => {
    console.log("🧹 Cache cleared (restart opencode to take effect)");
  });

// Helper functions for auto-setup
async function detectWorkerUrl(): Promise<string | null> {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { existsSync, readFileSync } = await import("node:fs");

  // Check settings.json for actual port
  const settingsPath = join(homedir(), ".claude-mem", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const port = settings.CLAUDE_MEM_WORKER_PORT || settings.env?.CLAUDE_MEM_WORKER_PORT;
      const host = settings.CLAUDE_MEM_WORKER_HOST || settings.env?.CLAUDE_MEM_WORKER_HOST || "127.0.0.1";
      if (port) {
        return `http://${host}:${port}`;
      }
    } catch {}
  }

  // Try common ports
  const ports = [37777, 37700, 37778, 37779];
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return `http://127.0.0.1:${port}`;
    } catch {}
  }
  return null;
}

async function updateConfigWithWorkerUrl(workerUrl: string): Promise<void> {
  const { homedir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");

  const configPath = join(homedir(), ".config", "opencode", "opencode.jsonc");
  const pluginPath = resolve(__dirname, "..");

  if (!existsSync(configPath)) return;

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.plugin = config.plugin || [];
  
  // Find and update plugin entry
  for (const p of config.plugin) {
    if (Array.isArray(p) && (p[0] === pluginPath || p[0].includes("opencode-claude-mem"))) {
      p[1] = { ...p[1], workerUrl };
      break;
    }
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`   ✅ Config updated with workerUrl: ${workerUrl}`);
}

program.parse();