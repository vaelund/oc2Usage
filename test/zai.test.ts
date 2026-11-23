import { describe, expect, test } from "bun:test";
import {
  asSnapshot,
  emptySnapshot,
  formatCompact,
  formatDetail,
  formatFooter,
  providerWindows,
  usageKindFromProviderID,
  ZAI_WINDOW_LABELS,
} from "../src/format.ts";
import { parseZai } from "../src/providers.ts";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

const RESET_5H = 1788448916000;
const RESET_WEEK = 1788739200000;
const RESET_MCP = 1789000000000;

const QUOTA_BODY = {
  code: 200,
  msg: "success",
  success: true,
  data: {
    level: "pro",
    limits: [
      {
        type: "TOKENS_LIMIT",
        unit: 3,
        number: 5,
        percentage: 12.5,
        currentValue: 1,
        usage: 8,
        nextResetTime: RESET_5H,
      },
      {
        type: "CREDIT_LIMIT",
        unit: 6,
        number: 1,
        percentage: 34,
        nextResetTime: RESET_WEEK,
      },
      {
        type: "TIME_LIMIT",
        unit: 5,
        number: 1,
        percentage: 50,
        currentValue: 500,
        usage: 1000,
        nextResetTime: RESET_MCP,
      },
    ],
  },
};

describe("parseZai", () => {
  test("parses 5h, weekly, and MCP windows", () => {
    const zai = parseZai(200, QUOTA_BODY);
    expect(zai.status).toBe("ok");
    expect(zai.product).toBe("Z.ai");
    expect(zai.percent).toBe(12.5);
    expect(zai.label).toBe("5h");
    expect(zai.rolling?.percent).toBe(12.5);
    expect(zai.rolling?.resetsAt).toBe(new Date(RESET_5H).toISOString());
    expect(zai.weekly?.percent).toBe(34);
    expect(zai.weekly?.resetsAt).toBe(new Date(RESET_WEEK).toISOString());
    expect(zai.monthly?.percent).toBe(50);
    expect(zai.monthly?.resetsAt).toBe(new Date(RESET_MCP).toISOString());
    expect(
      providerWindows(zai, ZAI_WINDOW_LABELS)
        .map((row) => `${row.label}:${row.percent}`)
        .join(","),
    ).toBe("5h:12.5,week:34,mcp:50");
  });

  test("accepts epoch-second resets", () => {
    const body = {
      success: true,
      data: {
        limits: [
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            number: 5,
            percentage: 7,
            nextResetTime: RESET_5H / 1000,
          },
        ],
      },
    };
    expect(parseZai(200, body).rolling?.resetsAt).toBe(
      new Date(RESET_5H).toISOString(),
    );
  });

  test("unwrapped payloads still parse", () => {
    const { data } = QUOTA_BODY;
    const zai = parseZai(200, data);
    expect(zai.status).toBe("ok");
    expect(zai.percent).toBe(12.5);
  });

  test("weekly-only payload labels the window", () => {
    const body = {
      success: true,
      data: {
        limits: [
          {
            type: "TOKENS_LIMIT",
            unit: 6,
            number: 1,
            percentage: 64,
          },
        ],
      },
    };
    const zai = parseZai(200, body);
    expect(zai.status).toBe("ok");
    expect(zai.percent).toBe(64);
    expect(zai.label).toBe("week");
  });

  test("API envelope errors surface the message", () => {
    const zai = parseZai(200, {
      code: 1001,
      success: false,
      msg: "invalid token",
    });
    expect(zai.status).toBe("error");
    expect(zai.error).toContain("invalid token");
  });

  test("payload without recognizable limits is an error", () => {
    expect(parseZai(200, { success: true, data: { limits: [] } }).status).toBe(
      "error",
    );
    expect(parseZai(200, null).status).toBe("error");
  });

  test("auth and rate-limit statuses", () => {
    expect(parseZai(401, {}).status).toBe("error");
    expect(parseZai(403, {}).status).toBe("error");
    expect(parseZai(429, {}).status).toBe("rate-limited");
    expect(parseZai(500, {}).error).toBe("HTTP 500");
  });
});

describe("zai footer / snapshot", () => {
  const snap = { ...emptySnapshot(), zai: parseZai(200, QUOTA_BODY) };

  test("kind mapping", () => {
    expect(usageKindFromProviderID("zai")).toBe("zai");
    expect(usageKindFromProviderID("zai-coding-plan")).toBe("zai");
    expect(usageKindFromProviderID("zhipuai-coding-plan")).toBe("zai");
    expect(usageKindFromProviderID("zai-coding-plan/glm-5.3")).toBe("zai");
  });

  test("footer shows percents", () => {
    expect(formatFooter(snap, "zai", NOW)).toBe("zai 13/34/50%");
  });

  test("compact lists zai", () => {
    expect(formatCompact(snap)).toContain("zai 13/34/50%");
  });

  test("footer hides pending zai", () => {
    expect(formatFooter(emptySnapshot(), "zai", NOW)).toBe("");
  });

  test("footer shows missing zai", () => {
    const missing = { ...emptySnapshot(), zai: { status: "missing" } };
    expect(formatFooter(missing, "zai-coding-plan", NOW)).toBe("");
  });

  test("asSnapshot defaults missing zai (backward compat)", () => {
    const old = {
      fetchedAt: "",
      grok: { status: "pending" },
      go: { status: "pending" },
      anthropic: { status: "pending" },
    };
    expect(asSnapshot(old).zai.status).toBe("pending");
    expect(emptySnapshot().zai.status).toBe("pending");
  });

  test("detail includes Z.ai rows", () => {
    const detail = formatDetail(snap);
    expect(detail).toContain("Z.ai 5h");
    expect(detail).toContain("13%");
    expect(detail).toContain("Z.ai mcp");
  });
});
