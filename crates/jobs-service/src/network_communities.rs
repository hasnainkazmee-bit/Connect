use super::*;
pub(super) async fn access(app: &App, id: &str, ctx: &Context) -> Result<Value> {
    checked_id(id)?;
    let row:Option<String>=sqlx::query_scalar(&format!("SELECT (to_jsonb(c)||jsonb_build_object('company',{},'cover_url',CASE WHEN c.cover_file_id IS NOT NULL AND network_can_read_community(c.id,$2::uuid,$3) THEN '/api/network-v2/files/'||c.cover_file_id ELSE '' END,'member_count',(SELECT count(*) FROM network_members WHERE community_id=c.id AND status='joined'),'host_reader',EXISTS(SELECT 1 FROM memberships hm WHERE hm.company_id=c.owner_company_id AND hm.user_id=$2::uuid AND hm.role IN ('owner','admin')),'pinned_posts',CASE WHEN network_can_read_community(c.id,$2::uuid,$3) THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'body',left(p.body,240),'kind',p.kind) ORDER BY p.sequence DESC) FROM network_posts p WHERE p.community_id=c.id AND p.pinned AND p.status='published'),'[]'::jsonb) ELSE '[]'::jsonb END,'membership',(SELECT jsonb_build_object('role',role,'status',status) FROM network_members WHERE community_id=c.id AND user_id=$2::uuid)))::text FROM network_communities c JOIN companies co ON co.id=c.owner_company_id WHERE c.id=$1::uuid AND c.is_demo=$3",company_sql("co")))
 .bind(id).bind(&ctx.actor.user).bind(ctx.is_demo).fetch_optional(&app.db).await?;
    let mut c = parse_json(row.ok_or_else(missing)?)?;
    let joined = c["membership"]["status"] == "joined";
    let role = c["membership"]["role"].as_str().unwrap_or("");
    let host = c["owner_company_id"].as_str() == ctx.actor.company.as_deref()
        && matches!(ctx.actor.role.as_deref(), Some("owner" | "admin"));
    let admin = host || (joined && role == "admin");
    let moderator = admin || (joined && role == "moderator");
    let read = c["visibility"] == "public" || joined || c["host_reader"] == true;
    c.as_object_mut().unwrap().remove("host_reader");
    c["can_manage"] = json!(admin);
    c["can_moderate"] = json!(moderator);
    c["can_read"] = json!(read);
    c["can_post"] =
        json!((joined || host) && c["archived_at"].is_null() && writer(ctx, false).is_ok());
    if !read {
        c["topics"] = json!([]);
        c["post_types"] = json!([]);
        c["cover_url"] = json!("");
    }
    Ok(c)
}
async fn list(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let rows:Vec<String>=sqlx::query_scalar("SELECT id::text FROM network_communities c WHERE is_demo=$1 AND sequence<$2 AND (name ILIKE $3 OR description ILIKE $3) AND (NOT $4 OR EXISTS(SELECT 1 FROM network_members m WHERE m.community_id=c.id AND m.user_id=$5::uuid AND m.status IN ('joined','pending'))) AND (archived_at IS NULL OR EXISTS(SELECT 1 FROM network_members m WHERE m.community_id=c.id AND m.user_id=$5::uuid AND m.status='joined')) ORDER BY sequence DESC LIMIT $6")
 .bind(c.is_demo).bind(s.cursor()).bind(s.query()?).bind(s.joined.unwrap_or(false)).bind(&c.actor.user).bind(s.limit()).fetch_all(&app.db).await?;
    let mut result = Vec::new();
    for id in rows {
        result.push(access(&app, &id, &c).await?)
    }
    Ok(Json(page(result, s.limit())))
}
async fn detail(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    Ok(Json(json!({"community":access(&app,&id,&c).await?})))
}
fn settings(v: &Value, old: Option<&Value>) -> Result<Value> {
    let mut x=old.cloned().unwrap_or_else(||json!({"description":"","visibility":"public","join_policy":"open","rules":[],"topics":[],"post_types":[],"require_topic":false}));
    for k in [
        "name",
        "description",
        "visibility",
        "join_policy",
        "rules",
        "topics",
        "post_types",
        "require_topic",
    ] {
        if let Some(val) = v.get(k) {
            x[k] = val.clone()
        }
    }
    req(&x, "name", 3, 100)?;
    txt(&x, "description", 4000)?;
    if !matches!(x["visibility"].as_str(), Some("public" | "private"))
        || !matches!(x["join_policy"].as_str(), Some("open" | "approval"))
    {
        return Err(bad("Choose community visibility and joining policy."));
    }
    if x["visibility"] == "private" {
        x["join_policy"] = json!("approval")
    }
    x["rules"] = fields::rules(&x["rules"])?;
    x["topics"] = fields::topics(
        &x["topics"],
        &old.map(|o| o["topics"].clone()).unwrap_or(json!([])),
    )?;
    x["post_types"] = fields::post_types(
        &x["post_types"],
        &old.map(|o| o["post_types"].clone()).unwrap_or(json!([])),
    )?;
    if x["require_topic"].as_bool().is_none() {
        return Err(bad("Choose whether a topic is required."));
    }
    if x["require_topic"] == true && x["topics"].as_array().is_none_or(|a| a.is_empty()) {
        return Err(bad("Add a topic before making it required."));
    }
    Ok(x)
}
async fn cover(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &Context,
    id: Option<&str>,
    community: Option<&str>,
) -> Result<()> {
    if let Some(id) = id {
        let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM network_files WHERE id=$1::uuid AND owner_user_id=$2::uuid AND company_id=$3::uuid AND purpose='cover' AND mime_type IN ('image/png','image/jpeg','image/webp') AND (community_id IS NULL OR community_id=$4::uuid))").bind(id).bind(&ctx.actor.user).bind(ctx.actor.company.as_deref()).bind(community).fetch_one(&mut **tx).await?;
        if !ok {
            return Err(bad(
                "Choose a cover image uploaded by you for this community.",
            ));
        }
    }
    Ok(())
}
async fn create(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, true)?;
    let s = settings(&v, None)?;
    let cover_id = uid(&v, "cover_file_id")?;
    let mut tx = app.db.begin().await?;
    cover(&mut tx, &c, cover_id, None).await?;
    let id:String=sqlx::query_scalar("INSERT INTO network_communities(owner_company_id,created_by,name,description,visibility,join_policy,rules,topics,require_topic,is_demo,cover_file_id,post_types) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::uuid,$12::jsonb) RETURNING id::text")
 .bind(company).bind(&c.actor.user).bind(s["name"].as_str()).bind(s["description"].as_str()).bind(s["visibility"].as_str()).bind(s["join_policy"].as_str()).bind(s["rules"].to_string()).bind(s["topics"].to_string()).bind(s["require_topic"].as_bool()).bind(c.is_demo).bind(cover_id).bind(s["post_types"].to_string()).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO network_members(community_id,user_id,company_id,role,status) VALUES($1::uuid,$2::uuid,$3::uuid,'admin','joined')").bind(&id).bind(&c.actor.user).bind(company).execute(&mut *tx).await?;
    if let Some(fid) = cover_id {
        sqlx::query("UPDATE network_files SET community_id=$1::uuid WHERE id=$2::uuid")
            .bind(&id)
            .bind(fid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"community":access(&app,&id,&c).await?})))
}
async fn edit(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    writer(&c, false)?;
    let old = access(&app, &id, &c).await?;
    if old["can_manage"] != true {
        return Err(forbidden());
    }
    let s = settings(&v, Some(&old))?;
    let ver = version(&v)?;
    let cover_id = if v.get("cover_file_id").is_some() {
        uid(&v, "cover_file_id")?
    } else {
        old["cover_file_id"].as_str()
    };
    let mut tx = app.db.begin().await?;
    if v.get("cover_file_id").is_some() && cover_id != old["cover_file_id"].as_str() {
        cover(&mut tx, &c, cover_id, Some(&id)).await?
    }
    let changed=sqlx::query("UPDATE network_communities SET name=$1,description=$2,visibility=$3,join_policy=$4,rules=$5::jsonb,topics=$6::jsonb,require_topic=$7,cover_file_id=$8::uuid,archived_at=CASE WHEN $9::boolean IS NULL THEN archived_at WHEN $9 THEN COALESCE(archived_at,now()) ELSE NULL END,post_types=$12::jsonb,version=version+1,updated_at=now() WHERE id=$10::uuid AND version=$11")
 .bind(s["name"].as_str()).bind(s["description"].as_str()).bind(s["visibility"].as_str()).bind(s["join_policy"].as_str()).bind(s["rules"].to_string()).bind(s["topics"].to_string()).bind(s["require_topic"].as_bool()).bind(cover_id).bind(v["archived"].as_bool()).bind(&id).bind(ver).bind(s["post_types"].to_string()).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict(
            "Community settings changed. Reload before saving.",
        ));
    }
    if let Some(fid) = cover_id {
        sqlx::query("UPDATE network_files SET community_id=$1::uuid WHERE id=$2::uuid AND community_id IS NULL").bind(&id).bind(fid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"community":access(&app,&id,&c).await?})))
}
async fn lock_community(tx: &mut Transaction<'_, Postgres>, id: &str) -> Result<()> {
    sqlx::query("SELECT id FROM network_communities WHERE id=$1::uuid FOR UPDATE")
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(())
}
async fn last_admin(tx: &mut Transaction<'_, Postgres>, id: &str, user: &str) -> Result<()> {
    let is_last:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM network_members WHERE community_id=$1::uuid AND user_id=$2::uuid AND role='admin' AND status='joined') AND (SELECT count(*) FROM network_members WHERE community_id=$1::uuid AND role='admin' AND status='joined')<=1").bind(id).bind(user).fetch_one(&mut **tx).await?;
    if is_last {
        return Err(conflict(
            "Assign another community admin before removing the last admin.",
        ));
    }
    Ok(())
}
async fn membership(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    access(&app, &id, &c).await?;
    let action = req(&v, "action", 1, 20)?;
    let mut tx = app.db.begin().await?;
    lock_community(&mut tx, &id).await?;
    let comm = access(&app, &id, &c).await?;
    match action {
        "join" => {
            if !comm["archived_at"].is_null() {
                return Err(conflict("This community is archived."));
            }
            let status = if comm["join_policy"] == "open" && comm["visibility"] == "public" {
                "joined"
            } else {
                "pending"
            };
            let existing:Option<String>=sqlx::query_scalar("SELECT status FROM network_members WHERE community_id=$1::uuid AND user_id=$2::uuid").bind(&id).bind(&c.actor.user).fetch_optional(&mut *tx).await?;
            if existing.as_deref() == Some("removed") {
                return Err(forbidden());
            }
            sqlx::query("INSERT INTO network_members(community_id,user_id,company_id,role,status) VALUES($1::uuid,$2::uuid,$3::uuid,'member',$4) ON CONFLICT(community_id,user_id) DO UPDATE SET status=CASE WHEN network_members.status='joined' THEN 'joined' ELSE $4 END,updated_at=now()")
 .bind(&id).bind(&c.actor.user).bind(company).bind(status).execute(&mut *tx).await?;
            if status == "pending" && existing.is_none() {
                let members:Vec<(String,String)>=sqlx::query_as("SELECT user_id::text,company_id::text FROM network_members WHERE community_id=$1::uuid AND status='joined' AND role IN ('admin','moderator')").bind(&id).fetch_all(&mut *tx).await?;
                for (user, company) in members {
                    notify(
                        &mut tx,
                        &c,
                        &user,
                        Some(&company),
                        &format!("network:join:{id}:{}", c.actor.user),
                        "request",
                        "network_community",
                        &id,
                        &format!("/network/communities/{id}/manage/members"),
                    )
                    .await?;
                }
            }
        }
        "cancel" => {
            sqlx::query("DELETE FROM network_members WHERE community_id=$1::uuid AND user_id=$2::uuid AND status='pending'").bind(&id).bind(&c.actor.user).execute(&mut *tx).await?;
        }
        "leave" => {
            last_admin(&mut tx, &id, &c.actor.user).await?;
            sqlx::query("DELETE FROM network_members WHERE community_id=$1::uuid AND user_id=$2::uuid AND status='joined'").bind(&id).bind(&c.actor.user).execute(&mut *tx).await?;
        }
        _ => return Err(bad("Choose a membership action.")),
    }
    tx.commit().await?;
    Ok(Json(json!({"community":access(&app,&id,&c).await?})))
}
async fn members(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let comm = access(&app, &id, &c).await?;
    if comm["can_moderate"] != true {
        return Err(forbidden());
    }
    let status = s.status.as_deref().unwrap_or("joined");
    if !matches!(status, "joined" | "pending" | "removed") {
        return Err(bad("Choose a member status."));
    }
    let rows:Vec<String>=sqlx::query_scalar("SELECT jsonb_build_object('user_id',m.user_id,'sequence',m.sequence,'name',u.name,'email',u.email,'company_name',co.name,'role',m.role,'status',m.status,'created_at',m.created_at)::text FROM network_members m JOIN users u ON u.id=m.user_id JOIN companies co ON co.id=m.company_id WHERE community_id=$1::uuid AND status=$2 AND m.sequence<$3 ORDER BY m.sequence DESC LIMIT $4")
 .bind(id).bind(status).bind(s.cursor()).bind(s.limit()).fetch_all(&app.db).await?;
    Ok(Json(page(json_rows(rows)?, s.limit())))
}
async fn member_action(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, user)): Path<(String, String)>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    writer(&c, false)?;
    let comm = access(&app, &id, &c).await?;
    if comm["can_moderate"] != true {
        return Err(forbidden());
    }
    checked_id(&user)?;
    let action = req(&v, "action", 1, 20)?;
    let mut tx = app.db.begin().await?;
    lock_community(&mut tx, &id).await?;
    let comm = access(&app, &id, &c).await?;
    if comm["can_moderate"] != true {
        return Err(forbidden());
    }
    let target=sqlx::query("SELECT status,role FROM network_members WHERE community_id=$1::uuid AND user_id=$2::uuid FOR UPDATE").bind(&id).bind(&user).fetch_optional(&mut *tx).await?.ok_or_else(missing)?;
    let role: String = target.get("role");
    let status: String = target.get("status");
    if comm["can_manage"] != true && (role != "member" || !matches!(action, "approve" | "reject")) {
        return Err(forbidden());
    }
    match action {
        "approve" | "reject" => {
            if status != "pending" {
                return Err(conflict("This request has already been handled."));
            }
            if action == "approve" {
                sqlx::query("UPDATE network_members SET status='joined',updated_at=now() WHERE community_id=$1::uuid AND user_id=$2::uuid").bind(&id).bind(&user).execute(&mut *tx).await?;
            } else {
                sqlx::query(
                    "DELETE FROM network_members WHERE community_id=$1::uuid AND user_id=$2::uuid",
                )
                .bind(&id)
                .bind(&user)
                .execute(&mut *tx)
                .await?;
            }
        }
        "remove" => {
            last_admin(&mut tx, &id, &user).await?;
            sqlx::query("UPDATE network_members SET status='removed',updated_at=now() WHERE community_id=$1::uuid AND user_id=$2::uuid").bind(&id).bind(&user).execute(&mut *tx).await?;
        }
        "role" => {
            let role = req(&v, "role", 1, 20)?;
            if !matches!(role, "admin" | "moderator" | "member") || status != "joined" {
                return Err(bad("Choose a role for a joined member."));
            }
            if role != "admin" {
                last_admin(&mut tx, &id, &user).await?
            }
            sqlx::query("UPDATE network_members SET role=$3,updated_at=now() WHERE community_id=$1::uuid AND user_id=$2::uuid").bind(&id).bind(&user).bind(role).execute(&mut *tx).await?;
        }
        _ => return Err(bad("Choose a member action.")),
    }
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}
fn invite_json() -> &'static str {
    "jsonb_build_object('id',i.id,'sequence',i.sequence,'email',i.email,'role',i.role,'status',CASE WHEN i.status='pending' AND i.expires_at<=now() THEN 'expired' ELSE i.status END,'expires_at',i.expires_at,'created_at',i.created_at)"
}
async fn invitations(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    if access(&app, &id, &c).await?["can_manage"] != true {
        return Err(forbidden());
    }
    let rows:Vec<String>=sqlx::query_scalar(&format!("SELECT {}::text FROM network_invitations i WHERE community_id=$1::uuid AND sequence<$2 ORDER BY sequence DESC LIMIT $3",invite_json())).bind(id).bind(s.cursor()).bind(s.limit()).fetch_all(&app.db).await?;
    Ok(Json(page(json_rows(rows)?, s.limit())))
}
async fn new_token(tx: &mut Transaction<'_, Postgres>) -> Result<String> {
    Ok(sqlx::query_scalar(
        "SELECT replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')",
    )
    .fetch_one(&mut **tx)
    .await?)
}
fn email(v: &Value) -> Result<String> {
    let e = req(v, "email", 3, 254)?.to_ascii_lowercase();
    let (name, host) = e
        .split_once('@')
        .ok_or_else(|| bad("Enter a valid email address."))?;
    if name.is_empty()
        || host.is_empty()
        || !host.contains('.')
        || e.chars().any(char::is_whitespace)
        || host.contains('@')
    {
        return Err(bad("Enter a valid email address."));
    }
    Ok(e)
}
async fn invite(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    writer(&c, false)?;
    let comm = access(&app, &id, &c).await?;
    if comm["can_manage"] != true {
        return Err(forbidden());
    }
    if !comm["archived_at"].is_null() {
        return Err(conflict("This community is archived."));
    }
    let email = email(&v)?;
    let role = req(&v, "role", 1, 20)?;
    if !matches!(role, "admin" | "moderator" | "member") {
        return Err(bad("Choose an invitation role."));
    }
    let mut tx = app.db.begin().await?;
    lock_community(&mut tx, &id).await?;
    sqlx::query("UPDATE network_invitations SET status='revoked',responded_at=now() WHERE community_id=$1::uuid AND email=$2 AND status='pending'").bind(&id).bind(&email).execute(&mut *tx).await?;
    let token = new_token(&mut tx).await?;
    let hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    let iid:String=sqlx::query_scalar("INSERT INTO network_invitations(community_id,email,role,token_hash,invited_by,expires_at) VALUES($1::uuid,$2,$3,$4,$5::uuid,now()+interval '7 days') RETURNING id::text").bind(&id).bind(&email).bind(role).bind(hash).bind(&c.actor.user).fetch_one(&mut *tx).await?;
    let recipients:Vec<(String,String)>=sqlx::query_as("SELECT u.id::text,m.company_id::text FROM users u JOIN memberships m ON m.user_id=u.id JOIN companies co ON co.id=m.company_id WHERE lower(u.email)=$1 AND u.email_verified_at IS NOT NULL AND co.is_demo=$2 LIMIT 10").bind(&email).bind(c.is_demo).fetch_all(&mut *tx).await?;
    for (user, company) in recipients {
        notify(
            &mut tx,
            &c,
            &user,
            Some(&company),
            &format!("network:invite:{iid}"),
            "invitation",
            "network_invitation",
            &iid,
            &format!("/network/invitations/{token}"),
        )
        .await?
    }
    let raw: String = sqlx::query_scalar(&format!(
        "SELECT {}::text FROM network_invitations i WHERE id=$1::uuid",
        invite_json()
    ))
    .bind(&iid)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"invitation":parse_json(raw)?,"invite_url":format!("/network/invitations/{token}")}),
    ))
}
async fn change_invite(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path((id, iid)): Path<(String, String)>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    writer(&c, false)?;
    if access(&app, &id, &c).await?["can_manage"] != true {
        return Err(forbidden());
    }
    checked_id(&iid)?;
    let mut tx = app.db.begin().await?;
    lock_community(&mut tx, &id).await?;
    let status:Option<String>=sqlx::query_scalar("SELECT status FROM network_invitations WHERE id=$1::uuid AND community_id=$2::uuid FOR UPDATE").bind(&iid).bind(&id).fetch_optional(&mut *tx).await?;
    if status.as_deref() != Some("pending") {
        return Err(conflict("This invitation is no longer pending."));
    }
    let action = req(&v, "action", 1, 20)?;
    let token = if action == "renew" {
        let token = new_token(&mut tx).await?;
        sqlx::query("UPDATE network_invitations SET token_hash=$1,expires_at=now()+interval '7 days' WHERE id=$2::uuid").bind(format!("{:x}",Sha256::digest(token.as_bytes()))).bind(&iid).execute(&mut *tx).await?;
        Some(token)
    } else if action == "revoke" {
        sqlx::query(
            "UPDATE network_invitations SET status='revoked',responded_at=now() WHERE id=$1::uuid",
        )
        .bind(&iid)
        .execute(&mut *tx)
        .await?;
        None
    } else {
        return Err(bad("Choose an invitation action."));
    };
    let raw: String = sqlx::query_scalar(&format!(
        "SELECT {}::text FROM network_invitations i WHERE id=$1::uuid",
        invite_json()
    ))
    .bind(&iid)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"invitation":parse_json(raw)?,"invite_url":token.map(|t|format!("/network/invitations/{t}"))}),
    ))
}
fn token_hash(token: &str) -> Result<String> {
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(missing());
    }
    Ok(format!("{:x}", Sha256::digest(token.as_bytes())))
}
async fn invitation(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let hash = token_hash(&token)?;
    let row=sqlx::query(&format!("SELECT {}::text AS invitation,i.community_id::text,lower(u.email)=i.email AS matches,i.status='pending' AND i.expires_at>now() AS usable FROM network_invitations i JOIN network_communities co ON co.id=i.community_id CROSS JOIN users u WHERE token_hash=$1 AND u.id=$2::uuid AND co.is_demo=$3",invite_json())).bind(hash).bind(&c.actor.user).bind(c.is_demo).fetch_optional(&app.db).await?.ok_or_else(missing)?;
    let mut inv = parse_json(row.get("invitation"))?;
    let matches: bool = row.get("matches");
    if !matches {
        inv["email"] = json!("");
    }
    let comm = access(&app, &row.get::<String, _>("community_id"), &c).await?;
    Ok(Json(
        json!({"invitation":inv,"community":comm,"email_matches":matches,"can_accept":matches&&row.get::<bool,_>("usable")&&writer(&c,false).is_ok()}),
    ))
}
async fn respond_invitation(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    let hash = token_hash(&token)?;
    let action = req(&v, "action", 1, 10)?;
    if !matches!(action, "accept" | "decline") {
        return Err(bad("Choose accept or decline."));
    }
    let mut tx = app.db.begin().await?;
    let row=sqlx::query("SELECT i.id::text,i.community_id::text,i.role,i.status,i.expires_at>now() AS valid,lower(u.email)=i.email AS matches,co.archived_at IS NULL AS active FROM network_invitations i JOIN network_communities co ON co.id=i.community_id CROSS JOIN users u WHERE i.token_hash=$1 AND u.id=$2::uuid AND co.is_demo=$3 FOR UPDATE OF i")
 .bind(hash).bind(&c.actor.user).bind(c.is_demo).fetch_optional(&mut *tx).await?.ok_or_else(missing)?;
    if !row.get::<bool, _>("matches") {
        return Err(forbidden());
    }
    if row.get::<String, _>("status") != "pending"
        || !row.get::<bool, _>("valid")
        || !row.get::<bool, _>("active")
    {
        return Err(conflict(
            "This invitation is expired or has already been handled.",
        ));
    }
    let cid: String = row.get("community_id");
    let iid: String = row.get("id");
    let status = if action == "accept" {
        "accepted"
    } else {
        "declined"
    };
    if action == "accept" {
        sqlx::query("INSERT INTO network_members(community_id,user_id,company_id,role,status) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'joined') ON CONFLICT(community_id,user_id) DO UPDATE SET company_id=$3::uuid,status='joined',role=CASE WHEN network_members.role='admin' AND network_members.status='joined' THEN 'admin' ELSE $4 END,updated_at=now()")
 .bind(&cid).bind(&c.actor.user).bind(company).bind(row.get::<String,_>("role")).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE network_invitations SET status=$1,accepted_by=$2::uuid,responded_at=now() WHERE id=$3::uuid").bind(status).bind(&c.actor.user).bind(iid).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"community_id":cid,"status":status})))
}
async fn reports_query(app: &App, c: &Context, id: Option<&str>, s: &Search) -> Result<Value> {
    if let Some(id) = id {
        if access(app, id, c).await?["can_moderate"] != true {
            return Err(forbidden());
        }
    } else if !c.is_admin {
        return Err(forbidden());
    }
    let status = s.status.as_deref().unwrap_or("open");
    if !matches!(status, "open" | "resolved") {
        return Err(bad("Choose a report status."));
    }
    let rows:Vec<String>=sqlx::query_scalar("SELECT (to_jsonb(r)||jsonb_build_object('post_title',p.title,'post_body',p.body,'reporter_name',u.name))::text FROM network_reports r JOIN network_posts p ON p.id=r.post_id JOIN users u ON u.id=r.reporter_id WHERE r.community_id IS NOT DISTINCT FROM $1::uuid AND p.is_demo=$2 AND r.sequence<$3 AND (($4='open' AND r.status='open') OR ($4='resolved' AND r.status<>'open')) ORDER BY r.sequence DESC LIMIT $5")
 .bind(id).bind(c.is_demo).bind(s.cursor()).bind(status).bind(s.limit()).fetch_all(&app.db).await?;
    Ok(page(json_rows(rows)?, s.limit()))
}
async fn reports(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    Ok(Json(reports_query(&app, &c, Some(&id), &s).await?))
}
async fn admin_reports(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    Ok(Json(reports_query(&app, &c, None, &s).await?))
}
async fn resolve(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    writer(&c, false)?;
    checked_id(&id)?;
    let decision = req(&v, "decision", 1, 10)?;
    if !matches!(decision, "keep" | "remove") {
        return Err(bad("Choose keep or remove."));
    }
    let reason = req(&v, "reason", 3, 2000)?;
    let row=sqlx::query("SELECT r.community_id::text,r.post_id::text FROM network_reports r JOIN network_posts p ON p.id=r.post_id WHERE r.id=$1::uuid AND p.is_demo=$2").bind(&id).bind(c.is_demo).fetch_optional(&app.db).await?.ok_or_else(missing)?;
    let community: Option<String> = row.get("community_id");
    let post: String = row.get("post_id");
    if let Some(cid) = &community {
        if access(&app, cid, &c).await?["can_moderate"] != true {
            return Err(forbidden());
        }
    } else if !c.is_admin {
        return Err(forbidden());
    }
    let mut tx = app.db.begin().await?;
    let changed=sqlx::query("UPDATE network_reports SET status=$1,resolution_reason=$2,resolved_by=$3::uuid,resolved_at=now() WHERE id=$4::uuid AND status='open'").bind(if decision=="keep"{"kept"}else{"removed"}).bind(reason).bind(&c.actor.user).bind(&id).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(conflict("This report has already been reviewed."));
    }
    if decision == "remove" {
        sqlx::query("UPDATE network_posts SET status='removed',version=version+1,updated_at=now() WHERE id=$1::uuid AND status='published'").bind(&post).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO network_moderation_log(community_id,post_id,report_id,actor_id,action,reason) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)").bind(community).bind(post).bind(&id).bind(&c.actor.user).bind(decision).bind(reason).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}
pub(super) fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/network-v2/communities", get(list).post(create))
        .route("/network-v2/communities/{id}", get(detail).patch(edit))
        .route("/network-v2/communities/{id}/membership", post(membership))
        .route("/network-v2/communities/{id}/members", get(members))
        .route(
            "/network-v2/communities/{id}/members/{user}",
            post(member_action),
        )
        .route(
            "/network-v2/communities/{id}/invitations",
            get(invitations).post(invite),
        )
        .route(
            "/network-v2/communities/{id}/invitations/{iid}",
            post(change_invite),
        )
        .route(
            "/network-v2/invitations/{token}",
            get(invitation).post(respond_invitation),
        )
        .route("/network-v2/communities/{id}/reports", get(reports))
        .route("/network-v2/admin/reports", get(admin_reports))
        .route("/network-v2/reports/{id}/resolve", post(resolve))
}
