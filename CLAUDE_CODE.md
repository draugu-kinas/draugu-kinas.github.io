# Instructions for Claude Code: deploy this site end to end

Goal: put this movie-night site online with a live Supabase backend, then hand the user a working link.
The user wants you to do as much as possible yourself. Stop and ask only for logins/approvals that
need them personally. Talk to the user in Lithuanian; keep the site itself in English.

Do NOT change the site's design or code unless something is actually broken. Read README.md and
SETUP.md first; this file is the automated version of SETUP.md.

## 0. Check tools
- `git`, `gh` (GitHub CLI), `node`/`npx`. If `gh` is missing, install it (brew / winget / apt) and run
  `gh auth login` (the user approves in the browser).
- Supabase: prefer the official Supabase MCP server. If it is not connected, run
  `claude mcp add --transport http supabase https://mcp.supabase.com/mcp`
  and ask the user to restart the session / authenticate it (one browser login, they may need to create
  a free Supabase account first). Fallback if MCP is not possible: `npx supabase login` + Supabase CLI /
  Management API.

## 1. Supabase
1. List the user's organizations; create a new **free** project named `movie-night`, region
   `eu-central-1` (Frankfurt). Confirm cost = $0 with the user if the tool asks. Generate a strong DB
   password yourself (the user does not need it).
2. Wait until the project is healthy.
3. Apply `supabase/schema.sql` as a single migration named `movie_night_init` (exact file contents).
4. Verify: `select number, title, location from events;` → one row, "movie night no. 1".
   Also verify the anon role cannot insert: there must be no insert policies; functions
   `join_event`, `add_movie`, `toggle_vote`, `host_claim` exist.
5. Get the project URL and the **publishable** key (or legacy **anon** key).
   NEVER use or write the service_role / secret key anywhere.
6. Write them into `config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Leave `TMDB_API_KEY` empty
   unless the user gives one.

## 2. Hosting on GitHub Pages
1. `git init`, commit everything (no secrets are in this folder; the publishable key is meant to be public).
2. `gh repo create movie-night --public --source . --push` (if the name is taken, use `upperroom-movie-night`).
   Public is required for free GitHub Pages; that is fine.
3. Enable Pages from the `main` branch root:
   `gh api -X POST repos/{owner}/{repo}/pages -f "source[branch]=main" -f "source[path]=/"`
4. Poll `gh api repos/{owner}/{repo}/pages` until status is `built`; the URL is
   `https://{owner}.github.io/{repo}/`.

(If the user prefers Netlify: `npx netlify-cli deploy --prod --dir .` after `npx netlify-cli login`.)

## 3. Smoke test
- Fetch the live URL and check `index.html`, `config.js`, `js/app.js` return 200.
- If you can drive a browser, open `/#/board`: it must NOT show the "demo mode" badge. Join with a
  nickname like `test`, add a film by hand, give it a ticket, then clean up in SQL:
  `delete from participants where nickname = 'test';` (cascades to its film and votes).

## 4. Hand over
Tell the user (in Lithuanian):
- the live link,
- that they must now open `<link>#/host` and **set their own host key** before sharing the link
  (first one to set it becomes host; you must not set it for them),
- that the Supabase free project pauses after ~7 days of no activity (restore button on supabase.com),
- how to redeploy after edits: `git commit -am "…" && git push`.
