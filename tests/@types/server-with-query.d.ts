// Allow importing "~/server?foo" variants in tests without impacting runtime behavior.
declare module "~/server?*" {
  export const server: import("hono").Hono
}
