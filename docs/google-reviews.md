# Google reviews for Connect companies

Connect keeps its own customer reviews separate from Google Maps reviews. The company profile's Reviews tab can show a separate Google Maps card with the rating, total ratings, and up to five review excerpts. It attributes every review to its author, links each excerpt to the source review, and uses Google's unmodified attribution asset.

The database stores only a verified Google Place ID per company. It never stores Google ratings, review text, reviewer details, or Places search results. A profile request retrieves current data from Places API (New). A company without a verified match has no Google card; a failed Google request does not replace Connect reviews.

## Enable

1. Obtain a server-side key restricted to Places API (New) and to the Connect server's egress IP. Enable billing and set a conservative API quota and budget alert in Google Cloud. Store the key in the server's protected environment as `GOOGLE_PLACES_API_KEY`, then redeploy the app.
2. Publish Connect terms and privacy pages that incorporate the Google terms and privacy policies before enabling Google data publicly. Have the text reviewed for the business's jurisdiction.
3. Match each company to the correct Google location. On a secure operator machine with database access, run `node tools/google-place-match.mjs --company=company-username` to view candidates. This makes one billable Text Search request and saves nothing. After checking name, location, website, and the Maps listing, run `node tools/google-place-match.mjs --company=company-username --place-id=PLACE_ID --confirm-name='Exact Google listing name'`. The tool refuses mismatched websites or cities and stores only the Place ID. Do not connect an unverified search result.
4. Prioritize claimed companies and high-traffic installer profiles. Many manufacturers have no customer-facing Google business location, while some installers have several branches; those profiles should not get an arbitrary location's rating. Leave unmatched companies without a Google badge. Review old Place IDs periodically.

Google returns at most five reviews through Place Details. It does not provide an unrestricted full review archive. Keep Google and Connect ratings separate and label each clearly.

Official references: [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details), [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), [Places display and storage rules](https://developers.google.com/maps/documentation/places/web-service/policies), [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id).
