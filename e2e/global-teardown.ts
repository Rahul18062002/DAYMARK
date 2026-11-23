export default async function globalTeardown() {
  const g = globalThis as unknown as { __smtp?: { close: (cb: () => void) => void }; __ai?: { close: (cb: () => void) => void } };
  await Promise.all([g.__smtp, g.__ai].map((s) => new Promise<void>((res) => (s ? s.close(() => res()) : res()))));
}
