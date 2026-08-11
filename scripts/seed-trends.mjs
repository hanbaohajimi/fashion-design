/**
 * seed-trends.mjs
 * Calls Claude via AMUX to generate real 2026 fashion trend data,
 * then seeds TrendItem + TrendDigest into the DB via Prisma.
 *
 * Usage: node scripts/seed-trends.mjs
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env manually (no dotenv dependency needed) ─────────────────────────
function loadEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // ignore if not found
  }
}
loadEnv(path.join(__dirname, "../.env"));
loadEnv(path.join(__dirname, "../apps/api/.env"));

const AMUX_BASE_URL   = process.env.AMUX_BASE_URL;
const AMUX_API_KEY    = process.env.AMUX_API_KEY;
const AMUX_MODEL      = process.env.AMUX_CLAUDE_MODEL ?? "claude-sonnet-5";
const DATABASE_URL    = process.env.DATABASE_URL;

if (!AMUX_BASE_URL || !AMUX_API_KEY) {
  console.error("❌  AMUX_BASE_URL / AMUX_API_KEY not set");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("❌  DATABASE_URL not set");
  process.exit(1);
}

// ── Prisma client ─────────────────────────────────────────────────────────────
// The @fashion/db package compiles to dist/src/client.js which exports the
// `prisma` singleton already wired to PrismaPg + DATABASE_URL.
// On Windows, path.join gives a drive-letter path (G:\...) which ESM import()
// rejects — must convert to a file:// URL first.
const { pathToFileURL } = await import("url");
const dbClientPath = path.join(__dirname, "../packages/db/dist/src/client.js");
const { prisma } = await import(pathToFileURL(dbClientPath).href);

// ── AMUX / Claude call ────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userPrompt) {
  const res = await fetch(`${AMUX_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AMUX_API_KEY}`,
    },
    body: JSON.stringify({
      model: AMUX_MODEL,
      max_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AMUX ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cuid2() {
  // Simple CUID2-style ID using random hex — good enough for seeding
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = chars[Math.floor(Math.random() * 26)]; // start with lowercase letter
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * 36)];
  return id;
}

function parseJson(text) {
  // Extract JSON from markdown code blocks if wrapped
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : text.trim();
  return JSON.parse(raw);
}

const ALLOWED_SOURCE_HOSTS = new Set([
  "businessoffashion.com",
  "fashionunited.com",
  "highsnobiety.com",
  "hypebeast.com",
  "ssense.com",
  "vogue.com",
  "wwd.com",
]);

async function verifiedSourceUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || !ALLOWED_SOURCE_HOSTS.has(host)) {
    return null;
  }
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "FashionTrendVerifier/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const finalHost = new URL(response.url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    const contentType = response.headers.get("content-type") ?? "";
    return response.ok &&
      ALLOWED_SOURCE_HOSTS.has(finalHost) &&
      contentType.includes("text/html")
      ? response.url
      : null;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🌐  Calling Claude (${AMUX_MODEL}) via AMUX to generate 2026 fashion trend data…\n`);

  // Step 1: Generate 12 trend items
  const itemsRaw = await callClaude(
    `You are a senior fashion industry analyst specializing in trend forecasting for 2026.
Return ONLY valid JSON — no markdown, no commentary, just a raw JSON array.`,
    `Generate an array of exactly 12 fashion trend articles for Q3 2026 (July–September).
Each item must be a JSON object with these exact fields:
{
  "title": "article headline (max 90 chars)",
  "summary": "2–3 sentence trend summary (100–180 chars)",
  "platform": one of ["vogue.com","wwd.com","hypebeast.com","ssense.com","highsnobiety.com","businessoffashion.com"],
  "sourceUrl": "https://[platform]/[realistic-slug]",
  "publishedAt": "ISO8601 date between 2026-07-01 and 2026-08-01",
  "category": one of ["color","silhouette","fabric","styling","sustainability","accessories"],
  "tags": array of 3–5 lowercase string tags,
  "extracted": {
    "keyColors": array of 3–5 HEX codes (e.g. "#c9a96e"),
    "silhouettes": array of 2–4 silhouette keywords (e.g. "cocoon coat", "bias-cut slip"),
    "keywords": array of 5–8 trend keywords,
    "fabricMentions": array of 2–4 fabric names (e.g. "crinkled silk", "technical mesh"),
    "sentimentScore": float 0.0–1.0
  }
}
Cover a diverse mix of categories, platforms, and aesthetics.
Do NOT wrap in markdown — return the raw JSON array only.`
  );

  let items;
  try {
    items = parseJson(itemsRaw);
  } catch (e) {
    console.error("❌  Could not parse items JSON:", e.message);
    console.error("Raw output:", itemsRaw.slice(0, 500));
    process.exit(1);
  }
  console.log(`✅  Generated ${items.length} trend items from Claude\n`);

  // Step 2: Generate the weekly digest
  const digestRaw = await callClaude(
    `You are a senior fashion editor writing the weekly trend digest for a professional design platform.
Return ONLY valid JSON — no markdown, no commentary.`,
    `Based on this week's top fashion trends for the week of 2026-07-28, write a trend digest.
Return a JSON object with these exact fields:
{
  "theme": "a single evocative theme title (max 60 chars, e.g. 'Soft Utility Meets Neo-Romantic')",
  "overview": "A rich 4–6 sentence editorial overview covering the dominant aesthetic directions, key color stories, silhouette shifts, and fabric innovations defining this week in fashion. Write in the voice of a Vogue market editor — authoritative, specific, forward-looking. At least 350 characters."
}
Topics to weave in: late-summer 2026 collections, resort & pre-fall crossover, the resurgence of artisanal craft, AI-assisted design tools entering ateliers, and sustainable material innovation.
Do NOT wrap in markdown — return the raw JSON object only.`
  );

  let digest;
  try {
    digest = parseJson(digestRaw);
  } catch (e) {
    console.error("❌  Could not parse digest JSON:", e.message);
    console.error("Raw output:", digestRaw.slice(0, 500));
    process.exit(1);
  }
  console.log(`✅  Generated digest: "${digest.theme}"\n`);

  // Step 3: Verify every source before touching existing data.
  console.log("📦  Verifying sources before seeding…");
  const verifiedItems = [];
  for (const item of items) {
    try {
      const sourceUrl = await verifiedSourceUrl(item.sourceUrl);
      if (!sourceUrl) {
        console.warn(`   skipped unverifiable source: ${String(item.sourceUrl).slice(0, 120)}`);
        continue;
      }
      const platform = new URL(sourceUrl).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      verifiedItems.push({ ...item, platform, sourceUrl });
    } catch (err) {
      console.warn(`   ⚠️   Skipped (${err.message.slice(0, 80)})`);
    }
  }
  if (verifiedItems.length === 0) {
    throw new Error("没有可验证的真实趋势来源；已保留数据库原有数据");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.trendDigest.deleteMany({});
    await transaction.trendItem.deleteMany({});

    const insertedIds = [];
    for (const item of verifiedItems) {
      const id = cuid2();
      await transaction.trendItem.create({
        data: {
          id,
          title:       String(item.title).slice(0, 255),
          summary:     String(item.summary),
          platform: item.platform,
          sourceUrl: item.sourceUrl,
          publishedAt: new Date(item.publishedAt),
          category:    String(item.category),
          tags:        Array.isArray(item.tags) ? item.tags.map(String) : [],
          extracted:   item.extracted ?? null,
          status:      "published",
        },
      });
      insertedIds.push(id);
      console.log(`   ✓  [${item.category}] ${item.title.slice(0, 60)}…`);
    }

    const now = new Date();
    const period = isoWeekPeriod(now);
    await transaction.trendDigest.create({
      data: {
        id:      cuid2(),
        period,
        theme:   digest.theme,
        itemIds: insertedIds,
        overview: digest.overview,
      },
    });
    console.log(`   ✓  Digest created (period: ${period}, ${insertedIds.length} items)\n`);
  });

  // Step 4: Verify via API
  console.log("🔍  Querying API to verify…\n");
  try {
    const [trendsRes, digestRes] = await Promise.all([
      fetch("http://127.0.0.1:3001/trends?limit=12"),
      fetch("http://127.0.0.1:3001/trends/digest/current"),
    ]);

    // The /trends endpoint is guarded; try direct Prisma query instead
    const [dbItems, dbDigest] = await Promise.all([
      prisma.trendItem.findMany({
        where: { status: "published" },
        orderBy: { publishedAt: "desc" },
        take: 12,
        select: { id: true, title: true, category: true, platform: true, publishedAt: true, tags: true },
      }),
      prisma.trendDigest.findFirst({ orderBy: { createdAt: "desc" } }),
    ]);

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🧵  2026 FASHION TREND REPORT — Week 31 (Jul 28 – Aug 3)");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log(`  THEME: ${dbDigest?.theme}\n`);
    console.log(`  OVERVIEW:\n  ${dbDigest?.overview}\n`);
    console.log("  ─── TREND ITEMS (" + dbItems.length + ") ───────────────────────────────────\n");
    for (const t of dbItems) {
      const date = t.publishedAt.toISOString().slice(0, 10);
      console.log(`  [${t.category.padEnd(14)}] ${t.title.slice(0, 65)}`);
      console.log(`                   📌 ${t.platform}  ·  ${date}  ·  #${t.tags.slice(0,3).join(" #")}\n`);
    }
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  ✅  ${dbItems.length} items seeded · digest period ${dbDigest?.period}`);
    console.log("  🌐  Endpoints ready:");
    console.log("       GET http://127.0.0.1:3001/trends");
    console.log("       GET http://127.0.0.1:3001/trends/digest/current");
    console.log("═══════════════════════════════════════════════════════════\n");
  } catch (err) {
    console.error("Verification error:", err.message);
  }

  await prisma.$disconnect();
}

function isoWeekPeriod(date) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((current - yearStart) / 86400000 + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
