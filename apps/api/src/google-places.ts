import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool, HttpError } from "./db.js";

const uuid = z.string().uuid();
const detailsUrl = (id: string) =>
  `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`;

type GoogleReview = {
  name?: string;
  rating?: number;
  relativePublishTimeDescription?: string;
  publishTime?: string;
  visitDate?: { year?: number; month?: number };
  text?: { text?: string };
  googleMapsUri?: string;
  authorAttribution?: {
    displayName?: string;
    uri?: string;
    photoUri?: string;
  };
};
type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  reviews?: GoogleReview[];
  attributions?: { provider?: string; providerUri?: string }[];
};

async function fetchPlace(id: string, fields: string): Promise<GooglePlace> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new HttpError(503, "Google reviews are not configured.");
  const response = await fetch(detailsUrl(id), {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fields,
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok)
    throw new HttpError(502, "Google reviews are temporarily unavailable.");
  const place = (await response.json()) as GooglePlace;
  if (place.id !== id)
    throw new HttpError(502, "Google returned a different place.");
  return place;
}

export function googlePlacesRoutes() {
  const router = Router();
  router.get(
    "/companies/:id/google-reviews",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      const id = uuid.parse(req.params.id);
      const match = (
        await pool.query<{ place_id: string }>(
          "SELECT place_id FROM company_google_places WHERE company_id=$1",
          [id],
        )
      ).rows[0];
      if (!match) return res.json({ linked: false });
      const place = await fetchPlace(
        match.place_id,
        "id,googleMapsUri,rating,userRatingCount,reviews,attributions",
      );
      res.json({
        linked: true,
        googleMapsUri:
          place.googleMapsUri ||
          `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(match.place_id)}`,
        rating: place.rating ?? null,
        count: place.userRatingCount ?? 0,
        attributions: place.attributions || [],
        reviews: (place.reviews || [])
          .filter((review) => review.googleMapsUri)
          .map((review) => ({
            id: review.name,
            rating: review.rating ?? null,
            body: review.text?.text || "",
            published: review.relativePublishTimeDescription || "",
            publishedAt: review.publishTime || null,
            visitDate: review.visitDate || null,
            googleMapsUri: review.googleMapsUri,
            author: review.authorAttribution || null,
          })),
      });
    },
  );
  return router;
}
