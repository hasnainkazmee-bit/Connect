mod provider_matching;
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::{collections::HashMap, net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::io::AsyncWriteExt;

#[derive(Clone)]
struct App {
    db: PgPool,
    uploads: PathBuf,
}

#[derive(Debug)]
struct Error(StatusCode, &'static str);
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        eprintln!("jobs database error: {error}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The job could not be loaded. Please try again.",
        )
    }
}
type Result<T> = std::result::Result<T, Error>;
fn bad(message: &'static str) -> Error {
    Error(StatusCode::BAD_REQUEST, message)
}
fn conflict(message: &'static str) -> Error {
    Error(StatusCode::CONFLICT, message)
}
fn forbidden() -> Error {
    Error(StatusCode::FORBIDDEN, "Your company cannot do that.")
}
fn not_found() -> Error {
    Error(StatusCode::NOT_FOUND, "Job not found.")
}
fn valid_id(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}
fn checked_id(s: &str) -> Result<&str> {
    if valid_id(s) {
        Ok(s)
    } else {
        Err(bad("Invalid job ID."))
    }
}
fn parse_json(s: String) -> Result<Value> {
    serde_json::from_str(&s).map_err(|_| {
        Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The job could not be loaded.",
        )
    })
}
fn required_text<'a>(value: &'a Value, key: &str, min: usize, max: usize) -> Result<&'a str> {
    let text = value.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if text.len() < min || text.len() > max {
        Err(bad("Check the required fields and try again."))
    } else {
        Ok(text)
    }
}
fn optional_text<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    let text = value.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if text.len() > max {
        Err(bad("A field is too long."))
    } else {
        Ok(text)
    }
}

#[derive(Clone)]
struct Actor {
    user: String,
    company: Option<String>,
    role: Option<String>,
    verified: bool,
    account_type: String,
}
async fn actor(app: &App, headers: &HeaderMap) -> Result<Option<Actor>> {
    let cookie = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = ["connect_session", "sunhub_session"]
        .iter()
        .find_map(|name| {
            cookie
                .split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix(&format!("{name}=")))
        });
    let Some(token) = token else { return Ok(None) };
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(None);
    }
    let hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    let row = sqlx::query(
        "SELECT s.user_id::text AS user_id,s.company_id::text AS company_id,m.role,\
         u.email_verified_at IS NOT NULL AS verified,u.account_type FROM sessions s \
         JOIN users u ON u.id=s.user_id LEFT JOIN memberships m ON m.user_id=s.user_id AND m.company_id=s.company_id \
         WHERE s.token_hash=$1 AND s.expires_at>now()",
    ).bind(hash).fetch_optional(&app.db).await?;
    Ok(row.map(|r| Actor {
        user: r.get("user_id"),
        company: if r.get::<Option<String>, _>("role").is_some() {
            r.get("company_id")
        } else {
            None
        },
        role: r.get("role"),
        verified: r.get("verified"),
        account_type: r.get("account_type"),
    }))
}
async fn company_actor(app: &App, headers: &HeaderMap, admin: bool) -> Result<Actor> {
    let a = actor(app, headers).await?.ok_or(Error(
        StatusCode::UNAUTHORIZED,
        "Please sign in to continue.",
    ))?;
    if !a.verified {
        return Err(Error(
            StatusCode::FORBIDDEN,
            "Verify your email before continuing.",
        ));
    }
    if a.account_type != "company" || a.company.is_none() {
        return Err(forbidden());
    }
    if admin && !matches!(a.role.as_deref(), Some("owner" | "admin")) {
        return Err(forbidden());
    }
    Ok(a)
}
struct JobAccess {
    job: Value,
    hirer: bool,
    chosen: bool,
    invited: bool,
    quoted: bool,
}
impl JobAccess {
    fn status(&self) -> &str {
        self.job["status"].as_str().unwrap_or("")
    }
    fn hirer_id(&self) -> &str {
        self.job["hiring_company_id"].as_str().unwrap_or("")
    }
    fn participant(&self) -> Result<()> {
        if self.hirer || self.chosen {
            Ok(())
        } else {
            Err(forbidden())
        }
    }
}
async fn job_access(app: &App, id: &str, company: Option<&str>) -> Result<JobAccess> {
    checked_id(id)?;
    let raw = sqlx::query_scalar::<_, String>(
        "SELECT row_to_json(j)::text FROM jobs j WHERE id=$1::uuid",
    )
    .bind(id)
    .fetch_optional(&app.db)
    .await?
    .ok_or_else(not_found)?;
    let job = parse_json(raw)?;
    let hirer = company == job["hiring_company_id"].as_str();
    let mut chosen = false;
    let mut invited = false;
    let mut quoted = false;
    let mut conversed = false;
    if let Some(company) = company {
        let row = sqlx::query(
            "SELECT EXISTS(SELECT 1 FROM job_quotes WHERE job_id=$1::uuid AND provider_company_id=$2::uuid) AS quoted,\
             EXISTS(SELECT 1 FROM job_invitations WHERE job_id=$1::uuid AND provider_company_id=$2::uuid AND status='pending') AS invited,\
             EXISTS(SELECT 1 FROM job_quotes WHERE id=(SELECT chosen_quote_id FROM jobs WHERE id=$1::uuid) AND provider_company_id=$2::uuid) AS chosen,\
             EXISTS(SELECT 1 FROM job_messages WHERE job_id=$1::uuid AND provider_company_id=$2::uuid) AS conversed"
        ).bind(id).bind(company).fetch_one(&app.db).await?;
        quoted = row.get("quoted");
        conversed = row.get("conversed");
        invited = row.get("invited");
        chosen = row.get("chosen");
    }
    if !hirer
        && !chosen
        && !invited
        && !quoted
        && !conversed
        && !(job["visibility"] == "open" && job["status"] == "open")
    {
        return Err(not_found());
    }
    Ok(JobAccess {
        job,
        hirer,
        chosen,
        invited,
        quoted,
    })
}
async fn notify(
    app: &App,
    target: &str,
    actor: &Actor,
    key: &str,
    title: &str,
    body: &str,
    job: &str,
) -> Result<()> {
    sqlx::query("SELECT connect_notify($1::uuid,NULL,$2::uuid,$3::uuid,$4,'job','requests',$5,$6,$7,'job',$8::uuid)")
        .bind(target).bind(actor.company.as_deref()).bind(&actor.user).bind(key).bind(title).bind(body)
        .bind(format!("/jobs/{job}")).bind(job).execute(&app.db).await?;
    Ok(())
}
fn company_json() -> &'static str {
    "json_build_object('id',c.id,'name',c.name,'slug',c.slug,'username',c.username,\
     'logo_url',c.logo_url,'logo_style',c.logo_style,'location',c.location,'type',c.type,\
     'tagline',c.tagline,'description',c.description,'services',c.services,'service_areas',c.service_areas,
     'is_demo',c.is_demo)"
}

#[derive(Deserialize)]
struct ProviderSearch {
    q: Option<String>,
    trade: Option<String>,
    location: Option<String>,
    kind: Option<String>,
    sample: Option<bool>,
    page: Option<i64>,
}
async fn list_providers(
    State(app): State<Arc<App>>,
    Query(search): Query<ProviderSearch>,
) -> Result<Json<Value>> {
    let page = search.page.unwrap_or(1).clamp(1, 1000);
    let sample = search.sample.unwrap_or(false);
    let q = search.q.unwrap_or_default();
    let trade = search.trade.unwrap_or_default();
    let location = search.location.unwrap_or_default();
    let kind = search.kind.unwrap_or_default();
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT (to_jsonb(c)||jsonb_build_object(
          'trades',COALESCE(p.trades,'{}'::text[]),'project_types',COALESCE(p.project_types,'{}'::text[]),
          'availability',COALESCE(p.availability,''),'crew_size',COALESCE(p.crew_size,''),
          'capacity',COALESCE(p.capacity,''),'project_count',(SELECT count(*) FROM projects pr WHERE pr.company_id=c.id),
          'completed_jobs',(SELECT count(*) FROM job_reviews jr WHERE jr.reviewed_company_id=c.id)))::text
         FROM companies c LEFT JOIN provider_profiles p ON p.company_id=c.id
         LEFT JOIN provider_directory_pins pin ON pin.company_id=c.id
         LEFT JOIN provider_capabilities enrichment ON enrichment.company_id=c.id
         WHERE c.is_demo=$1
           AND ($2='' OR c.name ILIKE '%'||$2||'%' OR c.slug ILIKE '%'||$2||'%' OR c.description ILIKE '%'||$2||'%' OR
             EXISTS(SELECT 1 FROM unnest(c.services) s WHERE s ILIKE '%'||$2||'%'))
           AND ($3='' OR $3=ANY(COALESCE(p.trades,'{}'::text[])) OR
             EXISTS(SELECT 1 FROM unnest(c.services) s WHERE s ILIKE '%'||$3||'%'))
           AND ($4='' OR c.location ILIKE '%'||$4||'%' OR
             EXISTS(SELECT 1 FROM unnest(c.service_areas) a WHERE a ILIKE '%'||$4||'%'))
           AND ($6='' OR c.type=$6)
         ORDER BY pin.position ASC NULLS LAST,
           CASE WHEN enrichment.research->>'reviewMethod'='source-check-v1' THEN 0
                WHEN enrichment.company_id IS NOT NULL THEN 1 ELSE 2 END,
           (c.listing_status='managed') DESC,(c.logo_url<>'') DESC,
           (length(c.description)>80) DESC,(cardinality(c.services)>0) DESC,c.name,c.id
         LIMIT 24 OFFSET $5"
    ).bind(sample).bind(&q).bind(&trade)
     .bind(&location).bind((page-1)*24).bind(&kind).fetch_all(&app.db).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM companies c LEFT JOIN provider_profiles p ON p.company_id=c.id
         WHERE c.is_demo=$1
           AND ($2='' OR c.name ILIKE '%'||$2||'%' OR c.slug ILIKE '%'||$2||'%' OR c.description ILIKE '%'||$2||'%' OR
             EXISTS(SELECT 1 FROM unnest(c.services) s WHERE s ILIKE '%'||$2||'%'))
           AND ($3='' OR $3=ANY(COALESCE(p.trades,'{}'::text[])) OR
             EXISTS(SELECT 1 FROM unnest(c.services) s WHERE s ILIKE '%'||$3||'%'))
           AND ($4='' OR c.location ILIKE '%'||$4||'%' OR
             EXISTS(SELECT 1 FROM unnest(c.service_areas) a WHERE a ILIKE '%'||$4||'%'))
           AND ($5='' OR c.type=$5)",
    )
    .bind(sample)
    .bind(&q)
    .bind(&trade)
    .bind(&location)
    .bind(&kind)
    .fetch_one(&app.db)
    .await?;
    Ok(Json(
        json!({"providers":rows.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?,
      "total":count,"page":page,"sample":sample}),
    ))
}
async fn provider_detail(
    State(app): State<Arc<App>>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    let raw: Option<String> = sqlx::query_scalar(
        "SELECT (to_jsonb(c)||jsonb_build_object('trades',COALESCE(p.trades,'{}'::text[]),
         'project_types',COALESCE(p.project_types,'{}'::text[]),'availability',COALESCE(p.availability,''),
         'crew_size',COALESCE(p.crew_size,''),'capacity',COALESCE(p.capacity,''),
         'license_details',COALESCE(p.license_details,''),'insurance_details',COALESCE(p.insurance_details,''),
         'capabilities',CASE WHEN p.updated_at<=e.updated_at THEN e.research-'reviewNotes'-'identityNote'-'confirmationNeeded' ELSE NULL END))::text
         FROM companies c LEFT JOIN provider_profiles p ON p.company_id=c.id
         LEFT JOIN provider_capabilities e ON e.company_id=c.id
         WHERE c.slug=$1 OR c.username=$1 OR c.id::text=$1 LIMIT 1"
    ).bind(slug).fetch_optional(&app.db).await?;
    let mut provider = parse_json(raw.ok_or_else(not_found)?)?;
    if let Some(sources) = provider
        .get_mut("capabilities")
        .and_then(|c| c.get_mut("sources"))
        .and_then(Value::as_array_mut)
    {
        // Keep research excerpts internal. Public profiles expose source links and dates.
        for source in sources {
            if let Some(object) = source.as_object_mut() {
                object.remove("evidence");
            }
        }
    }
    Ok(Json(json!({"provider": provider})))
}
async fn update_provider(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let a = company_actor(&app, &headers, true).await?;
    let company = a.company.as_deref().unwrap();
    let strings = |key: &str, max: usize| -> Result<Vec<String>> {
        let values = body
            .get(key)
            .and_then(Value::as_array)
            .ok_or_else(|| bad("Check the profile fields."))?;
        if values.len() > max {
            return Err(bad("Too many profile items."));
        }
        values
            .iter()
            .map(|v| {
                let s = v.as_str().unwrap_or("").trim();
                if s.is_empty() || s.len() > 80 {
                    Err(bad("Check the profile fields."))
                } else {
                    Ok(s.to_string())
                }
            })
            .collect()
    };
    let trades = strings("trades", 12)?;
    let project_types = strings("projectTypes", 12)?;
    let availability = optional_text(&body, "availability", 160)?;
    let crew_size = optional_text(&body, "crewSize", 80)?;
    let capacity = optional_text(&body, "capacity", 160)?;
    let license = optional_text(&body, "licenseDetails", 1000)?;
    let insurance = optional_text(&body, "insuranceDetails", 1000)?;
    sqlx::query(
        "INSERT INTO provider_profiles(company_id,trades,project_types,availability,crew_size,capacity,license_details,insurance_details)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(company_id) DO UPDATE SET trades=$2,project_types=$3,availability=$4,
           crew_size=$5,capacity=$6,license_details=$7,insurance_details=$8,updated_at=now()"
    ).bind(company).bind(trades).bind(project_types).bind(availability).bind(crew_size)
     .bind(capacity).bind(license).bind(insurance).execute(&app.db).await?;
    Ok(Json(json!({"ok":true})))
}

#[derive(Deserialize)]
struct Search {
    q: Option<String>,
    trade: Option<String>,
    location: Option<String>,
    page: Option<i64>,
    sample: Option<bool>,
}
async fn list_jobs(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(search): Query<Search>,
) -> Result<Json<Value>> {
    let a = actor(&app, &headers).await?;
    let company = a.as_ref().and_then(|a| a.company.as_deref());
    let page = search.page.unwrap_or(1).clamp(1, 1000);
    let sql = format!(
        "SELECT json_build_object('id',j.id,'title',j.title,'description',j.description,'trade',j.trade,\
         'people_needed',j.people_needed,'expected_duration',j.expected_duration,'work_arrangement',j.work_arrangement,'project_type',j.project_type,'system_size_kw',j.system_size_kw,'site_count',j.site_count,'location',j.location,'postal_code',j.postal_code,'start_window',j.start_window,'budget_cents',j.budget_cents,\
         'quote_deadline',j.quote_deadline,'visibility',j.visibility,'status',j.status,'created_at',j.created_at,\
         'company',{},'quote_count',(SELECT count(*) FROM job_quotes q WHERE q.job_id=j.id AND q.status='submitted'),\
         'invited',EXISTS(SELECT 1 FROM job_invitations i WHERE i.job_id=j.id AND i.provider_company_id=$1::uuid))::text \
         FROM jobs j JOIN companies c ON c.id=j.hiring_company_id WHERE j.status='open' \
         AND (j.visibility='open' OR EXISTS(SELECT 1 FROM job_invitations i WHERE i.job_id=j.id AND i.provider_company_id=$1::uuid AND i.status='pending')) \
         AND ($1::uuid IS NULL OR j.hiring_company_id<>$1::uuid) \
         AND ($2='' OR j.title ILIKE '%'||$2||'%' OR j.description ILIKE '%'||$2||'%') \
         AND ($3='' OR j.trade=$3) AND ($4='' OR j.location ILIKE '%'||$4||'%') \
         AND c.is_demo=$6 AND (j.quote_deadline IS NULL OR j.quote_deadline>=now()) ORDER BY j.created_at DESC,j.id LIMIT 25 OFFSET $5", company_json()
    );
    let rows: Vec<String> = sqlx::query_scalar(&sql)
        .bind(company)
        .bind(search.q.unwrap_or_default())
        .bind(search.trade.unwrap_or_default())
        .bind(search.location.unwrap_or_default())
        .bind((page - 1) * 24)
        .bind(search.sample.unwrap_or(false))
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"hasMore":rows.len()>24,"jobs": rows.into_iter().take(24).map(parse_json).collect::<Result<Vec<_>>>()?, "page":page}),
    ))
}
async fn my_jobs(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let a = company_actor(&app, &headers, false).await?;
    let company = a.company.as_deref().unwrap();
    let sql = format!(
        "SELECT json_build_object('id',j.id,'title',j.title,'description',j.description,'budget_cents',j.budget_cents,'people_needed',j.people_needed,'expected_duration',j.expected_duration,'work_arrangement',j.work_arrangement,'project_type',j.project_type,'system_size_kw',j.system_size_kw,'site_count',j.site_count,'trade',j.trade,'location',j.location,\
         'start_window',j.start_window,'status',j.status,'created_at',j.created_at,'updated_at',j.updated_at,\
         'hiring_company_id',j.hiring_company_id,'chosen_quote_id',j.chosen_quote_id,'company',{},\
         'quote_count',(SELECT count(*) FROM job_quotes q WHERE q.job_id=j.id AND q.status='submitted'),\
         'my_quote_status',(SELECT q.status FROM job_quotes q WHERE q.job_id=j.id AND q.provider_company_id=$1::uuid), \
         'invited',EXISTS(SELECT 1 FROM job_invitations i WHERE i.job_id=j.id AND i.provider_company_id=$1::uuid AND i.status='pending'))::text \
         FROM jobs j JOIN companies c ON c.id=j.hiring_company_id WHERE j.hiring_company_id=$1::uuid \
         OR EXISTS(SELECT 1 FROM job_quotes q WHERE q.job_id=j.id AND q.provider_company_id=$1::uuid) \
         OR EXISTS(SELECT 1 FROM job_invitations i WHERE i.job_id=j.id AND i.provider_company_id=$1::uuid) \
         ORDER BY j.updated_at DESC LIMIT 200", company_json()
    );
    let rows: Vec<String> = sqlx::query_scalar(&sql)
        .bind(company)
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"jobs": rows.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?}),
    ))
}
async fn get_job(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let actor = actor(&app, &headers).await?;
    let a = job_access(&app, &id, actor.as_ref().and_then(|v| v.company.as_deref())).await?;
    let mut job = a.job;
    if !a.hirer && !a.chosen {
        job["exact_address"] = json!("");
    }
    let company_raw: String = sqlx::query_scalar(&format!(
        "SELECT {}::text FROM companies c WHERE c.id=$1::uuid",
        company_json()
    ))
    .bind(job["hiring_company_id"].as_str().unwrap_or(""))
    .fetch_one(&app.db)
    .await?;
    let hiring_company = parse_json(company_raw)?;
    let quotes = if a.hirer {
        let sql = format!("SELECT (to_jsonb(q)||jsonb_build_object('company',{},'job_rating',(SELECT round(avg(rating)::numeric,1) FROM job_reviews WHERE reviewed_company_id=c.id),'job_review_count',(SELECT count(*) FROM job_reviews WHERE reviewed_company_id=c.id)))::text FROM job_quotes q JOIN companies c ON c.id=q.provider_company_id WHERE q.job_id=$1::uuid ORDER BY q.created_at DESC", company_json());
        let rows: Vec<String> = sqlx::query_scalar(&sql)
            .bind(&id)
            .fetch_all(&app.db)
            .await?;
        rows.into_iter()
            .map(parse_json)
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let own_quote = if let Some(c) = actor.as_ref().and_then(|v| v.company.as_deref()) {
        if !a.hirer {
            sqlx::query_scalar::<_, String>("SELECT row_to_json(q)::text FROM job_quotes q WHERE q.job_id=$1::uuid AND q.provider_company_id=$2::uuid")
            .bind(&id).bind(c).fetch_optional(&app.db).await?.map(parse_json).transpose()?
        } else {
            None
        }
    } else {
        None
    };
    let selected = if let Some(qid) = job["chosen_quote_id"]
        .as_str()
        .filter(|_| a.hirer || a.chosen)
    {
        let sql = format!("SELECT (to_jsonb(q)||jsonb_build_object('company',{}))::text FROM job_quotes q JOIN companies c ON c.id=q.provider_company_id WHERE q.id=$1::uuid", company_json());
        sqlx::query_scalar::<_, String>(&sql)
            .bind(qid)
            .fetch_optional(&app.db)
            .await?
            .map(parse_json)
            .transpose()?
    } else {
        None
    };
    let updates = if a.hirer || a.chosen {
        let rows: Vec<String> = sqlx::query_scalar("SELECT (to_jsonb(u)||jsonb_build_object('company_name',c.name))::text FROM job_updates u JOIN companies c ON c.id=u.company_id WHERE u.job_id=$1::uuid ORDER BY u.created_at DESC")
            .bind(&id).fetch_all(&app.db).await?;
        rows.into_iter()
            .map(parse_json)
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let stages = if a.hirer || a.chosen {
        let rows: Vec<String> = sqlx::query_scalar("SELECT row_to_json(s)::text FROM job_payment_stages s WHERE s.job_id=$1::uuid ORDER BY sort_order")
            .bind(&id).fetch_all(&app.db).await?;
        rows.into_iter()
            .map(parse_json)
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let files = if actor.as_ref().and_then(|v| v.company.as_deref()).is_some() {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT (to_jsonb(f)-'storage_key'||jsonb_build_object('provider_company_id',q.provider_company_id))::text \
             FROM job_files f LEFT JOIN job_quotes q ON q.id=f.quote_id WHERE f.job_id=$1::uuid \
             AND ((f.quote_id IS NULL AND f.update_id IS NULL) \
              OR (f.quote_id IS NOT NULL AND ($2::uuid=(SELECT hiring_company_id FROM jobs WHERE id=$1::uuid) OR q.provider_company_id=$2::uuid)) \
              OR (f.update_id IS NOT NULL AND $3::boolean)) ORDER BY f.created_at DESC")
            .bind(&id).bind(actor.as_ref().and_then(|a| a.company.as_deref())).bind(a.hirer || a.chosen).fetch_all(&app.db).await?;
        rows.into_iter()
            .map(parse_json)
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let reviews = if job["status"] == "completed" {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT row_to_json(r)::text FROM job_reviews r WHERE r.job_id=$1::uuid",
        )
        .bind(&id)
        .fetch_all(&app.db)
        .await?;
        rows.into_iter()
            .map(parse_json)
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let conversations = if a.hirer {
        let sql = format!("SELECT {}::text FROM companies c WHERE c.id IN (SELECT provider_company_id FROM job_quotes WHERE job_id=$1::uuid UNION SELECT provider_company_id FROM job_invitations WHERE job_id=$1::uuid UNION SELECT provider_company_id FROM job_messages WHERE job_id=$1::uuid) ORDER BY c.name", company_json());
        let rows: Vec<String> = sqlx::query_scalar(&sql)
            .bind(&id)
            .fetch_all(&app.db)
            .await?;
        rows.into_iter()
            .map(parse_json)
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    Ok(Json(
        json!({"conversations":conversations,"job":job,"hiringCompany":hiring_company,"quotes":quotes,"ownQuote":own_quote,
        "selected":selected,"updates":updates,"paymentStages":stages,"files":files,"reviews":reviews,
        "permissions":{"hirer":a.hirer,"chosen":a.chosen,"invited":a.invited,"quoted":a.quoted}}),
    ))
}

fn detected_mime(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"%PDF-") {
        Some("application/pdf")
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if data.len() > 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
async fn upload_file(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, false).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    if body.is_empty() || body.len() > 12 * 1024 * 1024 {
        return Err(bad("Choose a file under 12 MB."));
    }
    let mime = detected_mime(&body).ok_or_else(|| bad("Attach a PDF, JPEG, PNG, or WebP file."))?;
    let name = query
        .get("name")
        .map(String::as_str)
        .unwrap_or("Attachment")
        .trim();
    if name.is_empty() || name.len() > 200 || name.contains(['\n', '\r']) {
        return Err(bad("Invalid file name."));
    }
    let quote = query.get("quoteId").map(String::as_str);
    let update = query.get("updateId").map(String::as_str);
    if quote.is_some() && update.is_some() {
        return Err(bad("Choose one attachment destination."));
    }
    if let Some(qid) = quote {
        checked_id(qid)?;
        let owner: Option<String> = sqlx::query_scalar("SELECT provider_company_id::text FROM job_quotes WHERE id=$1::uuid AND job_id=$2::uuid AND status='submitted'")
            .bind(qid).bind(&id).fetch_optional(&app.db).await?;
        if owner.as_deref() != actor.company.as_deref() || a.status() != "open" {
            return Err(forbidden());
        }
    } else if let Some(uid) = update {
        checked_id(uid)?;
        a.participant()?;
        let owner: Option<String> = sqlx::query_scalar(
            "SELECT company_id::text FROM job_updates WHERE id=$1::uuid AND job_id=$2::uuid",
        )
        .bind(uid)
        .bind(&id)
        .fetch_optional(&app.db)
        .await?;
        if owner.as_deref() != actor.company.as_deref() {
            return Err(forbidden());
        }
    } else if !a.hirer || !["open", "draft"].contains(&a.status()) {
        return Err(forbidden());
    }
    let file_id: String = sqlx::query_scalar("SELECT gen_random_uuid()::text")
        .fetch_one(&app.db)
        .await?;
    let dir = app.uploads.join("jobs").join(&id);
    tokio::fs::create_dir_all(&dir).await.map_err(|_| {
        Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "File storage is unavailable.",
        )
    })?;
    let file = dir.join(&file_id);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .await
        .map_err(|_| {
            Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "File storage is unavailable.",
            )
        })?;
    output.write_all(&body).await.map_err(|_| {
        Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "File storage is unavailable.",
        )
    })?;
    let key = format!("jobs/{id}/{file_id}");
    let saved = sqlx::query("INSERT INTO job_files(id,job_id,quote_id,update_id,company_id,uploaded_by,original_name,storage_backend,storage_key,mime_type,size_bytes) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,'local',$8,$9,$10)")
        .bind(&file_id).bind(&id).bind(quote).bind(update).bind(actor.company.as_deref()).bind(&actor.user)
        .bind(name).bind(&key).bind(mime).bind(body.len() as i64).execute(&app.db).await;
    if let Err(error) = saved {
        let _ = tokio::fs::remove_file(&file).await;
        return Err(error.into());
    }
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":file_id,"name":name,"mime":mime})),
    ))
}
async fn download_file(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Response> {
    let actor = company_actor(&app, &headers, false).await?;
    checked_id(&file_id)?;
    let row = sqlx::query("SELECT f.job_id::text AS job_id,f.quote_id::text AS quote_id,f.update_id::text AS update_id,f.original_name,f.mime_type,f.storage_key,q.provider_company_id::text AS provider FROM job_files f LEFT JOIN job_quotes q ON q.id=f.quote_id WHERE f.id=$1::uuid")
        .bind(&file_id).fetch_optional(&app.db).await?.ok_or_else(not_found)?;
    let job_id: String = row.get("job_id");
    let a = job_access(&app, &job_id, actor.company.as_deref()).await?;
    let provider: Option<String> = row.get("provider");
    if provider.is_some() && !a.hirer && provider.as_deref() != actor.company.as_deref() {
        return Err(not_found());
    }
    if row.get::<Option<String>, _>("update_id").is_some() && !a.hirer && !a.chosen {
        return Err(not_found());
    }
    let key: String = row.get("storage_key");
    if !key.starts_with(&format!("jobs/{job_id}/")) || key.contains("..") {
        return Err(not_found());
    }
    let data = tokio::fs::read(app.uploads.join(&key))
        .await
        .map_err(|_| not_found())?;
    let mime: String = row.get("mime_type");
    let name: String = row.get("original_name");
    let safe_name = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || " ._-".contains(*c))
        .collect::<String>();
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (
                header::CONTENT_DISPOSITION,
                format!(
                    "{}; filename=\"{}\"",
                    if query.get("preview").is_some_and(|v| v == "1") {
                        "inline"
                    } else {
                        "attachment"
                    },
                    safe_name
                ),
            ),
        ],
        data,
    )
        .into_response())
}

async fn invite_companies(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    if !a.hirer || a.status() != "open" {
        return Err(conflict("This job is not accepting invitations."));
    }
    let ids = body["companyIds"]
        .as_array()
        .ok_or_else(|| bad("Choose companies to invite."))?;
    if ids.is_empty() || ids.len() > 20 {
        return Err(bad("Choose up to 20 companies."));
    }
    for value in ids {
        let provider = value.as_str().ok_or_else(|| bad("Invalid company."))?;
        checked_id(provider)?;
        if provider == actor.company.as_deref().unwrap() {
            continue;
        }
        let result = sqlx::query("INSERT INTO job_invitations(job_id,provider_company_id,invited_by) SELECT $1::uuid,p.id,$3::uuid FROM companies p WHERE p.id=$2::uuid AND p.listing_status='managed' ON CONFLICT DO NOTHING")
            .bind(&id).bind(provider).bind(&actor.user).execute(&app.db).await?;
        if result.rows_affected() == 0 {
            continue;
        }
        notify(
            &app,
            provider,
            &actor,
            &format!("job-invite:{id}:{provider}"),
            "You're invited to quote",
            a.job["title"].as_str().unwrap_or("A job"),
            &id,
        )
        .await?;
    }
    Ok(Json(json!({"ok":true})))
}

async fn job_inbox(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let page = query
        .get("page")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(1)
        .clamp(1, 1000);
    let search = query
        .get("q")
        .map(|v| v.chars().take(160).collect::<String>())
        .unwrap_or_default();
    let sql = format!(
        r#"
        WITH threads AS (
          SELECT job_id,provider_company_id FROM job_messages WHERE provider_company_id=$1::uuid OR job_id IN (SELECT id FROM jobs WHERE hiring_company_id=$1::uuid)
          UNION SELECT job_id,provider_company_id FROM job_quotes WHERE provider_company_id=$1::uuid OR job_id IN (SELECT id FROM jobs WHERE hiring_company_id=$1::uuid)
          UNION SELECT job_id,provider_company_id FROM job_invitations WHERE provider_company_id=$1::uuid OR job_id IN (SELECT id FROM jobs WHERE hiring_company_id=$1::uuid)
        )
        SELECT json_build_object('job_id',j.id,'title',j.title,'status',j.status,
          'provider_id',t.provider_company_id,'company',{},'body',m.body,
          'sender_company_id',m.sender_company_id,'unread_count',unread.total,
          'updated_at',COALESCE(m.created_at,j.updated_at))::text
        FROM threads t JOIN jobs j ON j.id=t.job_id
        JOIN companies c ON c.id=CASE WHEN j.hiring_company_id=$1::uuid THEN t.provider_company_id ELSE j.hiring_company_id END
        LEFT JOIN LATERAL (SELECT body,created_at,sender_company_id FROM job_messages WHERE job_id=j.id AND provider_company_id=t.provider_company_id ORDER BY created_at DESC,id DESC LIMIT 1) m ON true
        LEFT JOIN job_message_reads r ON r.job_id=j.id AND r.provider_company_id=t.provider_company_id AND r.company_id=$1::uuid AND r.user_id=$4::uuid
        CROSS JOIN LATERAL (SELECT count(*) AS total FROM job_messages um WHERE um.job_id=j.id AND um.provider_company_id=t.provider_company_id AND um.sender_company_id<>$1::uuid AND (r.user_id IS NULL OR (um.created_at,um.id)>(r.last_read_at,r.last_read_message_id))) unread
        WHERE (j.hiring_company_id=$1::uuid OR t.provider_company_id=$1::uuid)
          AND (j.title ILIKE $2 OR c.name ILIKE $2)
          AND (NOT $5::boolean OR unread.total>0)
        ORDER BY COALESCE(m.created_at,j.updated_at) DESC,j.id,t.provider_company_id
        LIMIT 51 OFFSET $3
    "#,
        company_json()
    );
    let rows: Vec<String> = sqlx::query_scalar(&sql)
        .bind(actor.company.as_deref())
        .bind(format!("%{}%", search))
        .bind((page - 1) * 50)
        .bind(&actor.user)
        .bind(query.get("unread").is_some_and(|v| v == "true"))
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"hasMore":rows.len()>50,"page":page,"threads":rows.into_iter().take(50).map(parse_json).collect::<Result<Vec<_>>>()?}),
    ))
}

async fn job_activity(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, false).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    a.participant()?;
    let kind = required_text(&body, "kind", 1, 30)?;
    if !["update_requested", "problem"].contains(&kind) {
        return Err(bad("Choose a valid job action."));
    }
    if kind == "update_requested" && (!a.hirer || a.status() != "in_progress") {
        return Err(forbidden());
    }
    if !["awarded", "in_progress", "review", "completed"].contains(&a.status()) {
        return Err(conflict("Choose a company before using this action."));
    }
    let text = if kind == "update_requested" {
        "Please share an update on the work and expected completion."
    } else {
        required_text(&body, "body", 10, 5000)?
    };
    let mut tx = app.db.begin().await?;
    let current: String =
        sqlx::query_scalar("SELECT status FROM jobs WHERE id=$1::uuid FOR UPDATE")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    if current != a.status() {
        return Err(conflict("This job has changed. Refresh it and try again."));
    }
    let recent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_updates WHERE job_id=$1::uuid AND company_id=$2::uuid AND kind=$3 AND created_at>now()-interval '1 minute')")
        .bind(&id).bind(actor.company.as_deref()).bind(kind).fetch_one(&mut *tx).await?;
    if recent {
        return Err(conflict(
            "Already sent. Give the other company a moment to respond.",
        ));
    }
    let update_id: String = sqlx::query_scalar("INSERT INTO job_updates(job_id,company_id,author_id,kind,body) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5) RETURNING id::text")
        .bind(&id).bind(actor.company.as_deref()).bind(&actor.user).bind(kind).bind(text).fetch_one(&mut *tx).await?;
    let target = if a.hirer {
        selected_provider(&app, &id).await?
    } else {
        a.hirer_id().to_owned()
    };
    sqlx::query("SELECT connect_notify($1::uuid,NULL,$2::uuid,$3::uuid,$4,'job','requests',$5,$6,$7,'job',$8::uuid)")
        .bind(&target).bind(actor.company.as_deref()).bind(&actor.user).bind(format!("job-activity:{update_id}"))
        .bind(if kind == "problem" { "Problem reported on a job" } else { "Job update requested" })
        .bind(text).bind(format!("/jobs/{id}")).bind(&id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"id":update_id}))))
}

async fn message_provider(
    app: &App,
    a: &JobAccess,
    actor: &Actor,
    requested: Option<&str>,
) -> Result<String> {
    let own = actor.company.as_deref().unwrap();
    let provider = if a.hirer {
        requested.ok_or_else(|| bad("Choose a company."))?
    } else {
        own
    };
    checked_id(provider)?;
    if !a.hirer && requested.is_some_and(|v| v != own) {
        return Err(forbidden());
    }
    if a.hirer {
        let known: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_quotes WHERE job_id=$1::uuid AND provider_company_id=$2::uuid UNION SELECT 1 FROM job_invitations WHERE job_id=$1::uuid AND provider_company_id=$2::uuid UNION SELECT 1 FROM job_messages WHERE job_id=$1::uuid AND provider_company_id=$2::uuid)")
            .bind(a.job["id"].as_str()).bind(provider).fetch_one(&app.db).await?;
        if !known {
            return Err(not_found());
        }
    }
    Ok(provider.to_owned())
}

async fn quote_messages(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    let provider = message_provider(
        &app,
        &a,
        &actor,
        query.get("providerId").map(String::as_str),
    )
    .await?;
    let after = query.get("after");
    let before = query.get("before");
    if after.is_some() && before.is_some() {
        return Err(bad("Choose one message cursor."));
    }
    let cursor = after.or(before);
    if let Some(cursor) = cursor {
        checked_id(cursor)?;
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_messages WHERE id=$1::uuid AND job_id=$2::uuid AND provider_company_id=$3::uuid)")
            .bind(cursor).bind(&id).bind(&provider).fetch_one(&app.db).await?;
        if !exists {
            return Err(not_found());
        }
    }
    let comparison = if after.is_some() { ">" } else { "<" };
    let order = if after.is_some() { "ASC" } else { "DESC" };
    let sql = format!("SELECT (to_jsonb(m)||jsonb_build_object('sender_name',c.name,'author_name',u.name))::text FROM job_messages m JOIN companies c ON c.id=m.sender_company_id JOIN users u ON u.id=m.author_id WHERE m.job_id=$1::uuid AND m.provider_company_id=$2::uuid AND ($3::uuid IS NULL OR (m.created_at,m.id) {comparison} (SELECT created_at,id FROM job_messages WHERE id=$3::uuid)) ORDER BY m.created_at {order},m.id {order} LIMIT 51");
    let mut rows: Vec<String> = sqlx::query_scalar(&sql)
        .bind(&id)
        .bind(&provider)
        .bind(cursor)
        .fetch_all(&app.db)
        .await?;
    let more = rows.len() > 50;
    rows.truncate(50);
    if after.is_none() {
        rows.reverse();
    }
    Ok(Json(
        json!({"messages":rows.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?,"hasOlder":after.is_none() && more,"hasNewer":after.is_some() && more}),
    ))
}

async fn read_messages(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    let provider = message_provider(&app, &a, &actor, body["providerId"].as_str()).await?;
    let message = checked_id(required_text(&body, "messageId", 36, 36)?)?;
    let mut tx = app.db.begin().await?;
    let changed = sqlx::query("INSERT INTO job_message_reads(user_id,company_id,job_id,provider_company_id,last_read_at,last_read_message_id) SELECT $1::uuid,$2::uuid,job_id,provider_company_id,created_at,id FROM job_messages WHERE id=$3::uuid AND job_id=$4::uuid AND provider_company_id=$5::uuid ON CONFLICT(user_id,company_id,job_id,provider_company_id) DO UPDATE SET last_read_at=EXCLUDED.last_read_at,last_read_message_id=EXCLUDED.last_read_message_id WHERE (EXCLUDED.last_read_at,EXCLUDED.last_read_message_id)>(job_message_reads.last_read_at,job_message_reads.last_read_message_id)")
        .bind(&actor.user).bind(actor.company.as_deref()).bind(message).bind(&id).bind(&provider).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_messages WHERE id=$1::uuid AND job_id=$2::uuid AND provider_company_id=$3::uuid)")
            .bind(message).bind(&id).bind(&provider).fetch_one(&mut *tx).await?;
        if !exists {
            return Err(not_found());
        }
    }
    let notification_ids: Vec<String> = sqlx::query_scalar("UPDATE user_notifications n SET read_at=COALESCE(n.read_at,now()) WHERE n.user_id=$1::uuid AND n.company_id=$2::uuid AND n.read_at IS NULL AND n.event_key IN (SELECT 'job-message:'||m.id::text FROM job_messages m JOIN job_message_reads r ON r.user_id=$1::uuid AND r.company_id=$2::uuid AND r.job_id=m.job_id AND r.provider_company_id=m.provider_company_id WHERE m.job_id=$3::uuid AND m.provider_company_id=$4::uuid AND (m.created_at,m.id)<=(r.last_read_at,r.last_read_message_id)) RETURNING n.id::text")
        .bind(&actor.user).bind(actor.company.as_deref()).bind(&id).bind(&provider).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true,"notificationIds":notification_ids})))
}

async fn send_message(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, false).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    if a.status() != "open" && !a.hirer && !a.chosen {
        return Err(forbidden());
    }
    let text = required_text(&body, "body", 1, 5000)?;
    let provider = message_provider(&app, &a, &actor, body["providerId"].as_str()).await?;
    let client = body
        .get("clientId")
        .map(|v| checked_id(v.as_str().unwrap_or("")))
        .transpose()?;
    let mut tx = app.db.begin().await?;
    let inserted: Option<String> = sqlx::query_scalar("INSERT INTO job_messages(job_id,provider_company_id,sender_company_id,author_id,body,client_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid) ON CONFLICT(author_id,sender_company_id,client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id::text")
        .bind(&id).bind(&provider).bind(actor.company.as_deref()).bind(&actor.user).bind(text).bind(client).fetch_optional(&mut *tx).await?;
    let duplicate = inserted.is_none();
    let message_id = match inserted {
        Some(value) => value,
        None => sqlx::query_scalar::<_,String>("SELECT id::text FROM job_messages WHERE author_id=$1::uuid AND sender_company_id=$2::uuid AND client_id=$3::uuid AND job_id=$4::uuid AND provider_company_id=$5::uuid AND body=$6")
            .bind(&actor.user).bind(actor.company.as_deref()).bind(client).bind(&id).bind(&provider).bind(text).fetch_optional(&mut *tx).await?.ok_or_else(|| conflict("This send was already used for a different message."))?,
    };
    if !duplicate {
        let target = if a.hirer { &provider } else { a.hirer_id() };
        sqlx::query("SELECT connect_notify($1::uuid,NULL,$2::uuid,$3::uuid,$4,'job','messages',$5,$6,$7,'job',$8::uuid)")
            .bind(target).bind(actor.company.as_deref()).bind(&actor.user).bind(format!("job-message:{message_id}"))
            .bind("New job message").bind(text).bind(format!("/jobs/inbox?job={id}&provider={provider}")).bind(&id).execute(&mut *tx).await?;
    }
    let raw: String = sqlx::query_scalar("SELECT (to_jsonb(m)||jsonb_build_object('sender_name',c.name,'author_name',u.name))::text FROM job_messages m JOIN companies c ON c.id=m.sender_company_id JOIN users u ON u.id=m.author_id WHERE m.id=$1::uuid")
        .bind(&message_id).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        if duplicate {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        },
        Json(json!({"id":message_id,"message":parse_json(raw)?,"duplicate":duplicate})),
    ))
}

async fn set_payment_stages(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    if !a.hirer || !["awarded", "in_progress"].contains(&a.status()) {
        return Err(conflict(
            "Choose a company before agreeing on payment stages.",
        ));
    }
    let stages = body["stages"]
        .as_array()
        .ok_or_else(|| bad("Add payment stages."))?;
    if stages.is_empty() || stages.len() > 8 {
        return Err(bad("Add up to 8 payment stages."));
    }
    let mut total = 0_i64;
    for stage in stages {
        required_text(stage, "title", 2, 120)?;
        let amount = stage["amountCents"]
            .as_i64()
            .ok_or_else(|| bad("Enter each stage amount."))?;
        if amount <= 0 {
            return Err(bad("Enter a valid stage amount."));
        }
        total = total
            .checked_add(amount)
            .ok_or_else(|| bad("Payment total is too large."))?;
    }
    let expected: i64 = sqlx::query_scalar("SELECT amount_cents FROM job_quotes WHERE id=$1::uuid")
        .bind(a.job["chosen_quote_id"].as_str())
        .fetch_one(&app.db)
        .await?;
    if total != expected {
        return Err(bad("Payment stages must add up to the chosen quote."));
    }
    let mut tx = app.db.begin().await?;
    let changed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_payment_stages WHERE job_id=$1::uuid AND status<>'planned')")
        .bind(&id).fetch_one(&mut *tx).await?;
    if changed {
        return Err(conflict(
            "A payment stage has already started and cannot be replaced.",
        ));
    }
    sqlx::query("DELETE FROM job_payment_stages WHERE job_id=$1::uuid")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    for (index, stage) in stages.iter().enumerate() {
        sqlx::query("INSERT INTO job_payment_stages(job_id,title,amount_cents,sort_order) VALUES($1::uuid,$2,$3,$4)")
            .bind(&id).bind(stage["title"].as_str()).bind(stage["amountCents"].as_i64()).bind(index as i32).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}
async fn advance_payment(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((job_id, stage_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    let a = job_access(&app, &job_id, actor.company.as_deref()).await?;
    a.participant()?;
    checked_id(&stage_id)?;
    let next = required_text(&body, "status", 1, 30)?;
    let reference = optional_text(&body, "invoiceReference", 200)?;
    let (old, new) = match next {
        "invoiced" if a.chosen => ("planned", "invoiced"),
        "reported_paid" if a.hirer => ("invoiced", "reported_paid"),
        "confirmed_received" if a.chosen => ("reported_paid", "confirmed_received"),
        _ => return Err(forbidden()),
    };
    let affected = sqlx::query("UPDATE job_payment_stages SET status=$1,invoice_reference=CASE WHEN $1='invoiced' THEN $2 ELSE invoice_reference END,updated_at=now() WHERE id=$3::uuid AND job_id=$4::uuid AND status=$5")
        .bind(new).bind(reference).bind(&stage_id).bind(&job_id).bind(old).execute(&app.db).await?.rows_affected();
    if affected == 0 {
        return Err(conflict("Payment status changed. Refresh and try again."));
    }
    let target = if a.hirer {
        selected_provider(&app, &job_id).await?
    } else {
        a.hirer_id().to_owned()
    };
    notify(
        &app,
        &target,
        &actor,
        &format!("job-payment:{stage_id}:{new}"),
        "Payment update",
        new,
        &job_id,
    )
    .await?;
    Ok(Json(json!({"ok":true})))
}

// A concise, typed brief supplements the free-form scope without inventing missing facts.
struct Brief<'a> {
    project: &'a str,
    size: Option<f64>,
    sites: Option<i64>,
    materials: &'a str,
    requirements: &'a str,
    people: Option<i64>,
    duration: &'a str,
    arrangement: &'a str,
}
fn parse_brief(body: &Value) -> Result<Brief<'_>> {
    let project = optional_text(body, "projectType", 30)?;
    if !["", "residential", "commercial", "utility", "mixed"].contains(&project) {
        return Err(bad("Choose a valid project type."));
    }
    let size = match body.get("systemSizeKw").filter(|v| !v.is_null()) {
        Some(v) => Some(
            v.as_f64()
                .filter(|v| v.is_finite() && *v > 0. && *v <= 100_000_000.)
                .ok_or_else(|| bad("System size must be greater than zero."))?,
        ),
        None => None,
    };
    let sites = match body.get("siteCount").filter(|v| !v.is_null()) {
        Some(v) => Some(
            v.as_i64()
                .filter(|v| (1..=100_000).contains(v))
                .ok_or_else(|| bad("Enter a valid number of sites."))?,
        ),
        None => None,
    };
    let materials = body["materialsBy"].as_str().unwrap_or("to_agree");
    if !["to_agree", "hiring_company", "provider"].contains(&materials) {
        return Err(bad("Choose who supplies materials."));
    }
    let people = match body.get("peopleNeeded").filter(|v| !v.is_null()) {
        Some(v) => Some(
            v.as_i64()
                .filter(|v| (1..=1000).contains(v))
                .ok_or_else(|| bad("Enter a team size between 1 and 1,000."))?,
        ),
        None => None,
    };
    let arrangement = body["workArrangement"].as_str().unwrap_or("onsite");
    if !["onsite", "remote", "hybrid"].contains(&arrangement) {
        return Err(bad("Choose on site, remote, or hybrid work."));
    }
    Ok(Brief {
        project,
        size,
        sites,
        materials,
        requirements: optional_text(body, "requirements", 3000)?,
        people,
        duration: optional_text(body, "expectedDuration", 120)?,
        arrangement,
    })
}
fn parse_breakdown(body: &Value, amount: i64) -> Result<Value> {
    let empty = vec![];
    let items = match body.get("priceBreakdown") {
        None => &empty,
        Some(v) => v
            .as_array()
            .ok_or_else(|| bad("Invalid price breakdown."))?,
    };
    if items.len() > 20 {
        return Err(bad("Use no more than 20 price items."));
    }
    let mut sum = 0i64;
    let mut result = vec![];
    for item in items {
        let label = required_text(item, "label", 1, 160)?;
        let cents = item["amountCents"]
            .as_i64()
            .filter(|n| (1..=100_000_000_000).contains(n))
            .ok_or_else(|| bad("Each price item needs a positive amount."))?;
        sum = sum
            .checked_add(cents)
            .ok_or_else(|| bad("Invalid price total."))?;
        result.push(json!({"label":label,"amountCents":cents}));
    }
    if !items.is_empty() && sum != amount {
        return Err(bad("Price items must add up to your quote total."));
    }
    Ok(json!(result))
}

async fn create_job(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let a = company_actor(&app, &headers, true).await?;
    let status = body["status"].as_str().unwrap_or("open");
    if !["open", "draft"].contains(&status) {
        return Err(bad("Invalid job status."));
    }
    let title = if status == "draft" {
        optional_text(&body, "title", 160)?
    } else {
        required_text(&body, "title", 8, 160)?
    };
    let description = if status == "draft" {
        optional_text(&body, "description", 10000)?
    } else {
        required_text(&body, "description", 20, 10000)?
    };
    let trade = required_text(&body, "trade", 1, 40)?;
    if ![
        "crew",
        "installation",
        "electrical",
        "roofing",
        "service",
        "design",
        "permitting",
        "inspection",
        "equipment",
        "logistics",
        "other",
    ]
    .contains(&trade)
    {
        return Err(bad("Choose a type of work."));
    }
    let location = if status == "draft" {
        optional_text(&body, "location", 160)?
    } else {
        required_text(&body, "location", 2, 160)?
    };
    let postal = optional_text(&body, "postalCode", 20)?;
    let exact = optional_text(&body, "exactAddress", 300)?;
    let start = optional_text(&body, "startWindow", 120)?;
    let visibility = body["visibility"].as_str().unwrap_or("open");
    if !["open", "invite_only"].contains(&visibility) {
        return Err(bad("Choose who can see this job."));
    }
    let budget = body["budgetCents"].as_i64();
    if budget.is_some_and(|v| v < 0 || v > 100_000_000_000) {
        return Err(bad("Invalid budget."));
    }
    let deadline = optional_text(&body, "quoteDeadline", 50)?;
    let brief = parse_brief(&body)?;
    let new_id: String = sqlx::query_scalar(
        "INSERT INTO jobs(hiring_company_id,author_id,title,description,trade,location,postal_code,exact_address,\
         start_window,budget_cents,visibility,quote_deadline,status,project_type,system_size_kw,site_count,materials_by,requirements,people_needed,expected_duration,work_arrangement) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULLIF($12,'')::timestamptz,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id::text")
        .bind(a.company.as_deref()).bind(&a.user).bind(title).bind(description).bind(trade).bind(location)
        .bind(postal).bind(exact).bind(start).bind(budget).bind(visibility).bind(deadline).bind(status)
        .bind(brief.project).bind(brief.size).bind(brief.sites).bind(brief.materials).bind(brief.requirements)
        .bind(brief.people).bind(brief.duration).bind(brief.arrangement)
        .fetch_one(&app.db).await?;
    Ok((StatusCode::CREATED, Json(json!({"id":new_id}))))
}

async fn edit_job(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    let status = body["status"].as_str().unwrap_or("open");
    if !["open", "draft"].contains(&status) {
        return Err(bad("Invalid job status."));
    }
    let title = if status == "draft" {
        optional_text(&body, "title", 160)?
    } else {
        required_text(&body, "title", 8, 160)?
    };
    let description = if status == "draft" {
        optional_text(&body, "description", 10000)?
    } else {
        required_text(&body, "description", 20, 10000)?
    };
    let trade = required_text(&body, "trade", 1, 40)?;
    if ![
        "crew",
        "installation",
        "electrical",
        "roofing",
        "service",
        "design",
        "permitting",
        "inspection",
        "equipment",
        "logistics",
        "other",
    ]
    .contains(&trade)
    {
        return Err(bad("Choose a type of work."));
    }
    let location = if status == "draft" {
        optional_text(&body, "location", 160)?
    } else {
        required_text(&body, "location", 2, 160)?
    };
    let postal = optional_text(&body, "postalCode", 20)?;
    let exact = optional_text(&body, "exactAddress", 300)?;
    let start = optional_text(&body, "startWindow", 120)?;
    let visibility = body["visibility"].as_str().unwrap_or("open");
    if !["open", "invite_only"].contains(&visibility) {
        return Err(bad("Choose who can see this job."));
    }
    let budget = body["budgetCents"].as_i64();
    if budget.is_some_and(|v| v < 0 || v > 100_000_000_000) {
        return Err(bad("Invalid budget."));
    }
    let deadline = optional_text(&body, "quoteDeadline", 50)?;
    let brief = parse_brief(&body)?;
    let mut tx = app.db.begin().await?;
    let row = sqlx::query(
        "SELECT hiring_company_id::text AS hirer,status FROM jobs WHERE id=$1::uuid FOR UPDATE",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    if row.get::<String, _>("hirer") != actor.company.as_deref().unwrap() {
        return Err(forbidden());
    }
    if !["draft", "open"].contains(&row.get::<String, _>("status").as_str()) {
        return Err(conflict("This job can no longer be edited."));
    }
    let has_quotes: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_quotes WHERE job_id=$1::uuid)")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    if has_quotes {
        return Err(conflict(
            "Quotes have arrived. This job can no longer be edited.",
        ));
    }
    sqlx::query("UPDATE jobs SET title=$1,description=$2,trade=$3,location=$4,postal_code=$5,exact_address=$6,start_window=$7,budget_cents=$8,visibility=$9,quote_deadline=NULLIF($10,'')::timestamptz,status=$11,project_type=$13,system_size_kw=$14,site_count=$15,materials_by=$16,requirements=$17,people_needed=$18,expected_duration=$19,work_arrangement=$20,updated_at=now() WHERE id=$12::uuid")
        .bind(title).bind(description).bind(trade).bind(location).bind(postal).bind(exact).bind(start).bind(budget)
        .bind(visibility).bind(deadline).bind(status).bind(&id)
        .bind(brief.project).bind(brief.size).bind(brief.sites).bind(brief.materials).bind(brief.requirements)
        .bind(brief.people).bind(brief.duration).bind(brief.arrangement).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}

async fn send_quote(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    let company = actor.company.as_deref().unwrap();
    checked_id(&id)?;
    let amount = body["amountCents"]
        .as_i64()
        .ok_or_else(|| bad("Enter your quote amount."))?;
    if !(1..=100_000_000_000).contains(&amount) {
        return Err(bad("Enter a valid quote amount."));
    }
    let note = required_text(&body, "note", 10, 5000)?;
    let start = optional_text(&body, "startWindow", 120)?;
    let duration = optional_text(&body, "duration", 120)?;
    let included = optional_text(&body, "included", 5000)?;
    let excluded = optional_text(&body, "excluded", 5000)?;
    let payment = optional_text(&body, "paymentTerms", 2000)?;
    let breakdown = parse_breakdown(&body, amount)?;
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT j.hiring_company_id::text AS hirer,j.title,j.status,j.visibility,COALESCE(j.quote_deadline<now(),false) AS expired FROM jobs j WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let hirer: String = job.get("hirer");
    if hirer == company {
        return Err(forbidden());
    }
    let expired: bool = job.get("expired");
    if job.get::<String, _>("status") != "open" || expired {
        return Err(conflict("This job is no longer accepting quotes."));
    }
    if job.get::<String, _>("visibility") == "invite_only" {
        let invited: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_invitations WHERE job_id=$1::uuid AND provider_company_id=$2::uuid AND status='pending')")
            .bind(&id).bind(company).fetch_one(&mut *tx).await?;
        if !invited {
            return Err(forbidden());
        }
    }
    let quote_id: Option<String> = sqlx::query_scalar(
        "INSERT INTO job_quotes(job_id,provider_company_id,author_id,amount_cents,start_window,duration,note,included,excluded,payment_terms,price_breakdown)\
         VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)\
         ON CONFLICT(job_id,provider_company_id) DO UPDATE SET amount_cents=$4,start_window=$5,duration=$6,note=$7,\
         included=$8,excluded=$9,payment_terms=$10,price_breakdown=$11::jsonb,status='submitted',updated_at=now()\
         WHERE job_quotes.status IN ('submitted','withdrawn') RETURNING id::text")
        .bind(&id).bind(company).bind(&actor.user).bind(amount).bind(start).bind(duration).bind(note)
        .bind(included).bind(excluded).bind(payment).bind(breakdown.to_string()).fetch_optional(&mut *tx).await?;
    let quote_id = quote_id.ok_or_else(|| conflict("This quote can no longer be changed."))?;
    sqlx::query("UPDATE jobs SET updated_at=now() WHERE id=$1::uuid")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    notify(
        &app,
        &hirer,
        &actor,
        &format!("job-quote:{quote_id}:{}", chrono_stamp()),
        "New quote received",
        &job.get::<String, _>("title"),
        &id,
    )
    .await?;
    Ok(Json(json!({"id":quote_id})))
}

fn chrono_stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

async fn choose_company(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    let qid = required_text(&body, "quoteId", 36, 36)?;
    checked_id(qid)?;
    checked_id(&id)?;
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT hiring_company_id::text AS hirer,title,status FROM jobs WHERE id=$1::uuid FOR UPDATE")
        .bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if job.get::<String, _>("hirer") != actor.company.as_deref().unwrap() {
        return Err(forbidden());
    }
    if job.get::<String, _>("status") != "open" {
        return Err(conflict("This job cannot choose a company."));
    }
    let provider: String = sqlx::query_scalar("SELECT provider_company_id::text FROM job_quotes WHERE id=$1::uuid AND job_id=$2::uuid AND status='submitted'")
        .bind(qid).bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    sqlx::query("UPDATE jobs SET status='awarded',chosen_quote_id=$1::uuid,updated_at=now() WHERE id=$2::uuid")
        .bind(qid).bind(&id).execute(&mut *tx).await?;
    sqlx::query("UPDATE job_quotes SET status=CASE WHEN id=$1::uuid THEN 'chosen' ELSE 'not_chosen' END,updated_at=now() WHERE job_id=$2::uuid AND status='submitted'")
        .bind(qid).bind(&id).execute(&mut *tx).await?;
    tx.commit().await?;
    notify(
        &app,
        &provider,
        &actor,
        &format!("job-chosen:{id}"),
        "Your quote was chosen",
        &job.get::<String, _>("title"),
        &id,
    )
    .await?;
    Ok(Json(json!({"ok":true})))
}

async fn confirm_job(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    let row = sqlx::query("UPDATE jobs j SET status='in_progress',updated_at=now() FROM job_quotes q WHERE j.id=$1::uuid AND j.status='awarded' AND q.id=j.chosen_quote_id AND q.provider_company_id=$2::uuid RETURNING j.hiring_company_id::text AS hirer,j.title")
        .bind(&id).bind(actor.company.as_deref()).fetch_optional(&app.db).await?.ok_or_else(|| conflict("This job is not awaiting your confirmation."))?;
    notify(
        &app,
        &row.get::<String, _>("hirer"),
        &actor,
        &format!("job-confirmed:{id}"),
        "Work confirmed",
        &row.get::<String, _>("title"),
        &id,
    )
    .await?;
    Ok(Json(json!({"ok":true})))
}

async fn add_update(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, false).await?;
    let kind = required_text(&body, "kind", 1, 30)?;
    if !["progress", "completion"].contains(&kind) {
        return Err(bad("Choose an update type."));
    }
    let text = required_text(&body, "body", 1, 5000)?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    a.participant()?;
    if a.status() != "in_progress" {
        return Err(conflict("This job is not in progress."));
    }
    if kind == "completion" && !a.chosen {
        return Err(forbidden());
    }
    let mut tx = app.db.begin().await?;
    let status: String = sqlx::query_scalar("SELECT status FROM jobs WHERE id=$1::uuid FOR UPDATE")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if status != "in_progress" {
        return Err(conflict("This job has changed. Refresh it and try again."));
    }
    let update_id: String = sqlx::query_scalar("INSERT INTO job_updates(job_id,company_id,author_id,kind,body) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5) RETURNING id::text")
        .bind(&id).bind(actor.company.as_deref()).bind(&actor.user).bind(kind).bind(text).fetch_one(&mut *tx).await?;
    if kind == "completion" {
        sqlx::query("UPDATE jobs SET status='review',updated_at=now() WHERE id=$1::uuid")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    let target = if a.hirer {
        selected_provider(&app, &id).await?
    } else {
        a.hirer_id().to_owned()
    };
    notify(
        &app,
        &target,
        &actor,
        &format!("job-update:{update_id}"),
        if kind == "completion" {
            "Work ready for review"
        } else {
            "New job update"
        },
        text,
        &id,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(json!({"id":update_id}))))
}
async fn selected_provider(app: &App, id: &str) -> Result<String> {
    sqlx::query_scalar("SELECT q.provider_company_id::text FROM jobs j JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid")
        .bind(id).fetch_optional(&app.db).await?.ok_or_else(not_found)
}

async fn review_work(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    let decision = required_text(&body, "decision", 1, 30)?;
    if !["accept", "changes"].contains(&decision) {
        return Err(bad("Choose a decision."));
    }
    let note = optional_text(&body, "note", 5000)?;
    if decision == "changes" && note.is_empty() {
        return Err(bad("Tell the company what needs to change."));
    }
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    if !a.hirer || a.status() != "review" {
        return Err(conflict("This work is not ready for review."));
    }
    let mut tx = app.db.begin().await?;
    let current: String =
        sqlx::query_scalar("SELECT status FROM jobs WHERE id=$1::uuid FOR UPDATE")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await?;
    if current != "review" {
        return Err(conflict("This job has changed. Refresh it and try again."));
    }
    sqlx::query("UPDATE jobs SET status=$1,updated_at=now() WHERE id=$2::uuid")
        .bind(if decision == "accept" {
            "completed"
        } else {
            "in_progress"
        })
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if !note.is_empty() {
        sqlx::query("INSERT INTO job_updates(job_id,company_id,author_id,kind,body) VALUES($1::uuid,$2::uuid,$3::uuid,'changes_requested',$4)")
            .bind(&id).bind(actor.company.as_deref()).bind(&actor.user).bind(note).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    let provider = selected_provider(&app, &id).await?;
    notify(
        &app,
        &provider,
        &actor,
        &format!("job-review:{id}:{}", chrono_stamp()),
        if decision == "accept" {
            "Job finished"
        } else {
            "Changes requested"
        },
        if note.is_empty() {
            "The work was accepted."
        } else {
            note
        },
        &id,
    )
    .await?;
    Ok(Json(json!({"ok":true})))
}

async fn review_company(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, true).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    a.participant()?;
    if a.status() != "completed" {
        return Err(conflict("Reviews open after the job is finished."));
    }
    let rating = body["rating"].as_i64().unwrap_or(0);
    if !(1..=5).contains(&rating) {
        return Err(bad("Choose a rating from 1 to 5."));
    }
    let text = optional_text(&body, "text", 3000)?;
    let reviewed = if a.hirer {
        selected_provider(&app, &id).await?
    } else {
        a.hirer_id().to_owned()
    };
    let result = sqlx::query("INSERT INTO job_reviews(job_id,reviewer_company_id,reviewed_company_id,rating,text) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5) ON CONFLICT(job_id,reviewer_company_id) DO NOTHING")
        .bind(&id).bind(actor.company.as_deref()).bind(&reviewed).bind(rating as i32).bind(text).execute(&app.db).await?;
    if result.rows_affected() == 0 {
        return Err(conflict("You have already reviewed this job."));
    }
    Ok((StatusCode::CREATED, Json(json!({"ok":true}))))
}

async fn health(State(app): State<Arc<App>>) -> Result<Json<Value>> {
    sqlx::query("SELECT 1").execute(&app.db).await?;
    Ok(Json(json!({"status":"ok"})))
}

async fn work_profile(
    State(app): State<Arc<App>>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    if slug.len() > 100 || slug.is_empty() {
        return Err(not_found());
    }
    let id: String =
        sqlx::query_scalar("SELECT id::text FROM companies WHERE slug=$1 OR username=$1 LIMIT 1")
            .bind(&slug)
            .fetch_optional(&app.db)
            .await?
            .ok_or_else(not_found)?;
    let row = sqlx::query("SELECT COUNT(*)::bigint AS review_count,COALESCE(ROUND(AVG(rating)::numeric,1),0)::float8 AS rating FROM job_reviews WHERE reviewed_company_id=$1::uuid")
        .bind(&id).fetch_one(&app.db).await?;
    let completed: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs j JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.status='completed' AND q.provider_company_id=$1::uuid")
        .bind(&id).fetch_one(&app.db).await?;
    let rows: Vec<String> = sqlx::query_scalar("SELECT json_build_object('id',r.id,'rating',r.rating,'text',r.text,'created_at',r.created_at,'reviewer',c.name)::text FROM job_reviews r JOIN companies c ON c.id=r.reviewer_company_id WHERE r.reviewed_company_id=$1::uuid ORDER BY r.created_at DESC LIMIT 5")
        .bind(&id).fetch_all(&app.db).await?;
    Ok(Json(
        json!({"rating":row.get::<f64,_>("rating"),"reviewCount":row.get::<i64,_>("review_count"),"completedJobs":completed,"reviews":rows.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?}),
    ))
}

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let database_url = std::env::var("DATABASE_URL")?;
    let pool = PgPool::connect(&database_url).await?;
    let uploads =
        PathBuf::from(std::env::var("JOBS_UPLOAD_DIR").unwrap_or_else(|_| "uploads".into()));
    let app = Arc::new(App { db: pool, uploads });
    let routes = Router::new()
        .route("/health", get(health))
        .route("/jobs", get(list_jobs).post(create_job))
        .route("/jobs/provider-taxonomy", get(provider_matching::taxonomy))
        .route("/jobs/provider-matches", post(provider_matching::preview))
        .route(
            "/jobs/providers/me/availability",
            axum::routing::put(provider_matching::update_availability),
        )
        .route("/jobs/providers", get(list_providers))
        .route("/jobs/providers/me", axum::routing::patch(update_provider))
        .route("/jobs/providers/{slug}", get(provider_detail))
        .route("/jobs/mine", get(my_jobs))
        .route("/jobs/inbox", get(job_inbox))
        .route("/jobs/{id}/messages/read", post(read_messages))
        .route("/jobs/companies/{slug}", get(work_profile))
        .route("/jobs/files/{file_id}", get(download_file))
        .route("/jobs/{id}", get(get_job).patch(edit_job))
        .route("/jobs/{id}/invite", post(invite_companies))
        .route("/jobs/{id}/quote", post(send_quote))
        .route("/jobs/{id}/choose", post(choose_company))
        .route("/jobs/{id}/confirm", post(confirm_job))
        .route("/jobs/{id}/updates", post(add_update))
        .route("/jobs/{id}/activity", post(job_activity))
        .route("/jobs/{id}/review-work", post(review_work))
        .route("/jobs/{id}/reviews", post(review_company))
        .route(
            "/jobs/{id}/messages",
            get(quote_messages).post(send_message),
        )
        .route("/jobs/{id}/payment-stages", post(set_payment_stages))
        .route(
            "/jobs/{id}/payment-stages/{stage_id}",
            post(advance_payment),
        )
        .route("/jobs/{id}/files", post(upload_file))
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .with_state(app);
    let bind = std::env::var("JOBS_BIND").unwrap_or_else(|_| "127.0.0.1:4201".into());
    let address: SocketAddr = bind.parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("Connect jobs listening on {address}");
    axum::serve(listener, routes).await?;
    Ok(())
}
