/**
 * SUNBIZ NAME SEARCH PROXY — STANDALONE SERVER
 * Uses Firecrawl to bypass Sunbiz Cloudflare protection.
 * Deploy as a new Render Web Service.
 *
 * Endpoint: GET /api/sunbiz/check?name=Sunrise+Holdings+LLC
 * Health:   GET /health
 */

require("dotenv").config();

const express   = require("express");
const axios     = require("axios");
const cheerio   = require("cheerio");
const rateLimit = require("express-rate-limit");
const cors      = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Render's proxy
app.set("trust proxy", 1);

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "fc-d5ee473d476740e1a1e93c60c63e4f2e";

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "https://damianmaknowles.com",
    "https://www.damianmaknowles.com",
    "http://localhost:5173",
    "http://localhost:3000"
  ]
}));

app.use(express.json());

// ── Rate limiter ──────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests. Please wait a moment and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeName(name) {
  return name
    .toUpperCase()
    .replace(/,?\s*(LLC|L\.L\.C\.|LIMITED LIABILITY COMPANY)\s*$/i, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .trim();
}

function isExactMatch(search, result) {
  return normalizeName(search) === normalizeName(result);
}

function isCloseMatch(search, result) {
  const s = normalizeName(search);
  const r = normalizeName(result);
  return (r.startsWith(s) || s.startsWith(r)) && s !== r;
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "sunbiz-proxy", engine: "firecrawl", timestamp: new Date().toISOString() });
});

// ── Sunbiz name check via Firecrawl ──────────────────────────────────────────
app.get("/api/sunbiz/check", limiter, async (req, res) => {
  const raw = (req.query.name || "").trim();

  if (!raw || raw.length < 2) {
    return res.status(400).json({ error: "Name must be at least 2 characters." });
  }
  if (raw.length > 200) {
    return res.status(400).json({ error: "Name is too long." });
  }

  const encoded   = encodeURIComponent(raw.toUpperCase());
  const sunbizUrl = `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=EntityName&inquiryDirectionType=ForwardList&searchNameOrder=&masterFileNumber=&inquiryDirectionType=ForwardList&searchTerm=${encoded}&listNameOrder=`;

  try {
    console.log(`[Sunbiz] Fetching via Firecrawl: ${raw}`);

    // Use Firecrawl to fetch the Sunbiz page
    const firecrawlResponse = await axios.post(
      "https://api.firecrawl.dev/v1/scrape",
      {
        url: sunbizUrl,
        formats: ["markdown"],
        waitFor: 2000,
      },
      {
        headers: {
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const markdown = firecrawlResponse.data?.data?.markdown || firecrawlResponse.data?.markdown || "";

    if (!markdown) {
      console.error("[Sunbiz] Firecrawl returned no markdown");
      return res.status(503).json({ error: "Unable to retrieve Sunbiz data at this time." });
    }

    console.log(`[Sunbiz] Firecrawl returned ${markdown.length} chars of markdown`);
    console.log("[Sunbiz] Sample:", markdown.substring(0, 300));

    // Parse markdown table rows
    // Format: | Corporate Name | Document Number | Status |
    const lines = markdown.split("\n");
    const matches = [];

    for (const line of lines) {
      if (!line.startsWith("|")) continue;
      const cols = line.split("|").map(c => c.trim()).filter(c => c.length > 0);
      if (cols.length < 3) continue;
      const entityName = cols[0].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
      const docNumber  = cols[1].trim();
      const status     = cols[2].trim();
      if (
        entityName &&
        entityName !== "Corporate Name" &&
        entityName !== "---" &&
        entityName.length > 1
      ) {
        matches.push({ entityName, docNumber, status });
      }
    }

    console.log(`[Sunbiz] Parsed ${matches.length} matches for: ${raw}`);

    const exactMatches  = matches.filter(m => isExactMatch(raw, m.entityName));
    const closeMatches  = matches.filter(m => isCloseMatch(raw, m.entityName));
    const activeExact   = exactMatches.filter(m => m.status.toUpperCase().includes("ACTIVE"));
    const activeClose   = closeMatches.filter(m => m.status.toUpperCase().includes("ACTIVE"));

    let status;
    if      (activeExact.length > 0)  status = "unavailable";
    else if (activeClose.length > 0)  status = "likely_taken";
    else if (exactMatches.length > 0) status = "likely_available";
    else                               status = "available";

    return res.json({
      name: raw,
      status,
      available:    status === "available" || status === "likely_available",
      exactMatches,
      closeMatches: activeClose.slice(0, 5),
      totalResults: matches.length,
      sunbizUrl,
      checkedAt:    new Date().toISOString(),
    });

  } catch (err) {
    console.error("[Sunbiz] Firecrawl error:", err.response?.status, err.message);
    return res.status(500).json({ error: "Unable to reach Sunbiz at this time." });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Sunbiz proxy running on port ${PORT}`);
});

const express   = require("express");
const axios     = require("axios");
const cheerio   = require("cheerio");
const rateLimit = require("express-rate-limit");
const cors      = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Render's proxy
app.set("trust proxy", 1);

// ── CORS — allow your domain only ────────────────────────────────────────────
app.use(cors({
  origin: [
    "https://damianmaknowles.com",
    "https://www.damianmaknowles.com",
    "http://localhost:5173",
    "http://localhost:3000"
  ]
}));

app.use(express.json());

// ── Rate limiter ──────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests. Please wait a moment and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeName(name) {
  return name
    .toUpperCase()
    .replace(/,?\s*(LLC|L\.L\.C\.|LIMITED LIABILITY COMPANY)\s*$/i, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .trim();
}

function isExactMatch(search, result) {
  return normalizeName(search) === normalizeName(result);
}

function isCloseMatch(search, result) {
  const s = normalizeName(search);
  const r = normalizeName(result);
  return (r.startsWith(s) || s.startsWith(r)) && s !== r;
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "sunbiz-proxy", timestamp: new Date().toISOString() });
});

// ── Sunbiz name check ─────────────────────────────────────────────────────────
app.get("/api/sunbiz/check", limiter, async (req, res) => {
  const raw = (req.query.name || "").trim();

  if (!raw || raw.length < 2) {
    return res.status(400).json({ error: "Name must be at least 2 characters." });
  }
  if (raw.length > 200) {
    return res.status(400).json({ error: "Name is too long." });
  }

  const encoded   = encodeURIComponent(raw);
  const sunbizUrl = `https://search.sunbiz.org/Inquiry/corporationsearch/SearchResults?inquiryType=EntityName&searchTerm=${encoded}`;
  const altUrl    = `https://dos.fl.gov/sunbiz/search-results/?search=entity-name&search-term=${encoded}`;

  try {
    const response = await axios.get(sunbizUrl, {
      headers: {
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept":           "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language":  "en-US,en;q=0.9",
        "Accept-Encoding":  "gzip, deflate, br",
        "Connection":       "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest":   "document",
        "Sec-Fetch-Mode":   "navigate",
        "Sec-Fetch-Site":   "none",
        "Sec-Fetch-User":   "?1",
        "Cache-Control":    "max-age=0",
        "Referer":          "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
      },
      timeout: 10000,
    });

    const $       = cheerio.load(response.data);
    const matches = [];

    // Log the raw HTML for debugging (remove after confirming)
    const tableHtml = $("table").first().html();
    console.log("[Sunbiz] Table HTML snippet:", tableHtml ? tableHtml.substring(0, 500) : "NO TABLE FOUND");
    console.log("[Sunbiz] Full selectors found:", $("table").length, "tables");

    // Try multiple selectors to handle Sunbiz HTML variations
    const selectors = [
      "table.searchResultGrid tbody tr",
      "table.search-results tbody tr",
      "#search-results table tbody tr",
      "table tbody tr",
      "tr"
    ];

    let rowsFound = false;
    for (const selector of selectors) {
      const rows = $(selector);
      if (rows.length > 0) {
        console.log(`[Sunbiz] Found ${rows.length} rows with selector: ${selector}`);
        rows.each((i, row) => {
          const cols = $(row).find("td");
          if (cols.length >= 2) {
            const entityName = $(cols[0]).text().trim();
            const docNumber  = cols.length >= 2 ? $(cols[1]).text().trim() : "";
            const status     = cols.length >= 3 ? $(cols[2]).text().trim() : "";
            if (entityName && entityName.length > 1 && !entityName.toLowerCase().includes("entity name")) {
              matches.push({ entityName, docNumber, status });
            }
          }
        });
        if (matches.length > 0) { rowsFound = true; break; }
      }
    }

    console.log(`[Sunbiz] Parsed ${matches.length} matches for: ${raw}`);

    const exactMatches  = matches.filter(m => isExactMatch(raw, m.entityName));
    const closeMatches  = matches.filter(m => isCloseMatch(raw, m.entityName));
    const activeExact   = exactMatches.filter(m => m.status.toUpperCase().includes("ACTIVE"));
    const activeClose   = closeMatches.filter(m => m.status.toUpperCase().includes("ACTIVE"));

    let status;
    if      (activeExact.length > 0)  status = "unavailable";
    else if (activeClose.length > 0)  status = "likely_taken";
    else if (exactMatches.length > 0) status = "likely_available";
    else                               status = "available";

    return res.json({
      name,
      status,
      available:    status === "available" || status === "likely_available",
      exactMatches,
      closeMatches: activeClose.slice(0, 5),
      totalResults: matches.length,
      sunbizUrl,
      checkedAt:    new Date().toISOString(),
    });

  } catch (err) {
    if (err.code === "ECONNABORTED") {
      return res.status(503).json({ error: "Sunbiz is temporarily unavailable. Please try again." });
    }
    console.error("Sunbiz proxy error:", err.message);
    return res.status(500).json({ error: "Unable to reach Sunbiz at this time." });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Sunbiz proxy running on port ${PORT}`);
});
