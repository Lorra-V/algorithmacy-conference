# Studio agent events

An agent posts one plain sentence after a run. The portal shows that sentence to the client. The key belongs to one agent on one account. It is shown once, when the engineer creates the agent, and only a hash is stored.

## Request

```bash
curl -sS -X POST https://algorithmacy.org/api/agent-events \
  -H "Authorization: Bearer $STUDIO_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"did","summary":"Chased the three missing intake documents. Two came back.","detail":"Still waiting on the signed engagement letter."}'
```

`STUDIO_AGENT_KEY` is the `sk_…` value from the portal. Do not put it in a prompt or a committed file.

## Body

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | `did`, `needs_approval`, `blocked`, `error`, or `note` |
| `summary` | yes | One or two sentences a person in the office can read. 500 characters. |
| `detail` | no | The longer note. 4000 characters. |
| `needsApproval` | no | If true, or if `type` is `needs_approval`, the portal also opens an approval for the office to accept or decline. |

`did` is something the agent finished. `blocked` is something it stopped on. `error` is a failure. `note` is context that did not change a file. `needs_approval` is a step waiting for a person.

The agent does not send client documents, and it does not send a transcript of a client conversation. The summary names the chore. The files stay in the office’s own systems.

## Response

`200` with `{ "ok": true, "id": "…" }`. `401` if the key is wrong. `400` if the body is not one of the types above. `429` if the agent posts more than 60 events in an hour.

## What the office sees

The event appears on `/portal/activity`. An approval appears on `/portal/approvals`. A weekly digest emails the members who asked for one. The monthly report is a page at `/portal/reports`, written from that month’s events.
