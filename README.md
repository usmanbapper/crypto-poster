
# Crypto Reposter — Advanced Edition

This repository is an upgraded, GitHub Actions-ready bot to repost and summarize updates from multiple crypto projects.

Features:
- Twice-daily runs (09:00 & 19:00 Africa/Lagos).
- Reposts real project updates, avoids duplicates (SQLite dedupe).
- Optional AI-generated short hype captions using OpenAI.
- Thread reconstruction for long announcements.
- Media download from original tweet and re-upload to X (basic implementation included).
- Rate-limit aware with retries and exponential backoff.
- Configurable `projects.json` where you can add exact handles.

## Setup

1. Create a new GitHub repository and upload the contents of this ZIP.
2. Add repository secrets:
   - `X_BEARER_TOKEN` (required) — X API bearer token with tweet read & write scopes.
   - `OPENAI_API_KEY` (optional) — for AI captions.
3. Commit and push. GitHub Actions will run automatically on the schedule.

## Notes & Caveats

- Media upload to X may require elevated API access depending on your developer tier. The script includes a best-effort implementation but you may need to adjust for your account.
- The script uses the Twitter/X v2 endpoints. If your access tier differs, change endpoints accordingly.
- Test by running the script locally with environment variables first:
  ```
  X_BEARER_TOKEN=your_token node scripts/generate_and_post.js
  ```
- If you want me to auto-fill `projects.json` with confirmed handles, ask and I will prepare a version for you.

