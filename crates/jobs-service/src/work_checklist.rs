use super::*;
use sqlx::{Postgres, Transaction};
use std::collections::HashSet;

pub(super) fn parse(body: &Value) -> Result<Option<Value>> {
    let Some(value) = body.get("workChecklist") else {
        return Ok(None);
    };
    let entries = value
        .as_array()
        .filter(|items| items.len() <= 30)
        .ok_or_else(|| bad("Add up to 30 checklist items."))?;
    let mut ids = HashSet::new();
    let mut items = Vec::with_capacity(entries.len());
    for entry in entries {
        let id = entry["id"]
            .as_str()
            .filter(|id| valid_id(id))
            .ok_or_else(|| bad("Each checklist item needs a valid identifier."))?
            .to_ascii_lowercase();
        if !ids.insert(id.clone()) {
            return Err(bad("Each checklist item needs a different identifier."));
        }
        let title = entry["title"]
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty() && text.chars().count() <= 300 && !text.contains('\0'))
            .ok_or_else(|| bad("Write each checklist item using 1 to 300 characters."))?;
        // Completion is server-owned; posting cannot mark work complete.
        items.push(json!({"id":id,"title":title,"status":"todo","revision":1,"completed":false,"completedAt":null,"completedByCompanyId":null}));
    }
    Ok(Some(json!(items)))
}

pub(super) fn merge(existing: &Value, replacement: Value) -> Result<Value> {
    let previous = existing
        .as_array()
        .ok_or_else(|| conflict("Refresh the job checklist and try again."))?;
    let mut next = replacement
        .as_array()
        .cloned()
        .ok_or_else(|| bad("Check the job checklist."))?;
    for old in previous {
        let found = next.iter_mut().find(|item| item["id"] == old["id"]);
        if old["completed"] == true
            && found
                .as_ref()
                .is_none_or(|item| item["title"] != old["title"])
        {
            return Err(conflict(
                "Completed checklist items cannot be removed or renamed.",
            ));
        }
        if let Some(item) = found {
            if item["title"] == old["title"] {
                *item = old.clone();
            }
        }
    }
    Ok(json!(next))
}

pub(super) fn public_scope(items: &Value) -> Value {
    json!(items
        .as_array()
        .into_iter()
        .flatten()
        .map(|item| json!({"id":item["id"],"title":item["title"]}))
        .collect::<Vec<_>>())
}

// Call while holding the job row lock, including after attachment upload.
pub(super) async fn ensure_complete(tx: &mut Transaction<'_, Postgres>, id: &str) -> Result<()> {
    let incomplete: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM jobs j CROSS JOIN LATERAL jsonb_array_elements(j.work_checklist) item WHERE j.id=$1::uuid AND item->>'status' IS DISTINCT FROM 'approved')")
        .bind(id).fetch_one(&mut **tx).await?;
    if incomplete {
        return Err(conflict(
            "Every checklist item needs the hiring company’s approval before submitting the work for review.",
        ));
    }
    Ok(())
}

fn require_admin(actor: &Actor) -> Result<()> {
    if !matches!(actor.role.as_deref(), Some("owner" | "admin")) {
        return Err(forbidden());
    }
    Ok(())
}
fn version(body: &Value, actual: i32) -> Result<()> {
    let supplied = body["version"]
        .as_i64()
        .filter(|v| *v > 0 && *v <= i32::MAX as i64)
        .ok_or_else(|| bad("Choose the checklist version to update."))?;
    if supplied != actual as i64 {
        return Err(conflict(
            "The checklist has changed. Refresh it before updating a task.",
        ));
    }
    Ok(())
}
fn item_mut<'a>(items: &'a mut Value, id: &str) -> Result<&'a mut Value> {
    items
        .as_array_mut()
        .and_then(|items| {
            items
                .iter_mut()
                .find(|item| item["id"].as_str() == Some(id))
        })
        .ok_or(Error(StatusCode::NOT_FOUND, "Checklist item not found."))
}
async fn timestamp(tx: &mut Transaction<'_, Postgres>) -> Result<Value> {
    parse_json(
        sqlx::query_scalar("SELECT to_jsonb(now())::text")
            .fetch_one(&mut **tx)
            .await?,
    )
}
async fn save_items(tx: &mut Transaction<'_, Postgres>, id: &str, items: &Value) -> Result<i32> {
    Ok(sqlx::query_scalar("UPDATE jobs SET work_checklist=$2::jsonb,checklist_version=checklist_version+1,updated_at=now() WHERE id=$1::uuid RETURNING checklist_version")
        .bind(id).bind(items.to_string()).fetch_one(&mut **tx).await?)
}
pub(super) async fn decorate(db: &PgPool, id: &str, items: &mut Value) -> Result<()> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT (to_jsonb(f)-'storage_key')::text FROM job_files f JOIN job_checklist_submissions s ON s.id=f.update_id WHERE s.job_id=$1::uuid AND s.status IN ('submitted','approved','changes_requested') ORDER BY f.created_at,f.id")
        .bind(id).fetch_all(db).await?;
    let files = rows
        .into_iter()
        .map(parse_json)
        .collect::<Result<Vec<_>>>()?;
    if let Some(items) = items.as_array_mut() {
        for item in items {
            item["proofFiles"] = json!(files
                .iter()
                .filter(|file| file["update_id"] == item["submissionId"])
                .collect::<Vec<_>>());
        }
    }
    Ok(())
}
pub(super) async fn submit(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, item_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    checked_id(&item_id)?;
    let item_id = item_id.to_ascii_lowercase();
    let client = body["clientId"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or_else(|| bad("Choose a valid proof submission identifier."))?;
    let note = match body.get("note") {
        None => "",
        Some(value) => value
            .as_str()
            .map(str::trim)
            .filter(|v| v.chars().count() <= 3000 && !v.contains('\0'))
            .ok_or_else(|| bad("Keep the proof note under 3,000 characters."))?,
    };
    let count = project_publication::attachment_count(&body)?;
    if count == 0 {
        return Err(bad(
            "Attach at least one photo or document as proof of the work.",
        ));
    }
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT j.status,j.work_checklist::text AS items,j.checklist_version,q.provider_company_id::text AS provider FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if job.get::<Option<String>, _>("provider").as_deref() != actor.company.as_deref() {
        return Err(forbidden());
    }
    let mut items = parse_json(job.get("items"))?;
    let item = item_mut(&mut items, &item_id)?;
    let previous = sqlx::query("SELECT s.id::text,s.note,s.status,s.item_revision,u.expected_files FROM job_checklist_submissions s JOIN job_updates u ON u.id=s.id WHERE s.job_id=$1::uuid AND s.item_id=$2::uuid AND s.company_id=$3::uuid AND s.client_id=$4::uuid")
        .bind(&id).bind(&item_id).bind(actor.company.as_deref()).bind(client).fetch_optional(&mut *tx).await?;
    if let Some(old) = previous {
        if old.get::<String, _>("status") == "cancelled" {
            return Err(conflict(
                "This proof draft was discarded. Start a new submission.",
            ));
        }
        if old.get::<String, _>("note") != note || old.get::<i32, _>("expected_files") != count {
            return Err(conflict(
                "This proof submission was already started with different files or notes.",
            ));
        }
        let draft = old.get::<String, _>("status") == "draft";
        if draft
            && (job.get::<String, _>("status") != "in_progress"
                || old.get::<i32, _>("item_revision") as i64
                    != item["revision"].as_i64().unwrap_or(1))
        {
            return Err(conflict(
                "This task has changed. Start a new proof submission.",
            ));
        }
        let uid: String = old.get("id");
        return Ok((
            StatusCode::CREATED,
            Json(json!({"submissionId":uid,"updateId":uid,"pendingUploads":draft})),
        ));
    }
    if job.get::<String, _>("status") != "in_progress" {
        return Err(conflict(
            "Proof can be submitted only while the job is in progress.",
        ));
    }
    version(&body, job.get("checklist_version"))?;
    if !matches!(
        item["status"].as_str().unwrap_or("todo"),
        "todo" | "changes_requested"
    ) {
        return Err(conflict("This task is already submitted or approved."));
    }
    let text = format!(
        "Proof submitted: {}{}",
        item["title"].as_str().unwrap_or("Task"),
        if note.is_empty() {
            String::new()
        } else {
            format!("\n\n{note}")
        }
    );
    let uid: String = sqlx::query_scalar("INSERT INTO job_updates(job_id,company_id,author_id,kind,body,provider_company_id,upload_pending,expected_files,published_at) VALUES($1::uuid,$2::uuid,$3::uuid,'progress',$4,$2::uuid,true,$5,NULL) RETURNING id::text")
        .bind(&id).bind(actor.company.as_deref()).bind(&actor.user).bind(text).bind(count).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO job_checklist_submissions(id,job_id,item_id,item_revision,company_id,client_id,note) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid,$7)")
        .bind(&uid).bind(&id).bind(&item_id).bind(item["revision"].as_i64().unwrap_or(1) as i32).bind(actor.company.as_deref()).bind(client).bind(note).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"submissionId":uid,"updateId":uid,"pendingUploads":true})),
    ))
}

// Cancellation uses the client identifier so a lost prepare response cannot trap
// a draft with an invalid file or an attachment count the user cannot fulfil.
pub(super) async fn cancel(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, item_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    checked_id(&item_id)?;
    let client = body["clientId"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or_else(|| bad("Choose a valid proof submission identifier."))?;
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT q.provider_company_id::text AS provider FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if job.get::<Option<String>, _>("provider").as_deref() != actor.company.as_deref() {
        return Err(forbidden());
    }
    let old = sqlx::query("SELECT id::text,status FROM job_checklist_submissions WHERE job_id=$1::uuid AND item_id=$2::uuid AND company_id=$3::uuid AND client_id=$4::uuid")
        .bind(&id).bind(&item_id).bind(actor.company.as_deref()).bind(client).fetch_optional(&mut *tx).await?;
    if let Some(old) = old {
        match old.get::<String, _>("status").as_str() {
            "draft" => {
                sqlx::query(
                    "UPDATE job_checklist_submissions SET status='cancelled' WHERE id=$1::uuid",
                )
                .bind(old.get::<String, _>("id"))
                .execute(&mut *tx)
                .await?;
            }
            "cancelled" => {}
            _ => return Err(conflict("Submitted proof cannot be discarded.")),
        }
    }
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

pub(super) async fn alert(
    tx: &mut Transaction<'_, Postgres>,
    target: &str,
    actor: &Actor,
    event_id: &str,
    title: &str,
    body: &str,
    job: &str,
) -> Result<()> {
    sqlx::query("SELECT connect_notify($1::uuid,NULL,$2::uuid,$3::uuid,$4,'job','requests',$5,$6,$7,'job',$8::uuid)")
        .bind(target).bind(actor.company.as_deref()).bind(&actor.user).bind(format!("job-event:{event_id}")).bind(title).bind(body).bind(format!("/jobs/{job}#work-checklist")).bind(job).execute(&mut **tx).await?;
    Ok(())
}
// Generic update upload/publish routes must enforce the same task permissions.
pub(super) async fn guard_upload(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    uid: &str,
    actor: &Actor,
) -> Result<()> {
    let row = sqlx::query("SELECT s.status,s.item_revision,s.item_id::text,j.status AS job_status,j.work_checklist::text AS items FROM job_checklist_submissions s JOIN jobs j ON j.id=s.job_id WHERE s.id=$1::uuid AND s.job_id=$2::uuid")
        .bind(uid).bind(id).fetch_optional(&mut **tx).await?;
    if let Some(row) = row {
        require_admin(actor)?;
        let mut items = parse_json(row.get("items"))?;
        let item = item_mut(&mut items, &row.get::<String, _>("item_id"))?;
        if row.get::<String, _>("status") != "draft"
            || row.get::<String, _>("job_status") != "in_progress"
            || row.get::<i32, _>("item_revision") as i64 != item["revision"].as_i64().unwrap_or(1)
        {
            return Err(conflict(
                "This task has changed. Refresh it before attaching proof.",
            ));
        }
    }
    Ok(())
}
pub(super) async fn publish_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    uid: &str,
    actor: &Actor,
) -> Result<bool> {
    let row = sqlx::query("SELECT item_id::text,item_revision,note,status FROM job_checklist_submissions WHERE id=$1::uuid AND job_id=$2::uuid FOR UPDATE")
        .bind(uid).bind(id).fetch_optional(&mut **tx).await?;
    let Some(row) = row else {
        return Ok(false);
    };
    require_admin(actor)?;
    if row.get::<String, _>("status") != "draft" {
        return Err(conflict("This proof was already submitted."));
    }
    let raw: String = sqlx::query_scalar("SELECT work_checklist::text FROM jobs WHERE id=$1::uuid")
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    let mut items = parse_json(raw)?;
    let item = item_mut(&mut items, &row.get::<String, _>("item_id"))?;
    if item["revision"].as_i64().unwrap_or(1) != row.get::<i32, _>("item_revision") as i64
        || !matches!(
            item["status"].as_str().unwrap_or("todo"),
            "todo" | "changes_requested"
        )
    {
        return Err(conflict(
            "This task has changed. Start a new proof submission.",
        ));
    }
    let proof_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM job_files WHERE update_id=$1::uuid")
            .bind(uid)
            .fetch_one(&mut **tx)
            .await?;
    if proof_count < 1 {
        return Err(conflict("Attach proof before submitting this task."));
    }
    let at = timestamp(tx).await?;
    item["status"] = json!("submitted");
    item["completed"] = json!(false);
    item["revision"] = json!(row.get::<i32, _>("item_revision") + 1);
    item["submissionId"] = json!(uid);
    item["proofNote"] = json!(row.get::<String, _>("note"));
    item["submittedAt"] = at;
    item["reviewNote"] = json!("");
    item["reviewedAt"] = Value::Null;
    item["completedAt"] = Value::Null;
    item["completedByCompanyId"] = Value::Null;
    save_items(tx, id, &items).await?;
    sqlx::query("UPDATE job_checklist_submissions SET status='submitted',submitted_at=now() WHERE id=$1::uuid").bind(uid).execute(&mut **tx).await?;
    Ok(true)
}
pub(super) async fn review(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, item_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    checked_id(&item_id)?;
    let item_id = item_id.to_ascii_lowercase();
    let sid = body["submissionId"]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or_else(|| bad("Choose the proof submission to review."))?;
    let decision = body["decision"]
        .as_str()
        .filter(|v| matches!(*v, "approve" | "changes"))
        .ok_or_else(|| bad("Choose a review decision."))?;
    let note = match body.get("note") {
        None => "",
        Some(value) => value
            .as_str()
            .map(str::trim)
            .filter(|v| v.chars().count() <= 3000 && !v.contains('\0'))
            .ok_or_else(|| bad("Keep the review note under 3,000 characters."))?,
    };
    if decision == "changes" && note.is_empty() {
        return Err(bad("Tell the company what needs to change."));
    }
    let mut tx = app.db.begin().await?;
    let job=sqlx::query("SELECT j.hiring_company_id::text AS hirer,j.status,j.work_checklist::text AS items,j.checklist_version,q.provider_company_id::text AS provider FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if Some(job.get::<String, _>("hirer").as_str()) != actor.company.as_deref() {
        return Err(forbidden());
    }
    if job.get::<String, _>("status") != "in_progress" {
        return Err(conflict(
            "Tasks can be reviewed only while the job is in progress.",
        ));
    }
    version(&body, job.get("checklist_version"))?;
    let mut items = parse_json(job.get("items"))?;
    let item = item_mut(&mut items, &item_id)?;
    if item["submissionId"].as_str() != Some(sid)
        || (item["status"] != "submitted"
            && !(decision == "changes" && item["status"] == "approved"))
    {
        return Err(conflict(
            "This proof has changed or was already reviewed. Refresh the task.",
        ));
    }
    let at = timestamp(&mut tx).await?;
    let approved = decision == "approve";
    item["status"] = json!(if approved {
        "approved"
    } else {
        "changes_requested"
    });
    item["completed"] = json!(approved);
    item["revision"] = json!(item["revision"].as_i64().unwrap_or(1) + 1);
    item["reviewNote"] = json!(note);
    item["reviewedAt"] = at.clone();
    item["completedAt"] = if approved { at } else { Value::Null };
    item["completedByCompanyId"] = if approved {
        json!(actor.company.as_deref())
    } else {
        Value::Null
    };
    let title = item["title"].as_str().unwrap_or("Task").to_owned();
    let next_version = save_items(&mut tx, &id, &items).await?;
    sqlx::query("UPDATE job_checklist_submissions SET status=$2,reviewed_at=now(),review_note=$3,reviewed_by=$4::uuid WHERE id=$1::uuid AND job_id=$5::uuid")
        .bind(sid).bind(if approved {"approved"} else {"changes_requested"}).bind(note).bind(&actor.user).bind(&id).execute(&mut *tx).await?;
    let provider: String = job.get("provider");
    let text = format!(
        "{}: {title}{}",
        if approved {
            "Task approved"
        } else {
            "Task changes requested"
        },
        if note.is_empty() {
            String::new()
        } else {
            format!("\n\n{note}")
        }
    );
    let uid:String=sqlx::query_scalar("INSERT INTO job_updates(job_id,company_id,author_id,kind,body,provider_company_id) VALUES($1::uuid,$2::uuid,$3::uuid,'progress',$4,$5::uuid) RETURNING id::text")
        .bind(&id).bind(actor.company.as_deref()).bind(&actor.user).bind(&text).bind(&provider).fetch_one(&mut *tx).await?;
    let eid = quote_workflow::event(
        &mut tx,
        &id,
        &provider,
        &actor,
        "progress",
        &text,
        None,
        None,
        Some(&uid),
        None,
    )
    .await?;
    alert(
        &mut tx,
        &provider,
        &actor,
        &eid,
        if approved {
            "Task approved"
        } else {
            "Changes requested"
        },
        &title,
        &id,
    )
    .await?;
    tx.commit().await?;
    decorate(&app.db, &id, &mut items).await?;
    Ok(Json(
        json!({"workChecklist":items,"checklistVersion":next_version}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_ids_and_owns_completion_state() {
        let id = "ABCDEFAB-1234-5678-9012-123456789ABC";
        let parsed = parse(
            &json!({"workChecklist":[{"id":id,"title":"  Install racking  ","completed":true}]}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(parsed[0]["id"], id.to_lowercase());
        assert_eq!(parsed[0]["title"], "Install racking");
        assert_eq!(parsed[0]["completed"], false);
        assert!(parse(&json!({"workChecklist":[{"id":id,"title":"First"},{"id":id.to_lowercase(),"title":"Second"}]})).is_err());
    }

    #[test]
    fn retains_completion_and_rejects_destructive_edits() {
        let old = json!([{"id":"11111111-1111-1111-1111-111111111111","title":"Install racking","completed":true,"completedAt":"2026-11-13T12:00:00Z","completedByCompanyId":"22222222-2222-2222-2222-222222222222"}]);
        let same = parse(&json!({"workChecklist":[{"id":old[0]["id"],"title":"Install racking"}]}))
            .unwrap()
            .unwrap();
        assert_eq!(merge(&old, same).unwrap(), old);
        assert!(merge(&old, json!([])).is_err());
        let renamed =
            parse(&json!({"workChecklist":[{"id":old[0]["id"],"title":"Different scope"}]}))
                .unwrap()
                .unwrap();
        assert!(merge(&old, renamed).is_err());
        assert_eq!(
            public_scope(&old),
            json!([{"id":old[0]["id"],"title":"Install racking"}])
        );
    }
}
