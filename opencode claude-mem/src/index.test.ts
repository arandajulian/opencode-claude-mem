import { describe, it, expect, vi, beforeEach } from "vitest";
import { textFromContent, readClaudeMemSettings, resolveWorkerUrl } from "./index.js";

describe("opencode-claude-mem", () => {
  describe("textFromContent", () => {
    it("returns string as-is", () => {
      expect(textFromContent("hello")).toBe("hello");
    });

    it("extracts text from array of parts", () => {
      const parts = [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ];
      expect(textFromContent(parts)).toBe("hello\nworld");
    });

    it("handles non-text parts", () => {
      const parts = [
        { type: "text", text: "hello" },
        { type: "tool", name: "bash" },
      ];
      expect(textFromContent(parts)).toBe("hello");
    });

    it("returns empty for unknown types", () => {
      expect(textFromContent(null)).toBe("");
      expect(textFromContent(123)).toBe("");
    });
  });

  describe("readClaudeMemSettings", () => {
    it("returns settings object (may be empty or populated)", () => {
      const settings = readClaudeMemSettings();
      expect(typeof settings).toBe("object");
      expect(settings).not.toBeNull();
    });
  });

  describe("resolveWorkerUrl", () => {
    it("uses plugin config workerUrl", async () => {
      const url = await resolveWorkerUrl({ workerUrl: "http://custom:1234" });
      expect(url).toBe("http://custom:1234");
    });

    it("returns a valid URL", async () => {
      const url = await resolveWorkerUrl({});
      expect(url).toMatch(/^http:\/\/[\w.:]+:\d+$/);
    });
  });
});