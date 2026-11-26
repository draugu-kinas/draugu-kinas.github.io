# wanna watch a movie?

A tiny movie-night site for friends: a Wes Anderson-ish room with a glowing TV,
a shared pool of film suggestions (3 each), tickets to vote with (5 each), a date poll,
a guestbook, a host panel with switchable themes, and an archive of past nights.

- plain HTML/CSS/JS, no build step — deploy the folder anywhere static
- data in Supabase (`supabase/schema.sql`), demo mode in localStorage when `config.js` is empty
- film search: TMDB if a key is set, otherwise keyless iTunes + Wikidata

Setup: see **SETUP.md**.
