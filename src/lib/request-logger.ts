import type { Context, Next } from "hono"

const requestModelKey = "requestModel"
const resolvedModelKey = "resolvedModel"
const responseModelKey = "responseModel"

export function setRequestModel(c: Context, model: string | null | undefined) {
  if (model) {
    c.set(requestModelKey, model)
  }
}

export function setResolvedModel(c: Context, model: string | null | undefined) {
  if (model) {
    c.set(resolvedModelKey, model)
  }
}

export function setResponseModel(c: Context, model: string | null | undefined) {
  if (model) {
    c.set(responseModelKey, model)
  }
}

export async function requestLogger(c: Context, next: Next) {
  const start = Date.now()
  const requestTarget = getRequestTarget(c)

  console.log(`<-- ${c.req.method} ${requestTarget}`)

  await next()

  const duration = formatDuration(Date.now() - start)
  const modelSuffix = formatModelSuffix(c)

  console.log(
    `--> ${c.req.method} ${requestTarget} ${c.res.status} ${duration}${modelSuffix}`,
  )
}

function getRequestTarget(c: Context): string {
  const url = new URL(c.req.url)
  return `${url.pathname}${url.search}`
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${Math.round(durationMs / 1000)}s`
  }

  return `${durationMs}ms`
}

function formatModelSuffix(c: Context): string {
  const requestModel = c.get(requestModelKey) as string | undefined
  const resolvedModel = c.get(resolvedModelKey) as string | undefined
  const responseModel = c.get(responseModelKey) as string | undefined

  if (responseModel) {
    return ` model=${responseModel}`
  }

  if (resolvedModel && requestModel && resolvedModel !== requestModel) {
    return ` requested_model=${requestModel} resolved_model=${resolvedModel}`
  }

  if (resolvedModel) {
    return ` model=${resolvedModel}`
  }

  if (requestModel) {
    return ` model=${requestModel}`
  }

  return ""
}
