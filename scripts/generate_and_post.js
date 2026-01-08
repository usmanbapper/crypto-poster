import OAuth from "oauth-1.0a";
import crypto from "crypto";
import fetch from "node-fetch";
import OpenAI from "openai";
import fs from "fs";

/* ================== CONFIG ================== */

const DB_FILE = "posts.json";
const DRY_RUN = false; // set true to test without posting

/* ================== ENV ================== */

const {
  X_API_KEY,
  X_API_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_TOKEN_SECRET,
  OPENAI_API_KEY,
  PROJECT_NAME
} = process.env;

if (
  !X_API_KEY ||
  !X_API_SECRET ||
  !X_ACCESS_TOKEN ||
  !X_ACCESS_TOKEN_SECRET ||
  !OPENAI_API_KEY
) {
  throw new Error("❌ Missing required environment variables");
}

/* ================== STORAGE ================== */

function loadPosts() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function savePosts(posts) {
  fs.writeFileSync(DB_FILE, JSON.stringify(posts, null, 2));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function alreadyPostedToday(posts) {
  return posts.some(p => p.date === today());
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function isDuplicate(posts, hash) {
  return posts.some(p => p.hash === hash);
}

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

function oauthHeader(url, method) {
  const request_data = { url, method };
  const token = { key: X_ACCESS_TOKEN, secret: X_ACCESS_TOKEN_SECRET };
  return oauth.toHeader(oauth.authorize(request_data, token));
}

/* ================== AI GENERATION ================== */

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function generateCryptoPost() {
  const prompt = `
Write a short, insightful crypto update about "${PROJECT_NAME}".
Educational or thoughtful tone.
No hype, no emojis spam.
Max 280 characters.
Avoid repeating ideas.
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
  });

  return res.choices[0].message.content.trim();
}

/* ================== POST TO X ================== */

async function postTweet(text) {
  if (DRY_RUN) {
    console.log("\n[DRY RUN] Would post:\n", text);
    return;
  }

  const url = "https://api.twitter.com/2/tweets";
  const headers = {
    Authorization: oauthHeader(url, "POST").Authorization,
    "Content-Type": "application/json",
  };

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

/* ================== MAIN ================== */

async function runDailyPost() {
  const posts = loadPosts();

  if (alreadyPostedToday(posts)) {
    console.log("✅ Already posted today — skipping");
    return;
  }

  const text = await generateCryptoPost();
  if (!text) {
    console.log("⚠️ AI returned empty content — skipping");
    return;
  }

  const hash = hashText(text);

  if (isDuplicate(posts, hash)) {
    console.log("⚠️ Duplicate content detected — skipping");
    return;
  }

  await postTweet(text);

  posts.push({
    hash,
    content: text,
    date: today(),
  });

  savePosts(posts);
  console.log("🚀 Post published successfully");
}

runDailyPost().catch(err => {
  console.error("❌ Job failed:", err.message);
  process.exit(1);
});
