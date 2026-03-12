export function createRunId(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:.TZ]/g, "");
  const random = crypto.randomUUID().slice(0, 8);
  return `${iso}_${random}`;
}
