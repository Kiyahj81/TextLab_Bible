export type ToolTraceEntry = { tool: string; args?: Record<string, unknown>; error?: string };

export function formatToolTrace(entry: ToolTraceEntry): string {
  if (entry.error) return `${entry.tool} failed: ${entry.error}`;
  const args = entry.args ? `(${JSON.stringify(entry.args)})` : "()";
  return `${entry.tool}${args}`;
}
