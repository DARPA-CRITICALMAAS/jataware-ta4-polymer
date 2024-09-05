/**
 * Generates a SHA-256 hash of a string.
 * @param input - The string to hash.
 * @returns The SHA-256 hash.
 */
async function sha256(input: string): Promise<string> {
  const textAsBuffer = new TextEncoder().encode(input);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", textAsBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
  return hash;
}

/**
 * Gets a random number between 0 and 1 based on a seed.
 * @param seed - The seed to generate the random number.
 * @returns The random number.
 */
export async function rand(seed?: string): Promise<number> {
  const cyrb53 = (str: string, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed,
      h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };

  if (!seed) {
    seed = Math.random().toString();
  }

  const hash = cyrb53(await sha256(seed));
  return hash / Math.pow(10, Math.ceil(Math.log10(hash)));
}

/**
 * Generates a random integer between a minimum and maximum value based on a seed.
 * @param min - The minimum value of the range (inclusive).
 * @param max - The maximum value of the range (inclusive).
 * @param seed - The seed to generate the random number.
 * @returns The random integer.
 */
export async function randint(
  min: number,
  max: number,
  seed?: string,
): Promise<number> {
  const randomNumber = await rand(seed);
  const range = max - min + 1;
  return Math.floor(randomNumber * range) + min;
}
