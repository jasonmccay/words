import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);

function usage() {
	console.error('Usage: pnpm cp "Post Title" [-t tag1,tag2] [-s "Description"]');
	process.exit(1);
}

// Parse args
let title = null;
let tags = [];
let description = null;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "-t" && args[i + 1]) {
		tags = args[++i].split(",").map((t) => t.trim());
	} else if (args[i] === "-s" && args[i + 1]) {
		description = args[++i];
	} else if (!title) {
		title = args[i];
	}
}

if (!title) usage();

if (!description) description = title;

// Generate slug: lowercase, replace non-alphanumeric with hyphens, collapse/trim
const slug = title
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, "-")
	.replace(/^-|-$/g, "");

// Format date as "DD Mon YYYY"
const months = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const now = new Date();
const day = now.getDate();
const dateStr = `${day} ${months[now.getMonth()]} ${now.getFullYear()}`;

// Build frontmatter
const tagsStr = tags.length
	? `[${tags.map((t) => `"${t}"`).join(", ")}]`
	: "[]";

const frontmatter = `---
title: "${title}"
description: "${description}"
publishDate: "${dateStr}"
tags: ${tagsStr}
---
`;

// Create directory and file
const dir = join(
	import.meta.dirname,
	"..",
	"src",
	"content",
	"post",
	slug,
);

if (existsSync(dir)) {
	console.error(`Error: directory already exists: ${dir}`);
	process.exit(1);
}

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "index.md"), frontmatter);

console.log(`Created: src/content/post/${slug}/index.md`);
