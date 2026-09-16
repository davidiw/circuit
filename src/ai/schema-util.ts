/** Strip JSON Schema keywords that provider schema validators reject. */
export function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, ...rest } = schema;
  return rest;
}
