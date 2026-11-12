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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CredentialRequirement {
    catalog_key: String,
    scope: String,
}
#[derive(Deserialize)]
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
    page: Option<usize>,
    page_size: Option<usize>,
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
    Ok(Json(
        json!({"version":1,"categories":rows.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?,"sectors":SECTORS,"systemTypes":SYSTEMS,"deliveryMethods":DELIVERIES}),
    ))
}

pub(super) async fn preview(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    body: std::result::Result<Json<MatchRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>> {
    let a = company_actor(&app, &headers, false).await?;
    let Json(b) = body.map_err(|_| bad("Check the matching request fields."))?;
    validate(&b)?;
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
    let rows: Vec<String>=sqlx::query_scalar(
      "SELECT jsonb_build_object('company',jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'username',c.username,
         'logo_url',c.logo_url,'logo_style',c.logo_style,'location',c.location,'claimed',c.listing_status='managed'),
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
       'availability',CASE WHEN av.valid_until>now() THEN av.status ELSE 'unknown' END,
       'earliestStart',CASE WHEN av.valid_until>now() THEN av.earliest_start ELSE NULL END,
       'availabilityValidUntil',CASE WHEN av.valid_until>now() THEN av.valid_until ELSE NULL END,
       'credentialsConfirmed',NOT EXISTS(SELECT 1 FROM jsonb_array_elements($10::jsonb) req WHERE NOT EXISTS(
         SELECT 1 FROM company_credentials cc WHERE cc.company_id=c.id AND cc.catalog_key=req->>'key' AND cc.scope=req->>'scope'
          AND cc.category IN ('certification','qualification') AND cc.evidence_basis='issuer'
          AND cc.checked_at BETWEEN now()-interval '180 days' AND now()
          AND (cc.valid_until IS NULL OR cc.valid_until>=current_date))))::text
       FROM provider_current_offerings o JOIN companies c ON c.id=o.company_id
       LEFT JOIN provider_service_availability av ON av.company_id=o.company_id AND av.category_id=o.category_id AND o.kind='service'
       WHERE o.kind=$1 AND o.category_id=$2 AND ($3='' OR cardinality(o.sectors)=0 OR $3=ANY(o.sectors))
         AND ($11='' OR cardinality(o.system_types)=0 OR $11=ANY(o.system_types))
         AND ($4='' OR o.delivery=$4) AND ($5='' OR o.product_role=$5) AND c.id<>$9::uuid
       ORDER BY c.name,c.id,o.id"
    ).bind(&b.kind).bind(&b.category_id).bind(b.sector.as_deref().unwrap_or(""))
     .bind(b.delivery.as_deref().unwrap_or("")).bind(b.product_role.as_deref().unwrap_or(""))
     .bind(&b.country_code).bind(b.state_code.as_deref().unwrap_or(""))
     .bind(b.city.as_deref().unwrap_or("").trim().to_lowercase()).bind(a.company.as_deref().unwrap())
     .bind(required.to_string()).bind(b.system_type.as_deref().unwrap_or("")).fetch_all(&app.db).await?;
    let mut grouped: HashMap<String, Value> = HashMap::new();
    for raw in rows {
        let row = parse_json(raw)?;
        let mut missing = Vec::new();
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
        let candidate = json!({"offering":row["offering"],"sources":row["sources"],"coverage":row["coverage"],"needsConfirmation":missing,
            "availability":row["availability"],"earliestStart":row["earliestStart"],"availabilityValidUntil":row["availabilityValidUntil"]});
        let entry = grouped
            .entry(id)
            .or_insert_with(|| json!({"company":row["company"],"eligible":false,"offerings":[]}));
        if missing.is_empty() {
            entry["eligible"] = json!(true);
        }
        entry["offerings"].as_array_mut().unwrap().push(candidate);
    }
    let mut companies: Vec<Value> = grouped.into_values().collect();
    companies.sort_by(|a, b| {
        a["company"]["name"]
            .as_str()
            .cmp(&b["company"]["name"].as_str())
            .then_with(|| {
                a["company"]["id"]
                    .as_str()
                    .cmp(&b["company"]["id"].as_str())
            })
    });
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
      "basis":"reviewed_company_capabilities","distanceCalculated":false,"invitationsSent":0}),
    ))
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
