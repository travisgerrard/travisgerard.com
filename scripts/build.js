const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "content.json"), "utf8"));
const sourceRoot = path.resolve(root, config.sourceRoot);
const outDirs = ["writing", "dictations"];

for (const dir of outDirs) {
  fs.rmSync(path.join(root, dir), { force: true, recursive: true });
  fs.mkdirSync(path.join(root, dir), { recursive: true });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}[_-]?/, "")
    .replace(/_/g, "-")
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMarkdownFile(relativePath) {
  const fullPath = path.join(sourceRoot, relativePath);
  const raw = fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
  const parsed = parseFrontmatter(raw);
  return {
    ...parsed,
    fullPath,
    relativePath,
    slug: slugify(path.basename(relativePath)),
    title: parsed.meta.title || firstHeading(parsed.body) || titleFromFilename(relativePath),
    date: parsed.meta.date || parsed.meta.created || dateFromFilename(relativePath),
  };
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { meta: {}, body: raw.trim() };
  }

  const end = raw.indexOf("\n---", 4);
  if (end === -1) {
    return { meta: {}, body: raw.trim() };
  }

  const yaml = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).trim();
  const meta = {};

  for (const line of yaml.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  }

  return { meta, body };
}

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? cleanInline(match[1]) : "";
}

function titleFromFilename(relativePath) {
  return path
    .basename(relativePath, ".md")
    .replace(/^\d{4}-\d{2}-\d{2}[_-]?/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function dateFromFilename(relativePath) {
  const match = path.basename(relativePath).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function cleanInline(value) {
  return value
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, page, label) => label || page)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, page, label) => {
    return escapeHtml(label || page);
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
    return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let inCode = false;
  let code = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  return blocks.join("\n");
}

function stripLeadingTitle(markdown, title) {
  const lines = markdown.split("\n");
  const firstMeaningful = lines.findIndex((line) => line.trim());
  if (firstMeaningful === -1) return markdown;

  const heading = lines[firstMeaningful].match(/^#\s+(.+)$/);
  if (!heading) return markdown;

  if (cleanInline(heading[1]).toLowerCase() !== String(title).toLowerCase()) {
    return markdown;
  }

  lines.splice(firstMeaningful, 1);
  return lines.join("\n").trim();
}

function page(title, body, extraClass = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Travis Gerrard</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="page ${extraClass}">
    <header class="site-header">
      <h1><a href="/">Travis Gerrard</a></h1>
      <p>Writing, notes, and source transcripts.</p>
      <nav class="nav">
        <a href="/">home</a>
        <a href="/#writing">writing</a>
        <a href="/#why-transcripts">why transcripts?</a>
        <a href="https://travisgerardmd.com">professional page</a>
      </nav>
    </header>
${body}
    <footer class="footer">
      <p>Plain HTML, blue links, and receipts where available.</p>
    </footer>
  </main>
</body>
</html>
`;
}

function writePage(relativePath, html) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, html);
}

function copyAsset() {
  const source = path.resolve(root, "../resume/images/travis-gerrard-portrait.jpg");
  const dest = path.join(root, "assets/travis-gerrard.jpg");
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, dest);
  }
}

copyAsset();

const posts = config.posts.map((entry) => {
  const article = parseMarkdownFile(entry.article);
  const dictations = (entry.dictations || []).map(parseMarkdownFile);
  return { ...entry, article, dictations };
});

for (const post of posts) {
  const articleBody = `
    <article class="article">
      <h1>${escapeHtml(post.article.title)}</h1>
      <p class="meta">${escapeHtml(post.article.date || "undated")}</p>
      ${
        post.dictations.length
          ? `<p class="source-links">Source transcript${post.dictations.length > 1 ? "s" : ""}: ${post.dictations
              .map((item) => `<a href="/dictations/${item.slug}/">${escapeHtml(item.title)}</a>`)
              .join(" · ")}</p>`
          : ""
      }
      ${markdownToHtml(stripLeadingTitle(post.article.body, post.article.title))}
    </article>
  `;
  writePage(`writing/${post.article.slug}/index.html`, page(post.article.title, articleBody, "article-page"));

  for (const dictation of post.dictations) {
    const dictationBody = `
      <article class="article transcript">
        <h1>${escapeHtml(dictation.title)}</h1>
        <p class="meta">${escapeHtml(dictation.date || "undated")} · source transcript for <a href="/writing/${post.article.slug}/">${escapeHtml(post.article.title)}</a></p>
        ${markdownToHtml(stripLeadingTitle(dictation.body, dictation.title))}
      </article>
    `;
    writePage(`dictations/${dictation.slug}/index.html`, page(dictation.title, dictationBody, "dictation-page"));
  }
}

const postList = posts
  .map((post) => {
    const dictationLinks = post.dictations
      .map((item) => `<a href="/dictations/${item.slug}/">${escapeHtml(item.title)}</a>`)
      .join(" · ");
    return `<li>
      <a href="/writing/${post.article.slug}/">${escapeHtml(post.article.title)}</a>
      <p class="meta">${escapeHtml(post.article.date || "undated")}</p>
      ${dictationLinks ? `<p class="source-links">dictation trail: ${dictationLinks}</p>` : ""}
    </li>`;
  })
  .join("\n");

const writingBody = posts.length
  ? `<ul class="post-list">
${postList}
      </ul>`
  : `<p class="empty-state">Starting fresh from June 3, 2026. I may backfill older pieces later.</p>`;

const homeBody = `
    <section class="intro">
      <img class="portrait" src="/assets/travis-gerrard.jpg" alt="Travis Gerrard">
      <p>This is the personal site for the non-CV side of my writing: essays, notes, and the spoken drafts behind some of them.</p>
      <p>I am interested in keeping a visible trail from thought to dictation to finished writing. Not every page will have that trail, but when it does, the transcript is linked next to the piece.</p>
    </section>

    <section id="writing">
      <h2>Writing</h2>
      ${writingBody}
    </section>

    <section id="why-transcripts" class="note">
      <h2>Why transcripts?</h2>
      <p>A lot of writing now passes through AI tools. I still want the work to feel connected to a human voice. The source transcript is one way to show the rough material before editing, cutting, and arranging.</p>
    </section>
`;

writePage("index.html", page("Home", homeBody));

console.log(`Built ${posts.length} post(s) into ${root}`);
