/** Typed JSON readers shared by the normalization modules. Each reader
 * validates one value and throws with the offending path. */

export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown, path: string): JsonObject {
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

/** An empty string counts as absent for identifiers with documented
 * fallbacks (window kind, credit unit). Metadata lists keep an empty string
 * as a value. */
export function readNonEmptyString(
  record: JsonObject,
  key: string,
  path: string,
): string | null {
  const value = readOptionalString(record, key, path);
  return value === "" ? null : value;
}

export function readOptionalObject(
  record: JsonObject,
  key: string,
  path: string,
): JsonObject | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  return requireObject(value, path);
}

export function readOptionalNumber(
  record: JsonObject,
  key: string,
  path: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number or null.`);
  }
  return value;
}

export function readOptionalBoolean(
  record: JsonObject,
  key: string,
  path: string,
): boolean | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean or null.`);
  }
  return value;
}

export function readRequiredNumber(
  record: JsonObject,
  key: string,
  path: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

export function readOptionalString(
  record: JsonObject,
  key: string,
  path: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string or null.`);
  }
  return value;
}
