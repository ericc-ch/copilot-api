import { Counter, Registry } from "prom-client"

// Create a custom registry
export const register = new Registry()

// Counter for input tokens per model
export const tokensInCounter = new Counter({
  name: "copilot_api_tokens_in_total",
  help: "Total number of input tokens processed per model",
  labelNames: ["model"],
  registers: [register],
})

// Counter for output tokens per model
export const tokensOutCounter = new Counter({
  name: "copilot_api_tokens_out_total",
  help: "Total number of output tokens generated per model",
  labelNames: ["model"],
  registers: [register],
})

// Counter for total requests per model
export const requestCounter = new Counter({
  name: "copilot_api_requests_total",
  help: "Total number of requests per model",
  labelNames: ["model", "endpoint"],
  registers: [register],
})

// Helper function to record token usage
export function recordTokenUsage(
  model: string,
  tokensIn: number,
  tokensOut: number,
) {
  tokensInCounter.inc({ model }, tokensIn)
  tokensOutCounter.inc({ model }, tokensOut)
}

// Helper function to record requests
export function recordRequest(model: string, endpoint: string) {
  requestCounter.inc({ model, endpoint })
}
