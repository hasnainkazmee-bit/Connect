use super::*;
use sqlx::{Postgres, Transaction};

pub(super) fn attachment_count(body: &Value) -> Result<i32> {
    match body.get("attachmentCount") {
        None => Ok(0),
        Some(value) => value
            .as_i64()
            .filter(|v| (0..=20).contains(v))
            .map(|v| v as i32)
            .ok_or_else(|| bad("Attach up to 20 files.")),
    }
}
pub(super) async fn publish_quote(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, qid)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    checked_id(&qid)?;
    let v = body["version"]
        .as_i64()
        .filter(|v| *v > 0 && *v <= i32::MAX as i64)
        .ok_or_else(|| bad("Choose the quote version to publish."))? as i32;
    let mut tx = app.db.begin().await?;
    let job=sqlx::query("SELECT status,hiring_company_id::text AS hirer,title,COALESCE(quote_deadline<now(),false) AS expired FROM jobs WHERE id=$1::uuid FOR UPDATE").bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let quote=sqlx::query("SELECT provider_company_id::text AS provider,current_version,status,expected_files FROM job_quotes WHERE id=$1::uuid AND job_id=$2::uuid FOR UPDATE").bind(&qid).bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let provider: String = quote.get("provider");
    if Some(provider.as_str()) != actor.company.as_deref() {
        return Err(forbidden());
    }
    let published:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_quote_publications WHERE quote_id=$1::uuid AND version=$2)").bind(&qid).bind(v).fetch_one(&mut *tx).await?;
    if published {
        return Ok(Json(json!({"ok":true,"alreadyPublished":true})));
    }
    if quote.get::<i32, _>("current_version") != v {
        return Err(conflict("This quote has changed. Open the latest version."));
    }
    if job.get::<String, _>("status") != "open"
        || job.get::<bool, _>("expired")
        || quote.get::<String, _>("status") != "submitted"
    {
        return Err(conflict("This job is no longer accepting this quote."));
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM job_files WHERE quote_id=$1::uuid AND quote_version=$2",
    )
    .bind(&qid)
    .bind(v)
    .fetch_one(&mut *tx)
    .await?;
    if count != quote.get::<i32, _>("expected_files") as i64 {
        return Err(conflict(
            "Finish uploading the quote attachments before sending it.",
        ));
    }
    let note: String = sqlx::query_scalar(
        "SELECT revision_note FROM job_quote_versions WHERE quote_id=$1::uuid AND version=$2",
    )
    .bind(&qid)
    .bind(v)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO job_quote_publications(quote_id,version) VALUES($1::uuid,$2)")
        .bind(&qid)
        .bind(v)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE job_quotes SET upload_pending=false,updated_at=now() WHERE id=$1::uuid")
        .bind(&qid)
        .execute(&mut *tx)
        .await?;
    let eid = quote_workflow::event(
        &mut tx,
        &id,
        &provider,
        &actor,
        if v == 1 {
            "quote_submitted"
        } else {
            "quote_revised"
        },
        &note,
        Some(&qid),
        Some(v),
        None,
        None,
    )
    .await?;
    quote_workflow::alert(
        &mut tx,
        &job.get::<String, _>("hirer"),
        &provider,
        &actor,
        &eid,
        if v == 1 {
            "New quote received"
        } else {
            "Updated quote received"
        },
        &job.get::<String, _>("title"),
        &id,
    )
    .await?;
    sqlx::query("UPDATE jobs SET updated_at=now() WHERE id=$1::uuid")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}
async fn finish_update(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    uid: &str,
    actor: &Actor,
) -> Result<()> {
    let job=sqlx::query("SELECT j.status,j.hiring_company_id::text AS hirer,q.provider_company_id::text AS provider FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j").bind(id).fetch_optional(&mut **tx).await?.ok_or_else(not_found)?;
    let update=sqlx::query("SELECT company_id::text AS company,provider_company_id::text AS provider,kind,body,expected_files FROM job_updates WHERE id=$1::uuid AND job_id=$2::uuid FOR UPDATE").bind(uid).bind(id).fetch_optional(&mut **tx).await?.ok_or_else(not_found)?;
    if Some(update.get::<String, _>("company").as_str()) != actor.company.as_deref() {
        return Err(forbidden());
    }
    let published: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM job_conversation_events WHERE update_id=$1::uuid)",
    )
    .bind(uid)
    .fetch_one(&mut **tx)
    .await?;
    if published {
        return Ok(());
    }
    let provider: String = update.get("provider");
    if job.get::<String, _>("status") != "in_progress"
        || job.get::<Option<String>, _>("provider").as_deref() != Some(provider.as_str())
    {
        return Err(conflict("This job is no longer ready for this update."));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM job_files WHERE update_id=$1::uuid")
        .bind(uid)
        .fetch_one(&mut **tx)
        .await?;
    if count != update.get::<i32, _>("expected_files") as i64 {
        return Err(conflict(
            "Finish uploading the update attachments before sharing it.",
        ));
    }
    let kind: String = update.get("kind");
    let text: String = update.get("body");
    if kind == "completion" {
        let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_scope_changes WHERE job_id=$1::uuid AND status='pending')").bind(id).fetch_one(&mut **tx).await?;
        if pending {
            return Err(conflict(
                "Review the pending job change before submitting completed work.",
            ));
        }
        sqlx::query("UPDATE jobs SET status='review',updated_at=now() WHERE id=$1::uuid")
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    sqlx::query("UPDATE job_updates SET upload_pending=false,published_at=now() WHERE id=$1::uuid")
        .bind(uid)
        .execute(&mut **tx)
        .await?;
    let eid = quote_workflow::event(
        tx,
        id,
        &provider,
        actor,
        if kind == "completion" {
            "work_submitted"
        } else {
            "progress"
        },
        &text,
        None,
        None,
        Some(uid),
        None,
    )
    .await?;
    let hirer: String = job.get("hirer");
    let target = if actor.company.as_deref() == Some(hirer.as_str()) {
        &provider
    } else {
        &hirer
    };
    quote_workflow::alert(
        tx,
        target,
        &provider,
        actor,
        &eid,
        if kind == "completion" {
            "Work ready for review"
        } else {
            "New job update"
        },
        &text,
        id,
    )
    .await?;
    Ok(())
}
pub(super) async fn add_update(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, false).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    a.participant()?;
    let kind = required_text(&body, "kind", 1, 30)?;
    if !["progress", "completion"].contains(&kind) {
        return Err(bad("Choose an update type."));
    }
    let text = required_text(&body, "body", 1, 5000)?;
    let count = attachment_count(&body)?;
    let mut tx = app.db.begin().await?;
    let job=sqlx::query("SELECT j.status,q.provider_company_id::text AS provider FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j").bind(&id).fetch_one(&mut *tx).await?;
    if job.get::<String, _>("status") != "in_progress" {
        return Err(conflict("This job is not in progress."));
    }
    let provider: String = job.get("provider");
    if !a.hirer && actor.company.as_deref() != Some(provider.as_str()) {
        return Err(forbidden());
    }
    if kind == "completion" && actor.company.as_deref() != Some(provider.as_str()) {
        return Err(forbidden());
    }
    if kind == "completion" {
        let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_scope_changes WHERE job_id=$1::uuid AND status='pending')").bind(&id).fetch_one(&mut *tx).await?;
        if pending {
            return Err(conflict(
                "Review the pending job change before submitting completed work.",
            ));
        }
    }
    let uid:String=sqlx::query_scalar("INSERT INTO job_updates(job_id,company_id,author_id,kind,body,provider_company_id,upload_pending,expected_files,published_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8,CASE WHEN $7 THEN NULL ELSE now() END) RETURNING id::text")
        .bind(&id).bind(actor.company.as_deref()).bind(&actor.user).bind(kind).bind(text).bind(&provider).bind(count>0).bind(count).fetch_one(&mut *tx).await?;
    if count == 0 {
        finish_update(&mut tx, &id, &uid, &actor).await?;
    }
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":uid,"pendingUploads":count>0})),
    ))
}
pub(super) async fn publish_update(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, uid)): Path<(String, String)>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    checked_id(&id)?;
    checked_id(&uid)?;
    let mut tx = app.db.begin().await?;
    finish_update(&mut tx, &id, &uid, &actor).await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}
