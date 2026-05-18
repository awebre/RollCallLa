# Roll Call LA

A free, public web app for browsing how Louisiana state legislators vote.

**Live:** [roll-call-la.thewebre.com](https://roll-call-la.thewebre.com)

## What is this?

The Louisiana State Legislature publishes every roll-call vote on its website,
but as one PDF per vote, scattered across hundreds of bill pages. There's no
way to ask "how did *my* senator vote?" without manually clicking through
thousands of documents.

Roll Call LA gathers that information into one place. Each legislator has a
page showing every vote they've cast — filterable by session, vote category
(final passage / amendments / procedural), and outcome.

It's a civic-data project, not a product. No accounts, no ads, no tracking. The
goal is to make government accountability slightly less of a slog for the
average Louisianan.

## How do you use it?

1. Go to **[roll-call-la.thewebre.com](https://roll-call-la.thewebre.com)**.
2. Pick a session from the dropdown in the top right (defaults to most recent).
3. Find your legislator — search by name or filter by chamber and party.
4. Click their name to see every vote they've cast that session.
5. Click any vote row to see how every member of that chamber voted on the
   same bill.
6. Each bill number and roll-call entry links back to the original document
   on [legis.la.gov](https://legis.la.gov) for citation.

The masthead shows the data's age — green if refreshed within 12 hours, amber
12-24h, red and marked "(stale)" past 24h. The pipeline runs nightly, so a
healthy site is always green or amber.

Anywhere a legislator's data is incomplete (e.g. someone who served in 2024
but isn't in the current roster), the UI shows a "PDF-only" or "Term:
Wikipedia" badge so you know which fields came from the official chamber
roster and which were reconstructed from secondary sources.

## How does it work?

A nightly job scrapes three sources, normalizes the data, and pushes it into
a small database that the website reads:

1. **Chamber rosters** — `senate.la.gov` and `house.louisiana.gov` are
   scraped for the current Senate and House membership, including each
   member's party, district, and year first elected.
2. **Bills and roll-call metadata** — `legis.la.gov`'s bill pages are walked
   for each active session. Every floor vote produces a roll-call entry with
   the bill, date, chamber, and a categorized description (final passage,
   concurrence, amendment, procedural, etc.).
3. **Per-member votes** — each roll-call links to a PDF showing how every
   individual member voted. Those PDFs are downloaded, parsed, and matched
   back to the roster so each vote is attributed to a real legislator.
4. **Term dates** — for legislators who joined or left mid-cycle (e.g. via a
   special election), exact swearing-in dates come from Wikipedia infoboxes.
   This stops a representative from being credited with votes that happened
   before they took office.

After each refresh, the site shows the latest counts and an updated "last
refreshed" timestamp. If the refresh fails, the site keeps serving the
previous snapshot and the masthead colors warn that the data is stale.

### Where the data is honest about its gaps

- Roll-call PDFs sometimes wrap two members onto one line. The parser does
  its best to split these, but a handful of votes per session may go to a
  synthetic placeholder member rather than the right person.
- Legislators who served in older sessions but aren't on the current roster
  show up as "PDF-only" — last name only, no party or district — until they
  can be backfilled from another source.
- Term dates scraped from Wikipedia are marked as such; the eventual upgrade
  is to pull them from an official source once one becomes available.

This is intentionally surfaced in the UI rather than hidden. The point is
that you can see what we know, what we *don't* know, and where the
uncertainty lives.
