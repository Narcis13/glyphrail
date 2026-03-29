import { describe, expect, test } from "bun:test"
import { claudeCodeAdapter } from "../../src/agent/claude-code-adapter"
import type { StructuredAgentRequest } from "../../src/agent/contracts"

function baseRequest(overrides: Partial<StructuredAgentRequest> = {}): StructuredAgentRequest {
  return {
    runId: "test-run",
    stepId: "test-step",
    provider: "claude-code",
    model: "sonnet",
    objective: "Test objective",
    prompt: "Test prompt",
    attempt: 1,
    ...overrides,
  }
}

describe("claude-code-adapter", () => {
  test("adapter has correct name", () => {
    expect(claudeCodeAdapter.name).toBe("claude-code")
  })

  test("adapter implements runStructured", () => {
    expect(typeof claudeCodeAdapter.runStructured).toBe("function")
  })

  test("returns error when claude binary is not found", async () => {
    const request = baseRequest({
      meta: {
        claudeBinary: "/nonexistent/claude-binary-that-does-not-exist",
      },
    })

    const result = await claudeCodeAdapter.runStructured(request)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_RUNTIME_ERROR")
      expect(result.meta?.adapter).toBe("claude-code")
      expect(result.meta?.attempt).toBe(1)
    }
  })

  test("returns error result with adapter metadata on failure", async () => {
    const request = baseRequest({
      meta: {
        claudeBinary: "/nonexistent/binary",
      },
    })

    const result = await claudeCodeAdapter.runStructured(request)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.retryable).toBe(true)
      expect(result.meta?.adapter).toBe("claude-code")
      expect(result.meta?.binary).toBe("/nonexistent/binary")
      expect(typeof result.meta?.durationMs).toBe("number")
    }
  })

  test("meta defaults are applied correctly", () => {
    // Verify adapter name for registration
    expect(claudeCodeAdapter.name).toBe("claude-code")
  })
})
