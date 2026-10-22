import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

// Where the bytes of uploaded Event images are kept (step 39). The database holds only the key.
// Only the folder version below exists so far; the production store (a fly.io volume or object
// storage) comes with the deploy (step 27) behind the same interface.
export interface ImageStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  // Deleting a key that is not there is not an error.
  delete(key: string): Promise<void>;
}

// Keys are made by the server (uuids); anything else is refused so a key can never leave the folder.
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function fileImageStore(dir: string): ImageStore {
  const path = (key: string) => {
    if (!KEY.test(key)) throw new Error("Invalid image key");
    return join(dir, key);
  };
  return {
    async put(key, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(path(key), bytes);
    },
    async get(key) {
      try {
        return await readFile(path(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
  };
}

export function memoryImageStore(): ImageStore & { keys(): string[]; clear(): void } {
  const files = new Map<string, Buffer>();
  return {
    async put(key, bytes) {
      files.set(key, bytes);
    },
    async get(key) {
      return files.get(key);
    },
    async delete(key) {
      files.delete(key);
    },
    keys: () => [...files.keys()],
    clear: () => files.clear(),
  };
}

// `IMAGE_DIR`, or an `uploads` folder next to the API's source (ignored by git).
export function imageStoreFromEnv(): ImageStore {
  return fileImageStore(process.env.IMAGE_DIR ?? fileURLToPath(new URL("../uploads", import.meta.url)));
}

// The longest side kept, and the most pixels read: a small file can still hold a huge picture.
const MAX_SIDE = 2560;
const MAX_PIXELS = 40_000_000;

const FORMATS = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

export type PreparedImage = { bytes: Buffer; contentType: (typeof FORMATS)[keyof typeof FORMATS] };

// Checks that the bytes really are a JPEG, PNG or WebP picture (whatever the sender said), turns it
// the way its orientation says, shrinks it to the longest side we keep, and drops everything else in
// the file (location and camera data) by writing it out again. Returns undefined for anything else.
export async function prepareImage(input: Buffer): Promise<PreparedImage | undefined> {
  try {
    // The input's own format, so an SVG or GIF is refused instead of being turned into a PNG.
    const source = sharp(input, { limitInputPixels: MAX_PIXELS });
    if (!((await source.metadata()).format! in FORMATS)) return undefined;
    const { data, info } = await source
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    const contentType = FORMATS[info.format as keyof typeof FORMATS];
    return contentType ? { bytes: data, contentType } : undefined;
  } catch {
    return undefined;
  }
}
