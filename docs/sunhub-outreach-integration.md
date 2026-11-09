# Sunhub outreach integration

Connect owns public company profiles and their ownership claims. Sunhub owns
contacts, campaign drafts, delivery outcomes, and replies. No outreach contact
list is stored in Connect.

Sunhub's server can read `GET /api/integrations/sunhub/companies` with an
`Authorization: Bearer <token>` header. Configure the same unique random
32-character-or-longer `CONNECT_SUNHUB_SYNC_TOKEN` on both servers. The endpoint
is unavailable when the token is unset; the token must never be sent to a
browser, mobile app, repository, or spreadsheet.

Use `limit=1..200` and the returned `nextCursor` as `after` until it is null.
Pages are ordered by immutable Connect company UUID. Each item has:

- `companyId`, `username`, `name`, `nameKey`, `website`, and curated `domains`
- `profileUrl` and `claimUrl` for the public profile and claim flow
- `listingStatus` (`unclaimed` or `managed`)
- `claimStatus` (`unclaimed`, `pending`, `claimed`, or `joined`)
- `claimRequestedAt`, `claimedAt`, and `claimantEmail` when applicable

`joined` means a company manages its Connect profile but did not claim a
pre-existing directory listing. `claimed` means an ownership claim was
approved. Match imported Sunhub companies to Connect using an exact curated
domain, and retain ambiguous or unmatched rows for human review. Do not infer
an email delivery from a valid-looking address or a claim; only the Sunhub
sender's delivery event establishes receipt.
