
/**
 * generate_and_post.js (Advanced)
 *
 * - Reads projects.json
 * - Resolves handles -> user IDs
 * - Fetches recent tweets
 * - Reconstructs threads when needed
 * - Downloads media and re-uploads to X (best-effort)
 * - Dedupes via SQLite
 * - Optional OpenAI captions
 *
 * Requirements:
 * - Set env var X_BEARER_TOKEN (required)
 * - Optionally set OPENAI_API_KEY for better captions
 *
 * Notes:
 * - Media upload to X may require elevated API access depending on your app access.
 * - Run in Node 18+.
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import FormData from 'form-data';
import axios from 'axios';

const PROJECTS_FILE = process.env.PROJECTS_FILE || './projects.json';
const DB_PATH = process.env.DEDUPE_DB || './data/posts.db';
const X_BEARER = process.env.X_BEARER_TOKEN;
const OPENAI_KEY = process.env.OPENAI_API_KEY || null;

if (!X_BEARER) {
  console.error('Missing X_BEARER_TOKEN');
  process.exit(1);
}

// --- Utilities
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }

async function setupDb(){
  await fs.promises.mkdir(path.dirname(DB_PATH), { recursive: true });
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS posted (id TEXT PRIMARY KEY, created_at TEXT, project TEXT)`);
  return db;
}

// Exponential retry helper
async function withRetry(fn, attempts = 4, baseMs = 1000){
  let attempt = 0;
  while(attempt < attempts){
    try { return await fn(); }
    catch(e){
      attempt++;
      const wait = baseMs * Math.pow(2, attempt);
      console.warn('Attempt', attempt, 'failed:', e?.message || e);
      if (attempt >= attempts) throw e;
      await sleep(wait);
    }
  }
}

// Resolve username to user id
async function resolveUserIdByHandle(handle){
  const username = handle.replace(/^@/, '');
  const url = `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}`;
  const res = await withRetry(() => fetch(url, { headers: { Authorization: 'Bearer ' + X_BEARER } }));
  if (!res.ok) { console.warn('resolveUserIdByHandle failed', res.status); return null; }
  const j = await res.json();
  return j?.data?.id || null;
}

// Fetch recent tweets for a user (includes tweet.fields)
async function fetchTweetsForUser(userId, max_results=10){
  const url = new URL(`https://api.twitter.com/2/users/${userId}/tweets`);
  url.searchParams.set('max_results', String(max_results));
  url.searchParams.set('tweet.fields', 'conversation_id,created_at,referenced_tweets,attachments,author_id');
  const res = await withRetry(() => fetch(url.href, { headers: { Authorization: 'Bearer ' + X_BEARER } }));
  if (!res.ok) { console.warn('fetchTweetsForUser failed', res.status); return null; }
  return await res.json();
}

// Fetch a conversation (thread) by conversation_id - search recent tweets by user and conversation_id
async function fetchConversation(userId, conversation_id, max_results=50){
  // Note: This uses tweets endpoint with query - requires Elevated access for full search.
  // As a simpler approach, fetch recent tweets for user and filter by conversation_id.
  const tweets = await fetchTweetsForUser(userId, max_results);
  if (!tweets || !tweets.data) return [];
  return tweets.data.filter(t => t.conversation_id === conversation_id);
}

// Simple OpenAI caption generator
async function generateCaption(text, handle){
  if (!OPENAI_KEY) return `🔥 ${handle} update — check this out! 🚀 #Crypto`;
  try {
    const prompt = `Write a one-line hype caption (max 120 chars) to attach to this repost of: "${text}". Include the handle ${handle}.`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60
      })
    });
    const j = await res.json();
    const msg = j?.choices?.[0]?.message?.content || null;
    return (msg || `🔥 ${handle} update — check it out! 🚀`).trim();
  } catch(e){
    console.warn('OpenAI caption error', e?.message || e);
    return `🔥 ${handle} update — check it out! 🚀`;
  }
}

// Media download helper - returns local path
async function downloadMedia(url, outDir='./tmp_media'){
  await fs.promises.mkdir(outDir, { recursive: true });
  const filename = path.basename(new URL(url).pathname);
  const outPath = path.join(outDir, Date.now() + '_' + filename);
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  await fs.promises.writeFile(outPath, res.data);
  return outPath;
}

// Upload media to X - best-effort. Uses v1.1 media upload endpoint for compatibility (chunking not implemented).
async function uploadMediaToX(localPath){
  // This implementation uses the v1.1 media/upload endpoint which may be available depending on your app access.
  // For large video files, you must implement chunked upload (INIT, APPEND, FINALIZE).
  try {
    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    const form = new FormData();
    form.append('media', fs.createReadStream(localPath));
    const headers = form.getHeaders();
    headers['Authorization'] = 'Bearer ' + X_BEARER;
    const res = await axios.post(url, form, { headers, maxContentLength: Infinity, maxBodyLength: Infinity });
    if (res.data && res.data.media_id_string) return res.data.media_id_string;
    return null;
  } catch(e){
    console.warn('uploadMediaToX failed:', e?.response?.data || e?.message || e);
    return null;
  }
}

// Post tweet (text + optional media_ids array + optional in_reply_to)
async function postTweet(text, media_ids = [], in_reply_to_id = null){
  const url = 'https://api.twitter.com/2/tweets';
  const body = { text };
  if (media_ids && media_ids.length) {
    body['media'] = { media_ids };
  }
  if (in_reply_to_id) body['reply'] = { in_reply_to_tweet_id: in_reply_to_id };
  const res = await withRetry(() => fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + X_BEARER, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }));
  const j = await res.json();
  return j;
}

async function main(){
  const db = await setupDb();
  const projects = JSON.parse(await fs.promises.readFile(PROJECTS_FILE, 'utf8')).projects;

  for (const p of projects){
    try {
      const handle = p.handle || p.name.replace(/\s+/g,'').toLowerCase();
      const handleWithAt = handle.startsWith('@') ? handle : '@' + handle;
      console.log('Processing', p.name, 'as', handleWithAt);

      // resolve id
      const userId = await resolveUserIdByHandle(handleWithAt);
      if (!userId) { console.warn('Could not resolve user id for', handleWithAt); continue; }

      const timeline = await fetchTweetsForUser(userId, 8);
      if (!timeline || !timeline.data || timeline.data.length === 0) {
        console.log('No recent tweets for', p.name);
        continue;
      }

      // process oldest->newest
      const tweets = timeline.data.slice().reverse();
      for (const t of tweets){
        const content = t.text;
        const uniqueKey = t.id + '|' + content.slice(0,300);
        const hash = sha256(uniqueKey);
        const exists = await db.get('SELECT id FROM posted WHERE id = ?', [hash]);
        if (exists) { console.log('Already posted', t.id); continue; }

        // If part of a conversation, try to rebuild thread (simple approach)
        let threadTweets = [t];
        if (t.conversation_id && t.conversation_id !== t.id){
          const convo = await fetchConversation(userId, t.conversation_id, 50);
          if (convo && convo.length > 1){
            // sort by created_at asc
            convo.sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));
            threadTweets = convo;
          }
        }

        // If tweet has attachments, attempt to download & re-upload
        let media_ids = [];
        if (t.attachments && t.attachments.media_keys){
          // Note: To map media_keys to URLs you must request expansions and media fields when fetching tweets.
          // For now we will attempt to parse extended entities via v1.1 if available (best-effort).
          console.log('Tweet has attachments; attempting media handling (best-effort).');
          // This is a simplified placeholder: you would need to fetch tweet with expansions to get media URLs.
          // The code below assumes you have direct media URLs (in real use, adjust accordingly).
        }

        // Build caption using OpenAI or fallback
        const caption = await generateCaption(content, handleWithAt);
        // For threads, join into a single text or post as a thread
        if (threadTweets.length === 1){
          const repostText = `${caption}\n\n🔁 Original: https://twitter.com/${handle.replace(/^@/,'')}/status/${t.id}`;
          const res = await postTweet(repostText, media_ids, null);
          console.log('Posted single tweet repost:', res);
        } else {
          // Post first (headline) then reply subsequent tweets
          let firstText = `${caption}\n\n🔁 Thread by ${handleWithAt}`;
          const firstRes = await postTweet(firstText, media_ids, null);
          const postedId = firstRes?.data?.id;
          console.log('Posted thread head:', firstRes);
          if (postedId){
            for (const tw of threadTweets){
              const text = tw.text.slice(0,270); // keep within limits
              const replyRes = await postTweet(text, [], postedId);
              console.log('Posted thread reply:', replyRes);
              // small delay
              await sleep(1200);
            }
          }
        }

        await db.run('INSERT INTO posted (id, created_at, project) VALUES (?, ?, ?)', [hash, new Date().toISOString(), p.name]);
        await sleep(1500);
      }

    } catch(e){
      console.error('Project loop error for', p.name, e);
    }
  }

  await db.close();
}

main().catch(e=>{ console.error('Fatal error', e); process.exit(1); });
