use super::*;

// Shared by history, sends and pinned messages so all surfaces enforce identical visibility.
pub(super) fn message_json(user_parameter: usize) -> String {
    format!(
        r#"(to_jsonb(m)||jsonb_build_object(
      'sender_name',c.name,'author_name',u.name,
      'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'original_name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'created_at',f.created_at) ORDER BY f.created_at,f.id) FROM job_files f WHERE f.message_id=m.id),'[]'::jsonb),
      'reply',(SELECT jsonb_build_object('id',r.id,'body',r.body,'author_name',ru.name,'sender_name',rc.name,'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',rf.id,'original_name',rf.original_name,'mime_type',rf.mime_type,'size_bytes',rf.size_bytes)) FROM job_files rf WHERE rf.message_id=r.id),'[]'::jsonb)) FROM job_messages r JOIN users ru ON ru.id=r.author_id JOIN companies rc ON rc.id=r.sender_company_id WHERE r.id=m.reply_to AND r.job_id=m.job_id AND r.provider_company_id=m.provider_company_id),
      'reactions',COALESCE((SELECT jsonb_agg(x.value ORDER BY x.emoji) FROM (SELECT jr.emoji,jsonb_build_object('emoji',jr.emoji,'count',count(*),'reacted',bool_or(jr.user_id=${user_parameter}::uuid),'people',jsonb_agg(jsonb_build_object('id',ju.id,'name',ju.name,'company_name',jc.name) ORDER BY jr.created_at)) AS value FROM job_message_reactions jr JOIN users ju ON ju.id=jr.user_id JOIN companies jc ON jc.id=jr.company_id WHERE jr.message_id=m.id GROUP BY jr.emoji) x),'[]'::jsonb),
      'pinned',m.pinned_at IS NOT NULL,
      'readByOtherCompany',EXISTS(SELECT 1 FROM job_message_reads mr WHERE mr.job_id=m.job_id AND mr.provider_company_id=m.provider_company_id AND mr.company_id<>m.sender_company_id AND (mr.last_read_at,mr.last_read_message_id)>=(m.created_at,m.id))
    ))"#
    )
}

pub(super) async fn sending_reason(
    app: &App,
    id: &str,
    provider: &str,
) -> Result<Option<&'static str>> {
    let row = sqlx::query("SELECT j.status,q.provider_company_id::text AS selected FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid")
        .bind(id).fetch_one(&app.db).await?;
    Ok(status_reason(
        &row.get::<String, _>("status"),
        row.get::<Option<String>, _>("selected").as_deref(),
        provider,
    ))
}

pub(super) fn status_reason(
    status: &str,
    selected: Option<&str>,
    provider: &str,
) -> Option<&'static str> {
    if matches!(status, "completed" | "cancelled") {
        Some("This job is closed. Your conversation and files remain available here.")
    } else if status != "open" && selected != Some(provider) {
        Some("Another company was chosen. This conversation is now read-only.")
    } else {
        None
    }
}

pub(super) async fn files(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let access = job_access(&app, &id, actor.company.as_deref()).await?;
    let contact = message_provider(
        &app,
        &access,
        &actor,
        query.get("providerId").map(String::as_str),
        true,
    )
    .await?;
    let rows: Vec<String> = sqlx::query_scalar("SELECT jsonb_build_object('id',f.id,'original_name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'created_at',f.created_at,'message_id',f.message_id,'author_name',u.name,'company_name',c.name)::text FROM job_files f JOIN users u ON u.id=f.uploaded_by JOIN companies c ON c.id=f.company_id WHERE f.job_id=$1::uuid AND f.provider_company_id=$2::uuid AND f.message_id IS NOT NULL ORDER BY f.created_at DESC,f.id DESC LIMIT 500")
        .bind(&id).bind(&contact.provider).fetch_all(&app.db).await?;
    Ok(Json(
        json!({"files":rows.into_iter().map(parse_json).collect::<Result<Vec<_>>>()?}),
    ))
}

pub(super) async fn read_events(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let access = job_access(&app, &id, actor.company.as_deref()).await?;
    let contact =
        message_provider(&app, &access, &actor, body["providerId"].as_str(), false).await?;
    let event = checked_id(required_text(&body, "eventId", 36, 36)?)?;
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_conversation_events WHERE id=$1::uuid AND job_id=$2::uuid AND provider_company_id=$3::uuid)")
        .bind(event).bind(&id).bind(&contact.provider).fetch_one(&app.db).await?;
    if !exists {
        return Err(not_found());
    }
    let ids:Vec<String>=sqlx::query_scalar("UPDATE user_notifications n SET read_at=now() WHERE n.user_id=$1::uuid AND n.company_id=$2::uuid AND n.read_at IS NULL AND n.event_key IN (SELECT 'job-event:'||e.id::text FROM job_conversation_events e WHERE e.job_id=$3::uuid AND e.provider_company_id=$4::uuid AND (e.created_at,e.id)<=(SELECT created_at,id FROM job_conversation_events WHERE id=$5::uuid)) RETURNING n.id::text")
        .bind(&actor.user).bind(actor.company.as_deref()).bind(&id).bind(&contact.provider).bind(event).fetch_all(&app.db).await?;
    Ok(Json(json!({"notificationIds":ids})))
}

fn valid_emoji(value: &str) -> bool {
    value.chars().count() <= 32 && value.len() <= 128 && value.chars().any(|c| matches!(c as u32,0x1F000..=0x1FAFF|0x2600..=0x27BF|0x2300..=0x23FF|0x2B00..=0x2BFF|0x00A9|0x00AE|0x2122|0x203C|0x2049|0x3030|0x303D|0x3297|0x3299|0x20E3)) && value.chars().all(|c| matches!(c as u32,0x1F000..=0x1FAFF|0x2600..=0x27BF|0x2300..=0x23FF|0x2B00..=0x2BFF|0x00A9|0x00AE|0x2122|0x203C|0x2049|0x3030|0x303D|0x3297|0x3299|0x20E3|0xFE0F|0xFE0E|0x200D|0xE0020..=0xE007F|0x30..=0x39|0x23|0x2A))
}

pub(super) async fn react(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, message)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let access = job_access(&app, &id, actor.company.as_deref()).await?;
    let contact =
        message_provider(&app, &access, &actor, body["providerId"].as_str(), false).await?;
    checked_id(&message)?;
    let emoji = required_text(&body, "emoji", 1, 128)?;
    if !valid_emoji(emoji) {
        return Err(bad("Choose an emoji reaction."));
    }
    let mut tx = app.db.begin().await?;
    let current=sqlx::query("SELECT j.status,q.provider_company_id::text AS selected FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(&id).fetch_one(&mut *tx).await?;
    if status_reason(
        &current.get::<String, _>("status"),
        current.get::<Option<String>, _>("selected").as_deref(),
        &contact.provider,
    )
    .is_some()
    {
        return Err(forbidden());
    }
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM job_messages WHERE id=$1::uuid AND job_id=$2::uuid AND provider_company_id=$3::uuid)")
        .bind(&message).bind(&id).bind(&contact.provider).fetch_one(&mut *tx).await?;
    if !exists {
        return Err(not_found());
    }
    let removed=sqlx::query("DELETE FROM job_message_reactions WHERE message_id=$1::uuid AND user_id=$2::uuid AND emoji=$3")
        .bind(&message).bind(&actor.user).bind(emoji).execute(&mut *tx).await?.rows_affected();
    if removed == 0 {
        sqlx::query("INSERT INTO job_message_reactions(message_id,user_id,company_id,emoji) VALUES($1::uuid,$2::uuid,$3::uuid,$4)")
        .bind(&message).bind(&actor.user).bind(actor.company.as_deref()).bind(emoji).execute(&mut *tx).await?;
    }
    let raw:String=sqlx::query_scalar(&format!("SELECT {}::text FROM job_messages m JOIN users u ON u.id=m.author_id JOIN companies c ON c.id=m.sender_company_id WHERE m.id=$1::uuid",message_json(2)))
        .bind(&message).bind(&actor.user).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    let value = parse_json(raw)?;
    Ok(Json(
        json!({"reactions":value["reactions"],"message":value}),
    ))
}

pub(super) async fn pin(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, message)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let actor = company_actor(&app, &headers, false).await?;
    let access = job_access(&app, &id, actor.company.as_deref()).await?;
    let contact =
        message_provider(&app, &access, &actor, body["providerId"].as_str(), false).await?;
    checked_id(&message)?;
    let pinned = body["pinned"]
        .as_bool()
        .ok_or_else(|| bad("Choose whether to pin this message."))?;
    let mut tx = app.db.begin().await?;
    let current=sqlx::query("SELECT j.status,q.provider_company_id::text AS selected FROM jobs j LEFT JOIN job_quotes q ON q.id=j.chosen_quote_id WHERE j.id=$1::uuid FOR UPDATE OF j")
        .bind(&id).fetch_one(&mut *tx).await?;
    if status_reason(
        &current.get::<String, _>("status"),
        current.get::<Option<String>, _>("selected").as_deref(),
        &contact.provider,
    )
    .is_some()
    {
        return Err(forbidden());
    }
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM job_messages WHERE job_id=$1::uuid AND provider_company_id=$2::uuid AND pinned_at IS NOT NULL AND id<>$3::uuid")
        .bind(&id).bind(&contact.provider).bind(&message).fetch_one(&mut *tx).await?;
    if pinned && count >= 10 {
        return Err(conflict(
            "Unpin a message before adding another. You can keep 10 messages pinned.",
        ));
    }
    let changed=sqlx::query("UPDATE job_messages SET pinned_at=CASE WHEN $4 THEN COALESCE(pinned_at,now()) ELSE NULL END,pinned_by=CASE WHEN $4 THEN $5::uuid ELSE NULL END WHERE id=$1::uuid AND job_id=$2::uuid AND provider_company_id=$3::uuid")
        .bind(&message).bind(&id).bind(&contact.provider).bind(pinned).bind(&actor.user).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        return Err(not_found());
    }
    tx.commit().await?;
    Ok(Json(json!({"pinned":pinned})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_rules_are_symmetric() {
        assert!(status_reason("open", None, "a").is_none());
        assert!(status_reason("in_progress", Some("a"), "a").is_none());
        assert!(status_reason("awarded", Some("a"), "b").is_some());
        assert!(status_reason("completed", Some("a"), "a").is_some());
        assert!(status_reason("cancelled", None, "b").is_some());
    }
    #[test]
    fn reactions_accept_compound_emoji_not_arbitrary_text() {
        for emoji in ["👍", "👍🏽", "❤️", "👨‍👩‍👦", "🇺🇸", "1️⃣"] {
            assert!(valid_emoji(emoji));
        }
        for value in ["", "great", "hello👍", "<script>🔥", "🔥\n"] {
            assert!(!valid_emoji(value));
        }
    }
}
