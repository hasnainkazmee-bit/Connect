//! Authenticated, company-scoped Network API. Separate from legacy updates.
use super::*;
use sqlx::{Postgres, Transaction};
use std::collections::HashSet;
#[path = "network_communities.rs"]
mod communities;
#[path = "network_fields.rs"]
mod fields;
#[path = "network_posts.rs"]
mod posts;

pub(super) struct Context {
    pub actor: Actor,
    pub is_demo: bool,
    pub is_admin: bool,
}
pub(super) async fn context(app: &App, headers: &HeaderMap) -> Result<Context> {
    let actor = actor(app, headers).await?.ok_or(Error(
        StatusCode::UNAUTHORIZED,
        "Please sign in to use Network.",
    ))?;
    let row=sqlx::query("SELECT COALESCE((SELECT is_demo FROM companies WHERE id=$1::uuid),false) AS demo,EXISTS(SELECT 1 FROM network_administrators WHERE user_id=$2::uuid) AS admin")
        .bind(actor.company.as_deref()).bind(&actor.user).fetch_one(&app.db).await?;
    Ok(Context {
        actor,
        is_demo: row.get("demo"),
        is_admin: row.get("admin"),
    })
}
fn writer(ctx: &Context, publisher: bool) -> Result<&str> {
    if !ctx.actor.verified {
        return Err(Error(
            StatusCode::FORBIDDEN,
            "Verify your email before posting.",
        ));
    }
    if ctx.actor.account_type != "company"
        || (publisher && !matches!(ctx.actor.role.as_deref(), Some("owner" | "admin")))
    {
        return Err(forbidden());
    }
    ctx.actor.company.as_deref().ok_or_else(forbidden)
}
fn missing() -> Error {
    Error(StatusCode::NOT_FOUND, "This Network item is not available.")
}
fn txt<'a>(v: &'a Value, k: &str, max: usize) -> Result<&'a str> {
    let t = optional_text(v, k, max)?;
    if t.contains('\0') {
        Err(bad("Remove invalid characters."))
    } else {
        Ok(t)
    }
}
fn req<'a>(v: &'a Value, k: &str, min: usize, max: usize) -> Result<&'a str> {
    let t = txt(v, k, max)?;
    if t.chars().count() < min {
        Err(bad("Complete the required fields."))
    } else {
        Ok(t)
    }
}
fn uid<'a>(v: &'a Value, k: &str) -> Result<Option<&'a str>> {
    match v.get(k).filter(|v| !v.is_null()) {
        None => Ok(None),
        Some(x) => {
            let s = x.as_str().ok_or_else(|| bad("Invalid identifier."))?;
            checked_id(s)?;
            Ok(Some(s))
        }
    }
}
fn version(v: &Value) -> Result<i32> {
    v["version"]
        .as_i64()
        .filter(|n| *n >= 0 && *n <= i32::MAX as i64)
        .map(|n| n as i32)
        .ok_or_else(|| bad("Reload this item before saving."))
}
fn json_rows(rows: Vec<String>) -> Result<Vec<Value>> {
    rows.into_iter().map(parse_json).collect()
}
fn page(items: Vec<Value>, limit: i64) -> Value {
    let next = if items.len() as i64 == limit {
        items
            .last()
            .and_then(|v| v["sequence"].as_i64())
            .map(|v| v.to_string())
    } else {
        None
    };
    json!({"items":items,"next_cursor":next})
}
#[derive(Deserialize, Default)]
pub(super) struct Search {
    cursor: Option<i64>,
    limit: Option<i64>,
    q: Option<String>,
    company_id: Option<String>,
    community_id: Option<String>,
    topic_id: Option<String>,
    saved: Option<bool>,
    following: Option<bool>,
    suggested: Option<bool>,
    joined: Option<bool>,
    unread: Option<bool>,
    status: Option<String>,
}
impl Search {
    fn limit(&self) -> i64 {
        self.limit.unwrap_or(20).clamp(1, 50)
    }
    fn cursor(&self) -> i64 {
        self.cursor.unwrap_or(i64::MAX)
    }
    fn query(&self) -> Result<String> {
        let s = self.q.as_deref().unwrap_or("").trim();
        if s.len() > 200 {
            return Err(bad("Search is too long."));
        }
        Ok(format!("%{}%", s.replace('%', "\\%").replace('_', "\\_")))
    }
}
fn company_sql(alias: &str) -> String {
    format!("jsonb_build_object('id',{alias}.id,'name',{alias}.name,'slug',COALESCE({alias}.username,{alias}.slug),'logo_url',{alias}.logo_url,'tagline',{alias}.tagline,'location',{alias}.location,'is_demo',{alias}.is_demo)")
}
pub(super) async fn community_access(app: &App, id: &str, c: &Context) -> Result<Value> {
    communities::access(app, id, c).await
}
pub(super) async fn post_access(app: &App, id: &str, c: &Context) -> Result<Value> {
    posts::access(app, id, c).await
}
fn can_edit_post(p: &Value, c: &Context) -> bool {
    if p["community_id"].is_null() {
        p["company_id"].as_str() == c.actor.company.as_deref()
            && matches!(c.actor.role.as_deref(), Some("owner" | "admin"))
    } else {
        p["author_id"] == c.actor.user && p["company_id"].as_str() == c.actor.company.as_deref()
    }
}
async fn notify(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &Context,
    user: &str,
    company: Option<&str>,
    event: &str,
    kind: &str,
    source: &str,
    source_id: &str,
    url: &str,
) -> Result<()> {
    if user == ctx.actor.user {
        return Ok(());
    }
    // Notification copy never carries private post text, company names or filenames.
    let title = match kind {
        "reply" => "New reply in Network",
        "mention" => "You were mentioned",
        "invitation" => "Community invitation",
        "request" => "Community membership request",
        _ => "New activity in Network",
    };
    sqlx::query("INSERT INTO user_notifications(user_id,company_id,actor_user_id,actor_company_id,event_key,type,category,title,text,url,source_kind,source_id) SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'network_'||$6,'social',$7,'Open Network to view this activity.',$8,$9,$10::uuid WHERE COALESCE((SELECT CASE $6 WHEN 'reply' THEN replies WHEN 'mention' THEN mentions WHEN 'community_post' THEN community_posts WHEN 'company_post' THEN company_posts ELSE true END FROM network_notification_preferences WHERE user_id=$1::uuid),true) ON CONFLICT(user_id,event_key) DO NOTHING")
        .bind(user).bind(company).bind(&ctx.actor.user).bind(ctx.actor.company.as_deref()).bind(format!("{event}:{}",company.unwrap_or("personal"))).bind(kind).bind(title).bind(url).bind(source).bind(source_id).execute(&mut **tx).await?;
    Ok(())
}
async fn notify_mentions(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &Context,
    input: &Value,
    post: &Value,
    event: &str,
) -> Result<Value> {
    let users = fields::id_list(input, "mention_user_ids", 20)?;
    let companies = fields::id_list(input, "mention_company_ids", 20)?;
    if users.len() + companies.len() > 20 {
        return Err(bad("Mention up to 20 people or companies."));
    }
    let body = input["body"].as_str().unwrap_or("").to_lowercase();
    let prior = post["mentions"].as_array();
    let mut snapshots = Vec::new();
    for id in users {
        let rows:Vec<(String,String,String)>=sqlx::query_as("SELECT DISTINCT u.id::text,m.company_id::text,u.name FROM users u JOIN memberships m ON m.user_id=u.id JOIN companies co ON co.id=m.company_id WHERE u.id=$1::uuid AND u.email_verified_at IS NOT NULL AND co.is_demo=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM network_members nm WHERE nm.user_id=u.id AND nm.community_id=$3::uuid AND nm.company_id=m.company_id AND nm.status='joined'))")
            .bind(&id).bind(ctx.is_demo).bind(post["community_id"].as_str()).fetch_all(&mut **tx).await?;
        let Some((_, _, name)) = rows.first() else {
            continue;
        };
        if !body.contains(&format!("@{}", name.to_lowercase())) {
            continue;
        }
        snapshots.push(json!({"id":id,"name":name,"kind":"user"}));
        let existing =
            prior.is_some_and(|a| a.iter().any(|v| v["id"] == id && v["kind"] == "user"));
        if !existing {
            for (user, company, _) in rows {
                notify(
                    tx,
                    ctx,
                    &user,
                    Some(&company),
                    &format!("network:{event}:mention:{user}"),
                    "mention",
                    "network_post",
                    post["id"].as_str().unwrap(),
                    &format!("/network/posts/{}", post["id"].as_str().unwrap()),
                )
                .await?;
            }
        }
    }
    for id in companies {
        let name:Option<String>=sqlx::query_scalar("SELECT name FROM companies co WHERE id=$1::uuid AND is_demo=$2 AND listing_status='managed' AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=co.id)").bind(&id).bind(ctx.is_demo).fetch_optional(&mut **tx).await?;
        let Some(name) = name else { continue };
        if !body.contains(&format!("@{}", name.to_lowercase())) {
            continue;
        }
        snapshots.push(json!({"id":id,"name":name,"kind":"company"}));
        let existing =
            prior.is_some_and(|a| a.iter().any(|v| v["id"] == id && v["kind"] == "company"));
        if !existing && Some(id.as_str()) != ctx.actor.company.as_deref() {
            let targets:Vec<String>=sqlx::query_scalar("SELECT m.user_id::text FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1::uuid AND m.role IN ('owner','admin') AND u.email_verified_at IS NOT NULL AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM network_members nm WHERE nm.user_id=m.user_id AND nm.community_id=$2::uuid AND nm.status='joined'))").bind(&id).bind(post["community_id"].as_str()).fetch_all(&mut **tx).await?;
            for user in targets {
                notify(
                    tx,
                    ctx,
                    &user,
                    Some(&id),
                    &format!("network:{event}:companymention:{id}"),
                    "mention",
                    "network_post",
                    post["id"].as_str().unwrap(),
                    &format!("/network/posts/{}", post["id"].as_str().unwrap()),
                )
                .await?;
            }
        }
    }
    Ok(json!(snapshots))
}
async fn bootstrap(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let user: Value = parse_json(
        sqlx::query_scalar(
            "SELECT jsonb_build_object('id',id,'name',name)::text FROM users WHERE id=$1::uuid",
        )
        .bind(&c.actor.user)
        .fetch_one(&app.db)
        .await?,
    )?;
    let company = if let Some(id) = &c.actor.company {
        parse_json(
            sqlx::query_scalar(&format!(
                "SELECT {}::text FROM companies co WHERE id=$1::uuid",
                company_sql("co")
            ))
            .bind(id)
            .fetch_one(&app.db)
            .await?,
        )?
    } else {
        Value::Null
    };
    let ids:Vec<String>=sqlx::query_scalar("SELECT c.id::text FROM network_communities c JOIN network_members m ON m.community_id=c.id WHERE m.user_id=$1::uuid AND m.status IN ('joined','pending') AND c.is_demo=$2 ORDER BY m.created_at LIMIT 100").bind(&c.actor.user).bind(c.is_demo).fetch_all(&app.db).await?;
    let mut comm = Vec::new();
    for id in ids {
        comm.push(communities::access(&app, &id, &c).await?);
    }
    let following:Vec<String>=sqlx::query_scalar("SELECT followed_company_id::text FROM network_follows WHERE user_id=$1::uuid AND company_id=$2::uuid LIMIT 1000").bind(&c.actor.user).bind(c.actor.company.as_deref()).fetch_all(&app.db).await?;
    let suggested = companies_query(
        &app,
        &c,
        &Search {
            limit: Some(12),
            suggested: Some(true),
            ..Default::default()
        },
    )
    .await?;
    let unread = unread(&app, &c).await?;
    let drafts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM network_drafts WHERE author_id=$1::uuid AND company_id=$2::uuid",
    )
    .bind(&c.actor.user)
    .bind(c.actor.company.as_deref())
    .fetch_one(&app.db)
    .await?;
    Ok(Json(
        json!({"viewer":{"id":user["id"],"name":user["name"],"email_verified":c.actor.verified,"company":company,"can_publish":writer(&c,true).is_ok(),"can_host":writer(&c,true).is_ok(),"is_platform_admin":c.is_admin},"communities":comm,"suggested_companies":suggested["items"],"following_company_ids":following,"unread_count":unread,"draft_count":drafts}),
    ))
}
async fn companies_query(app: &App, c: &Context, s: &Search) -> Result<Value> {
    // Only maintained company pages can publish/follow Network content.
    let cursor = s.cursor.unwrap_or(0).max(0);
    let limit = s.limit();
    let rows:Vec<String>=sqlx::query_scalar(&format!("SELECT ({}||jsonb_build_object('following',EXISTS(SELECT 1 FROM network_follows f WHERE f.followed_company_id=co.id AND f.user_id=$2::uuid AND f.company_id=$3::uuid),'sequence',row_number))::text FROM (SELECT co.*,row_number() OVER(ORDER BY co.name,co.id) AS row_number FROM companies co WHERE co.is_demo=$1 AND co.listing_status='managed' AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=co.id) AND co.name ILIKE $4) co WHERE row_number>$5 AND co.id IS DISTINCT FROM $3::uuid AND (NOT $7 OR NOT EXISTS(SELECT 1 FROM network_follows f WHERE f.followed_company_id=co.id AND f.user_id=$2::uuid AND f.company_id=$3::uuid)) ORDER BY row_number LIMIT $6",company_sql("co")))
        .bind(c.is_demo).bind(&c.actor.user).bind(c.actor.company.as_deref()).bind(s.query()?).bind(cursor).bind(limit).bind(s.suggested.unwrap_or(false)).fetch_all(&app.db).await?;
    Ok(page(json_rows(rows)?, limit))
}
async fn companies(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    Ok(Json(companies_query(&app, &c, &s).await?))
}
async fn follow(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let company = writer(&c, false)?;
    checked_id(&id)?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM companies co WHERE id=$1::uuid AND is_demo=$2 AND listing_status='managed' AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=co.id))").bind(&id).bind(c.is_demo).fetch_one(&app.db).await?;
    if !valid || id == company {
        return Err(bad("Choose another company on Colabb."));
    }
    if v["following"]
        .as_bool()
        .ok_or_else(|| bad("Choose a follow setting."))?
    {
        sqlx::query("INSERT INTO network_follows(user_id,company_id,followed_company_id) VALUES($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING").bind(&c.actor.user).bind(company).bind(id).execute(&app.db).await?;
    } else {
        sqlx::query("DELETE FROM network_follows WHERE user_id=$1::uuid AND company_id=$2::uuid AND followed_company_id=$3::uuid").bind(&c.actor.user).bind(company).bind(id).execute(&app.db).await?;
    }
    Ok(Json(json!({"ok":true})))
}
async fn mentions(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    if let Some(id) = &s.community_id {
        let comm = community_access(&app, id, &c).await?;
        if comm["can_read"] != true {
            return Err(forbidden());
        }
    }
    let rows:Vec<String>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'kind',kind)::text FROM (SELECT co.id,co.name,'company' AS kind FROM companies co WHERE co.is_demo=$1 AND co.listing_status='managed' AND co.name ILIKE $2 UNION ALL SELECT u.id,u.name,'user' FROM users u WHERE u.name ILIKE $2 AND u.email_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM memberships m JOIN companies co ON co.id=m.company_id WHERE m.user_id=u.id AND co.is_demo=$1) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM network_members nm WHERE nm.community_id=$3::uuid AND nm.user_id=u.id AND nm.status='joined'))) x ORDER BY name LIMIT 15")
        .bind(c.is_demo).bind(s.query()?).bind(s.community_id.as_deref()).fetch_all(&app.db).await?;
    Ok(Json(json!({"items":json_rows(rows)?})))
}
async fn unread(app: &App, c: &Context) -> Result<i64> {
    Ok(sqlx::query_scalar("SELECT count(*) FROM user_notifications WHERE user_id=$1::uuid AND company_id IS NOT DISTINCT FROM $2::uuid AND source_kind LIKE 'network_%' AND network_notification_visible(source_kind,source_id,$1::uuid,$3) AND read_at IS NULL AND expires_at>now()").bind(&c.actor.user).bind(c.actor.company.as_deref()).bind(c.is_demo).fetch_one(&app.db).await?)
}
async fn notifications(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(s): Query<Search>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let rows:Vec<String>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'sequence',sequence,'type',type,'title',title,'body',text,'url',url,'post_id',CASE WHEN source_kind='network_post' THEN source_id ELSE NULL END,'community_id',CASE WHEN source_kind='network_community' THEN source_id ELSE NULL END,'created_at',created_at,'read_at',read_at)::text FROM user_notifications WHERE user_id=$1::uuid AND company_id IS NOT DISTINCT FROM $2::uuid AND source_kind LIKE 'network_%' AND network_notification_visible(source_kind,source_id,$1::uuid,$6) AND expires_at>now() AND sequence<$3 AND (NOT $4 OR read_at IS NULL) ORDER BY sequence DESC LIMIT $5")
        .bind(&c.actor.user).bind(c.actor.company.as_deref()).bind(s.cursor()).bind(s.unread.unwrap_or(false)).bind(s.limit()).bind(c.is_demo).fetch_all(&app.db).await?;
    let mut result = page(json_rows(rows)?, s.limit());
    result["unread_count"] = json!(unread(&app, &c).await?);
    Ok(Json(result))
}
async fn read_notifications(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let ids = fields::id_list(&v, "ids", 100)?;
    sqlx::query("UPDATE user_notifications SET read_at=COALESCE(read_at,now()) WHERE id::text=ANY($1) AND user_id=$2::uuid AND company_id IS NOT DISTINCT FROM $3::uuid AND source_kind LIKE 'network_%'").bind(ids).bind(&c.actor.user).bind(c.actor.company.as_deref()).execute(&app.db).await?;
    Ok(Json(
        json!({"ok":true,"unread_count":unread(&app,&c).await?}),
    ))
}
async fn preferences(State(app): State<Arc<App>>, headers: HeaderMap) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let value:Option<String>=sqlx::query_scalar("SELECT (to_jsonb(p)-'user_id')::text FROM network_notification_preferences p WHERE user_id=$1::uuid").bind(&c.actor.user).fetch_optional(&app.db).await?;
    Ok(Json(
        json!({"preferences":match value{Some(v)=>parse_json(v)?,None=>json!({"replies":true,"mentions":true,"community_posts":true,"company_posts":true})}}),
    ))
}
async fn save_preferences(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(v): Json<Value>,
) -> Result<Json<Value>> {
    let c = context(&app, &headers).await?;
    let mut values = Vec::new();
    for k in ["replies", "mentions", "community_posts", "company_posts"] {
        values.push(
            v[k].as_bool()
                .ok_or_else(|| bad("Check notification preferences."))?,
        );
    }
    sqlx::query("INSERT INTO network_notification_preferences(user_id,replies,mentions,community_posts,company_posts) VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET replies=$2,mentions=$3,community_posts=$4,company_posts=$5").bind(&c.actor.user).bind(values[0]).bind(values[1]).bind(values[2]).bind(values[3]).execute(&app.db).await?;
    Ok(Json(json!({"preferences":v})))
}
pub(super) fn routes() -> Router<Arc<App>> {
    Router::new()
        .route("/network-v2/bootstrap", get(bootstrap))
        .route("/network-v2/companies", get(companies))
        .route("/network-v2/companies/{id}/follow", post(follow))
        .route("/network-v2/mentions", get(mentions))
        .route("/network-v2/notifications", get(notifications))
        .route("/network-v2/notifications/read", post(read_notifications))
        .route(
            "/network-v2/notification-preferences",
            get(preferences).put(save_preferences),
        )
        .merge(communities::routes())
        .merge(posts::routes())
}
