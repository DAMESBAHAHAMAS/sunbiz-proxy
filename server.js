/**
 * SUNBIZ NAME SEARCH PROXY — STANDALONE SERVER
 * Lightweight Express server. No Redis. No workers.
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

  const encoded   = encodeURIComponent(raw.toUpperCase());
  const sunbizUrl = `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=EntityName&inquiryDirectionType=ForwardList&searchNameOrder=&masterFileNumber=&inquiryDirectionType=ForwardList&searchTerm=${encoded}&listNameOrder=`;

  try {
    const response = await axios.get(sunbizUrl, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (compatible; DKProxyBot/1.0)",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer":         "https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
      },
      timeout: 8000,
    });

    const $       = cheerio.load(response.data);
    const matches = [];

    $("table.searchResultGrid tbody tr").each((i, row) => {
      const cols = $(row).find("td");
      if (cols.length >= 3) {
        const entityName = $(cols[0]).text().trim();
        const docNumber  = $(cols[1]).text().trim();
        const status     = $(cols[2]).text().trim();
        if (entityName) matches.push({ entityName, docNumber, status });
      }
    });

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
