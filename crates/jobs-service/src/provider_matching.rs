//! Reviewed provider facts and matching. No keyword-derived claims or automatic invitations.
use super::*;

const SECTORS: &[&str] = &[
    "residential",
    "commercial",
    "industrial",
    "agricultural",
    "municipal",
    "nonprofit",
    "utility",
];
const SYSTEMS: &[&str] = &[
    "rooftop",
    "ground-mount",
    "carport",
    "pergola",
    "fixed-tilt",
    "tracker-foundations",
    "floating",
    "tracking",
];
const DELIVERIES: &[&str] = &[
    "turnkey",
    "specialist-service",
    "advisory",
    "managed-project",
    "contract-staff",
    "supply",
    "labor-only",
];

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CredentialRequirement {
    catalog_key: String,
    scope: String,
}
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MatchRequest {
    kind: String,
    category_id: String,
    sector: Option<String>,
    system_type: Option<String>,
    delivery: Option<String>,
    product_role: Option<String>,
    country_code: String,
    state_code: Option<String>,
    city: Option<String>,
    #[serde(default)]
    require_availability: bool,
    start_by: Option<String>,
    #[serde(default)]
    required_credentials: Vec<CredentialRequirement>,
    #[serde(default)]
    preferred_credentials: Vec<PreferredCredential>,
    #[serde(default)]
    prefer_available: bool,
    preferred_start: Option<String>,
    #[serde(default = "prefer_local_default")]
    prefer_local: bool,
    page: Option<usize>,
    page_size: Option<usize>,
}
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreferredCredential {
    title: String,
    scope: String,
}
fn prefer_local_default() -> bool {
    true
}
pub(super) fn date_valid(s: &str) -> bool {
    if s.len() != 10
        || !s.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
    {
        return false;
    }
    let year = s[0..4].parse::<u32>().unwrap_or(0);
    let month = s[5..7].parse::<usize>().unwrap_or(0);
    let day = s[8..10].parse::<u32>().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    (2000..=2100).contains(&year) && (1..=12).contains(&month) && day > 0 && day <= days[month - 1]
}
fn state_valid(country: &str, state: &str) -> bool {
    let codes=match country { "US"=>"AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI", "CA"=>"AB BC MB NB NL NS NT NU ON PE QC SK YT", _=>return false };
    codes.split_whitespace().any(|s| s == state)
}
fn code_valid(s: &str) -> bool {
    s.len() == 2 && s.bytes().all(|b| b.is_ascii_uppercase())
}
fn validate(b: &MatchRequest) -> Result<()> {
    if !["US", "CA"].contains(&b.country_code.as_str())
        || b.state_code
            .as_ref()
            .is_some_and(|s| !state_valid(&b.country_code, s))
        || b.page.is_some_and(|p| p == 0 || p > 10000)
        || b.page_size.is_some_and(|p| p == 0 || p > 50)
        || b.system_type
            .as_ref()
            .is_some_and(|s| !SYSTEMS.contains(&s.as_str()))
        || !["service", "product"].contains(&b.kind.as_str())
        || b.category_id.is_empty()
        || b.category_id.len() > 80
        || !code_valid(&b.country_code)
        || b.state_code.as_ref().is_some_and(|s| !code_valid(s))
        || b.city
            .as_ref()
            .is_some_and(|s| s.trim().is_empty() || s.len() > 100 || b.state_code.is_none())
        || b.sector
            .as_ref()
            .is_some_and(|s| !SECTORS.contains(&s.as_str()))
        || b.delivery
            .as_ref()
            .is_some_and(|s| !DELIVERIES.contains(&s.as_str()))
        || b.product_role.as_ref().is_some_and(|s| {
            !["manufactures", "distributes", "supplies-and-installs"].contains(&s.as_str())
        })
        || (b.kind == "product"
            && (b.delivery.is_some()
                || b.sector.is_some()
                || b.require_availability
                || b.start_by.is_some()))
        || (b.kind == "service" && b.product_role.is_some())
        || b.start_by.as_ref().is_some_and(|s| !date_valid(s))
        || b.preferred_start.as_ref().is_some_and(|s| !date_valid(s))
        || b.preferred_credentials.len() > 8
        || b.preferred_credentials.iter().any(|r| {
            r.title.trim().is_empty()
                || r.title.len() > 180
                || !["company", "personnel", "product"].contains(&r.scope.as_str())
        })
        || b.required_credentials.len() > 8
        || b.required_credentials.iter().any(|r| {
            r.catalog_key.is_empty()
                || r.catalog_key.len() > 100
                || !["company", "personnel", "product"].contains(&r.scope.as_str())
        })
    {
        return Err(bad(
            "Check the service, location and matching requirements.",
        ));
    }
    Ok(())
}

pub(super) async fn taxonomy(State(app): State<Arc<App>>) -> Result<Json<Value>> {
    let rows: Vec<String>=sqlx::query_scalar("SELECT json_build_object('kind',kind,'id',id,'label',label)::text FROM provider_taxonomy ORDER BY kind,label")
        .fetch_all(&app.db).await?;
    let credentials:Vec<String> = sqlx::query_scalar("SELECT jsonb_build_object('title',min(cc.title),'scope',cc.scope)::text FROM company_credentials cc JOIN companies c ON c.id=cc.company_id WHERE NOT c.is_demo AND cc.category IN ('certification','qualification') AND (cc.valid_until IS NULL OR cc.valid_until>=current_date) GROUP BY lower(trim(cc.title)),cc.scope ORDER BY min(cc.title),cc.scope").fetch_all(&app.db).await?;
    Ok(Json(
        json!({"credentials":credentials.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?,"version":1,"categories":rows.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?,"sectors":SECTORS,"systemTypes":SYSTEMS,"deliveryMethods":DELIVERIES}),
    ))
}

pub(super) async fn preview(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    body: std::result::Result<Json<MatchRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let a = company_actor(&app, &headers, false).await?;
    let Json(b) = body.map_err(|_| bad("Check the matching request fields."))?;
    search(&app, a.company.as_deref().unwrap(), &b, false).await
}

async fn search(
    app: &App,
    company: &str,
    b: &MatchRequest,
    include_sourced: bool,
) -> Result<Json<Value>> {
    validate(b)?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM provider_taxonomy WHERE kind=$1 AND id=$2)",
    )
    .bind(&b.kind)
    .bind(&b.category_id)
    .fetch_one(&app.db)
    .await?;
    if !exists {
        return Err(bad("Choose a known service or product."));
    }
    let required = Value::Array(
        b.required_credentials
            .iter()
            .map(|c| json!({"key":c.catalog_key,"scope":c.scope}))
            .collect(),
    );
    let state_name = match b.state_code.as_deref().unwrap_or("") {
        "OH" => "Ohio",
        "TX" => "Texas",
        "CA" if b.country_code == "US" => "California",
        "NY" => "New York",
        "FL" => "Florida",
        "PA" => "Pennsylvania",
        "MI" => "Michigan",
        "IN" => "Indiana",
        "IL" => "Illinois",
        "MA" => "Massachusetts",
        "NJ" => "New Jersey",
        "VA" => "Virginia",
        "NC" => "North Carolina",
        "SC" => "South Carolina",
        "GA" => "Georgia",
        "AZ" => "Arizona",
        "CO" => "Colorado",
        "WA" => "Washington",
        "OR" => "Oregon",
        "MD" => "Maryland",
        "WI" => "Wisconsin",
        "MN" => "Minnesota",
        "TN" => "Tennessee",
        "MO" => "Missouri",
        "AL" => "Alabama",
        "AK" => "Alaska",
        "AR" => "Arkansas",
        "CT" => "Connecticut",
        "DE" => "Delaware",
        "DC" => "District of Columbia",
        "HI" => "Hawaii",
        "ID" => "Idaho",
        "IA" => "Iowa",
        "KS" => "Kansas",
        "KY" => "Kentucky",
        "LA" => "Louisiana",
        "ME" => "Maine",
        "MS" => "Mississippi",
        "MT" => "Montana",
        "NE" => "Nebraska",
        "NV" => "Nevada",
        "NH" => "New Hampshire",
        "NM" => "New Mexico",
        "ND" => "North Dakota",
        "OK" => "Oklahoma",
        "RI" => "Rhode Island",
        "SD" => "South Dakota",
        "UT" => "Utah",
        "VT" => "Vermont",
        "WV" => "West Virginia",
        "WY" => "Wyoming",
        "ON" => "Ontario",
        "BC" => "British Columbia",
        "AB" => "Alberta",
        "MB" => "Manitoba",
        "NB" => "New Brunswick",
        "NL" => "Newfoundland and Labrador",
        "NS" => "Nova Scotia",
        "NT" => "Northwest Territories",
        "NU" => "Nunavut",
        "PE" => "Prince Edward Island",
        "QC" => "Quebec",
        "SK" => "Saskatchewan",
        "YT" => "Yukon",
        "AS" => "American Samoa",
        "GU" => "Guam",
        "MP" => "Northern Mariana Islands",
        "PR" => "Puerto Rico",
        "VI" => "US Virgin Islands",
        _ => "unknown",
    };
    let location_pattern=format!("(^|,[[:space:]]*)({}|{})([[:space:]][0-9]{{5}}(-[0-9]{{4}})?)?([[:space:]]*,.*|[[:space:]]*$)", b.state_code.as_deref().unwrap_or("unknown"),state_name);
    let preferred = serde_json::to_value(&b.preferred_credentials)
        .map_err(|_| bad("Check certification preferences."))?;
    let rows: Vec<String>=sqlx::query_scalar(
      "SELECT jsonb_build_object('company',jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'username',c.username,
         'logo_url',c.logo_url,'logo_style',c.logo_style,'location',c.location,'claimed',c.listing_status='managed' AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=c.id)),
       'evidenceLevel',o.match_state,'basedInArea',c.location ~* $14,
       'preferredCredentials',(SELECT COALESCE(jsonb_agg(jsonb_build_object('title',cc.title,'scope',cc.scope,'basis',cc.evidence_basis,'sourceUrl',cc.source_url)),'[]') FROM company_credentials cc WHERE cc.company_id=c.id AND cc.category IN ('certification','qualification') AND cc.checked_at BETWEEN now()-interval '180 days' AND now() AND (cc.valid_until IS NULL OR cc.valid_until>=current_date) AND EXISTS(SELECT 1 FROM jsonb_array_elements($12::jsonb) pref WHERE lower(trim(cc.title))=lower(trim(pref->>'title')) AND cc.scope=pref->>'scope')),
       'offering',jsonb_build_object('id',o.id,'kind',o.kind,'categoryId',o.category_id,'title',o.title,'detail',o.detail,
         'delivery',o.delivery,'productRole',o.product_role,'sectors',o.sectors,'systemTypes',o.system_types,'checkedAt',o.checked_at),
       'sources',(SELECT COALESCE(jsonb_agg(jsonb_build_object('url',e.url,'title',e.title,'basis',e.basis,'checkedAt',e.checked_at)),'[]')
         FROM provider_offering_evidence oe JOIN provider_evidence e ON e.company_id=oe.company_id AND e.id=oe.evidence_id
         WHERE oe.company_id=o.company_id AND oe.offering_id=o.id),
       'coverage',(SELECT COALESCE(jsonb_agg(jsonb_build_object('label',ca.label,'kind',ca.kind,'countryCode',ca.country_code,
          'stateCode',ca.state_code,'stateCodes',ca.included_state_codes,'cityKey',ca.city_key,
          'sources',(SELECT COALESCE(jsonb_agg(jsonb_build_object('url',ce.url,'title',ce.title,'checkedAt',ce.checked_at)),'[]')
           FROM provider_coverage_evidence cr JOIN provider_evidence ce ON ce.company_id=cr.company_id AND ce.id=cr.evidence_id
           WHERE cr.company_id=ca.company_id AND cr.area_id=ca.id))),'[]')
         FROM provider_coverage_offerings co JOIN provider_coverage_areas ca ON ca.company_id=co.company_id AND ca.id=co.area_id
         WHERE co.company_id=o.company_id AND co.offering_id=o.id),
       'coverageConfirmed',EXISTS(SELECT 1 FROM provider_coverage_offerings co JOIN provider_coverage_areas ca ON ca.company_id=co.company_id AND ca.id=co.area_id
         WHERE co.company_id=o.company_id AND co.offering_id=o.id AND ca.country_code=$6 AND
          (ca.kind='country' OR (ca.kind='region' AND $7=ANY(ca.included_state_codes)) OR (ca.kind='state' AND ca.state_code=$7) OR (ca.kind='city' AND ca.state_code=$7 AND ca.city_key=$8))),
       'sectorConfirmed',($3='' OR $3=ANY(o.sectors)),
       'systemConfirmed',($11='' OR $11=ANY(o.system_types)),
       'availability',CASE WHEN o.kind='product' THEN 'unknown' WHEN av.valid_until>now() THEN av.status WHEN p.work_settings_confirmed_at>now()-interval '30 days' THEN CASE WHEN p.work_settings->>'availability'='from_date' THEN 'accepting' ELSE COALESCE(NULLIF(p.work_settings->>'availability',''),'unknown') END ELSE 'unknown' END,
       'earliestStart',CASE WHEN av.valid_until>now() THEN av.earliest_start::text WHEN p.work_settings_confirmed_at>now()-interval '30 days' THEN p.work_settings->>'availableFrom' ELSE NULL END,
       'availabilityValidUntil',CASE WHEN av.valid_until>now() THEN av.valid_until WHEN p.work_settings_confirmed_at>now()-interval '30 days' THEN p.work_settings_confirmed_at+interval '30 days' ELSE NULL END,
       'credentialsConfirmed',NOT EXISTS(SELECT 1 FROM jsonb_array_elements($10::jsonb) req WHERE NOT EXISTS(
         SELECT 1 FROM company_credentials cc WHERE cc.company_id=c.id AND cc.catalog_key=req->>'key' AND cc.scope=req->>'scope'
          AND cc.category IN ('certification','qualification') AND cc.evidence_basis='issuer'
          AND cc.checked_at BETWEEN now()-interval '180 days' AND now()
          AND (cc.valid_until IS NULL OR cc.valid_until>=current_date))))::text
       FROM provider_current_candidates o JOIN companies c ON c.id=o.company_id
       LEFT JOIN provider_profiles p ON p.company_id=c.id
       LEFT JOIN provider_service_availability av ON av.company_id=o.company_id AND av.category_id=o.category_id AND o.kind='service'
       WHERE ($13 OR o.match_state='reviewed') AND o.kind=$1 AND o.category_id=$2 AND ($3='' OR cardinality(o.sectors)=0 OR $3=ANY(o.sectors))
         AND ($11='' OR cardinality(o.system_types)=0 OR $11=ANY(o.system_types))
         AND ($4='' OR o.delivery=$4 OR ($13 AND o.delivery='unknown')) AND ($5='' OR o.product_role=$5) AND c.id<>$9::uuid
       ORDER BY c.name,c.id,o.id"
    ).bind(&b.kind).bind(&b.category_id).bind(b.sector.as_deref().unwrap_or(""))
     .bind(b.delivery.as_deref().unwrap_or("")).bind(b.product_role.as_deref().unwrap_or(""))
     .bind(&b.country_code).bind(b.state_code.as_deref().unwrap_or(""))
     .bind(b.city.as_deref().unwrap_or("").trim().to_lowercase()).bind(company)
     .bind(required.to_string()).bind(b.system_type.as_deref().unwrap_or(""))
     .bind(preferred.to_string()).bind(include_sourced).bind(location_pattern).fetch_all(&app.db).await?;
    let mut grouped: HashMap<String, Value> = HashMap::new();
    for raw in rows {
        let row = parse_json(raw)?;
        let mut missing = Vec::new();
        if b.delivery.is_some() && row["offering"]["delivery"] == "unknown" {
            missing.push("delivery_method");
        }
        // A business outside the requested region is not a useful suggestion.
        // Empty/ambiguous coverage remains explicitly pending, never confirmed.
        if include_sourced && row["coverageConfirmed"] != true {
            let areas = row["coverage"].as_array().unwrap();
            let possible = areas.iter().any(|area| {
                area["countryCode"] == b.country_code
                    && (area["kind"] == "country"
                        || area["stateCode"].as_str() == b.state_code.as_deref()
                        || area["stateCodes"].as_array().is_some_and(|codes| {
                            codes.iter().any(|c| c.as_str() == b.state_code.as_deref())
                        }))
            });
            if !areas.is_empty() && !possible {
                continue;
            }
        }
        if row["coverageConfirmed"] != true {
            missing.push("service_area");
        }
        if row["systemConfirmed"] != true {
            missing.push("system_type");
        }
        if row["sectorConfirmed"] != true {
            missing.push("project_sector");
        }
        if row["credentialsConfirmed"] != true {
            missing.push("required_credentials");
        }
        if row["availability"] == "unavailable" {
            missing.push("not_accepting_work");
        }
        if (b.require_availability || b.start_by.is_some())
            && !["accepting", "limited"].contains(&row["availability"].as_str().unwrap_or(""))
        {
            missing.push("availability");
        }
        if let Some(start) = &b.start_by {
            match row["earliestStart"].as_str() {
                None => missing.push("start_date"),
                Some(date) if date > start.as_str() => missing.push("start_date"),
                _ => (),
            }
        }
        let id = row["company"]["id"]
            .as_str()
            .ok_or_else(not_found)?
            .to_string();
        let (score, reasons, follow_up) = rank_offering(&row, b, &missing);
        let candidate = json!({"score":score,"reasons":reasons,"followUp":follow_up,"preferredCredentials":row["preferredCredentials"],"offering":row["offering"],"sources":row["sources"],"coverage":row["coverage"],"needsConfirmation":missing,
            "availability":row["availability"],"earliestStart":row["earliestStart"],"availabilityValidUntil":row["availabilityValidUntil"]});
        let entry = grouped
            .entry(id)
            .or_insert_with(|| json!({"company":row["company"],"evidenceLevel":row["evidenceLevel"],"eligible":false,"offerings":[]}));
        if missing.is_empty() {
            entry["eligible"] = json!(true);
        }
        entry["offerings"].as_array_mut().unwrap().push(candidate);
    }
    let mut companies: Vec<Value> = grouped.into_values().collect();
    for company in &mut companies {
        let offers = company["offerings"].as_array_mut().unwrap();
        offers.sort_by(|a, b| {
            let a_ready = a["needsConfirmation"].as_array().unwrap().is_empty();
            let b_ready = b["needsConfirmation"].as_array().unwrap().is_empty();
            b_ready
                .cmp(&a_ready)
                .then_with(|| b["score"].as_i64().cmp(&a["score"].as_i64()))
                .then_with(|| {
                    a["offering"]["id"]
                        .as_str()
                        .cmp(&b["offering"]["id"].as_str())
                })
        });
        let best = offers[0].clone();
        company["score"] = best["score"].clone();
        company["reasons"] = best["reasons"].clone();
        company["followUp"] = best["followUp"].clone();
    }
    companies.sort_by(compare_companies);
    let eligible = companies
        .iter()
        .filter(|c| c["eligible"] == true)
        .cloned()
        .collect::<Vec<_>>();
    let pending = companies
        .iter()
        .filter(|c| c["eligible"] != true)
        .cloned()
        .collect::<Vec<_>>();
    let page = b.page.unwrap_or(1);
    let size = b.page_size.unwrap_or(24);
    let offset = (page - 1) * size;
    Ok(Json(
        json!({"version":1,"matches":eligible.iter().skip(offset).take(size).collect::<Vec<_>>(),"needsConfirmation":pending.iter().skip(offset).take(size).collect::<Vec<_>>(),
        "page":page,"pageSize":size,"totalMatches":eligible.len(),"totalNeedsConfirmation":pending.len(),"evaluatedCompanies":companies.len(),
      "basis":if include_sourced {"sourced_company_capabilities"} else {"reviewed_company_capabilities"},"distanceCalculated":false,"invitationsSent":0}),
    ))
}

fn compare_companies(a: &Value, b: &Value) -> std::cmp::Ordering {
    // Account participation changes ordering, never evidence or eligibility.
    // Apply this before pagination so joined companies are not hidden on later pages.
    (b["eligible"] == true)
        .cmp(&(a["eligible"] == true))
        .then_with(|| (b["company"]["claimed"] == true).cmp(&(a["company"]["claimed"] == true)))
        .then_with(|| b["score"].as_i64().cmp(&a["score"].as_i64()))
        .then_with(|| {
            a["company"]["name"]
                .as_str()
                .cmp(&b["company"]["name"].as_str())
        })
        .then_with(|| {
            a["company"]["id"]
                .as_str()
                .cmp(&b["company"]["id"].as_str())
        })
}

// Ranking is a comparison of supported facts, not a probability or a guarantee.
fn rank_offering(
    row: &Value,
    b: &MatchRequest,
    missing: &[&str],
) -> (i64, Vec<String>, Vec<String>) {
    let mut score = 40;
    let mut reasons = vec![row["offering"]["title"]
        .as_str()
        .unwrap_or("Provides the requested service")
        .to_owned()];
    let mut follow_up = Vec::new();
    for (key, label) in [
        ("service_area", "Service area"),
        ("project_sector", "Project experience"),
        ("system_type", "System type"),
        ("delivery_method", "How the work is delivered"),
        ("required_credentials", "Required certifications"),
        ("availability", "Availability"),
        ("start_date", "Start date"),
        ("not_accepting_work", "Not currently accepting work"),
    ] {
        if missing.contains(&key) {
            follow_up.push(label.to_string());
        }
    }
    if row["coverageConfirmed"] == true {
        score += 30;
        reasons.push("Serves the job location".into());
    }
    if b.prefer_local && b.kind == "service" && row["basedInArea"] == true {
        score += 8;
        reasons.push("Based in the job’s state or province".into());
    }
    if b.sector.is_some() && row["sectorConfirmed"] == true {
        score += 10;
        reasons.push(format!("{} experience", b.sector.as_deref().unwrap()));
    }
    if b.system_type.is_some() && row["systemConfirmed"] == true {
        score += 5;
        reasons.push(format!("{} systems", b.system_type.as_deref().unwrap()));
    }
    if b.delivery.is_some() && row["offering"]["delivery"] == json!(b.delivery) {
        score += 5;
        reasons.push(format!("{} work", b.delivery.as_deref().unwrap()));
    }
    let mut seen = std::collections::HashSet::new();
    for c in row["preferredCredentials"].as_array().into_iter().flatten() {
        let key = format!(
            "{}:{}",
            c["title"].as_str().unwrap_or("").to_lowercase(),
            c["scope"]
        );
        if !seen.insert(key) {
            continue;
        }
        score += if c["basis"] == "issuer" { 5 } else { 2 };
        reasons.push(format!(
            "{}{}",
            c["title"].as_str().unwrap_or("Preferred certification"),
            if c["basis"] == "issuer" {
                ""
            } else {
                " (listed)"
            }
        ));
    }
    let accepting = ["accepting", "limited"].contains(&row["availability"].as_str().unwrap_or(""));
    let start_matches = b.preferred_start.as_ref().is_none_or(|start| {
        row["earliestStart"]
            .as_str()
            .is_some_and(|d| d <= start.as_str())
    });
    if b.kind == "product" {
        return (score, reasons, follow_up);
    }
    if accepting && start_matches {
        if b.prefer_available {
            score += 10;
        }
        reasons.push(
            if row["availability"] == "limited" {
                "Limited availability confirmed"
            } else {
                "Accepting work"
            }
            .into(),
        );
    } else if !follow_up
        .iter()
        .any(|s| s == "Availability" || s == "Start date" || s == "Not currently accepting work")
    {
        follow_up.push(
            if b.preferred_start.is_some() {
                "Start date"
            } else {
                "Availability"
            }
            .into(),
        );
    }
    (score, reasons, follow_up)
}

pub(super) async fn parse_job_preferences(app: &App, body: &Value) -> Result<Option<Value>> {
    let Some(value) = body.get("matchingPreferences").filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let mut b: MatchRequest = serde_json::from_value(value.clone())
        .map_err(|_| bad("Check company matching preferences."))?;
    validate(&b)?;
    if b.state_code.is_none() {
        return Err(bad("Choose the state or province for company matching."));
    }
    if b.page.is_some()
        || b.page_size.is_some()
        || b.require_availability
        || b.start_by.is_some()
        || !b.required_credentials.is_empty()
    {
        return Err(bad(
            "Use preferences for matching; confirm requirements with the company.",
        ));
    }
    b.page = None;
    b.page_size = None;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM provider_taxonomy WHERE kind=$1 AND id=$2)",
    )
    .bind(&b.kind)
    .bind(&b.category_id)
    .fetch_one(&app.db)
    .await?;
    if !exists {
        return Err(bad("Choose a known service or product."));
    }
    Ok(Some(
        serde_json::to_value(b).map_err(|_| bad("Check company matching preferences."))?,
    ))
}

pub(super) async fn for_job(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let access = job_access(&app, &id, actor.company.as_deref()).await?;
    if !access.hirer {
        return Err(forbidden());
    }
    let can_edit = matches!(actor.role.as_deref(), Some("owner" | "admin"))
        && ["draft", "open"].contains(&access.status())
        && sqlx::query_scalar::<_, bool>(
            "SELECT NOT EXISTS(SELECT 1 FROM job_quotes WHERE job_id=$1::uuid)",
        )
        .bind(&id)
        .fetch_one(&app.db)
        .await?;
    let preferences = access.job["matching_preferences"].clone();
    if preferences.is_null() {
        return Ok(Json(
            json!({"configured":false,"job":access.job,"canEdit":can_edit,"invitationsSent":0}),
        ));
    }
    let mut b: MatchRequest = serde_json::from_value(preferences.clone())
        .map_err(|_| bad("Update this job's matching preferences."))?;
    b.page = Some(
        q.get("page")
            .map(|v| v.parse::<usize>().map_err(|_| bad("Choose a valid page.")))
            .transpose()?
            .unwrap_or(1),
    );
    b.page_size = Some(12);
    let Json(mut result) = search(&app, actor.company.as_deref().unwrap(), &b, true).await?;
    let invited: Vec<String> = sqlx::query_scalar(
        "SELECT provider_company_id::text FROM job_invitations WHERE job_id=$1::uuid",
    )
    .bind(&id)
    .fetch_all(&app.db)
    .await?;
    let conversations: Vec<String> = sqlx::query_scalar(
        "SELECT provider_company_id::text FROM job_messages WHERE job_id=$1::uuid UNION SELECT provider_company_id::text FROM job_quotes WHERE job_id=$1::uuid",
    )
    .bind(&id)
    .fetch_all(&app.db)
    .await?;
    let pool: i64 =
        sqlx::query_scalar("SELECT count(DISTINCT company_id) FROM provider_current_candidates")
            .fetch_one(&app.db)
            .await?;
    for group in ["matches", "needsConfirmation"] {
        for candidate in result[group].as_array_mut().unwrap() {
            let notes = candidate["followUp"].as_array_mut().unwrap();
            if access.job["system_size_kw"]
                .as_f64()
                .is_some_and(|n| n > 0.)
            {
                notes.push(json!("Project size and capacity"));
            }
            if access.job["people_needed"].as_i64().is_some_and(|n| n > 0) {
                notes.push(json!("Crew size"));
            }
        }
    }
    result["configured"] = json!(true);
    result["canEdit"] = json!(can_edit);
    result["job"] = access.job;
    result["preferences"] = preferences;
    result["invitedCompanyIds"] = json!(invited);
    result["conversationCompanyIds"] = json!(conversations);
    result["searchableCompanies"] = json!(pool);
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Availability {
    category_id: String,
    status: String,
    earliest_start: Option<String>,
    crew_count: Option<i32>,
    valid_for_days: i32,
}
pub(super) async fn update_availability(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    body: std::result::Result<Json<Availability>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let a = company_actor(&app, &headers, true).await?;
    let Json(b) = body.map_err(|_| bad("Check your availability fields."))?;
    if !["accepting", "limited", "unavailable"].contains(&b.status.as_str())
        || !(1..=30).contains(&b.valid_for_days)
        || b.earliest_start.as_ref().is_some_and(|d| !date_valid(d))
        || b.crew_count.is_some_and(|n| !(1..=10000).contains(&n))
    {
        return Err(bad("Check your availability and confirmation period."));
    }
    let known: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM provider_taxonomy WHERE kind='service' AND id=$1)",
    )
    .bind(&b.category_id)
    .fetch_one(&app.db)
    .await?;
    if !known {
        return Err(bad("Choose a known service."));
    }
    let row:String=sqlx::query_scalar("INSERT INTO provider_service_availability(company_id,category_id,status,earliest_start,crew_count,confirmed_by,confirmed_at,valid_until)
      VALUES($1::uuid,$2,$3,$4::date,$5,$6::uuid,now(),now()+make_interval(days=>$7))
      ON CONFLICT(company_id,category_id) DO UPDATE SET status=excluded.status,earliest_start=excluded.earliest_start,
      crew_count=excluded.crew_count,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,valid_until=excluded.valid_until
      RETURNING jsonb_build_object('categoryId',category_id,'status',status,'earliestStart',earliest_start,'crewCount',crew_count,'confirmedAt',confirmed_at,'validUntil',valid_until)::text")
      .bind(a.company.as_deref().unwrap()).bind(b.category_id).bind(b.status).bind(b.earliest_start).bind(b.crew_count)
      .bind(&a.user).bind(b.valid_for_days).fetch_one(&app.db).await?;
    Ok(Json(json!({"availability":parse_json(row)?})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn joined_companies_are_first_within_each_match_group_before_pagination() {
        let candidate = |id: &str, name: &str, joined: bool, eligible: bool, score: i64| json!({"company":{"id":id,"name":name,"claimed":joined},"eligible":eligible,"score":score});
        let mut companies = vec![
            candidate("unclaimed-match", "A complete listing", false, true, 100),
            candidate("joined-low", "Z joined company", true, true, 70),
            candidate("joined-high-2", "A joined company", true, true, 90),
            candidate("joined-pending", "Joined, area unknown", true, false, 120),
            candidate(
                "unclaimed-pending",
                "Unclaimed, area unknown",
                false,
                false,
                140,
            ),
            candidate("joined-high-1", "A joined company", true, true, 90),
        ];
        companies.sort_by(compare_companies);
        let ids: Vec<_> = companies
            .iter()
            .map(|c| c["company"]["id"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            [
                "joined-high-1",
                "joined-high-2",
                "joined-low",
                "unclaimed-match",
                "joined-pending",
                "unclaimed-pending"
            ]
        );
        assert_eq!(
            companies[4]["eligible"], false,
            "Joining cannot turn missing facts into a match"
        );
        assert_eq!(
            companies[4]["score"], 120,
            "Participation must not inflate the evidence score"
        );
    }
    #[test]
    fn missing_account_status_does_not_receive_joined_priority() {
        let mut unknown =
            json!({"company":{"id":"unknown","name":"A company"},"eligible":true,"score":100});
        let joined = json!({"company":{"id":"joined","name":"Z company","claimed":true},"eligible":true,"score":70});
        assert!(compare_companies(&joined, &unknown).is_lt());
        unknown["company"]["claimed"] = json!(false);
        assert!(compare_companies(&joined, &unknown).is_lt());
    }
    #[test]
    fn ranking_uses_confirmed_facts_and_never_turns_unknown_schedule_into_availability() {
        let b:MatchRequest=serde_json::from_value(json!({"kind":"service","categoryId":"solar-installation","countryCode":"US","stateCode":"OH","sector":"commercial","preferAvailable":true,"preferredStart":"2027-01-15"})).unwrap();
        let mut row = json!({"offering":{"title":"Solar installation"},"coverageConfirmed":true,"sectorConfirmed":true,"preferredCredentials":[],"availability":"unknown","earliestStart":null});
        let (unknown, _, notes) = rank_offering(&row, &b, &[]);
        assert!(notes.contains(&"Start date".to_string()));
        row["availability"] = json!("accepting");
        row["earliestStart"] = json!("2027-02-01");
        let (late, _, _) = rank_offering(&row, &b, &[]);
        assert_eq!(unknown, late);
        row["earliestStart"] = json!("2027-01-10");
        let (ready, reasons, notes) = rank_offering(&row, &b, &[]);
        assert!(ready > unknown);
        assert!(reasons.contains(&"Accepting work".to_string()));
        assert!(notes.is_empty());
        row["coverageConfirmed"] = json!(false);
        row["basedInArea"] = json!(true);
        let (_, reasons, notes) = rank_offering(&row, &b, &["service_area"]);
        assert!(notes.contains(&"Service area".to_string()));
        assert!(!reasons.contains(&"Serves the job location".to_string()));
    }
    #[test]
    fn calendar_dates_are_validated_before_database_casts() {
        for date in ["2028-02-29", "2026-11-12", "2027-12-31"] {
            assert!(date_valid(date));
        }
        for date in [
            "2026-02-29",
            "2026-13-01",
            "2026-04-31",
            "2026-00-01",
            "today",
            "2026-1-01",
        ] {
            assert!(!date_valid(date));
        }
    }
    #[test]
    fn requirements_do_not_mix_product_shipping_and_labor() {
        let mut request: MatchRequest = serde_json::from_value(
            json!({"kind":"product","categoryId":"solar-modules","countryCode":"US"}),
        )
        .unwrap();
        assert!(validate(&request).is_ok());
        request.delivery = Some("labor-only".to_string());
        assert!(validate(&request).is_err());
    }
}
