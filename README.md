# Exifier

Batch-edit EXIF metadata on files based on their path, filename, and existing metadata.

## Prerequisites

- Node.js (v18+)

## Installation

```sh
npm install
```

This installs [exiftool-vendored](https://github.com/photostructure/exiftool-vendored.js) (which bundles its own copy of ExifTool) and [p-limit](https://github.com/sindresorhus/p-limit) for concurrency control.

## Usage

```sh
node index.mjs [--no-backup] <rootDir>
```

The script recursively walks `<rootDir>`, finds all JPEG (`.jpg`, `.jpeg`) and MP4 (`.mp4`) files, and applies metadata rules to each one.

### Options

| Option | Description |
|---|---|
| `--no-backup` | By default, ExifTool creates a backup of each modified file with an `_original` suffix. Pass this flag to skip backup creation and overwrite files in place. |

### Example

```sh
# Process all matching files under ./photos, keeping backups
node index.mjs ./photos

# Process without creating backup files
node index.mjs --no-backup ./photos
```

## File pattern

The `FILE_PATTERN` constant in `index.mjs` controls which files are processed. It currently matches JPEG (`.jpg`, `.jpeg`) and MP4 (`.mp4`) files. Adjust this regex to include or exclude other file types.

## How rules work

Metadata rules are defined in the `computeNewTags()` function in `index.mjs`. This is a pure function that receives:

- **`relPath`** — the file's path relative to `rootDir` (e.g. `vacation/beach/IMG_001.jpg`)
- **`filename`** — the file's basename including extension (e.g. `IMG_001.jpg`)
- **`existingTags`** — all existing EXIF/IPTC/XMP tags as read by ExifTool

It should return either:

- A `WriteTags` object with the tags to set (existing tags not included are left untouched; assign a tag a `null` value to delete that tag)
- `null` to skip the file entirely

### Placeholder rule

The current placeholder rule adds the filename (minus its extension) as a `Keywords` tag, unless the filename starts with a number.

## Error handling

Per-file errors are caught and logged to stderr. Processing continues for all remaining files. A summary of files found, written, skipped, and failed is printed at the end.
