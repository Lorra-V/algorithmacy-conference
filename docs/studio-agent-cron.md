# Studio agent run note

*Loaded after an agent finishes a chore for a Studio office. Delivery: the client portal, not a chat.*
*The key lives in the agent’s own environment as `STUDIO_AGENT_KEY`. It is never written into this file.*

## Job

After the run, post one sentence about what happened. A person at the office reads it. Write the sentence the way you would say it to them.

## Steps

1. Finish the chore the way that agent’s instructions already describe.
2. Decide the type:
   - `did` — the chore finished.
   - `needs_approval` — a person should say yes or no before anything else happens.
   - `blocked` — the agent stopped because something it needed was missing.
   - `error` — the run failed.
   - `note` — nothing changed, and the office should still see that it ran.
3. Post it:

```bash
curl -sS -X POST https://algorithmacy.org/api/agent-events \
  -H "Authorization: Bearer $STUDIO_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"did","summary":"SENTENCE"}'
```

Replace `SENTENCE` with the sentence. If a person must decide, use `needs_approval` and put the question in `summary`.

## Rules

- One event per run. Not a log line for every step.
- Name the chore. Do not paste a document, a client email, or a file path that only makes sense on the machine.
- Do not invent a result. If it failed, say `error`.
- If `STUDIO_AGENT_KEY` is missing, stop and tell the engineer. Do not post without it.

*Last updated: 2026-10-11*
