-- Only Google's stable Place ID is stored. Ratings and reviews are fetched live.
CREATE TABLE company_google_places (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  place_id text NOT NULL UNIQUE CHECK(length(place_id) BETWEEN 10 AND 255),
  matched_at timestamptz NOT NULL DEFAULT now(),
  matched_by uuid REFERENCES users(id) ON DELETE SET NULL
);
