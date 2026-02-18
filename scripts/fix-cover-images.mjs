#!/usr/bin/env node
/**
 * fix-cover-images.mjs
 *
 * Finds all index.md files under src/content/post/ that have a coverImage
 * block in their frontmatter and converts them to use an inline markdown
 * image in the post body instead.
 *
 * Before:
 *   ---
 *   ...
 *   coverImage:
 *     src: "./cover.jpg"
 *     alt: Some caption
 *   ---
 *
 *   Some caption
 *
 * After:
 *   ---
 *   ...
 *   ---
 *
 *   Some caption
 *
 *   ![Some caption](./cover.jpg)
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POST_DIR = join(__dirname, "..", "src", "content", "post");

let changed = 0;
let skipped = 0;
let errors = 0;

// Match the coverImage block: three lines, src and alt may be quoted or unquoted
// Handles both:
//   coverImage:\n  src: "./cover.jpg"\n  alt: Some text
//   coverImage:\n  src: "./cover.jpg"\n  alt: "Some text"
const COVER_BLOCK_RE = /^coverImage:\n  src: "([^"]+)"\n  alt: ([^\n]+)$/m;

for await (const file of glob("**/index.md", { cwd: POST_DIR })) {
	const filePath = join(POST_DIR, file);
	let content;

	try {
		content = await readFile(filePath, "utf8");
	} catch (err) {
		console.error(`✗ Could not read ${file}: ${err.message}`);
		errors++;
		continue;
	}

	const match = content.match(COVER_BLOCK_RE);
	if (!match) {
		skipped++;
		continue;
	}

	const src = match[1]; // e.g. "./cover.jpg"
	let alt = match[2].trim(); // may be wrapped in quotes or bare

	// Strip surrounding quotes if present
	if ((alt.startsWith('"') && alt.endsWith('"')) || (alt.startsWith("'") && alt.endsWith("'"))) {
		alt = alt.slice(1, -1);
	}

	// Remove the coverImage block (including the trailing newline)
	let updated = content.replace(COVER_BLOCK_RE, "").trimEnd();

	// Remove any blank lines that may have been left before the closing ---
	// The frontmatter closing --- should follow immediately after the last field
	updated = updated.replace(/\n+(\n---)/, "\n$1");

	// Append the inline image to the body (after the closing ---)
	updated = updated + `\n\n![${alt}](${src})\n`;

	try {
		await writeFile(filePath, updated, "utf8");
		changed++;
	} catch (err) {
		console.error(`✗ Could not write ${file}: ${err.message}`);
		errors++;
	}
}

console.log(`Done. Changed: ${changed}, Skipped: ${skipped}, Errors: ${errors}`);
