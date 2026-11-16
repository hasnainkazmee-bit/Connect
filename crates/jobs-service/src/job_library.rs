use super::*;
use serde::Serialize;
use sqlx::{Postgres, Transaction};
use std::collections::HashSet;

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
struct DraftBody {
    note: String,
    amount_cents: Option<i64>,
    start_window: String,
    duration: String,
    included: String,
    excluded: String,
    payment_terms: String,
    revision_note: String,
    answers: Vec<DraftAnswer>,
    questions_version: Option<i32>,
    quote_version: Option<i32>,
    price_breakdown: Vec<DraftPrice>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DraftAnswer {
    question_id: String,
    answer: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DraftPrice {
    label: String,
    amount_cents: Option<i64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SaveDraft {
    version: i32,
    body: DraftBody,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DraftVersion {
    version: i32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SavedInput {
    saved: bool,
}
#[derive(Deserialize)]
pub(super) struct Page {
    page: Option<i64>,
}

fn validate_body(body: &DraftBody) -> Result<()> {
    for (text, limit) in [
        (&body.note, 5000),
        (&body.start_window, 120),
        (&body.duration, 120),
        (&body.included, 5000),
        (&body.excluded, 5000),
        (&body.payment_terms, 2000),
        (&body.revision_note, 2000),
    ] {
        if text.len() > limit || text.contains('\0') {
            return Err(bad(
                "A proposal field is too long or contains invalid text.",
            ));
        }
    }
    if body
        .amount_cents
        .is_some_and(|n| !(0..=100_000_000_000).contains(&n))
        || body.questions_version.is_some_and(|n| n < 1)
        || body.quote_version.is_some_and(|n| n < 1)
        || body.answers.len() > 10
        || body.price_breakdown.len() > 20
    {
        return Err(bad("Check the proposal draft fields."));
    }
    let mut seen = HashSet::new();
    for answer in &body.answers {
        checked_id(&answer.question_id)?;
        if !seen.insert(answer.question_id.to_ascii_lowercase())
            || answer.answer.chars().count() > 5000
            || answer.answer.contains('\0')
        {
            return Err(bad("Check the proposal answers."));
        }
    }
    for price in &body.price_breakdown {
        if price.label.len() > 120
            || price.label.contains('\0')
            || price
                .amount_cents
                .is_some_and(|n| !(0..=100_000_000_000).contains(&n))
        {
            return Err(bad("Check the draft price breakdown."));
        }
    }
    Ok(())
}

// Lock the job before the private record, matching quote publication's lock order.
async fn writable_job(tx: &mut Transaction<'_, Postgres>, id: &str, company: &str) -> Result<()> {
    let row = sqlx::query("SELECT j.hiring_company_id::text AS hirer,j.status,j.visibility,COALESCE(j.quote_deadline<now(),false) AS expired,c.is_demo=mine.is_demo AS same_demo,EXISTS(SELECT 1 FROM job_invitations i WHERE i.job_id=j.id AND i.provider_company_id=$2::uuid AND i.status='pending') AS invited FROM jobs j JOIN companies c ON c.id=j.hiring_company_id JOIN companies mine ON mine.id=$2::uuid WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(id).bind(company).fetch_optional(&mut **tx).await?.ok_or_else(not_found)?;
    if row.get::<String, _>("hirer") == company || !row.get::<bool, _>("same_demo") {
        return Err(forbidden());
    }
    if row.get::<String, _>("visibility") == "invite_only" && !row.get::<bool, _>("invited") {
        return Err(not_found());
    }
    if row.get::<String, _>("status") != "open" || row.get::<bool, _>("expired") {
        return Err(conflict("This job is no longer accepting proposals."));
    }
    Ok(())
}

// Keep one projection for Saved and Drafts, without private address or other proposals.
fn job_card() -> String {
    format!("jsonb_build_object('id',j.id,'title',j.title,'description',j.description,'trade',j.trade,'location',j.location,'postal_code',j.postal_code,'start_window',j.start_window,'budget_cents',j.budget_cents,'quote_deadline',j.quote_deadline,'visibility',j.visibility,'status',j.status,'created_at',j.created_at,'project_type',j.project_type,'system_size_kw',j.system_size_kw,'site_count',j.site_count,'people_needed',j.people_needed,'expected_duration',j.expected_duration,'work_arrangement',j.work_arrangement,'posting_details',j.posting_details,'company',{},'quote_count',(SELECT count(*) FROM job_quotes q WHERE q.job_id=j.id AND q.status='submitted' AND NOT q.upload_pending),'my_quote_status',(SELECT q.status FROM job_quotes q WHERE q.job_id=j.id AND q.provider_company_id=$1::uuid),'invited',EXISTS(SELECT 1 FROM job_invitations i WHERE i.job_id=j.id AND i.provider_company_id=$1::uuid AND i.status='pending'),'saved',EXISTS(SELECT 1 FROM job_saved s WHERE s.job_id=j.id AND s.company_id=$1::uuid))", company_json())
}
const VISIBLE: &str = "c.is_demo=mine.is_demo AND j.hiring_company_id<>$1::uuid AND ((j.visibility='open' AND j.status='open') OR EXISTS(SELECT 1 FROM job_invitations i WHERE i.job_id=j.id AND i.provider_company_id=$1::uuid AND i.status='pending') OR EXISTS(SELECT 1 FROM job_quotes q WHERE q.job_id=j.id AND q.provider_company_id=$1::uuid) OR EXISTS(SELECT 1 FROM job_messages m WHERE m.job_id=j.id AND m.provider_company_id=$1::uuid))";

pub(super) async fn saved(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let page = page.page.unwrap_or(1).clamp(1, 1000);
    let sql = format!("SELECT ({}||jsonb_build_object('saved_at',s.created_at))::text FROM job_saved s JOIN jobs j ON j.id=s.job_id JOIN companies c ON c.id=j.hiring_company_id JOIN companies mine ON mine.id=s.company_id WHERE s.company_id=$1::uuid AND {VISIBLE} ORDER BY s.created_at DESC,j.id LIMIT 25 OFFSET $2",job_card());
    let rows: Vec<String> = sqlx::query_scalar(&sql)
        .bind(actor.company.as_deref())
        .bind((page - 1) * 24)
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"hasMore":rows.len()>24,"page":page,"jobs":rows.into_iter().take(24).map(parse_json).collect::<Result<Vec<_>>>()?}),
    ))
}
pub(super) async fn set_saved(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SavedInput>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    let company = actor.company.as_deref().unwrap();
    let mut tx = app.db.begin().await?;
    if body.saved {
        writable_job(&mut tx, &id, company).await?;
        sqlx::query("INSERT INTO job_saved(company_id,job_id,saved_by) VALUES($1::uuid,$2::uuid,$3::uuid) ON CONFLICT(company_id,job_id) DO NOTHING")
            .bind(company).bind(&id).bind(&actor.user).execute(&mut *tx).await?;
    } else {
        // Removal is allowed after a job closes or an invitation is withdrawn.
        sqlx::query("DELETE FROM job_saved WHERE company_id=$1::uuid AND job_id=$2::uuid")
            .bind(company)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"saved":body.saved})))
}

pub(super) async fn drafts(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let page = page.page.unwrap_or(1).clamp(1, 1000);
    let sql = format!("SELECT ({}||jsonb_build_object('draftVersion',d.version,'draftUpdatedAt',d.updated_at))::text FROM job_proposal_drafts d JOIN jobs j ON j.id=d.job_id JOIN companies c ON c.id=j.hiring_company_id JOIN companies mine ON mine.id=d.company_id WHERE d.company_id=$1::uuid AND {VISIBLE} ORDER BY d.updated_at DESC,j.id LIMIT 25 OFFSET $2",job_card());
    let rows: Vec<String> = sqlx::query_scalar(&sql)
        .bind(actor.company.as_deref())
        .bind((page - 1) * 24)
        .fetch_all(&app.db)
        .await?;
    Ok(Json(
        json!({"hasMore":rows.len()>24,"page":page,"jobs":rows.into_iter().take(24).map(parse_json).collect::<Result<Vec<_>>>()?}),
    ))
}
pub(super) async fn draft(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let company = actor.company.as_deref().unwrap();
    let access = job_access(&app, &id, Some(company)).await?;
    if access.hirer {
        return Err(forbidden());
    }
    let same_demo: bool = sqlx::query_scalar("SELECT c.is_demo=mine.is_demo FROM companies c JOIN companies mine ON mine.id=$2::uuid WHERE c.id=$1::uuid")
        .bind(access.hirer_id()).bind(company).fetch_one(&app.db).await?;
    if !same_demo {
        return Err(forbidden());
    }
    let raw: Option<String> = sqlx::query_scalar("SELECT jsonb_build_object('version',version,'updatedAt',updated_at,'body',body)::text FROM job_proposal_drafts WHERE company_id=$1::uuid AND job_id=$2::uuid")
        .bind(company).bind(&id).fetch_optional(&app.db).await?;
    let editable: bool = sqlx::query_scalar("SELECT status='open' AND (quote_deadline IS NULL OR quote_deadline>=now()) AND (visibility='open' OR EXISTS(SELECT 1 FROM job_invitations WHERE job_id=$1::uuid AND provider_company_id=$2::uuid AND status='pending')) FROM jobs WHERE id=$1::uuid")
        .bind(&id).bind(company).fetch_one(&app.db).await?;
    Ok(Json(
        json!({"draft":raw.map(parse_json).transpose()?,"canEdit":editable&&matches!(actor.role.as_deref(),Some("owner"|"admin"))}),
    ))
}
pub(super) async fn save_draft(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SaveDraft>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    if body.version < 0 || body.version == i32::MAX {
        return Err(bad("Check the draft version."));
    }
    validate_body(&body.body)?;
    let company = actor.company.as_deref().unwrap();
    let serialized =
        serde_json::to_string(&body.body).map_err(|_| bad("Check the draft fields."))?;
    if serialized.len() > 95000 {
        return Err(bad("The proposal draft is too large."));
    }
    let mut tx = app.db.begin().await?;
    writable_job(&mut tx, &id, company).await?;
    let actual:Option<i32>=sqlx::query_scalar("SELECT version FROM job_proposal_drafts WHERE company_id=$1::uuid AND job_id=$2::uuid FOR UPDATE")
        .bind(company).bind(&id).fetch_optional(&mut *tx).await?;
    if actual.unwrap_or(0) != body.version {
        return Err(conflict(
            "This draft was changed by your team. Reload it before saving.",
        ));
    }
    let raw:String=sqlx::query_scalar("INSERT INTO job_proposal_drafts(company_id,job_id,author_id,body) VALUES($1::uuid,$2::uuid,$3::uuid,$4::jsonb) ON CONFLICT(company_id,job_id) DO UPDATE SET author_id=$3::uuid,body=$4::jsonb,version=nextval('job_proposal_draft_version_seq'),updated_at=now() RETURNING jsonb_build_object('version',version,'updatedAt',updated_at,'body',body)::text")
        .bind(company).bind(&id).bind(&actor.user).bind(serialized).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"draft":parse_json(raw)?})))
}
pub(super) async fn delete_draft(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(input): Query<DraftVersion>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    if input.version < 1 {
        return Err(bad("Check the draft version."));
    }
    let company = actor.company.as_deref().unwrap();
    let mut tx = app.db.begin().await?;
    // Only the owning company can discard its record, including after access ends.
    let actual:Option<i32>=sqlx::query_scalar("SELECT version FROM job_proposal_drafts WHERE company_id=$1::uuid AND job_id=$2::uuid FOR UPDATE")
        .bind(company).bind(&id).fetch_optional(&mut *tx).await?;
    if actual.is_some_and(|v| v != input.version) {
        return Err(conflict(
            "This draft has changed. Reload it before discarding.",
        ));
    }
    sqlx::query("DELETE FROM job_proposal_drafts WHERE company_id=$1::uuid AND job_id=$2::uuid")
        .bind(company)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

pub(super) async fn submission_version(
    tx: &mut Transaction<'_, Postgres>,
    job: &str,
    company: &str,
    body: &Value,
) -> Result<Option<i32>> {
    let current:Option<i32>=sqlx::query_scalar("SELECT version FROM job_proposal_drafts WHERE company_id=$1::uuid AND job_id=$2::uuid FOR UPDATE")
        .bind(company).bind(job).fetch_optional(&mut **tx).await?;
    if let Some(supplied) = body.get("draftVersion").filter(|v| !v.is_null()) {
        let version = supplied
            .as_i64()
            .filter(|v| *v >= 0 && *v < i32::MAX as i64)
            .ok_or_else(|| bad("Check the proposal draft version."))?;
        if version != current.unwrap_or(0) as i64 {
            return Err(conflict(
                "This draft changed. Reload it before sending your proposal.",
            ));
        }
    }
    Ok(current)
}
pub(super) async fn clear_published(
    tx: &mut Transaction<'_, Postgres>,
    job: &str,
    company: &str,
    version: Option<i32>,
) -> Result<()> {
    if let Some(version) = version {
        sqlx::query("DELETE FROM job_proposal_drafts WHERE company_id=$1::uuid AND job_id=$2::uuid AND version=$3")
            .bind(company).bind(job).bind(version).execute(&mut **tx).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_drafts_allow_incomplete_pricing_but_reject_invalid_or_unknown_fields() {
        let body:DraftBody=serde_json::from_value(json!({"note":"Work in progress","amountCents":null,"priceBreakdown":[{"label":"Labor","amountCents":null}]})).unwrap();
        assert!(validate_body(&body).is_ok());
        for value in [
            json!({"amountCents":-1}),
            json!({"note":"x".repeat(5001)}),
            json!({"note":"bad\u{0000}text"}),
            json!({"questionsVersion":0}),
        ] {
            assert!(validate_body(&serde_json::from_value::<DraftBody>(value).unwrap()).is_err());
        }
        assert!(serde_json::from_value::<DraftBody>(json!({"files":[{"id":"invented"}]})).is_err());
        assert!(serde_json::from_value::<DraftBody>(json!({"companyId":"someone-else"})).is_err());
    }
}
