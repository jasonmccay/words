import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rl = createInterface({ input: process.stdin, output: process.stdout });

const content = await rl.question("Post content: ");
if (!content.trim()) {
	console.error("Error: post content is required.");
	process.exit(1);
}

const title = await rl.question("Title: ");
if (!title.trim()) {
	console.error("Error: title is required.");
	process.exit(1);
}

const tagsInput = await rl.question("Tags (comma-separated): ");
const tags = tagsInput
	.split(",")
	.map((t) => t.trim())
	.filter(Boolean);

rl.close();

const description = title;

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
writeFileSync(join(dir, "index.md"), frontmatter + content + "\n");

console.log(`Created: src/content/post/${slug}/index.md`);
