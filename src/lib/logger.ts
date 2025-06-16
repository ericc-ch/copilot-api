import consola from "consola"

// Simple logger wrapper around consola for basic logging needs
export const globalLogger = {
  debug: (message: string, data?: any) => consola.debug(message, data),
  info: (message: string, data?: any) => consola.info(message, data),
  warn: (message: string, data?: any) => consola.warn(message, data),
  error: (message: string, data?: any) => consola.error(message, data),
}
