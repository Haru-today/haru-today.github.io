import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

export const MAX_SAFE_READ_BYTES = 128 * 1024;

// Open once, validate that descriptor and its path, and read bounded bytes from
// the same descriptor. O_NOFOLLOW adds an atomic final-symlink guard where the
// OS supports it; descriptor/path identity checks also protect the fallback.
export function readBoundedRegularFile(path, maximum, { allowMissing = false, validatePath } = {}) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_SAFE_READ_BYTES) throw new Error('invalid_read_limit');
  let descriptor;
  try {
    try { descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return null; throw error; }
    const original = fstatSync(descriptor);
    if (!original.isFile() || original.size > maximum) throw new Error('file_size_or_type');
    const same = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((key) => a[key] === b[key]);
    const verify = () => {
      if (validatePath) validatePath();
      const current = lstatSync(path);
      if (current.isSymbolicLink() || !current.isFile() || !same(original, current)) throw new Error('file_changed_during_read');
    };
    verify();
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maximum || !same(original, fstatSync(descriptor))) throw new Error('file_changed_during_read');
    verify();
    return bytes.subarray(0, length);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

