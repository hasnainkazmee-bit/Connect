use super::*;
fn selection() -> String {
    format!("(to_jsonb(p)||jsonb_build_object('company',{},'author',jsonb_build_object('id',u.id,'name',u.name),'community_name',comm.name,'files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'width',f.width,'height',f.height,'url','/api/network-v2/files/'||f.id) ORDER BY pf.sort_order) FROM network_post_files pf JOIN network_files f ON f.id=pf.file_id WHERE pf.post_id=p.id),'[]'::jsonb),'reaction_count',(SELECT count(*) FROM network_post_states WHERE post_id=p.id AND liked),'comment_count',(SELECT count(*) FROM network_comments WHERE post_id=p.id AND deleted_at IS NULL),'liked',COALESCE(st.liked,false),'saved',COALESCE(st.saved,false)))::text",company_sql("co"))
}
fn joins() -> &'static str {
    "FROM network_posts p JOIN companies co ON co.id=p.company_id JOIN users u ON u.id=p.author_id LEFT JOIN network_communities comm ON comm.id=p.community_id LEFT JOIN network_post_states st ON st.post_id=p.id AND st.user_id=$2::uuid AND st.company_id=$3::uuid"
}
async fn decorate(app: &App, mut p: Value, c: &Context) -> Result<Value> {
    let comm = if let Some(id) = p["community_id"].as_str() {
        Some(community_access(app, id, c).await?)
    } else {
        None
    };
    let allowed = comm.as_ref().is_none_or(|v| v["can_post"] == true);
    p["can_edit"] = json!(can_edit_post(&p, c) && allowed && writer(c, false).is_ok());
    p["can_delete"] = json!(can_edit_post(&p, c) && writer(c, false).is_ok());
    p["can_comment"] = json!(writer(c, false).is_ok() && allowed && p["comments_open"] == true);
    p["can_moderate"] =
        json!(comm.as_ref().is_some_and(|v| v["can_moderate"] == true) || c.is_admin);
    if p["author_id"] != c.actor.user || p["company_id"].as_str() != c.actor.company.as_deref() {
        p["source_job_id"] = Value::Null;
    }
    p.as_object_mut().unwrap().remove("request_hash");
    Ok(p)
}
pub(super) async fn access(app: &App, id: &str, c: &Context) -> Result<Value> {
    checked_id(id)?;
    let raw: Option<String> = sqlx::query_scalar(&format!(
        "SELECT {} {} WHERE p.id=$1::uuid AND network_can_read_post(p.id,$2::uuid,$4)",
        selection(),
        joins()
    ))
    .bind(id)
    .bind(&c.actor.user)
    .bind(c.actor.company.as_deref())
    .bind(c.is_demo)
    .fetch_optional(&app.db)
    .await?;
    decorate(app, parse_json(raw.ok_or_else(missing)?)?, c).await
}
async fn list(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    for id in [&s.company_id, &s.community_id, &s.topic_id]
        .into_iter()
        .flatten()
    {
        checked_id(id)?;
    }
    if let Some(id) = &s.community_id {
        if community_access(&app, id, &c).await?["can_read"] != true {
            return Err(forbidden());
        }
    }
    let rows:Vec<String>=sqlx::query_scalar(&format!("SELECT {} {} WHERE p.sequence<$1 AND network_can_read_post(p.id,$2::uuid,$4) AND NOT COALESCE(st.hidden,false) AND ($5::uuid IS NULL OR p.company_id=$5::uuid) AND (($6::uuid IS NOT NULL AND p.community_id=$6::uuid) OR ($6::uuid IS NULL AND ($7 OR p.community_id IS NULL))) AND (NOT $7 OR COALESCE(st.saved,false)) AND (NOT $8 OR EXISTS(SELECT 1 FROM network_follows f WHERE f.user_id=$2::uuid AND f.company_id=$3::uuid AND f.followed_company_id=p.company_id)) AND (p.body ILIKE $9 OR p.title ILIKE $9) AND ($10::uuid IS NULL OR p.topic_id=$10::uuid) ORDER BY p.sequence DESC LIMIT $11",selection(),joins()))
 .bind(s.cursor()).bind(&c.actor.user).bind(c.actor.company.as_deref()).bind(c.is_demo).bind(s.company_id.as_deref()).bind(s.community_id.as_deref()).bind(s.saved.unwrap_or(false)).bind(s.following.unwrap_or(false)).bind(s.query()?).bind(s.topic_id.as_deref()).bind(s.limit()).fetch_all(&app.db).await?;
    let mut items = Vec::new();
    for raw in rows {
        items.push(decorate(&app, parse_json(raw)?, &c).await?)
    }
    Ok(Json(page(items, s.limit())))
}
async fn detail(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    Ok(Json(json!({"post":access(&app,&id,&c).await?})))
}
fn validate_content(v: &Value, community: bool, has_files: bool) -> Result<()> {
    let body = txt(v, "body", 10000)?;
    let title = txt(v, "title", 180)?;
    if body.is_empty() && !has_files {
        return Err(bad("Write something or add a file before posting."));
    }
    if community && title.chars().count() < 3 {
        return Err(bad("Add a title for this discussion."));
    }
    if !matches!(
        v["kind"].as_str().unwrap_or("post"),
        "post" | "question" | "sourcing" | "available"
    ) {
        return Err(bad("Choose a supported post type."));
    }
    if !community && v["kind"].as_str().unwrap_or("post") != "post" {
        return Err(bad("Choose a community for this post type."));
    }
    if !matches!(
        v["media_format"].as_str().unwrap_or("4:5"),
        "4:5" | "1:1" | "1.91:1" | "3:4"
    ) {
        return Err(bad("Choose an image format."));
    }
    Ok(())
}
async fn attach(
    tx: &mut Transaction<'_, Postgres>,
    c: &Context,
    post: &str,
    community: Option<&str>,
    ids: &[String],
) -> Result<()> {
    for (order, id) in ids.iter().enumerate() {
        let row=sqlx::query("SELECT owner_user_id::text,company_id::text,community_id::text,purpose FROM network_files WHERE id=$1::uuid FOR UPDATE").bind(id).fetch_optional(&mut **tx).await?.ok_or_else(||bad("An attachment is missing. Upload it again."))?;
        if row.get::<String, _>("owner_user_id") != c.actor.user
            || Some(row.get::<String, _>("company_id").as_str()) != c.actor.company.as_deref()
            || row.get::<Option<String>, _>("community_id").as_deref() != community
            || row.get::<String, _>("purpose") != "post"
        {
            return Err(forbidden());
        }
        let used: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM network_post_files WHERE file_id=$1::uuid)",
        )
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
        if used {
            return Err(conflict(
                "This attachment is already published. Upload a new copy.",
            ));
        }
        sqlx::query("INSERT INTO network_post_files(post_id,file_id,sort_order) VALUES($1::uuid,$2::uuid,$3)").bind(post).bind(id).bind(order as i32).execute(&mut **tx).await?;
    }
    Ok(())
}
async fn destination(app: &App, c: &Context, community: Option<&str>) -> Result<Option<Value>> {
    writer(c, community.is_none())?;
    if let Some(id) = community {
        let comm = community_access(app, id, c).await?;
        if comm["can_post"] != true {
            return Err(forbidden());
        }
        Ok(Some(comm))
    } else {
        Ok(None)
    }
}
fn request_hash(v: &Value) -> String {
    format!("{:x}", Sha256::digest(v.to_string().as_bytes()))
}
async fn create(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    let client = uid(&v, "client_id")?.ok_or_else(|| bad("A request identifier is required."))?;
    let community = uid(&v, "community_id")?;
    let hash = request_hash(&v);
    let mut tx = app.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("network-post:{}:{company}:{client}", c.actor.user))
        .execute(&mut *tx)
        .await?;
    if let Some(row)=sqlx::query("SELECT id::text,request_hash FROM network_posts WHERE author_id=$1::uuid AND company_id=$2::uuid AND client_id=$3::uuid").bind(&c.actor.user).bind(company).bind(client).fetch_optional(&mut *tx).await?{if row.get::<String,_>("request_hash")!=hash{return Err(conflict("This request was already used for a different post."))}let id:String=row.get("id");tx.commit().await?;return Ok(Json(json!({"post":access(&app,&id,&c).await?}))) }
    let comm = destination(&app, &c, community).await?;
    let files = fields::id_list(&v, "file_ids", 10)?;
    validate_content(&v, community.is_some(), !files.is_empty())?;
    let (topic, label, tver, answers) = if let Some(comm) = &comm {
        fields::answers(&v, comm)?
    } else {
        (None, String::new(), None, json!([]))
    };
    // Lock destination so archiving, changing forms or removing membership cannot race publication.
    if let Some(cid) = community {
        sqlx::query("SELECT id FROM network_communities WHERE id=$1::uuid FOR UPDATE")
            .bind(cid)
            .fetch_one(&mut *tx)
            .await?;
        let fresh = destination(&app, &c, community).await?;
        if fresh
            .as_ref()
            .is_some_and(|f| Some(&f["version"]) != comm.as_ref().map(|c| &c["version"]))
        {
            return Err(conflict(
                "This community changed. Reload before publishing.",
            ));
        }
    }
    let id:String=sqlx::query_scalar("INSERT INTO network_posts(client_id,author_id,company_id,community_id,kind,title,body,topic_id,topic_label,topic_version,answers,media_format,comments_open,is_demo,request_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::uuid,$9,$10,$11::jsonb,$12,$13,$14,$15) RETURNING id::text")
 .bind(client).bind(&c.actor.user).bind(company).bind(community).bind(v["kind"].as_str().unwrap_or("post")).bind(txt(&v,"title",180)?).bind(txt(&v,"body",10000)?).bind(topic).bind(label).bind(tver).bind(answers.to_string()).bind(v["media_format"].as_str().unwrap_or("4:5")).bind(v["comments_open"].as_bool().unwrap_or(true)).bind(c.is_demo).bind(hash).fetch_one(&mut *tx).await?;
    attach(&mut tx, &c, &id, community, &files).await?;
    // Fan-out is one transactional statement; notification and push outbox writes
    // commit with the publication and never truncate a large community's members.
    sqlx::query("INSERT INTO user_notifications(user_id,company_id,actor_user_id,actor_company_id,event_key,type,category,title,text,url,source_kind,source_id) SELECT recipients.user_id,recipients.company_id,$1::uuid,$2::uuid,$3||':'||recipients.company_id::text,CASE WHEN $4::uuid IS NULL THEN 'network_company_post' ELSE 'network_community_post' END,'social','New activity in Network','Open Network to view this activity.',$5,'network_post',$6::uuid FROM (SELECT user_id,company_id FROM network_members WHERE community_id=$4::uuid AND status='joined' UNION SELECT user_id,company_id FROM network_follows WHERE followed_company_id=$2::uuid AND $4::uuid IS NULL) recipients JOIN companies co ON co.id=recipients.company_id LEFT JOIN network_notification_preferences pref ON pref.user_id=recipients.user_id WHERE recipients.user_id<>$1::uuid AND co.is_demo=$7 AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=recipients.user_id AND m.company_id=recipients.company_id) AND CASE WHEN $4::uuid IS NULL THEN COALESCE(pref.company_posts,true) ELSE COALESCE(pref.community_posts,true) END ON CONFLICT(user_id,event_key) DO NOTHING")
        .bind(&c.actor.user).bind(company).bind(format!("network:post:{id}")).bind(community).bind(format!("/network/posts/{id}")).bind(&id).bind(c.is_demo).execute(&mut *tx).await?;
    let p = json!({"id":id,"community_id":community});
    let mentions = notify_mentions(&mut tx, &c, &v, &p, &format!("post:{id}")).await?;
    sqlx::query("UPDATE network_posts SET mentions=$1::jsonb WHERE id=$2::uuid")
        .bind(mentions.to_string())
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if let Some(did) = uid(&v, "draft_id")? {
        sqlx::query("DELETE FROM network_drafts WHERE id=$1::uuid AND author_id=$2::uuid AND company_id=$3::uuid AND version=$4").bind(did).bind(&c.actor.user).bind(company).bind(v["draft_version"].as_i64().unwrap_or(-1) as i32).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"post":access(&app,&id,&c).await?})))
}
async fn edit(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let p = access(&app, &id, &c).await?;
    if p["can_edit"] != true {
        return Err(forbidden());
    }
    let ver = version(&v)?;
    let mut input = p.clone();
    for key in ["body", "title", "media_format", "comments_open"] {
        if let Some(val) = v.get(key) {
            input[key] = val.clone()
        }
    }
    validate_content(
        &input,
        !p["community_id"].is_null(),
        p["files"].as_array().is_some_and(|f| !f.is_empty()),
    )?;
    if v.get("file_ids").is_some() {
        let ids = fields::id_list(&v, "file_ids", 10)?;
        let old: Vec<String> = p["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|f| f["id"].as_str().map(str::to_string))
            .collect();
        if old != ids {
            return Err(bad(
                "Published attachments stay unchanged. Create a new post to replace them.",
            ));
        }
    }
    let answers = if let Some(cid) = p["community_id"].as_str() {
        fields::edit_answers(&v, &p, &community_access(&app, cid, &c).await?)?
    } else {
        json!([])
    };
    let mut tx = app.db.begin().await?;
    if let Some(cid) = p["community_id"].as_str() {
        sqlx::query("SELECT id FROM network_communities WHERE id=$1::uuid FOR UPDATE")
            .bind(cid)
            .fetch_one(&mut *tx)
            .await?;
        if access(&app, &id, &c).await?["can_edit"] != true {
            return Err(forbidden());
        }
    }
    let mentions = if v.get("mention_user_ids").is_some() || v.get("mention_company_ids").is_some()
    {
        let mut mention_input = v.clone();
        mention_input["body"] = input["body"].clone();
        notify_mentions(
            &mut tx,
            &c,
            &mention_input,
            &p,
            &format!("postedit:{id}:{}", ver + 1),
        )
        .await?
    } else {
        p["mentions"].clone()
    };
    let changed=sqlx::query("UPDATE network_posts SET title=$1,body=$2,answers=$3::jsonb,media_format=$4,comments_open=$5,version=version+1,updated_at=now(),mentions=$8::jsonb WHERE id=$6::uuid AND version=$7 AND status='published'")
 .bind(input["title"].as_str()).bind(input["body"].as_str()).bind(answers.to_string()).bind(input["media_format"].as_str()).bind(input["comments_open"].as_bool().unwrap_or(true)).bind(&id).bind(ver).bind(mentions.to_string()).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict("This post changed. Reload before saving."));
    }
    tx.commit().await?;
    Ok(Json(json!({"post":access(&app,&id,&c).await?})))
}
async fn delete(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let p = access(&app, &id, &c).await?;
    if p["can_delete"] != true {
        return Err(forbidden());
    }
    let changed=sqlx::query("UPDATE network_posts SET status='deleted',version=version+1,updated_at=now() WHERE id=$1::uuid AND version=$2 AND status='published'").bind(id).bind(version(&v)?).execute(&app.db).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict("This post changed. Reload before deleting."));
    }
    Ok(Json(json!({"ok":true})))
}
async fn state(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    let p = access(&app, &id, &c).await?;
    let action = req(&v, "action", 1, 20)?;
    match action {
        "save" | "like" | "hide" => {
            let value = v["value"]
                .as_bool()
                .ok_or_else(|| bad("Choose a setting."))?;
            let column = match action {
                "save" => "saved",
                "like" => "liked",
                _ => "hidden",
            };
            sqlx::query(&format!("INSERT INTO network_post_states(post_id,user_id,company_id,{column}) VALUES($1::uuid,$2::uuid,$3::uuid,$4) ON CONFLICT(post_id,user_id,company_id) DO UPDATE SET {column}=$4,updated_at=now()"))
 .bind(&id).bind(&c.actor.user).bind(company).bind(value).execute(&app.db).await?;
        }
        "comments" | "sourcing" | "pin" | "moderate" => {
            let moderator = p["can_moderate"] == true;
            let owner = p["can_edit"] == true;
            if matches!(action, "pin" | "moderate") && !moderator {
                return Err(forbidden());
            }
            if !owner && !moderator {
                return Err(forbidden());
            }
            match action {
                "comments" => {
                    let value = v["value"]
                        .as_bool()
                        .ok_or_else(|| bad("Choose a comments setting."))?;
                    sqlx::query("UPDATE network_posts SET comments_open=$1,version=version+1,updated_at=now() WHERE id=$2::uuid").bind(value).bind(&id).execute(&app.db).await?;
                }
                "sourcing" => {
                    if !owner || !matches!(p["kind"].as_str(), Some("sourcing" | "available")) {
                        return Err(forbidden());
                    }
                    let value = v["value"].as_str().unwrap_or("");
                    if !matches!(value, "open" | "sourced" | "unavailable") {
                        return Err(bad("Choose a sourcing status."));
                    }
                    sqlx::query("UPDATE network_posts SET sourcing_status=$1,version=version+1,updated_at=now() WHERE id=$2::uuid").bind(value).bind(&id).execute(&app.db).await?;
                }
                "pin" => {
                    let value = v["value"]
                        .as_bool()
                        .ok_or_else(|| bad("Choose a pin setting."))?;
                    let cid = p["community_id"]
                        .as_str()
                        .ok_or_else(|| bad("Only community discussions can be pinned."))?;
                    let mut tx = app.db.begin().await?;
                    sqlx::query("SELECT id FROM network_communities WHERE id=$1::uuid FOR UPDATE")
                        .bind(cid)
                        .fetch_one(&mut *tx)
                        .await?;
                    if value {
                        let count:i64=sqlx::query_scalar("SELECT count(*) FROM network_posts WHERE community_id=$1::uuid AND pinned AND status='published' AND id<>$2::uuid").bind(cid).bind(&id).fetch_one(&mut *tx).await?;
                        if count >= 3 {
                            return Err(conflict("Unpin a discussion before pinning another. Up to three can stay at the top."));
                        }
                    }
                    sqlx::query("UPDATE network_posts SET pinned=$1,version=version+1,updated_at=now() WHERE id=$2::uuid").bind(value).bind(&id).execute(&mut *tx).await?;
                    tx.commit().await?;
                }
                _ => {
                    if v["value"] != "remove" {
                        return Err(bad("Choose a moderation action."));
                    }
                    let reason = req(&v, "reason", 3, 2000)?;
                    let mut tx = app.db.begin().await?;
                    sqlx::query("UPDATE network_posts SET status='removed',version=version+1,updated_at=now() WHERE id=$1::uuid AND status='published'").bind(&id).execute(&mut *tx).await?;
                    sqlx::query("INSERT INTO network_moderation_log(community_id,post_id,actor_id,action,reason) VALUES($1::uuid,$2::uuid,$3::uuid,'remove',$4)").bind(p["community_id"].as_str()).bind(&id).bind(&c.actor.user).bind(reason).execute(&mut *tx).await?;
                    tx.commit().await?;
                }
            }
        }
        _ => return Err(bad("Choose a post action.")),
    }
    Ok(Json(json!({"ok":true})))
}
async fn report(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    writer(&c, false)?;
    let p = access(&app, &id, &c).await?;
    sqlx::query("INSERT INTO network_reports(post_id,community_id,reporter_id,reason,details) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5) ON CONFLICT(post_id,reporter_id) WHERE status='open' DO NOTHING")
 .bind(id).bind(p["community_id"].as_str()).bind(&c.actor.user).bind(req(&v,"reason",3,120)?).bind(txt(&v,"details",3000)?).execute(&app.db).await?;
    Ok(Json(json!({"ok":true})))
}
fn comment_select() -> String {
    format!("(to_jsonb(cm)-'request_hash'||jsonb_build_object('body',CASE WHEN cm.deleted_at IS NULL THEN cm.body ELSE '' END,'author',jsonb_build_object('id',u.id,'name',u.name),'company',{},'can_edit',cm.author_id=$2::uuid AND cm.company_id=$3::uuid AND cm.deleted_at IS NULL))::text",company_sql("co"))
}
async fn comment(app: &App, id: &str, c: &Context) -> Result<Value> {
    let raw:String=sqlx::query_scalar(&format!("SELECT {} FROM network_comments cm JOIN users u ON u.id=cm.author_id JOIN companies co ON co.id=cm.company_id WHERE cm.id=$1::uuid",comment_select())).bind(id).bind(&c.actor.user).bind(c.actor.company.as_deref()).fetch_one(&app.db).await?;
    parse_json(raw)
}
async fn comments(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    access(&app, &id, &c).await?;
    let rows:Vec<String>=sqlx::query_scalar(&format!("SELECT {} FROM network_comments cm JOIN users u ON u.id=cm.author_id JOIN companies co ON co.id=cm.company_id WHERE cm.post_id=$1::uuid AND cm.sequence>$4 ORDER BY cm.sequence LIMIT $5",comment_select())).bind(id).bind(&c.actor.user).bind(c.actor.company.as_deref()).bind(s.cursor.unwrap_or(0).max(0)).bind(s.limit()).fetch_all(&app.db).await?;
    Ok(Json(page(json_rows(rows)?, s.limit())))
}
async fn add_comment(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    let p = access(&app, &id, &c).await?;
    let client = uid(&v, "client_id")?.ok_or_else(|| bad("A request identifier is required."))?;
    let parent = uid(&v, "parent_id")?;
    let body = req(&v, "body", 1, 5000)?;
    let hash = request_hash(&v);
    let mut tx = app.db.begin().await?;
    if let Some(cid) = p["community_id"].as_str() {
        sqlx::query("SELECT id FROM network_communities WHERE id=$1::uuid FOR UPDATE")
            .bind(cid)
            .fetch_one(&mut *tx)
            .await?;
    }
    sqlx::query("SELECT id FROM network_posts WHERE id=$1::uuid FOR UPDATE")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    if let Some(row)=sqlx::query("SELECT id::text,request_hash FROM network_comments WHERE post_id=$1::uuid AND author_id=$2::uuid AND company_id=$3::uuid AND client_id=$4::uuid").bind(&id).bind(&c.actor.user).bind(company).bind(client).fetch_optional(&mut *tx).await?{if row.get::<String,_>("request_hash")!=hash{return Err(conflict("This request was used for another reply."))}let cid:String=row.get("id");tx.commit().await?;return Ok(Json(json!({"comment":comment(&app,&cid,&c).await?}))) }
    if p["can_comment"] != true {
        return Err(forbidden());
    }
    let current = access(&app, &id, &c).await?;
    if current["can_comment"] != true {
        return Err(forbidden());
    }
    let mut reply_target = None;
    if let Some(parent) = parent {
        let row=sqlx::query("SELECT parent_id::text,author_id::text,company_id::text FROM network_comments WHERE id=$1::uuid AND post_id=$2::uuid").bind(parent).bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(||bad("The reply's parent is unavailable."))?;
        if row.get::<Option<String>, _>("parent_id").is_some() {
            return Err(bad("Reply to the top-level comment."));
        }
        reply_target = Some((
            row.get::<String, _>("author_id"),
            row.get::<String, _>("company_id"),
        ));
    }
    let cid:String=sqlx::query_scalar("INSERT INTO network_comments(post_id,author_id,company_id,parent_id,client_id,body,request_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7) RETURNING id::text").bind(&id).bind(&c.actor.user).bind(company).bind(parent).bind(client).bind(body).bind(hash).fetch_one(&mut *tx).await?;
    let mut recipients = vec![(
        p["author_id"].as_str().unwrap().to_string(),
        p["company_id"].as_str().unwrap().to_string(),
    )];
    if let Some(t) = reply_target {
        if !recipients.contains(&t) {
            recipients.push(t)
        }
    }
    for (user, company) in recipients {
        let can_read: bool =
            sqlx::query_scalar("SELECT network_can_read_post($1::uuid,$2::uuid,$3)")
                .bind(&id)
                .bind(&user)
                .bind(c.is_demo)
                .fetch_one(&mut *tx)
                .await?;
        if can_read {
            notify(
                &mut tx,
                &c,
                &user,
                Some(&company),
                &format!("network:comment:{cid}"),
                "reply",
                "network_post",
                &id,
                &format!("/network/posts/{id}?comment={cid}"),
            )
            .await?;
        }
    }
    let mut mention_context = p.clone();
    mention_context["mentions"] = json!([]);
    let mentions =
        notify_mentions(&mut tx, &c, &v, &mention_context, &format!("comment:{cid}")).await?;
    sqlx::query("UPDATE network_comments SET mentions=$1::jsonb WHERE id=$2::uuid")
        .bind(mentions.to_string())
        .bind(&cid)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"comment":comment(&app,&cid,&c).await?})))
}
async fn comment_owner(app: &App, id: &str, c: &Context) -> Result<Value> {
    checked_id(id)?;
    let row: Option<String> =
        sqlx::query_scalar("SELECT row_to_json(c)::text FROM network_comments c WHERE id=$1::uuid")
            .bind(id)
            .fetch_optional(&app.db)
            .await?;
    let v = parse_json(row.ok_or_else(missing)?)?;
    access(app, v["post_id"].as_str().unwrap(), c).await?;
    if v["author_id"] != c.actor.user
        || v["company_id"].as_str() != c.actor.company.as_deref()
        || !v["deleted_at"].is_null()
    {
        return Err(forbidden());
    }
    writer(c, false)?;
    Ok(v)
}
async fn edit_comment(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let old = comment_owner(&app, &id, &c).await?;
    let ver = version(&v)?;
    let body = req(&v, "body", 1, 5000)?;
    let mut tx = app.db.begin().await?;
    let mut p = access(&app, old["post_id"].as_str().unwrap(), &c).await?;
    p["mentions"] = old["mentions"].clone();
    let mentions = if v.get("mention_user_ids").is_some() || v.get("mention_company_ids").is_some()
    {
        notify_mentions(
            &mut tx,
            &c,
            &v,
            &p,
            &format!("commentedit:{id}:{}", ver + 1),
        )
        .await?
    } else {
        old["mentions"].clone()
    };
    let changed=sqlx::query("UPDATE network_comments SET body=$1,version=version+1,updated_at=now(),mentions=$4::jsonb WHERE id=$2::uuid AND version=$3 AND deleted_at IS NULL").bind(body).bind(&id).bind(ver).bind(mentions.to_string()).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict("This reply changed. Reload before saving."));
    }
    tx.commit().await?;
    Ok(Json(json!({"comment":comment(&app,&id,&c).await?})))
}
async fn delete_comment(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    comment_owner(&app, &id, &c).await?;
    let changed=sqlx::query("UPDATE network_comments SET body='',deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1::uuid AND version=$2 AND deleted_at IS NULL").bind(id).bind(version(&v)?).execute(&app.db).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict("This reply changed. Reload before deleting."));
    }
    Ok(Json(json!({"ok":true})))
}
fn draft_selection() -> &'static str {
    "(to_jsonb(d)||jsonb_build_object('files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'url','/api/network-v2/files/'||f.id)) FROM network_files f WHERE f.id::text IN (SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.body->'file_ids')='array' THEN d.body->'file_ids' ELSE '[]'::jsonb END)) AND f.owner_user_id=d.author_id AND f.company_id=d.company_id),'[]'::jsonb)))::text"
}
async fn decorate_draft(app: &App, mut d: Value, c: &Context) -> Result<Value> {
    let allowed = destination(app, c, d["community_id"].as_str())
        .await
        .is_ok();
    d["can_publish"] = json!(allowed);
    if !allowed {
        d["files"] = json!([])
    }
    Ok(d)
}
async fn drafts(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    let rows:Vec<String>=sqlx::query_scalar(&format!("SELECT {} FROM network_drafts d WHERE author_id=$1::uuid AND company_id=$2::uuid AND sequence<$3 ORDER BY sequence DESC LIMIT $4",draft_selection())).bind(&c.actor.user).bind(company).bind(s.cursor()).bind(s.limit()).fetch_all(&app.db).await?;
    let mut items = Vec::new();
    for raw in rows {
        items.push(decorate_draft(&app, parse_json(raw)?, &c).await?)
    }
    Ok(Json(page(items, s.limit())))
}
async fn get_draft(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    checked_id(&id)?;
    let raw: Option<String> = sqlx::query_scalar(&format!(
        "SELECT {} FROM network_drafts d WHERE id=$1::uuid AND author_id=$2::uuid AND company_id=$3::uuid",
        draft_selection()
    ))
    .bind(&id)
    .bind(&c.actor.user)
    .bind(company)
    .fetch_optional(&app.db)
    .await?;
    Ok(Json(
        json!({"draft":decorate_draft(&app,parse_json(raw.ok_or_else(missing)?)?,&c).await?}),
    ))
}
async fn save_draft(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    checked_id(&id)?;
    let body = &v["body"];
    if !body.is_object() || body.to_string().len() > 50000 {
        return Err(bad("This draft is too large."));
    }
    let community = uid(body, "community_id")?;
    if let Some(cid) = community {
        community_access(&app, cid, &c).await?;
    }
    txt(body, "body", 10000)?;
    txt(body, "title", 180)?;
    fields::id_list(body, "file_ids", 10)?;
    let ver = version(&v)?;
    let mut tx = app.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("network-draft:{id}"))
        .execute(&mut *tx)
        .await?;
    let old=sqlx::query("SELECT author_id::text,company_id::text,version FROM network_drafts WHERE id=$1::uuid FOR UPDATE").bind(&id).fetch_optional(&mut *tx).await?;
    if let Some(old) = old {
        if old.get::<String, _>("author_id") != c.actor.user
            || old.get::<String, _>("company_id") != company
        {
            return Err(forbidden());
        }
        if old.get::<i32, _>("version") != ver {
            return Err(conflict(
                "A newer draft is saved. Reload it before changing it.",
            ));
        }
        sqlx::query("UPDATE network_drafts SET community_id=$1::uuid,body=$2::jsonb,version=version+1,updated_at=now() WHERE id=$3::uuid").bind(community).bind(body.to_string()).bind(&id).execute(&mut *tx).await?;
    } else {
        if ver != 0 {
            return Err(conflict("This draft no longer exists."));
        }
        destination(&app, &c, community).await?;
        sqlx::query("INSERT INTO network_drafts(id,author_id,company_id,community_id,body) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)").bind(&id).bind(&c.actor.user).bind(company).bind(community).bind(body.to_string()).execute(&mut *tx).await?;
    }
    let raw: String = sqlx::query_scalar(&format!(
        "SELECT {} FROM network_drafts d WHERE id=$1::uuid",
        draft_selection()
    ))
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"draft":decorate_draft(&app,parse_json(raw)?,&c).await?}),
    ))
}
async fn delete_draft(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    checked_id(&id)?;
    let changed=sqlx::query("DELETE FROM network_drafts WHERE id=$1::uuid AND author_id=$2::uuid AND company_id=$3::uuid AND version=$4").bind(id).bind(&c.actor.user).bind(company).bind(version(&v)?).execute(&app.db).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict("This draft changed or is no longer available."));
    }
    Ok(Json(json!({"ok":true})))
}
async fn job_draft(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, true)?;
    let p = access(&app, &id, &c).await?;
    if p["author_id"] != c.actor.user
        || p["company_id"].as_str() != Some(company)
        || !matches!(p["kind"].as_str(), Some("sourcing" | "available"))
    {
        return Err(forbidden());
    }
    let title = req(&v, "title", 3, 160)?;
    let description = req(&v, "description", 1, 10000)?;
    let location = txt(&v, "location", 160)?;
    let start = txt(&v, "start_window", 120)?;
    let files = fields::id_list(&v, "file_ids", 10)?;
    for fid in &files {
        if !p["files"]
            .as_array()
            .is_some_and(|a| a.iter().any(|f| f["id"] == *fid))
        {
            return Err(bad("Choose files from this discussion only."));
        }
    }
    let mut tx = app.db.begin().await?;
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT source_job_id::text FROM network_posts WHERE id=$1::uuid FOR UPDATE",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(job) = existing {
        tx.commit().await?;
        return Ok(Json(
            json!({"job_id":job,"url":format!("/jobs/{job}/edit")}),
        ));
    }
    let job:String=sqlx::query_scalar("INSERT INTO jobs(hiring_company_id,author_id,title,description,trade,location,start_window,status,visibility) VALUES($1::uuid,$2::uuid,$3,$4,'other',$5,$6,'draft','open') RETURNING id::text").bind(company).bind(&c.actor.user).bind(title).bind(description).bind(location).bind(start).fetch_one(&mut *tx).await?;
    // Selected files get independent storage keys: later source access changes cannot expose unselected files.
    let mut copied_paths = Vec::new();
    for fid in files {
        let row=sqlx::query("SELECT storage_key,original_name,mime_type,size_bytes,content_sha256 FROM network_files WHERE id=$1::uuid").bind(&fid).fetch_one(&mut *tx).await?;
        let key = format!("jobs/{job}/network-{fid}");
        let path = app.uploads.join(&key);
        let dir = path.parent().unwrap();
        tokio::fs::create_dir_all(dir).await.map_err(|_| {
            Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not prepare the job files.",
            )
        })?;
        if tokio::fs::copy(
            app.uploads
                .join("network")
                .join(row.get::<String, _>("storage_key")),
            &path,
        )
        .await
        .is_err()
        {
            for path in copied_paths {
                let _ = tokio::fs::remove_file(path).await;
            }
            return Err(Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not copy an attachment. Try again.",
            ));
        }
        copied_paths.push(path);
        sqlx::query("INSERT INTO job_files(job_id,company_id,uploaded_by,original_name,storage_backend,storage_key,mime_type,size_bytes,content_sha256) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'local',$5,$6,$7,$8)").bind(&job).bind(company).bind(&c.actor.user).bind(row.get::<String,_>("original_name")).bind(key).bind(row.get::<String,_>("mime_type")).bind(row.get::<i64,_>("size_bytes")).bind(row.get::<String,_>("content_sha256")).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE network_posts SET source_job_id=$1::uuid WHERE id=$2::uuid")
        .bind(&job)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"job_id":job,"url":format!("/jobs/{job}/edit")}),
    ))
}
pub(super) fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/network-v2/posts", get(list).post(create))
        .route(
            "/network-v2/posts/{id}",
            get(detail).patch(edit).delete(delete),
        )
        .route("/network-v2/posts/{id}/state", post(state))
        .route("/network-v2/posts/{id}/report", post(report))
        .route(
            "/network-v2/posts/{id}/comments",
            get(comments).post(add_comment),
        )
        .route(
            "/network-v2/comments/{id}",
            axum::routing::patch(edit_comment).delete(delete_comment),
        )
        .route("/network-v2/drafts", get(drafts))
        .route(
            "/network-v2/drafts/{id}",
            get(get_draft).put(save_draft).delete(delete_draft),
        )
        .route("/network-v2/posts/{id}/job-draft", post(job_draft))
}
