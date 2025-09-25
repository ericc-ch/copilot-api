import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createResponses = async (
  // payload: ResponsesPayload,
  payload
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = false;  // FIXME

  const input = Array.isArray(payload.input) ? payload.input : [payload.input];
  const isAgentCall = input.some((msg) => {
    if (msg.role == "assistant") return true;
    if (msg.type == "function_call_output") return true;
    return false;
  });

  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  console.log("REQUEST:", payload)
  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
  console.log("RESPONSE:", response)
  // const responseJson = await response.json()
  // console.log("RESPONSE JSON:", responseJson)
  const responseBody = response.body
  console.log("RESPONSE BODY:", responseBody)

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) // as ResponsesResponse
}

// export interface ResponsesChunk {
//   //
// }

// export interface ResponsesResponse {
//   background: boolean
//   conversation: {
//     id: string
//   }
//   created_at: number
//   error: {
//     code: string
//     message: string
//   }
//   id: string
//   incomplete_details: {
//     reason: string
//   }
//   instructions: string | InputItemList
//   max_output_tokens: number
//   max_tool_calls: number
//   // metadata: //map
//   model: string
//   object: "response"
//   output: Array<OutputMessage | FileSearchToolCall | WebSearchToolCall | ComputerToolCall | Reasoning | ImageGenerationCall | CodeInterpreterToolCall | LocalShellCall | McpToolCall | McpListTools | McpApprovalRequest | CustomToolCall>
//   parallel_tool_calls: boolean
//   previous_response_id: string
//   prompt: {
//     id: string
//     // variables: //map
//     version: string
//   }
//   prompt_cache_key: string
//   reasoning: {
//     effort: string
//     summary: string
//   }
//   safety_identifier: string
//   service_tier: string
//   status: string
//   temperature: number
//   text: {
//     // format: Text | JsonSchema | JsonObject
//     verbosity: string
//   }
//   tool_choice: string | ToolChoice
//   tools: Array<FunctionTool | FileSearchTool | ComputerUsePreviewTool | WebSearchTool | McpTool | CodeInterpreterTool | ImageGenerationTool | LocalShellTool | CustomTool | WebSearchPreviewTool>
//   top_logprobs: number
//   top_p: number
//   truncation: string
//   usage: {
//     input_tokens: number
//     input_tokens_details: {
//       cached_tokens: number
//     }
//     output_tokens: number
//     output_tokens_details: {
//       reasoning_tokens: number
//     }
//     total_tokens: number
//   }
// }
