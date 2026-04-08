import { opendir, mkdir, rename, readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import ExifReader from "exifreader";

// ── Configuration ────────────────────────────────────────────────────────────

/** Regex that filenames must match to be processed. */
const FILENAME_PATTERN = /\.(jpe?g|tiff?|png|heic|webp|avif)$/i;

/** Max files processed concurrently (keeps file-handle usage bounded). */
const CONCURRENCY = 20;

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const filteredArgs = args.filter((a) => a !== "--dry-run");

const [sourceDir, targetDir] = filteredArgs;

if (!sourceDir || !targetDir) {
  console.error("Usage: node index.mjs [--dry-run] <sourceDir> <targetDir>");
  process.exit(1);
}

const srcRoot = resolve(sourceDir);
const dstRoot = resolve(targetDir);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively yields every file path under `dir`.
 * @param {string} dir directory
 */
async function* walk(dir) {
  const d = await opendir(dir);
  for await (const entry of d) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield { name: entry.name, path: full };
    }
  }
}

/**
 * Read all EXIF tags from an image file.
 * Returns the full tag map (each value has `.value` and `.description`).
 */
async function readExif(filePath) {
  const buf = await readFile(filePath);
  return ExifReader.load(buf, { expanded: true });
}

/**
 * Build a target filename from EXIF data.
 *
 * Currently uses the date the photo was taken, formatted as
 * `YYYY-MM-DD_HHmmss`.  The full `exif` object is available here so
 * the template can be changed to use any other field.
 * 
 * @param {ExifReader.ExpandedTags} exifTags exif tags object
 * @param {string} ext file extension (e.g. ".jpeg")
 * @returns {string | null} new filename, or `null` if filename cannot be constructed
 */
function buildName(exifTags, ext) {
  const dateTag =
    exifTags?.exif?.DateTimeOriginal ??
    exifTags?.exif?.DateTimeDigitized ??
    exifTags?.exif?.DateTime;

  if (!dateTag) return null;

  // DateTimeOriginal is typically "YYYY:MM:DD HH:MM:SS"
  const raw = dateTag.description ?? String(dateTag.value);
  const match = raw.match(
    /(\d{4})[:\-/](\d{2})[:\-/](\d{2})\s+(\d{2}):(\d{2}):(\d{2})/
  );
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}_${h}${mi}${s}${ext}`;
}

/**
 * Simple concurrency limiter.
 */
function makeSemaphore(max) {
  let active = 0;
  const queue = [];

  function next() {
    if (queue.length > 0 && active < max) {
      active++;
      const resolve = queue.shift();
      resolve();
    }
  }

  return {
    acquire() {
      return new Promise((res) => {
        queue.push(res);
        next();
      });
    },
    release() {
      active--;
      next();
    },
  };
}

/**
 * Ensure `name` is unique inside the set of already-claimed names.
 * Appends _001, _002, … on collision.
 */
function dedup(name, claimed) {
  if (!claimed.has(name)) {
    claimed.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  let i = 1;
  while (true) {
    const candidate = `${base}_${String(i).padStart(3, "0")}${ext}`;
    if (!claimed.has(candidate)) {
      claimed.add(candidate);
      return candidate;
    }
    i++;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!dryRun) {
    await mkdir(dstRoot, { recursive: true });
  }

  const sem = makeSemaphore(CONCURRENCY);
  const claimed = new Set(); // target filenames already used
  const tasks = [];

  let found = 0;
  let processed = 0;
  let skipped = 0;

  for await (const file of walk(srcRoot)) {
    if (!FILENAME_PATTERN.test(file.name)) continue;
    found++;

    await sem.acquire();

    const task = (async () => {
      try {
        const exif = await readExif(file.path);
        const ext = extname(file.name).toLowerCase();
        const newName = buildName(exif, ext);

        if (!newName) {
          console.warn(`  SKIP (missing required EXIF): ${file.path}`);
          skipped++;
          return;
        }

        const uniqueName = dedup(newName, claimed);
        const dst = join(dstRoot, uniqueName);

        if (dryRun) {
          console.log(`  [dry-run] ${file.path} → ${dst}`);
        } else {
          await rename(file.path, dst);
          console.log(`  ${file.path} → ${dst}`);
        }
        processed++;
      } catch (err) {
        console.warn(`  SKIP (error): ${file.path} — ${err.message}`);
        skipped++;
      } finally {
        sem.release();
      }
    })();

    tasks.push(task);
  }

  await Promise.all(tasks);

  console.log(
    `\nDone. Found: ${found}  Processed: ${processed}  Skipped: ${skipped}` +
      (dryRun ? "  (dry-run, no files moved)" : "")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
