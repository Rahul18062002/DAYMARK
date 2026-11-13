export default async function globalTeardown() {
  const s = (globalThis as unknown as { __smtp?: { close: (cb: () => void) => void } }).__smtp;
  await new Promise<void>((res) => (s ? s.close(res) : res()));
}
