# Google ratings for Connect companies

Connect keeps its own customer reviews separate from the Google Maps rating. Without a Places API key, each company profile shows a keyless Google Maps search link labeled "Check rating." The visitor sees Google's current rating on Google Maps and can confirm the correct listing. Connect does not claim that the search result is a verified match, copy the rating, or store Google review text or reviewer details.

The database stores only a verified Google Place ID per company. It never stores Google ratings or Places search results. If Places API (New) is enabled later, a matched profile can show a live rating and count with Google attribution. When there is no match, key, or response, the keyless Maps search link remains available. Directory cards do not make 24 paid Google requests per page.

## Enable

1. Obtain a server-side key restricted to Places API (New) and to the Connect server's egress IP. Enable billing and set a conservative API quota and budget alert in Google Cloud. Store the key in the server's protected environment as `GOOGLE_PLACES_API_KEY`, then redeploy the app.
2. Publish Connect terms and privacy pages that incorporate the Google terms and privacy policies before enabling Google data publicly. Have the text reviewed for the business's jurisdiction.
3. Match each company to the correct Google location. On a secure operator machine with database access, run `node tools/google-place-match.mjs --company=company-username` to view candidates. This makes one billable Text Search request and saves nothing. After checking name, location, website, and the Maps listing, run `node tools/google-place-match.mjs --company=company-username --place-id=PLACE_ID --confirm-name='Exact Google listing name'`. The tool refuses mismatched websites or cities and stores only the Place ID. Do not connect an unverified search result.
4. Prioritize claimed companies and high-traffic installer profiles. Many manufacturers have no customer-facing Google business location, while some installers have several branches; those profiles should not get an arbitrary location's rating. Leave unmatched companies without a Google badge. Review old Place IDs periodically.

The Place Details field mask requests `id,googleMapsUri,rating,userRatingCount,attributions`. It deliberately omits `reviews`, which keeps this in Google's Place Details Enterprise tier instead of Enterprise + Atmosphere.

Official references: [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details), [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), [Places display and storage rules](https://developers.google.com/maps/documentation/places/web-service/policies), [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id).
The [Maps URLs guide](https://developers.google.com/maps/documentation/urls/get-started) confirms that search links do not require a Google API key. These links cannot return a numeric rating to Connect.
