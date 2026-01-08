import OAuth from "oauth-1.0a";
import crypto from "crypto";
import fetch from "node-fetch";
import Database from "better-sqlite3";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

/* ================== SAFETY GUARDS ================== */

// Kill switch for GitHub Actions
if (process.env.GITHUB_ACTIONS === "true") {
  throw new Error("Posting disabled on GitHub Actions");
}

// Dry run mode (change to false only when ready)
const DRY_RUN = true;

/* ================== ENV ================== */

const {
  X_API_KEY,
  X_API_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_TOKEN_SECRET,
  OPENAI_API_KEY,
  PROJECT_NAME
} = process.env;

if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

/* ================== DATABASE ================== */

const db = new Database("posts.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS posts (
    hash TEXT PRIMARY KEY,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

/* ================== OAUTH ================== */

const oauth = new OAuth({
  consumer: { key: X_API_KEY, secret: X_API_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto
      .createHmac("sha1", key)
      .update(base_string)
      .digest("base64");
  },
});

function oauthHeader(url, method, data = {}) {
  const request_data = { url, method, data };
  const token = { key: X_ACCESS_TOKEN, secret: X_ACCESS_TOKEN_SECRET };
  return oauth.toHeader(oauth.authorize(request_data, token));
}

/* ================== AI GENERATOR ================== */

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function generateCryptoPost() {
  const prompt = `
Write a short, insightful crypto update about "${PROJECT_NAME}".
Educational or thoughtful tone.
No hype, no emojis spam.
Max 280 characters.
Never repeat previous posts.
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
  });

  return res.choices[0].message.content.trim();
}

/* ================== DUPLICATE CHECK ================== */

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function alreadyPostedToday() {
  const row = db.prepare(`
    SELECT 1 FROM posts
    WHERE DATE(created_at) = DATE('now','localtime')
  `).get();
  return !!row;
}

function isDuplicate(hash) {
  const row = db.prepare("SELECT 1 FROM posts WHERE hash = ?").get(hash);
  return !!row;
}

/* ================== POST TO X ================== */

async function postTweet(text) {
  const url = "https://api.twitter.com/2/tweets";

  const headers = {
    Authorization: oauthHeader(url, "POST").Authorization,
    "Content-Type": "application/json",
  };

  if (DRY_RUN) {
    console.log("\n[DRY RUN] Would post:\n", text);
    return;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X post failed: ${res.status} ${err}`);
  }

  return res.json();
}

/* ================== MAIN JOB ================== */

async function runDailyPost() {
  if (alreadyPostedToday()) {
    console.log("Already posted today — skipping");
    return;
  }

  const text = await generateCryptoPost();
  if (!text) {
    console.log("AI returned empty content — skipping");
    return;
  }

  const hash = hashText(text);
  if (isDuplicate(hash)) {
    console.log("Duplicate content detected — skipping");
    return;
  }

  await postTweet(text);

  db.prepare(
    "INSERT INTO posts (hash, content) VALUES (?, ?)"
  ).run(hash, text);

  console.log("Post completed successfully");
}

runDailyPost().catch(console.error);
