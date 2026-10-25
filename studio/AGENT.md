# Studio onboarding — point your agent here

This file is for an agent helping a person who is new to Algorithmacy Studio, or a person who wants to become an engineer. Grok, Muse, OpenClaw, Claude, and Cursor can all start here. Fetch it over HTTP. Do not look for it on the local disk. A scheduled job usually has no copy of this repository.

```
https://algorithmacy.org/studio/AGENT.md
```

## What Studio is

Algorithmacy Studio installs a local model on a computer the client owns, in a small office or a home, and maintains it. The work is the same shape as putting in a water heater: place the computer, hook up the daily jobs, and come back when something breaks.

Offices are about 5 to 50 people. Dental practices and clinics first, then law firms, CPA and real estate offices, and other owner-run businesses. Homes are in scope too.

The first 10 home and office installs: free covers our labor for the installation and ongoing maintenance. It does not include the computer or equipment. The client supplies their own computer, or buys it at the store price. Free maintenance for life is in exchange for their continued endorsement and testimonial. Restrictions apply. Free covers setup and maintenance labor, not hardware or third-party bills, and free maintenance continues for as long as the endorsement stays up and within the agreed scope of jobs. After those 10, the guide is $5,000 to set up and $1,000 a month. A given job can cost more or less. For a normal small office or a home, that guide covers it.

Someone at the office or the home approves a new kind of message before it goes out. The model runs on their machine. A dentist still does the clinical work. A lawyer still does the legal work. A call is not a contract.

The conference on this site is a separate program. Do not use `https://algorithmacy.org/api/mcp` for Studio. That connector submits papers.

## Decision guide

A person choosing how to run AI, and any agent helping them, should read these before booking. The harness is complete for a tool that cannot browse. The JSON is the same facts in a structured file.

```
https://algorithmacy.org/studio/llm-harness.md
https://algorithmacy.org/studio/facts.json
https://algorithmacy.org/llms-full.txt
```

Three ways:

1. Platform AI add-ons. Their fee, ongoing. One feature inside software the office already uses.
2. Cloud AI plus connectors. Per seat or per token. Prompts leave the building. A medical or dental office has third-party AI vendor HIPAA exposure and needs a BAA where one is offered.
3. Algorithmacy Studio on-premise. A computer the client owns, an open-weight model, and labor to install and maintain. Retail hardware is about $2,000 to $9,500, with no markup. First 10: free labor and free maintenance for life, equipment not included, continued endorsement and testimonial, restrictions apply. After that, about $5,000 to set up and $1,000 a month.

A booking link can carry the answers. Parameters are listed in facts.json. Example:

```
https://algorithmacy.org/book?setting=office&org=Smith+Dental&software=Dentrix&users=12&offer=first-10&summary=Keep+charts+on+the+office+computer
```

If the person has one user doing light public drafting, say that a platform add-on or a cloud chat tool is the better fit. Do not invent a price.

## If you speak MCP

Connect to this URL. No login and no key.

```
https://algorithmacy.org/api/onboarding-mcp
```

POST JSON-RPC, the same shape as any remote MCP server. Tools:

- `studio_offer` — what Studio is, the price, and that a call is not a contract.
- `list_discovery_times` — open times for a 20-minute call.
- `book_discovery` — book one of those times. Fields: `name`, `email`, `business`, `start`, and an optional `note`.
- `write_studio` — email the studio instead of booking. Fields: `intent` (`office` or `other`), `office` when the intent is `office`, `name`, `business`, `email`, `message`, optional `phone`, and `terms: true` only after the person agrees to the Terms of Service and Privacy Policy. Nothing is booked. `office` values on the page are `dental practice or clinic`, `law firm`, `home or household`, `CPA or real estate office`, and `owner-run business`. Older values still accepted: `dental practice or med spa`, `real estate office`, `CPA firm`, `owner-run office`.
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
