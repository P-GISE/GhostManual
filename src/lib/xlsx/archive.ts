import { crc32, inflateRawSync } from "node:zlib";
import { AppError } from "../errors";

const MAX_EXPANDED = 20 * 1024 * 1024;
const MAX_XML = 10 * 1024 * 1024;

export function unsafeFile(): AppError {
  return new AppError(
    "unsafe_file",
    422,
    "열 수 없는 엑셀 파일입니다. 매크로·암호가 없는 .xlsx로 저장해 다시 올리세요.",
  );
}

type Entry = {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly size: number;
  readonly compressed: number;
  readonly start: number;
  readonly local: number;
  readonly end: number;
};

export function readArchive(bytes: Uint8Array): {
  parts: Map<string, Uint8Array>;
  names: Set<string>;
  limited: boolean;
} {
  if (bytes.length > 5 * 1024 * 1024) {
    throw new AppError("file_too_large", 413, "파일은 5 MB까지 올릴 수 있습니다.");
  }
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (input.length < 22 || input.readUInt32LE(0) !== 0x04034b50) throw unsafeFile();
  let end = input.length - 22;
  while (end >= Math.max(0, input.length - 65557)) {
    if (
      input.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + input.readUInt16LE(end + 20) === input.length
    )
      break;
    end--;
  }
  if (end < 0 || end < input.length - 65557) throw unsafeFile();
  const count = input.readUInt16LE(end + 10);
  const offset = input.readUInt32LE(end + 16);
  if (
    input.readUInt16LE(end + 4) !== 0 ||
    input.readUInt16LE(end + 6) !== 0 ||
    input.readUInt16LE(end + 8) !== count ||
    count === 65535 ||
    offset + input.readUInt32LE(end + 12) !== end
  )
    throw unsafeFile();
  const entries: Entry[] = [];
  const names = new Set<string>();
  const foldedNames = new Set<string>();
  let position = offset;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || input.readUInt32LE(position) !== 0x02014b50) throw unsafeFile();
    const flags = input.readUInt16LE(position + 8);
    const method = input.readUInt16LE(position + 10);
    const compressed = input.readUInt32LE(position + 20);
    const size = input.readUInt32LE(position + 24);
    const nameLength = input.readUInt16LE(position + 28);
    const extraLength = input.readUInt16LE(position + 30);
    const commentLength = input.readUInt16LE(position + 32);
    const local = input.readUInt32LE(position + 42);
    if (
      position + 46 + nameLength + extraLength + commentLength > end ||
      local + 30 > offset ||
      input.readUInt32LE(local) !== 0x04034b50
    )
      throw unsafeFile();
    const nameBytes = input.subarray(position + 46, position + 46 + nameLength);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    const folded = name.toLowerCase();
    if (
      !name ||
      /[\\:]/.test(name) ||
      [...name].some((character) => character.charCodeAt(0) < 32) ||
      name.startsWith("/") ||
      name.split("/").some((part) => part === ".." || part === ".") ||
      foldedNames.has(folded) ||
      /(^|\/)(vbaproject\.bin|encryptioninfo|encryptedpackage)$/i.test(name) ||
      (flags & 0x2041) !== 0 ||
      ![0, 8].includes(method) ||
      input.readUInt16LE(position + 34) !== 0 ||
      compressed === 0xffffffff ||
      size === 0xffffffff
    )
      throw unsafeFile();
    const localNameLength = input.readUInt16LE(local + 26);
    const localExtraLength = input.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    const entryEnd = start + compressed;
    if (
      entryEnd > offset ||
      input.readUInt16LE(local + 6) !== flags ||
      input.readUInt16LE(local + 8) !== method ||
      localNameLength !== nameLength ||
      !input.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)
    )
      throw unsafeFile();
    if (
      (flags & 8) === 0 &&
      (input.readUInt32LE(local + 18) !== compressed ||
        input.readUInt32LE(local + 22) !== size ||
        input.readUInt32LE(local + 14) !== input.readUInt32LE(position + 16))
    )
      throw unsafeFile();
    names.add(name);
    foldedNames.add(folded);
    entries.push({
      name,
      method,
      compressed,
      size,
      start,
      local,
      end: entryEnd,
      crc: input.readUInt32LE(position + 16),
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) throw unsafeFile();
  const intervals = [...entries].sort((a, b) => a.local - b.local);
  for (let index = 1; index < intervals.length; index++) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (previous && current && current.local < previous.end) throw unsafeFile();
  }
  const parts = new Map<string, Uint8Array>();
  let expanded = 0;
  let limited = false;
  for (const entry of entries) {
    if (
      entry.size > MAX_EXPANDED - expanded ||
      (/\.(xml|rels)$/i.test(entry.name) && entry.size > MAX_XML)
    ) {
      limited = true;
      continue;
    }
    const compressed = input.subarray(entry.start, entry.end);
    const content =
      entry.method === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size + 1) });
    if (content.length !== entry.size || crc32(content) !== entry.crc) throw unsafeFile();
    expanded += content.length;
    parts.set(entry.name, content);
  }
  return { parts, names, limited };
}
