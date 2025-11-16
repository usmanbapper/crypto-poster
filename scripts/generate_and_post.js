import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import fetch from 'node-fetch';

// Read secrets from environment
const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

// OAuth1 helper
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

// Post a tweet
export async function postTweet(text) {
  const url = 'https://api.twitter.com/2/tweets';
  const body = { text };

  const headers = {
    Authorization: oauthHeader(url, 'POST').Authorization,
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    console.error('Failed to post tweet', res.status, err || await res.text());
    return err || { status: res.status, error: 'unknown' };
  }

  return await res.json();
}

// Example usage
// (replace with your existing posting logic)
(async () => {
  const result = await postTweet('Hello from my Advanced Crypto Poster!');
  console.log(result);
})();
