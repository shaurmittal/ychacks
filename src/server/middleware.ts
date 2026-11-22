import type { MiddlewareConfigFn } from "wasp/server";
// Default config keeps CORS enabled for /api routes.
export const apiMiddleware: MiddlewareConfigFn = (config) => config;
