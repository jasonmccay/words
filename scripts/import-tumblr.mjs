#!/usr/bin/env node
/**
 * import-tumblr.mjs
 *
 * Scrapes all posts from jasonmccay.com (a Tumblr blog) and imports them
 * into the Astro project as posts in src/content/post/.
 *
 * For each Tumblr photo post it will:
 *   1. Extract the caption, image URL, publish date, and tags
 *   2. Create a directory at src/content/post/<slug>/
 *   3. Download the image into that directory as cover.jpg (or .png)
 *   4. Write an index.md with proper frontmatter
 *
 * Usage:
 *   node scripts/import-tumblr.mjs
 *
 * Options (env vars):
 *   DRY_RUN=1   — print what would be created without writing files
 *   START_PAGE=N — start from page N (default 1)
 *   END_PAGE=N   — stop after page N (default: crawl until no more pages)
 *   DELAY_MS=N   — ms to wait between page fetches (default 1000)
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import http from "node:http";

// ─── Config ────────────────────────────────────────────────────────────────

const BLOG_URL = "https://jasonmccay.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONTENT_POST_DIR = path.join(PROJECT_ROOT, "src", "content", "post");

const DRY_RUN = process.env.DRY_RUN === "1";
const START_PAGE = Number.parseInt(process.env.START_PAGE ?? "1", 10);
const END_PAGE = process.env.END_PAGE
	? Number.parseInt(process.env.END_PAGE, 10)
	: Number.POSITIVE_INFINITY;
const DELAY_MS = Number.parseInt(process.env.DELAY_MS ?? "1000", 10);

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return the response body as text.
 */
function fetchText(url) {
	return new Promise((resolve, reject) => {
		const lib = url.startsWith("https") ? https : http;
		const req = lib.get(
			url,
			{
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml",
				},
			},
			(res) => {
				// Follow redirects
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					return resolve(fetchText(res.headers.location));
				}
				if (res.statusCode !== 200) {
					return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
				}
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
				res.on("error", reject);
			},
		);
		req.on("error", reject);
	});
}

/**
 * Download a URL to a local file path.
 */
function downloadFile(url, destPath) {
	return new Promise((resolve, reject) => {
		const lib = url.startsWith("https") ? https : http;
		const req = lib.get(
			url,
			{
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				},
			},
			async (res) => {
				// Follow redirects
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					return resolve(downloadFile(res.headers.location, destPath));
				}
				if (res.statusCode !== 200) {
					return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
				}
				try {
					const writer = createWriteStream(destPath);
					await pipeline(res, writer);
					resolve();
				} catch (err) {
					reject(err);
				}
			},
		);
		req.on("error", reject);
	});
}

/**
 * Sleep for N milliseconds.
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a caption string into a URL/folder-friendly slug.
 * Max 50 chars, lowercase, alphanumeric + hyphens.
 */
function slugify(text) {
	return text
		.toLowerCase()
		.replace(/['']/g, "") // remove apostrophes
		.replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → hyphen
		.replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
		.slice(0, 50)
		.replace(/-+$/, ""); // trim trailing hyphens after slice
}

/**
 * Truncate text to maxLen characters, trimming at the last word boundary
 * and appending "…" if truncated.
 */
function truncate(text, maxLen) {
	if (text.length <= maxLen) return text;
	const trimmed = text.slice(0, maxLen).replace(/\s+\S*$/, "");
	return trimmed + "…";
}

/**
 * Check if a path exists.
 */
async function exists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Convert a Tumblr date string like "Sep 13th, 2014" to a Date object.
 */
function parseTumblrDate(dateStr) {
	// The dates appear like "Sep 13th, 2014" or "Mar 28th, 2014"
	// Strip ordinal suffixes: 1st → 1, 2nd → 2, etc.
	const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/, "$1");
	const d = new Date(cleaned);
	if (isNaN(d.getTime())) {
		// Fall back to current date if parse fails
		console.warn(`  ⚠  Could not parse date: "${dateStr}", using today`);
		return new Date();
	}
	return d;
}

/**
 * Format a Date as "DD Mon YYYY" (e.g. "13 Sep 2014").
 */
function formatDate(date) {
	return date.toLocaleDateString("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

/**
 * Escape YAML special characters in a string value.
 */
function yamlStr(str) {
	// If the string contains special chars, wrap in double quotes and escape internals
	if (/[:"'#&*?|<>{}\[\],!%@`]/.test(str) || str.includes("\n")) {
		return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return str;
}

// ─── Parser ────────────────────────────────────────────────────────────────

/**
 * Very lightweight HTML parser — no external deps.
 * Extracts posts from a Tumblr blog page.
 *
 * Each post is an object:
 *   { postId, slug, caption, imageUrl, imageAlt, date, tags }
 */
function parsePosts(html) {
	const posts = [];

	// Find individual post blocks.
	// Tumblr wraps posts in <article> or identifiable <div> containers.
	// We'll look for the pattern: a linked image followed by a caption,
	// then a permalink date link.

	// Strategy: find all permalink links like:
	//   <a href="https://jasonmccay.com/post/97419682203/well-everyday-cant-be-a-sunny-day-at-the-beach" title="11 years ago">
	// and extract the surrounding post context.

	// Split HTML into rough "post" sections by permalink anchor
	const permaPattern =
		/href="(https:\/\/jasonmccay\.com\/post\/(\d+)\/([^"]+))"[^>]*title="([^"]+)"/g;

	const permalinks = [];
	for (;;) {
		const match = permaPattern.exec(html);
		if (match === null) break;
		permalinks.push({
			url: match[1],
			postId: match[2],
			urlSlug: match[3],
			title: match[4], // e.g. "11 years ago"
			index: match.index,
		});
	}

	// For each permalink, look backwards for the image and caption,
	// and extract tags.
	for (let i = 0; i < permalinks.length; i++) {
		const { postId, urlSlug, index } = permalinks[i];

		// Slice the HTML chunk for this post: from the previous permalink to this one
		const chunkStart = i === 0 ? 0 : permalinks[i - 1].index;
		const chunkEnd = index + 200; // a bit past the date link
		const chunk = html.slice(chunkStart, chunkEnd);

		// ── Image ──────────────────────────────────────────────
		// Look for <img ... src="https://64.media.tumblr.com/...">
		const imgMatch = chunk.match(
			/src="(https:\/\/(?:64\.media\.tumblr\.com|[^"]*tumblr[^"]*?)\/[^"]+_(?:640|500|400|1280)\.[a-z]+)"/i,
		);
		// Also try broader pattern for any tumblr CDN image
		const imgMatchBroad = chunk.match(/src="(https:\/\/64\.media\.tumblr\.com\/[^"]+)"/i);

		const imageUrl = (imgMatch && imgMatch[1]) || (imgMatchBroad && imgMatchBroad[1]);

		if (!imageUrl) {
			// Skip non-photo posts (text-only, etc.)
			continue;
		}

		// ── Alt / Caption ──────────────────────────────────────
		// The alt attribute on the img tag often contains the caption
		const altMatch = chunk.match(/alt="([^"]+)"/);
		// The paragraph text after the image often IS the caption
		// Look for text content between the </a> (after the image link) and the next tag
		const captionMatch = chunk.match(/<\/a>\s*\n\s*([\s\S]+?)\n\s*\[/);

		let caption =
			(altMatch && altMatch[1]) ||
			(captionMatch && captionMatch[1].trim()) ||
			urlSlug.replace(/-/g, " ");

		// Clean up caption: remove HTML tags, decode entities
		caption = caption
			.replace(/<[^>]+>/g, "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&apos;/g, "'")
			.replace(/&rsquo;/g, "'")
			.replace(/&lsquo;/g, "'")
			.replace(/&rdquo;/g, '"')
			.replace(/&ldquo;/g, '"')
			.replace(/&hellip;/g, "…")
			.replace(/&nbsp;/g, " ")
			.trim();

		// ── Date ───────────────────────────────────────────────
		// The date is the text content of the permalink's parent <a> element,
		// but it shows as "Sep 13th, 2014" format in another nearby link.
		// Actually on Tumblr, the date link has: >Sep 13th, 2014</a>
		const dateMatch = chunk.match(
			/>(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+(?:st|nd|rd|th),\s+\d{4}</,
		);
		const dateStr = dateMatch ? dateMatch[0].slice(1, -1) : null;
		const publishDate = dateStr ? parseTumblrDate(dateStr) : new Date();

		// ── Tags ───────────────────────────────────────────────
		// Tumblr tags appear as: <a href="https://jasonmccay.com/tagged/birmingham">birmingham</a>
		const tagPattern = /href="https:\/\/jasonmccay\.com\/tagged\/([^"]+)">([^<]+)<\/a>/g;
		const tags = [];
		for (;;) {
			const tagMatch = tagPattern.exec(chunk);
			if (tagMatch === null) break;
			const tag = tagMatch[1].toLowerCase().replace(/%20/g, "-").replace(/\s+/g, "-");
			if (!tags.includes(tag)) tags.push(tag);
		}

		// ── Image extension ────────────────────────────────────
		const extMatch = imageUrl.match(/\.([a-z]+)(?:\?|$)/i);
		const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";

		posts.push({
			postId,
			urlSlug,
			caption,
			imageUrl,
			imageExt: ext,
			publishDate,
			tags,
		});
	}

	return posts;
}

/**
 * Check if there is a "Next" page link in the HTML.
 */
function hasNextPage(html) {
	return html.includes('href="/page/') && /\[Next\]|>Next</.test(html);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
	console.log("╔════════════════════════════════════════╗");
	console.log("║   Tumblr → Astro Importer              ║");
	console.log("╚════════════════════════════════════════╝");
	if (DRY_RUN) console.log("  🔍 DRY RUN — no files will be written\n");

	let page = START_PAGE;
	let totalImported = 0;
	let totalSkipped = 0;
	let totalErrors = 0;

	// Track used slugs to avoid collisions
	const usedSlugs = new Set();

	while (page <= END_PAGE) {
		const pageUrl = page === 1 ? BLOG_URL : `${BLOG_URL}/page/${page}`;
		console.log(`\n📄  Fetching page ${page}: ${pageUrl}`);

		let html;
		try {
			html = await fetchText(pageUrl);
		} catch (err) {
			console.error(`  ✗  Failed to fetch page ${page}: ${err.message}`);
			break;
		}

		const posts = parsePosts(html);
		console.log(`  Found ${posts.length} photo post(s) on page ${page}`);

		for (const post of posts) {
			const { postId, caption, imageUrl, imageExt, publishDate, tags } = post;

			// Build a unique slug: slugified caption + postId suffix for uniqueness
			let baseSlug = slugify(caption);
			if (!baseSlug) baseSlug = `photo-${postId}`;

			// Ensure uniqueness
			let slug = baseSlug;
			let suffix = 2;
			while (usedSlugs.has(slug)) {
				slug = `${baseSlug}-${suffix++}`;
			}
			usedSlugs.add(slug);

			const postDir = path.join(CONTENT_POST_DIR, slug);
			const indexMd = path.join(postDir, "index.md");
			const imageName = `cover.${imageExt}`;
			const imagePath = path.join(postDir, imageName);

			// Build frontmatter fields
			const title = truncate(caption, 60);
			const description = truncate(caption, 160);
			const dateFormatted = formatDate(publishDate);
			const tagsYaml = tags.length > 0 ? `[${tags.map((t) => `"${t}"`).join(", ")}]` : '["photos"]';

			const frontmatter = `---
title: ${yamlStr(title)}
description: ${yamlStr(description)}
publishDate: "${dateFormatted}"
tags: ${tagsYaml}
coverImage:
  src: "./${imageName}"
  alt: ${yamlStr(caption)}
---
`;

			const mdContent = `${frontmatter}
${caption}
`;

			// ── Skip if already imported ────────────────────────
			if (await exists(indexMd)) {
				console.log(`  ⏭  Skipping (already exists): ${slug}`);
				totalSkipped++;
				usedSlugs.add(slug);
				continue;
			}

			console.log(`  ✦  Importing: ${slug}`);
			console.log(`       Date:  ${dateFormatted}`);
			console.log(`       Tags:  ${tags.join(", ") || "(none)"}`);
			console.log(`       Image: ${imageUrl}`);

			if (DRY_RUN) {
				totalImported++;
				continue;
			}

			try {
				// Create directory
				await mkdir(postDir, { recursive: true });

				// Download image
				console.log("       Downloading image\u2026");
				await downloadFile(imageUrl, imagePath);

				// Write markdown
				await writeFile(indexMd, mdContent, "utf8");

				totalImported++;
				console.log("       \u2713 Done");
			} catch (err) {
				console.error(`       ✗ Error: ${err.message}`);
				totalErrors++;
			}
		}

		// Check for next page
		if (!hasNextPage(html) || page >= END_PAGE) {
			console.log(`\n  No more pages found. Stopping at page ${page}.`);
			break;
		}

		page++;
		if (page <= END_PAGE) {
			console.log(`  ⏳  Waiting ${DELAY_MS}ms before next page…`);
			await sleep(DELAY_MS);
		}
	}

	console.log("\n╔════════════════════════════════════════╗");
	console.log("║   Import Complete                       ║");
	console.log("╚════════════════════════════════════════╝");
	console.log(`  ✓ Imported:  ${totalImported}`);
	console.log(`  ⏭ Skipped:   ${totalSkipped}`);
	console.log(`  ✗ Errors:    ${totalErrors}`);
	if (DRY_RUN) {
		console.log("\n  (Dry run — no files were written)");
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
