# Studio onboarding — point your agent here

This file is for an agent helping a person who is new to Algorithmacy Studio, or a person who wants to become an engineer. Grok, Muse, OpenClaw, Claude, and Cursor can all start here. Fetch it over HTTP. Do not look for it on the local disk. A scheduled job usually has no copy of this repository.

```
https://algorithmacy.org/studio/AGENT.md
```

The conference on this site is a separate program. Do not use `https://algorithmacy.org/api/mcp` for Studio. That connector submits papers.

## If you speak MCP

Connect to this URL. No login and no key.

```
https://algorithmacy.org/api/onboarding-mcp
```

POST JSON-RPC, the same shape as any remote MCP server. Tools:

- `studio_offer` — what Studio is, the price, and that a call is not a contract.
- `list_discovery_times` — open times for a 20-minute call.
- `book_discovery` — book one of those times. Fields: `name`, `email`, `business`, `start`, and an optional `note`.
- `write_studio` — email the studio instead of booking. Fields: `intent` (`office` or `other`), `office` when the intent is `office`, `name`, `business`, `email`, `message`, optional `phone`, and `terms: true` only after the person agrees to the Terms of Service and Privacy Policy. Nothing is booked.
- `engineer_application` — the pull request that applies to be an engineer. Optional `name`, used only for the photo file.

## If you only have fetch or curl

List open times:

```
GET https://algorithmacy.org/api/book?type=discovery
```

Book one. `start` is a `start` value from that list.

```
POST https://algorithmacy.org/api/book
Content-Type: application/json

{
  "type": "discovery",
  "name": "Ada Client",
  "email": "ada@example.com",
  "business": "Harbor & Finch",
  "start": "the ISO time from the list",
  "note": "Intake and chasing documents"
}
```

For an engineer, follow `engineer_application` against `https://github.com/rogerSuperBuilderAlpha/algorithmacy-conference`. Fork it, add the photo, edit `studio/index.html` under Your Engineers, add the name, GitHub login, and sign-in email to `lib/portal/studio-engineers.json`, and put one chore, who signs off, and one sample report in the pull request description.

## Stop here

A booked call is not an account. A pull request is the application. Access starts after that pull request is merged and the row in `lib/portal/studio-engineers.json` is on main. The email in that row receives the magic link. The GitHub login in that row can sign in when the email is blank. A noreply address is not a sign-in email.

Hand the person the email, and stop, when the next step is any of these:

- the calendar confirmation
- the portal invite
- the authenticator
- payment

Do not click those. Do not pay. Do not invent a sign-in.

## After they have an account

Once the person has an invite and has set up the authenticator, connect Claude, Cursor, Grok, Muse, or OpenClaw to the signed-in connector:

```
https://algorithmacy.org/api/studio-mcp
```

That connector asks the person to sign in. It cannot charge a card. An engineer connection cannot invite another engineer. If a client’s sign-in callback host is refused, that host is added when the real hostname is known. Do not guess one.
