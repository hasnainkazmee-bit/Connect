# Google and Connect ratings

Connect customer reviews stay in Connect's own review table. Google ratings are a separate, owner-authorized aggregate score and count from the Google Business Profile Reviews API. They are never averaged together.

Google's Business Profile APIs have no usage fee for approved projects, but approval and OAuth are required. Google does not allow a project to read arbitrary unclaimed businesses. Each company owner/admin must authorize its own verified Google Business Profile and select the matching location. Until then the public profile links to a Google Maps search without asserting a score.

## Activate

1. Request Google Business Profile API access for a Google Cloud project with a qualifying verified business profile. Google requires that profile to have been active for at least 60 days and have a website. Enable Google My Business API, My Business Account Management API, and My Business Business Information API after approval.
2. Configure an OAuth web client and consent screen. Register exactly `https://connect.sunhubapp.com/api/google-business/callback` as an authorized redirect URI. The requested scope is `https://www.googleapis.com/auth/business.manage`. Google grants a broad management scope; Connect calls only account/location list and reviews-list endpoints.
3. Generate a 32-byte random key, base64-encoded. Set `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`, and `GOOGLE_BUSINESS_TOKEN_KEY` in the protected server environment. Never commit them or distribute them with an app.
4. Redeploy the Connect app after setting the variables. An owner/admin will then see **Connect Google Business Profile** on their profile's Reviews tab. They authorize Google access and choose a location whose name or website matches their Connect company.

The API encrypts refresh tokens with AES-256-GCM, binding each ciphertext to its company ID. Only a company owner/admin can manage the connection. It stores one selected Google location per company, refreshes its aggregate rating about daily, and removes score snapshots older than 30 days. The company may disconnect at any time. Disconnecting removes Connect's token and score; the owner can also revoke the grant in their Google account.

The old optional Places API route remains as a fallback for a manually matched Place ID if a server-side Places key is configured. It is not needed for the owner-authorized route.

Official references: [Business Profile pricing](https://developers.google.com/my-business/content/pricing), [prerequisites](https://developers.google.com/my-business/content/prereqs), [OAuth](https://developers.google.com/my-business/content/implement-oauth), [reviews-list response](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list), and [API policy](https://developers.google.com/my-business/content/policies).
