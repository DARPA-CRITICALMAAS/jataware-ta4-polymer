/**
 * Represents a generic object with string keys and any values.
 * @template T - The type of the values in the object.
 */
type StringObject<T = any> = Record<string, T>;

/**
 * Represents all the keys in an object with string keys.
 * @template T - The object type.
 */
type StringObjectKeys<T extends StringObject> = Extract<keyof T, string>;

/**
 * Represents a generic type that defines a pair of values, `from` and `to`.
 * @template T - The type of the values in the pair.
 */
type FromTo<T extends string = string, U extends string = string> = {
  from: T;
  to: U;
};

/**
 * Recursively replaces all occurrences of a substring in a string type.
 * @template T - The string type to perform replacements on.
 * @template From - The substring to replace.
 * @template To - The substring to replace with.
 */
type Replace<
  T,
  From extends string,
  To extends string,
> = T extends `${infer Before}${From}${infer After}`
  ? Replace<`${Before}${To}${After}`, From, To>
  : T;

/**
 * Recursively replaces all occurrences of multiple substrings in a string type.
 * @template T - The string type to perform replacements on.
 * @template FromToArray - An array of objects specifying the substrings to replace and their replacements.
 */
type ReplaceAll<T, FromToArray extends FromTo[]> = FromToArray extends [
  { from: infer From extends string; to: infer To extends string },
  ...infer Rest extends FromTo[],
]
  ? ReplaceAll<Replace<T, From, To>, Rest>
  : T;

/**
 * Replaces all occurrences of multiple substrings in the keys of an object type.
 * @template T - The object type to perform replacements on.
 * @template FromToArray - An array of objects specifying the substrings to replace and their replacements.
 */
export type PropertyReplace<
  T extends StringObject,
  FromToArray extends FromTo[],
> = {
  [Key in keyof T as ReplaceAll<Key, FromToArray>]: T[Key];
};

/**
 * Replaces a property in an object with a new key.
 * @param object - The object to replace the property in.
 * @param oldKey - The old key to replace.
 * @param newKey - The new key to replace with.
 * @returns The object with the property replaced.
 */
export function replaceProperty<
  T extends StringObject,
  const OldKey extends StringObjectKeys<T> = StringObjectKeys<T>,
  const NewKey extends string = string,
>(object: T, oldKey: OldKey, newKey: NewKey) {
  const newObject = {};
  delete Object.assign(newObject, object, { [newKey]: object[oldKey] })[oldKey];
  return newObject as PropertyReplace<T, [{ from: OldKey; to: NewKey }]>;
}

/**
 * Replaces multiple properties in an object with new keys.
 * @param object - The object to replace the properties in.
 * @param replacements - The replacements to perform on the object.
 * @returns The object with the properties replaced.
 */
export function replaceProperties<
  T extends StringObject,
  const OldKey extends StringObjectKeys<T> = StringObjectKeys<T>,
  const NewKey extends string = string,
  const Replacements extends FromTo<OldKey, NewKey>[] = FromTo<
    OldKey,
    NewKey
  >[],
>(object: T, replacements: Replacements) {
  let newObject: any = { ...object };
  for (const { from: oldKey, to: newKey } of replacements) {
    newObject = replaceProperty<T>(newObject, oldKey, newKey);
  }
  return newObject as PropertyReplace<T, Replacements>;
}
