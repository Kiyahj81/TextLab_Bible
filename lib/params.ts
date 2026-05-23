export function parsePositiveInt(value?: string | string[] | null) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
