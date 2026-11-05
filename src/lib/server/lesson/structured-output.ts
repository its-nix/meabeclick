/** Adapt our optional-field contract to the CLI's strict JSON Schema subset. */
export interface OutputSchema {
  [key: string]: unknown;
  type?: string;
  properties?: Record<string, OutputSchema>;
  required?: readonly string[];
  items?: OutputSchema;
  anyOf?: readonly OutputSchema[];
}

export function strictOutputSchema(schema: OutputSchema): OutputSchema {
  const result = { ...schema };
  if (schema.properties) {
    const required = new Set(schema.required ?? []);
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key,
      required.has(key) ? strictOutputSchema(child) : { anyOf: [strictOutputSchema(child), { type: 'null' }] },
    ]));
    result.required = Object.keys(schema.properties);
    result.additionalProperties = false;
  }
  if (schema.items) result.items = strictOutputSchema(schema.items);
  if (schema.anyOf) result.anyOf = schema.anyOf.map(strictOutputSchema);
  return result;
}

/** Unselected games/optional fields come back as null; required nullable fields stay null. */
export function omitOptionalNulls(value: unknown, schema: OutputSchema): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (schema.anyOf) {
    const branch = schema.anyOf.find(s => s.type === (Array.isArray(value) ? 'array' : 'object'));
    if (branch) return omitOptionalNulls(value, branch);
  }
  if (Array.isArray(value)) return schema.items ? value.map(v => omitOptionalNulls(v, schema.items!)) : value;
  if (!schema.properties) return value;
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const property = Object.hasOwn(schema.properties!, key) ? schema.properties![key] : undefined;
    if (property && child === null && !required.has(key)) return [];
    return [[key, property ? omitOptionalNulls(child, property) : child]];
  }));
}
