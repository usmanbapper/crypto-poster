// test_auth.js — quick OAuth1.0a check (Node)
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import fetch from 'node-fetch';

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
  console.error('Missing one of the required env vars: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET');
  process.exit(1);
}

const oauth = new OAuth({
  consumer: { key: API_KEY, secret: API_SECRET },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return crypto.createHmac('sha1', key).update(base_string).digest('base64');
  },
});

function oauthHeader(url, method, data = {}) {
  const request_data = { url, method, data };
  const token = { key: ACCESS_TOKEN, secret: ACCESS_TOKEN_SECRET };
  return oauth.toHeader(oauth.authorize(request_data, token));
}

// Use v1.1 verify_credentials to check user & auth
async function verify() {
  const url = 'https://api.twitter.com/1.1/account/verify_credentials.json';
  const headers = { Authorization: oauthHeader(url, 'GET').Authorization };
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  console.log('HTTP', res.status);
  try { console.log(JSON.parse(text)); }
  catch(e) { console.log(text); }
}

verify().catch(e => { console.error('Error:', e); process.exit(1); });
