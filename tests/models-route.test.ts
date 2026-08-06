import { afterEach, describe, expect, test } from "bun:test"

import type { ModelsResponse } from "~/services/copilot/get-models"

import { state } from "~/lib/state"
import { server } from "~/server"

const originalModels = state.models

afterEach(() => {
  state.models = originalModels
})

describe("models route", () => {
  test("preserves routing and capability metadata", async () => {
    state.models = {
      object: "list",
      data: [
        {
          id: "gpt-5.6-terra",
          name: "GPT-5.6 Terra",
          object: "model",
          preview: false,
          vendor: "OpenAI",
          version: "5.6",
          model_picker_enabled: true,
          model_picker_category: "powerful",
          supported_endpoints: ["/responses", "ws:/responses"],
          capabilities: {
            family: "gpt-5.6-terra",
            object: "model_capabilities",
            tokenizer: "o200k_base",
            type: "chat",
            limits: {
              max_context_window_tokens: 400_000,
            },
            supports: {
              reasoning_effort: [
                "none",
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              tool_calls: true,
            },
          },
          policy: {
            state: "enabled",
            terms: "",
          },
        },
      ],
    } satisfies ModelsResponse

    const response = await server.request("/v1/models")

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>
    }
    expect(body.data[0]).toMatchObject({
      id: "gpt-5.6-terra",
      model_picker_enabled: true,
      model_picker_category: "powerful",
      supported_endpoints: ["/responses", "ws:/responses"],
      capabilities: {
        limits: {
          max_context_window_tokens: 400_000,
        },
        supports: {
          reasoning_effort: ["none", "low", "medium", "high", "xhigh", "max"],
        },
      },
      policy: {
        state: "enabled",
      },
    })
  })
})
