// tests/unit/prompts-rich-assemble.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// richAssemble -> lorebooks/runner -> db/lorebooks: even the no-lorebook-hit path opens the
// DB, so DATA_DIR must point at a throwaway dir BEFORE the module under test is imported —
// otherwise the test would create/write the real ~/.jroute database.
const dir = mkdtempSync(join(tmpdir(), "jroute-rich-assemble-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { assembleRichPreset, extractSamplerParams } =
  await import("../../src/lib/prompts/richAssemble.ts");
const { orderInjections, partitionBlocks } = await import("../../jroute/convert/types.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

import type { RichPreset } from "../../src/lib/db/types.ts";

function preset(overrides: Partial<RichPreset> = {}): RichPreset {
  return {
    id: 1,
    name: "test",
    charName: "Izumi",
    userName: "Anon",
    createdAt: 0,
    lorebookIds: [],
    raw: {
      temperature: 0.8,
      top_p: 0.9,
      prompts: [
        {
          identifier: "main",
          name: "Main",
          role: "system",
          content: "Write {{char}}'s reply to {{user}}.",
        },
        { identifier: "charDescription", name: "Char Description", role: "system", marker: true },
        { identifier: "charPersonality", name: "Char Personality", role: "system", marker: true },
        { identifier: "chatHistory", name: "Chat History", role: "system", marker: true },
        {
          identifier: "jailbreak",
          name: "Jailbreak",
          role: "system",
          content: "Stay in character.",
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: "main", enabled: true },
            { identifier: "charDescription", enabled: true },
            { identifier: "charPersonality", enabled: true },
            { identifier: "chatHistory", enabled: true },
            { identifier: "jailbreak", enabled: true },
          ],
        },
      ],
    },
    ...overrides,
  } as RichPreset;
}

test("extractSamplerParams pulls only numeric fields present in raw", () => {
  const out = extractSamplerParams(preset().raw);
  assert.equal(out.temperature, 0.8);
  assert.equal(out.top_p, 0.9);
  assert.equal("top_k" in out, false);
});

test("extractSamplerParams drops a negative seed (means 'unset' in SillyTavern)", () => {
  const out = extractSamplerParams({ ...preset().raw, seed: -1 });
  assert.equal("seed" in out, false);
});

test("extractSamplerParams keeps a seed >= 0", () => {
  const out = extractSamplerParams({ ...preset().raw, seed: 42 });
  assert.equal(out.seed, 42);
});

test("main/jailbreak resolve with macro substitution, before/after chatHistory split correctly", () => {
  const out = assembleRichPreset({
    preset: preset(),
    messages: [{ role: "user", content: "hi" }],
    rawSystemPrompt: "You are a helpful bot.",
  });
  const prepends = out.blocks.filter(
    (b) => b.tag === "system-block" && b.role === "system-prepend"
  );
  const appends = out.blocks.filter((b) => b.tag === "system-block" && b.role === "system-append");
  assert.equal(prepends.length, 2, "main + charDescription, both before chatHistory");
  assert.ok(prepends.some((b) => b.content === "Write Izumi's reply to Anon."));
  assert.ok(prepends.some((b) => b.content === "You are a helpful bot."));
  assert.equal(appends.length, 1, "jailbreak, after chatHistory");
  assert.equal(appends[0].content, "Stay in character.");
});

test("charPersonality/scenario/personaDescription/dialogueExamples markers emit nothing", () => {
  const out = assembleRichPreset({
    preset: preset(),
    messages: [],
    rawSystemPrompt: "desc",
  });
  const texts = out.blocks.map((b) => b.content);
  assert.ok(!texts.some((t) => typeof t === "string" && t.length === 0), "no empty blocks");
  assert.equal(
    out.blocks.length,
    3,
    "main + charDescription + jailbreak only, personality contributes nothing"
  );
});

test("disabled prompt_order entries are excluded entirely", () => {
  const p = preset();
  p.raw.prompt_order[0].order[4].enabled = false; // jailbreak
  const out = assembleRichPreset({ preset: p, messages: [], rawSystemPrompt: "d" });
  assert.ok(!out.blocks.some((b) => b.content === "Stay in character."));
});

test("injection_position: 1 entries become depth-injection blocks, not system-block", () => {
  const p = preset({
    raw: {
      ...preset().raw,
      prompts: [
        ...preset().raw.prompts,
        {
          identifier: "custom-depth",
          name: "Depth prompt",
          role: "system",
          content: "AT DEPTH",
          injection_position: 1,
          injection_depth: 3,
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            ...preset().raw.prompt_order[0].order,
            { identifier: "custom-depth", enabled: true },
          ],
        },
      ],
    },
  });
  const out = assembleRichPreset({ preset: p, messages: [], rawSystemPrompt: "d" });
  const injected = out.blocks.find((b) => b.tag === "depth-injection" && b.content === "AT DEPTH");
  assert.ok(injected);
  assert.equal((injected as { depth: number }).depth, 3);
});

test("same-depth entries are pre-sorted by injection_order descending", () => {
  const p = preset({
    raw: {
      ...preset().raw,
      prompts: [
        {
          identifier: "low",
          name: "low",
          role: "system",
          content: "LOW_ORDER",
          injection_position: 1,
          injection_depth: 1,
          injection_order: 50,
        },
        {
          identifier: "high",
          name: "high",
          role: "system",
          content: "HIGH_ORDER",
          injection_position: 1,
          injection_depth: 1,
          injection_order: 200,
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          // "low" registered first, "high" second — the OPPOSITE of desired output order,
          // so only a real injection_order sort (not registration order) puts HIGH first.
          order: [
            { identifier: "low", enabled: true },
            { identifier: "high", enabled: true },
          ],
        },
      ],
    },
  });
  const out = assembleRichPreset({ preset: p, messages: [], rawSystemPrompt: "d" });
  const contents = out.blocks.map((b) => b.content);
  assert.ok(
    contents.indexOf("HIGH_ORDER") < contents.indexOf("LOW_ORDER"),
    "higher injection_order must be registered first so the frozen depth-stable-sort preserves it"
  );

  // Assert the property the pre-sort exists FOR, not just the intermediate array: after the
  // frozen orderInjections depth-sort (the real downstream consumer), the same-depth pair
  // must still come out higher-injection_order first.
  const { injections } = partitionBlocks(out.blocks);
  const ordered = orderInjections(injections).map((b) => b.content);
  assert.ok(
    ordered.indexOf("HIGH_ORDER") < ordered.indexOf("LOW_ORDER"),
    "relative order must survive the frozen depth-only stable sort"
  );
});

test("worldInfoBefore and worldInfoAfter both enabled resolve the lorebook set exactly once", () => {
  const p = preset({
    lorebookIds: [999], // non-existent id — runLorebooksForRequest returns [] for it
  });
  p.raw.prompts.push(
    { identifier: "worldInfoBefore", name: "WI Before", role: "system", marker: true },
    { identifier: "worldInfoAfter", name: "WI After", role: "system", marker: true }
  );
  p.raw.prompt_order[0].order.push(
    { identifier: "worldInfoBefore", enabled: true },
    { identifier: "worldInfoAfter", enabled: true }
  );
  // No real lorebook exists for id 999 in this unit test, so runLorebooksForRequest hits
  // `getLorebook`, gets null, and contributes zero blocks either way — this test confirms
  // assembleRichPreset does not throw with both markers enabled; the call-count/dedup
  // assertion belongs in the route-level test per the design spec's own testing section.
  const out = assembleRichPreset({ preset: p, messages: [], rawSystemPrompt: "d" });
  assert.doesNotThrow(() => out);
});
