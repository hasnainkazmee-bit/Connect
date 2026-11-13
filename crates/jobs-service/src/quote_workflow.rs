use super::*;
use sqlx::{Postgres, Transaction};

pub(super) async fn event(
    tx: &mut Transaction<'_, Postgres>,
    job: &str,
    provider: &str,
    actor: &Actor,
    kind: &str,
    body: &str,
    quote: Option<&str>,
    version: Option<i32>,
    update: Option<&str>,
    change: Option<&str>,
) -> Result<String> {
    Ok(sqlx::query_scalar("INSERT INTO job_conversation_events(job_id,provider_company_id,actor_id,company_id,kind,body,quote_id,quote_version,update_id,change_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8,$9::uuid,$10::uuid) RETURNING id::text")
        .bind(job).bind(provider).bind(&actor.user).bind(actor.company.as_deref()).bind(kind).bind(body).bind(quote).bind(version).bind(update).bind(change).fetch_one(&mut **tx).await?)
}
pub(super) async fn alert(
    tx: &mut Transaction<'_, Postgres>,
    target: &str,
    provider: &str,
    actor: &Actor,
    event_id: &str,
    title: &str,
    body: &str,
    job: &str,
) -> Result<()> {
    sqlx::query("SELECT connect_notify($1::uuid,NULL,$2::uuid,$3::uuid,$4,'job','requests',$5,$6,$7,'job',$8::uuid)")
        .bind(target).bind(actor.company.as_deref()).bind(&actor.user).bind(format!("job-event:{event_id}")).bind(title).bind(body).bind(format!("/jobs/inbox?job={job}&provider={provider}")).bind(job).execute(&mut **tx).await?;
    Ok(())
}
fn version(body: &Value, actual: i32) -> Result<()> {
    if body.get("version").and_then(Value::as_i64) != Some(actual as i64) {
        return Err(conflict(
            "This quote has changed. Review the latest version and try again.",
        ));
    }
    Ok(())
}

pub(super) async fn send(
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
    let revision_note = optional_text(&body, "revisionNote", 2000)?;
    let breakdown = parse_breakdown(&body, amount)?;
    let attachment_count = project_publication::attachment_count(&body)?;
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT hiring_company_id::text AS hirer,title,status,visibility,COALESCE(quote_deadline<now(),false) AS expired FROM jobs WHERE id=$1::uuid FOR UPDATE")
        .bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let hirer: String = job.get("hirer");
    if hirer == company {
        return Err(forbidden());
    }
    if job.get::<String, _>("status") != "open" || job.get::<bool, _>("expired") {
        return Err(conflict("This job is no longer accepting quotes."));
    }
    if job.get::<String, _>("visibility") == "invite_only" {
        let invited: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_invitations WHERE job_id=$1::uuid AND provider_company_id=$2::uuid AND status='pending')")
            .bind(&id).bind(company).fetch_one(&mut *tx).await?;
        if !invited {
            return Err(forbidden());
        }
    }
    let previous = sqlx::query("SELECT id::text,current_version,status FROM job_quotes WHERE job_id=$1::uuid AND provider_company_id=$2::uuid FOR UPDATE")
        .bind(&id).bind(company).fetch_optional(&mut *tx).await?;
    let current_version = if let Some(ref previous) = previous {
        let status: String = previous.get("status");
        if ![
            "submitted",
            "withdrawn",
            "changes_requested",
            "declined",
            "award_declined",
            "not_chosen",
        ]
        .contains(&status.as_str())
        {
            return Err(conflict("This quote can no longer be changed."));
        }
        let old: i32 = previous.get("current_version");
        version(&body, old)?;
        if ["declined", "award_declined", "not_chosen"].contains(&status.as_str())
            && revision_note.is_empty()
        {
            return Err(bad(
                "Explain what has changed before sending this quote again.",
            ));
        }
        old.checked_add(1)
            .ok_or_else(|| conflict("This quote has too many versions."))?
    } else {
        1
    };
    let quote_id: String = sqlx::query_scalar("INSERT INTO job_quotes(job_id,provider_company_id,author_id,amount_cents,start_window,duration,note,included,excluded,payment_terms,price_breakdown,current_version,upload_pending,expected_files) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) ON CONFLICT(job_id,provider_company_id) DO UPDATE SET author_id=$3::uuid,amount_cents=$4,start_window=$5,duration=$6,note=$7,included=$8,excluded=$9,payment_terms=$10,price_breakdown=$11::jsonb,current_version=$12,upload_pending=$13,expected_files=$14,status='submitted',decision_note='',accepted_version=NULL,updated_at=now() RETURNING id::text")
        .bind(&id).bind(company).bind(&actor.user).bind(amount).bind(start).bind(duration).bind(note).bind(included).bind(excluded).bind(payment).bind(breakdown.to_string()).bind(current_version).bind(attachment_count>0).bind(attachment_count).fetch_one(&mut *tx).await?;
    let terms = json!({"amount_cents":amount,"start_window":start,"duration":duration,"note":note,"included":included,"excluded":excluded,"payment_terms":payment,"price_breakdown":breakdown});
    sqlx::query("INSERT INTO job_quote_versions(quote_id,version,terms,author_id,revision_note) VALUES($1::uuid,$2,$3::jsonb,$4::uuid,$5)")
        .bind(&quote_id).bind(current_version).bind(terms.to_string()).bind(&actor.user).bind(revision_note).execute(&mut *tx).await?;
    if current_version > 1 {
        sqlx::query("INSERT INTO job_quote_version_files(quote_id,version,file_id) SELECT quote_id,$2,file_id FROM job_quote_version_files WHERE quote_id=$1::uuid AND version=$2-1")
            .bind(&quote_id).bind(current_version).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE jobs SET updated_at=now() WHERE id=$1::uuid")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if attachment_count == 0 {
        sqlx::query("INSERT INTO job_quote_publications(quote_id,version) VALUES($1::uuid,$2)")
            .bind(&quote_id)
            .bind(current_version)
            .execute(&mut *tx)
            .await?;
        let event_id = event(
            &mut tx,
            &id,
            company,
            &actor,
            if current_version == 1 {
                "quote_submitted"
            } else {
                "quote_revised"
            },
            revision_note,
            Some(&quote_id),
            Some(current_version),
            None,
            None,
        )
        .await?;
        alert(
            &mut tx,
            &hirer,
            company,
            &actor,
            &event_id,
            if current_version == 1 {
                "New quote received"
            } else {
                "Updated quote received"
            },
            &job.get::<String, _>("title"),
            &id,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(
        json!({"id":quote_id,"current_version":current_version,"version":current_version,"pendingUploads":attachment_count>0}),
    ))
}

pub(super) async fn decide(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    let qid = required_text(&body, "quoteId", 36, 36)?;
    checked_id(qid)?;
    let decision = required_text(&body, "decision", 1, 30)?;
    if !["changes", "decline"].contains(&decision) {
        return Err(bad("Choose a quote decision."));
    }
    let note = required_text(&body, "note", 1, 5000)?;
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT hiring_company_id::text AS hirer,status,title FROM jobs WHERE id=$1::uuid FOR UPDATE").bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if job.get::<String, _>("hirer") != actor.company.as_deref().unwrap() {
        return Err(forbidden());
    }
    if job.get::<String, _>("status") != "open" {
        return Err(conflict(
            "Quotes cannot be reviewed after a company has been chosen.",
        ));
    }
    let quote = sqlx::query("SELECT provider_company_id::text AS provider,current_version,status,upload_pending FROM job_quotes WHERE id=$1::uuid AND job_id=$2::uuid FOR UPDATE").bind(qid).bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let v: i32 = quote.get("current_version");
    version(&body, v)?;
    if quote.get::<bool, _>("upload_pending") {
        return Err(conflict(
            "This quote is still uploading. Review it once all files have been sent.",
        ));
    }
    if quote.get::<String, _>("status") != "submitted" {
        return Err(conflict(
            "This quote has already been reviewed. Refresh the conversation.",
        ));
    }
    let status = if decision == "changes" {
        "changes_requested"
    } else {
        "declined"
    };
    sqlx::query(
        "UPDATE job_quotes SET status=$2,decision_note=$3,updated_at=now() WHERE id=$1::uuid",
    )
    .bind(qid)
    .bind(status)
    .bind(note)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE jobs SET updated_at=now() WHERE id=$1::uuid")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    let provider: String = quote.get("provider");
    let event_id = event(
        &mut tx,
        &id,
        &provider,
        &actor,
        if decision == "changes" {
            "quote_changes_requested"
        } else {
            "quote_declined"
        },
        note,
        Some(qid),
        Some(v),
        None,
        None,
    )
    .await?;
    alert(
        &mut tx,
        &provider,
        &provider,
        &actor,
        &event_id,
        if decision == "changes" {
            "Changes requested to your quote"
        } else {
            "Your quote was declined"
        },
        note,
        &id,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true,"status":status})))
}

pub(super) async fn choose(
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
    let job = sqlx::query("SELECT hiring_company_id::text AS hirer,title,status FROM jobs WHERE id=$1::uuid FOR UPDATE").bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if job.get::<String, _>("hirer") != actor.company.as_deref().unwrap() {
        return Err(forbidden());
    }
    if job.get::<String, _>("status") != "open" {
        return Err(conflict("This job already has a chosen company."));
    }
    let quote = sqlx::query("SELECT provider_company_id::text AS provider,current_version,status,upload_pending FROM job_quotes WHERE id=$1::uuid AND job_id=$2::uuid FOR UPDATE").bind(qid).bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let v: i32 = quote.get("current_version");
    version(&body, v)?;
    if quote.get::<bool, _>("upload_pending") {
        return Err(conflict(
            "This quote is still uploading. Review it once all files have been sent.",
        ));
    }
    if quote.get::<String, _>("status") != "submitted" {
        return Err(conflict("Only a submitted quote can be chosen."));
    }
    let provider: String = quote.get("provider");
    sqlx::query("UPDATE jobs SET status='awarded',chosen_quote_id=$1::uuid,updated_at=now() WHERE id=$2::uuid").bind(qid).bind(&id).execute(&mut *tx).await?;
    sqlx::query("UPDATE job_quotes SET status='chosen',accepted_version=current_version,decision_note='',updated_at=now() WHERE id=$1::uuid").bind(qid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO job_agreements(job_id,quote_id,quote_version,amount_cents,start_window,duration,scope) SELECT job_id,id,current_version,amount_cents,start_window,duration,COALESCE(NULLIF(included,''),note) FROM job_quotes WHERE id=$1::uuid").bind(qid).execute(&mut *tx).await?;
    let eid = event(
        &mut tx,
        &id,
        &provider,
        &actor,
        "company_chosen",
        "Please confirm the agreed quote to start work.",
        Some(qid),
        Some(v),
        None,
        None,
    )
    .await?;
    alert(
        &mut tx,
        &provider,
        &provider,
        &actor,
        &eid,
        "Your quote was chosen",
        &job.get::<String, _>("title"),
        &id,
    )
    .await?;
    let others: Vec<String> = sqlx::query_scalar("SELECT DISTINCT provider_company_id::text FROM (SELECT provider_company_id FROM job_quotes WHERE job_id=$1::uuid UNION SELECT provider_company_id FROM job_invitations WHERE job_id=$1::uuid UNION SELECT provider_company_id FROM job_messages WHERE job_id=$1::uuid) providers WHERE provider_company_id<>$2::uuid")
        .bind(&id).bind(&provider).fetch_all(&mut *tx).await?;
    sqlx::query("UPDATE job_quotes SET status='not_chosen',decision_note='Another company was chosen for this job.',updated_at=now() WHERE job_id=$1::uuid AND id<>$2::uuid AND status IN ('submitted','changes_requested')").bind(&id).bind(qid).execute(&mut *tx).await?;
    for other in others {
        let eid = event(
            &mut tx,
            &id,
            &other,
            &actor,
            "not_chosen",
            "Another company was chosen. This conversation is closed.",
            None,
            None,
            None,
            None,
        )
        .await?;
        alert(
            &mut tx,
            &other,
            &other,
            &actor,
            &eid,
            "A company was chosen for this job",
            &job.get::<String, _>("title"),
            &id,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}

pub(super) async fn confirm(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    payload: Option<Json<Value>>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&id)?;
    let body = payload.map(|v| v.0).unwrap_or_else(|| json!({}));
    if !body.is_object() {
        return Err(bad("Choose whether to accept this job."));
    }
    let decision = match body.get("decision") {
        None => "accept",
        Some(value) => value
            .as_str()
            .ok_or_else(|| bad("Choose whether to accept this job."))?,
    };
    if !["accept", "decline"].contains(&decision) {
        return Err(bad("Choose whether to accept this job."));
    }
    let note = optional_text(&body, "note", 5000)?;
    if decision == "decline" && note.is_empty() {
        return Err(bad("Tell the hiring company why you cannot take this job."));
    }
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT j.hiring_company_id::text AS hirer,j.title,j.status,j.chosen_quote_id::text AS quote_id,q.provider_company_id::text AS provider,q.accepted_version FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let provider: Option<String> = job.get("provider");
    if provider.as_deref() != actor.company.as_deref() {
        return Err(forbidden());
    }
    if job.get::<String, _>("status") != "awarded" {
        return Err(conflict("This job is not awaiting your confirmation."));
    }
    let provider = provider.unwrap();
    let qid: String = job.get("quote_id");
    let v: i32 = job.get("accepted_version");
    if body["quoteId"].as_str() != Some(qid.as_str()) {
        return Err(conflict(
            "The selected quote has changed. Review it before continuing.",
        ));
    }
    version(&body, v)?;
    if decision == "accept" {
        sqlx::query("UPDATE jobs SET status='in_progress',updated_at=now() WHERE id=$1::uuid")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    } else {
        let tracked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_payment_stages WHERE job_id=$1::uuid AND status<>'planned')").bind(&id).fetch_one(&mut *tx).await?;
        if tracked {
            return Err(conflict(
                "Resolve the existing payment records before declining this job.",
            ));
        }
        sqlx::query("DELETE FROM job_payment_stages WHERE job_id=$1::uuid")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE jobs SET status='open',chosen_quote_id=NULL,updated_at=now() WHERE id=$1::uuid",
        )
        .bind(&id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM job_agreements WHERE job_id=$1::uuid")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE job_quotes SET status='award_declined',decision_note=$2,updated_at=now() WHERE id=$1::uuid").bind(&qid).bind(note).execute(&mut *tx).await?;
    }
    let eid = event(
        &mut tx,
        &id,
        &provider,
        &actor,
        if decision == "accept" {
            "award_accepted"
        } else {
            "award_declined"
        },
        if note.is_empty() {
            "The agreed quote is confirmed. Work can begin."
        } else {
            note
        },
        Some(&qid),
        Some(v),
        None,
        None,
    )
    .await?;
    alert(
        &mut tx,
        &job.get::<String, _>("hirer"),
        &provider,
        &actor,
        &eid,
        if decision == "accept" {
            "Work confirmed"
        } else {
            "The chosen company could not accept"
        },
        &job.get::<String, _>("title"),
        &id,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"ok":true,"status":if decision=="accept" {"in_progress"} else {"open"}}),
    ))
}

pub(super) async fn payment_review_needed(app: &App, job: &str) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_agreements g WHERE g.job_id=$1::uuid AND EXISTS(SELECT 1 FROM job_payment_stages s WHERE s.job_id=g.job_id) AND g.amount_cents<>(SELECT COALESCE(sum(s.amount_cents),0) FROM job_payment_stages s WHERE s.job_id=g.job_id))").bind(job).fetch_one(&app.db).await?)
}
async fn check_price_change(
    tx: &mut Transaction<'_, Postgres>,
    job: &str,
    delta: i64,
) -> Result<()> {
    if delta != 0 {
        let started: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_payment_stages WHERE job_id=$1::uuid AND status<>'planned')").bind(job).fetch_one(&mut **tx).await?;
        if started {
            return Err(conflict("Payment tracking has started. Resolve the existing invoices before changing the agreed price."));
        }
    }
    Ok(())
}

pub(super) async fn history(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let a = job_access(&app, &id, actor.company.as_deref()).await?;
    let access = message_provider(
        &app,
        &a,
        &actor,
        query.get("providerId").map(String::as_str),
        true,
    )
    .await?;
    let provider = &access.provider;
    let raw: Option<String> = sqlx::query_scalar("SELECT row_to_json(q)::text FROM job_quotes q WHERE job_id=$1::uuid AND provider_company_id=$2::uuid").bind(&id).bind(provider).fetch_optional(&app.db).await?;
    let mut quote = raw.map(parse_json).transpose()?;
    if a.hirer && quote.as_ref().is_some_and(|q| q["upload_pending"] == true) {
        quote = None;
    }
    let versions: Vec<String> = sqlx::query_scalar("SELECT (v.terms||jsonb_build_object('version',v.version,'revision_note',v.revision_note,'created_at',v.created_at,'author_name',u.name,'files',COALESCE((SELECT jsonb_agg(to_jsonb(f)-'storage_key' ORDER BY f.created_at) FROM job_quote_version_files vf JOIN job_files f ON f.id=vf.file_id WHERE vf.quote_id=v.quote_id AND vf.version=v.version),'[]'::jsonb)))::text FROM job_quote_versions v JOIN job_quotes q ON q.id=v.quote_id JOIN users u ON u.id=v.author_id WHERE q.job_id=$1::uuid AND q.provider_company_id=$2::uuid AND ($3::boolean OR EXISTS(SELECT 1 FROM job_quote_publications p WHERE p.quote_id=v.quote_id AND p.version=v.version)) ORDER BY v.version DESC")
        .bind(&id).bind(provider).bind(!a.hirer).fetch_all(&app.db).await?;
    let events: Vec<String> = sqlx::query_scalar("SELECT (to_jsonb(e)||jsonb_build_object('actor_name',u.name,'company_name',c.name))::text FROM job_conversation_events e JOIN users u ON u.id=e.actor_id JOIN companies c ON c.id=e.company_id WHERE e.job_id=$1::uuid AND e.provider_company_id=$2::uuid ORDER BY e.created_at,e.id")
        .bind(&id).bind(provider).fetch_all(&app.db).await?;
    let selected_thread: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM jobs j JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid AND q.provider_company_id=$2::uuid)").bind(&id).bind(provider).fetch_one(&app.db).await?;
    let agreement = if selected_thread {
        sqlx::query_scalar::<_, String>(
            "SELECT row_to_json(a)::text FROM job_agreements a WHERE job_id=$1::uuid",
        )
        .bind(&id)
        .fetch_optional(&app.db)
        .await?
        .map(parse_json)
        .transpose()?
    } else {
        None
    };
    let changes = if selected_thread {
        sqlx::query_scalar::<_,String>("SELECT (to_jsonb(s)||jsonb_build_object('company_name',c.name,'author_name',u.name))::text FROM job_scope_changes s JOIN companies c ON c.id=s.company_id JOIN users u ON u.id=s.proposed_by WHERE s.job_id=$1::uuid ORDER BY s.created_at DESC").bind(&id).fetch_all(&app.db).await?.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let admin = matches!(actor.role.as_deref(), Some("owner" | "admin"));
    let status = quote
        .as_ref()
        .and_then(|q| q["status"].as_str())
        .unwrap_or("");
    let deadline_open: bool = sqlx::query_scalar(
        "SELECT COALESCE(quote_deadline>=now(),true) FROM jobs WHERE id=$1::uuid",
    )
    .bind(&id)
    .fetch_one(&app.db)
    .await?;
    let payment_review = selected_thread && payment_review_needed(&app, &id).await?;
    Ok(Json(
        json!({"paymentStagesNeedReview":payment_review,"quote":quote,"versions":versions.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?,"events":events.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?,"agreement":agreement,"changes":changes,"permissions":{"hirer":a.hirer,"provider":!a.hirer,"canDecide":admin&&a.hirer&&a.status()=="open"&&status=="submitted","canRevise":admin&&!a.hirer&&a.status()=="open"&&deadline_open&&quote.is_some()&&status!="chosen","canConfirm":admin&&!a.hirer&&selected_thread&&a.status()=="awarded","canProposeChange":admin&&selected_thread&&a.status()=="in_progress"}}),
    ))
}

pub(super) async fn propose_change(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = company_actor(&app, &headers, true).await?;
    let access = job_access(&app, &id, actor.company.as_deref()).await?;
    access.participant()?;
    let title = required_text(&body, "title", 3, 160)?;
    let scope = required_text(&body, "scope", 10, 5000)?;
    let delta = body["amountDeltaCents"]
        .as_i64()
        .ok_or_else(|| bad("Enter the change to the price, or zero if unchanged."))?;
    if !(-100_000_000_000..=100_000_000_000).contains(&delta) {
        return Err(bad("Enter a valid price change."));
    }
    let start = optional_text(&body, "startWindow", 120)?;
    let duration = optional_text(&body, "duration", 120)?;
    let mut tx = app.db.begin().await?;
    let job = sqlx::query("SELECT j.status,j.hiring_company_id::text AS hirer,q.provider_company_id::text AS provider FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j").bind(&id).fetch_one(&mut *tx).await?;
    if job.get::<String, _>("status") != "in_progress" {
        return Err(conflict(
            "Changes can be proposed while work is in progress.",
        ));
    }
    if actor.company.as_deref() != Some(job.get::<String, _>("hirer").as_str())
        && actor.company.as_deref() != job.get::<Option<String>, _>("provider").as_deref()
    {
        return Err(forbidden());
    }
    let agreement = sqlx::query(
        "SELECT revision,amount_cents FROM job_agreements WHERE job_id=$1::uuid FOR UPDATE",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| conflict("The agreed quote could not be found."))?;
    let revision: i32 = agreement.get("revision");
    if body["agreementVersion"].as_i64() != Some(revision as i64) {
        return Err(conflict(
            "The agreement has changed. Review the latest terms.",
        ));
    }
    let total = agreement
        .get::<i64, _>("amount_cents")
        .checked_add(delta)
        .ok_or_else(|| bad("Enter a valid price change."))?;
    if !(1..=100_000_000_000).contains(&total) {
        return Err(bad("The new total must be greater than zero."));
    }
    check_price_change(&mut tx, &id, delta).await?;
    let pending: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM job_scope_changes WHERE job_id=$1::uuid AND status='pending')",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if pending {
        return Err(conflict(
            "Review the pending change before proposing another.",
        ));
    }
    let change_id:String=sqlx::query_scalar("INSERT INTO job_scope_changes(job_id,proposed_by,company_id,agreement_revision,title,scope,amount_delta_cents,start_window,duration) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9) RETURNING id::text").bind(&id).bind(&actor.user).bind(actor.company.as_deref()).bind(revision).bind(title).bind(scope).bind(delta).bind(start).bind(duration).fetch_one(&mut *tx).await?;
    let provider: String = job.get("provider");
    let hirer: String = job.get("hirer");
    let target = if access.hirer { &provider } else { &hirer };
    let eid = event(
        &mut tx,
        &id,
        &provider,
        &actor,
        "change_proposed",
        title,
        None,
        None,
        None,
        Some(&change_id),
    )
    .await?;
    alert(
        &mut tx,
        target,
        &provider,
        &actor,
        &eid,
        "Review a proposed job change",
        title,
        &id,
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"id":change_id}))))
}

pub(super) async fn decide_change(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, change_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, true).await?;
    checked_id(&change_id)?;
    let access = job_access(&app, &id, actor.company.as_deref()).await?;
    access.participant()?;
    let decision = required_text(&body, "decision", 1, 30)?;
    if !["accept", "decline"].contains(&decision) {
        return Err(bad("Choose a decision."));
    }
    let note = optional_text(&body, "note", 5000)?;
    if decision == "decline" && note.is_empty() {
        return Err(bad("Explain why this change cannot be accepted."));
    }
    let mut tx = app.db.begin().await?;
    let job=sqlx::query("SELECT j.status,j.hiring_company_id::text AS hirer,q.provider_company_id::text AS provider FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j").bind(&id).fetch_one(&mut *tx).await?;
    if job.get::<String, _>("status") != "in_progress" {
        return Err(conflict("This job is no longer in progress."));
    }
    if actor.company.as_deref() != Some(job.get::<String, _>("hirer").as_str())
        && actor.company.as_deref() != job.get::<Option<String>, _>("provider").as_deref()
    {
        return Err(forbidden());
    }
    let change=sqlx::query("SELECT company_id::text AS company,agreement_revision,title,scope,amount_delta_cents,start_window,duration,status FROM job_scope_changes WHERE id=$1::uuid AND job_id=$2::uuid FOR UPDATE").bind(&change_id).bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if change.get::<String, _>("company") == actor.company.as_deref().unwrap() {
        return Err(forbidden());
    }
    if change.get::<String, _>("status") != "pending" {
        return Err(conflict("This change has already been reviewed."));
    }
    let status = if decision == "accept" {
        "accepted"
    } else {
        "declined"
    };
    if decision == "accept" {
        check_price_change(&mut tx, &id, change.get::<i64, _>("amount_delta_cents")).await?;
        let result=sqlx::query("UPDATE job_agreements SET amount_cents=amount_cents+$2,start_window=COALESCE(NULLIF($3,''),start_window),duration=COALESCE(NULLIF($4,''),duration),scope=scope||E'\n\n'||$5,revision=revision+1,updated_at=now() WHERE job_id=$1::uuid AND revision=$6")
            .bind(&id).bind(change.get::<i64,_>("amount_delta_cents")).bind(change.get::<String,_>("start_window")).bind(change.get::<String,_>("duration")).bind(change.get::<String,_>("scope")).bind(change.get::<i32,_>("agreement_revision")).execute(&mut *tx).await?;
        if result.rows_affected() != 1 {
            return Err(conflict(
                "The agreement has changed. Ask for an updated proposal.",
            ));
        }
    }
    sqlx::query("UPDATE job_scope_changes SET status=$2,decision_note=$3,decided_by=$4::uuid,decided_at=now() WHERE id=$1::uuid").bind(&change_id).bind(status).bind(note).bind(&actor.user).execute(&mut *tx).await?;
    let provider: String = job.get("provider");
    let eid = event(
        &mut tx,
        &id,
        &provider,
        &actor,
        if decision == "accept" {
            "change_accepted"
        } else {
            "change_declined"
        },
        note,
        None,
        None,
        None,
        Some(&change_id),
    )
    .await?;
    alert(
        &mut tx,
        &change.get::<String, _>("company"),
        &provider,
        &actor,
        &eid,
        if decision == "accept" {
            "Job change accepted"
        } else {
            "Job change declined"
        },
        &change.get::<String, _>("title"),
        &id,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true,"status":status})))
}
