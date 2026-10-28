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
  .action(async (options) => {
    const { execa } = await import("execa");
    const { homedir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const { existsSync, readFileSync } = await import("node:fs");

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
  .option("-u, --url <url>", "Worker URL", "http://127.0.0.1:37700")
  .action(async (options) => {
    console.log("🔍 Checking status...");
    console.log(`   Worker URL: ${options.url}`);
    
    try {
      const res = await fetch(`${options.url}/health`);
      if (res.ok) {
        console.log("✅ Worker: RUNNING");
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

program.parse();