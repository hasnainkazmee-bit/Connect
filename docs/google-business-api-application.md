# Connect Business Profile API application

Use the Google account that is listed as an owner or manager of Sunhub's verified Google Business Profile. Google requires its own approval before the Connect integration can be enabled; a public Maps listing by itself does not prove account ownership or approval.

## Application details

- Application type: **Application for Basic API Access**.
- Google Cloud/Firebase project ID: `connect-77d45`.
- Project number: `2392879430`.
- Business: **Sunhub**.
- Business website: use the exact website shown on Sunhub's Google Business Profile; confirm it matches `https://sunhub.com` before submitting.
- Product: **Connect**, `https://connect.sunhubapp.com`.
- Qualifying Business Profile: the verified Sunhub listing in Cleveland, Ohio. The applying Google account must have owner or manager access, and the listing must have been active for at least 60 days.

Suggested use-case description for Google's form:

> Connect is Sunhub's directory and social network for solar companies. A company administrator can explicitly connect a Google Business Profile they own or manage. Connect lists that account's locations, lets the administrator choose the matching company location, and reads only its aggregate Google rating and review count. We show the Google score separately from reviews left on Connect, with Google attribution and a link to the source listing. We do not modify Google profiles, copy review text, or query unrelated businesses. The administrator can disconnect at any time.

Official [application instructions](https://developers.google.com/my-business/content/prereqs) and [Basic API Access form](https://support.google.com/business/workflow/16726127). Google sends its decision to the applying account's email. A 0 QPM Business Profile API quota means the project has not been approved; 300 QPM indicates approval according to Google's prerequisites page.

## After Google approves

Enable the Google My Business API, My Business Account Management API, and My Business Business Information API in the same project. Create a web OAuth client with redirect URI `https://connect.sunhubapp.com/api/google-business/callback` and configure the OAuth consent screen. Store the client ID, client secret, and a random 32-byte token-encryption key only in Connect's protected production environment, then restart only Connect's app service. Confirm `/api/google-business/config` returns `{"enabled":true}`. Finally, while signed into Connect as a Sunhub owner/admin, open **My company → Reviews → Connect Google Business Profile**, authorize with the Google account managing the listing, and select the Sunhub location.

Google's OAuth scope covers Business Profile management, although this Connect integration only calls read endpoints for accounts, locations, and aggregate reviews. Never ask an owner to share their Google password or authorization code.
