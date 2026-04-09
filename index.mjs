import { exiftool } from "exiftool-vendored";
import pLimit from "p-limit";
import { readdir } from "node:fs/promises";
import { join, relative, basename, parse as parsePath } from "node:path";
import { parseArgs } from "node:util";

/** Regex matching file extensions to process (currently all JPEG and MP4 files). */
const FILE_PATTERN = /\.(jpe?g|mp4)$/i;

/** Max number of files read/written concurrently via exiftool. */
const CONCURRENCY = 8;

// --- CLI ---

const { values: opts, positionals } = parseArgs({
  options: {
    "no-backup": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const rootDir = positionals[0];
if (!rootDir) {
  console.error("Usage: node index.mjs [--no-backup] <rootDir>");
  process.exit(1);
}

// --- Rule engine (placeholder) ---

/**
 * Pure function: given a file's relative path, filename, and existing exif tags,
 * return the new tags to write, or null if no changes are needed.
 *
 * @param {string} relPath - path of the file relative to rootDir (e.g. "vacation/beach/IMG_001.jpg")
 * @param {string} filename - the file's basename including extension (e.g. "IMG_001.jpg")
 * @param {import("exiftool-vendored").Tags} existingTags - all existing EXIF/IPTC/XMP tags as read by exiftool
 * @returns {import("exiftool-vendored").WriteTags | null} tags to write, or null to skip this file
 */
function computeNewTags(relPath, filename, existingTags) {
  // Placeholder rule: add the filename (minus extension) as a keyword,
  // unless the filename starts with a number.
  if (/^\d/.test(filename)) return null;

  const stem = parsePath(filename).name;
  return { Keywords: stem };
}

// --- File discovery ---

async function* walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (FILE_PATTERN.test(entry.name)) {
      yield full;
    }
  }
}

// --- Processing ---

async function processFile(filePath, rootDir, writeArgs) {
  const filename = basename(filePath);
  const relPath = relative(rootDir, filePath);

  const existingTags = await exiftool.read(filePath);
  const newTags = computeNewTags(relPath, filename, existingTags);

  if (newTags == null) return { filePath, status: "skipped" };

  await exiftool.write(filePath, newTags, { writeArgs });
  return { filePath, status: "written" };
}

async function main() {
  const writeArgs = opts["no-backup"] ? ["-overwrite_original"] : [];
  const limit = pLimit(CONCURRENCY);
  const tasks = [];

  let total = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for await (const filePath of walkFiles(rootDir)) {
    total++;
    tasks.push(
      limit(async () => {
        try {
          const result = await processFile(filePath, rootDir, writeArgs);
          if (result.status === "written") written++;
          else skipped++;
        } catch (err) {
          failed++;
          console.error(`Error processing ${filePath}: ${err.message}`);
        }
      })
    );
  }

  await Promise.all(tasks);

  console.log(`Done. ${total} files found: ${written} written, ${skipped} skipped, ${failed} failed.`);
  await exiftool.end();
}

main();
