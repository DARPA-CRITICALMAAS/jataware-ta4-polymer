/**
 * Represents a failure response.
 * @template T - The type of the error.
 */
export type Failure<T> = { success: false; error: T };

/**
 * Represents a success response.
 * @template T - The type of the value.
 */
export type Success<T> = { success: true; value: T };

/**
 * Represents a failure result with an error.
 * @template T - The type of the error.
 * @param error - The error object.
 * @returns A Failure object with the specified error.
 */
export function Failure<T>(error: T): Failure<T>;
export function Failure(): Failure<null>;
export function Failure(error = null) {
  return { success: false, error };
}

/**
 * Represents a success result with a value.
 * @template T - The type of the value.
 * @param value - The value object.
 * @returns A Success object with the specified value.
 */
export function Success<T>(value: T): Success<T>;
export function Success(): Success<null>;
export function Success(value = null) {
  return { success: true, value };
}
