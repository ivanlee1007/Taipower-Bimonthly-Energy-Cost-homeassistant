#!/usr/bin/env node
/**
 * scripts/update_rates.js
 *
 * Download the latest Taipower rate PDF, parse it with pdf-parse,
 * and write structured rate data to rates.json.
 *
 * Usage:
 *   node scripts/update_rates.js
 *
 * Dependencies:  npm install pdf-parse node-fetch
 */

const fs = require("fs");
const path = require("path");

// ── PDF URL ──────────────────────────────────────────────────────────────────
const PDF_URL =
  "https://www.taipower.com.tw/media/ba2angqi/各類電價表及計算範例.pdf";
const OUTPUT_FILE = path.join(__dirname, "..", "rates.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPDF(url) {
  const fetch = (await import("node-fetch")).default;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function parsePDF(buffer) {
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  await parser.load();
  const result = await parser.getText();
  // Concatenate all pages
  return result.pages.map((p) => p.text).join("\n\n");
}

/**
 * Parse rate tiers from Taipower PDF text.
 *
 * The PDF text is vertical-layout, so characters appear newline-separated.
 * Uses page-by-page processing since each page is a different billing type.
 *
 * Falls back to known defaults if parsing fails.
 */
async function parseRatesFromPDF(parser) {
  const result = await parser.getText();

  // Normalize: join single CJK chars, "每\n度" etc.
  function normalize(s) {
    return s
      .replace(/([^\n])\n([^\n])\n([^\n])\n/g, (match, a, b, c) => {
        if (/[\u4e00-\u9fff]/.test(a) && /[\u4e00-\u9fff]/.test(b) && /[\u4e00-\u9fff]/.test(c))
          return a + b + c;
        return match;
      })
      .replace(/每\n度/g, '每度')
      .replace(/度\n以\n下/g, '度以下')
      .replace(/度\n以\n上/g, '度以上');
  }

  function parseTiers(pageText) {
    const tiers = [];
    const lineRe = /(\d+)\s*(?:~\s*(\d+))?\s*度\s*(?:以\s*)?(?:下|上)?\s*部分\s*(?:每\s*度\s*)?([\d.]+)\s+([\d.]+)/g;
    let m;
    while ((m = lineRe.exec(pageText)) !== null) {
      const isUpper = m[0].includes('以上');
      const hasRange = !!m[2];
      let upper;
      if (isUpper) upper = null;
      else if (hasRange) upper = parseInt(m[2], 10);
      else upper = parseInt(m[1], 10);
      tiers.push({
        threshold: upper,
        rate_summer: parseFloat(m[3]),
        rate_non_summer: parseFloat(m[4]),
      });
    }
    return tiers;
  }

  const modes = {};

  // Page 2 = residential + non-commercial (same rates)
  // Page 3 = commercial
  // Look for pages that contain 非時間電價 and 部分 (tier lines)
  for (const page of result.pages) {
    const text = normalize(page.text);
    if (!text.includes('非時間電價') || !text.includes('度部分')) continue;

    const tiers = parseTiers(text);
    if (tiers.length === 0) continue;

    if (text.includes('住宅用') || (text.includes('120') && tiers.length >= 6)) {
      // Take only first 6 tiers (residential + non-commercial share same page/rates)
      const uniqueTiers = tiers.slice(0, 6);
      modes.residential = {
        summer: uniqueTiers.map((t) => t.rate_summer),
        non_summer: uniqueTiers.map((t) => t.rate_non_summer),
      };
      modes.non_commercial = { ...modes.residential };
    } else if (text.includes('營') && text.includes('業') && text.includes('用')) {
      // Check it's the actual commercial table, not just example text
      if (tiers.some((t) => t.rate_summer > 2.0)) {
        modes.commercial = {
          summer: tiers.map((t) => t.rate_summer),
          non_summer: tiers.map((t) => t.rate_non_summer),
        };
      }
    }
  }

  return modes;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("⬇  Downloading Taipower rate PDF...");
  const buffer = await fetchPDF(PDF_URL);
  console.log(`   PDF size: ${(buffer.length / 1024).toFixed(1)} KB`);

  console.log("📄 Parsing PDF text...");
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  await parser.load();

  console.log("🔍 Extracting rate tiers...");
  const modes = await parseRatesFromPDF(parser);

  const version = new Date().toISOString().slice(0, 7).replace("-", ""); // e.g. "202603"
  const result = {
    version: `parsed_${version}`,
    updated_at: new Date().toISOString(),
    pdf_url: PDF_URL,
    modes,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), "utf-8");
  console.log(`✅ Wrote rates to ${OUTPUT_FILE}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
