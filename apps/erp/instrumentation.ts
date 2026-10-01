// register() runs once per server instance, in every runtime. The Node-only
// work lives in ./instrumentation-node so its node:* imports stay out of the
// Edge bundle -- see the comment at the top of that file.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
