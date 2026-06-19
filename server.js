/**
 * SUNBIZ NAME SEARCH PROXY
 * Firecrawl-powered Sunbiz search endpoint.
 *
 * Endpoint:
 * GET /api/sunbiz/check?name=Sunrise+Holdings+LLC
 *
 * Health:
 * GET /health
 */

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

// ─────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: [
      "https://damianmaknowles.com",
      "https://www.damianmaknowles.com",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
  })
);

app.use(express.json());

// ─────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: "Too many requests. Please wait a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "sunbiz-proxy",
    engine: "firecrawl",
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// SUNBIZ SEARCH
// ─────────────────────────────────────────────────────────────

app.get("/api/sunbiz/check", limiter, async (req, res) => {
  const raw = (req.query.name || "").trim();

  if (!raw || raw.length < 2) {
    return res.status(400).json({
      error: "Name must be at least 2 characters.",
    });
  }

  if (raw.length > 200) {
    return res.status(400).json({
      error: "Name is too long.",
    });
  }

  const encoded = encodeURIComponent(raw.toUpperCase());

  const sunbizUrl =
  `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/${encodeURIComponent(raw)}/Page1?searchNameOrder=${encoded}`;

  try {
    console.log(`[Sunbiz] Searching: ${raw}`);
    console.log(`[Sunbiz] URL: ${sunbizUrl}`);

    const firecrawlResponse = await axios.post(
      "https://api.firecrawl.dev/v1/scrape",
      {
        url: sunbizUrl,
        formats: ["markdown"],
        waitFor: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const markdown =
      firecrawlResponse.data?.data?.markdown ||
      firecrawlResponse.data?.markdown ||
      "";
console.log("MARKDOWN LENGTH:", markdown.length);
console.log("MARKDOWN SAMPLE START:");
console.log(markdown.substring(0, 2000));
    if (!markdown) {
      console.error("[Sunbiz] No markdown returned");
      return res.status(503).json({
        error: "Unable to retrieve Sunbiz data at this time.",
      });
    }

    const lines = markdown.split("\n");
    const entities = [];

    for (const line of lines) {
      if (!line.startsWith("|")) continue;

      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cols.length < 3) continue;

      const corporate_name = cols[0]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();

      const document_number = cols[1].trim();
      const status = cols[2].trim();

      if (
        corporate_name &&
        corporate_name !== "Corporate Name" &&
        corporate_name !== "---" &&
        corporate_name.length > 1
      ) {
        entities.push({
          corporate_name,
          document_number,
          status,
        });
      }
    }

    console.log(
      `[Sunbiz] Parsed ${entities.length} entities for "${raw}"`
    );

    return res.json({
      search_term: raw,
      total_results: entities.length,
      entities,
      interpretation_key: {
        ACTIVE: "Entity is currently active in Florida records.",
        INACT: "Entity is inactive and no longer in active status.",
        "INACT/UA": "Entity is inactive due to administrative action.",
        "CROSS RF": "Cross-reference filing record.",
        DISSOLVED: "Entity has been formally dissolved.",
        REVOKED: "Entity registration has been revoked.",
        RPEND: "Entity has a pending status with the state.",
        "RPEND/UA": "Entity has a pending administrative status.",
      },
      sunbizUrl,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "[Sunbiz] Firecrawl error:",
      err.response?.status,
      err.message
    );

    return res.status(500).json({
      error: "Unable to reach Sunbiz at this time.",
      details: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Sunbiz proxy running on port ${PORT}`);
});
