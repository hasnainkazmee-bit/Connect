//! Network attachment storage. Unattached bytes are private to their uploader;
//! published bytes inherit the current post/community access, never a public URL.
use super::network::{community_access, context, post_access, Context};
use super::*;

const MAX_FILE: usize = 12 * 1024 * 1024;
#[derive(Deserialize)]
pub(super) struct UploadQuery {
    name: String,
    community_id: Option<String>,
    purpose: Option<String>,
    upload_id: Option<String>,
}
#[derive(Deserialize)]
pub(super) struct ReadQuery {
    preview: Option<String>,
}

pub(super) fn routes() -> Router<Arc<App>> {
    Router::new()
        .route(
            "/network-v2/files",
            post(upload).layer(DefaultBodyLimit::max(MAX_FILE)),
        )
        .route("/network-v2/files/{id}", get(read).delete(remove))
}
// Drafts retain their attachments. Only abandoned, unreferenced uploads expire.
pub(super) fn start_cleanup(app: Arc<App>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(error) = cleanup(&app).await {
                eprintln!("Network orphan cleanup failed: {error:?}");
            }
        }
    });
}
async fn cleanup(app: &App) -> Result<()> {
    let keys: Vec<String> = sqlx::query_scalar("DELETE FROM network_files f WHERE f.created_at < now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM network_post_files pf WHERE pf.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM network_communities c WHERE c.cover_file_id=f.id) AND NOT EXISTS(SELECT 1 FROM network_drafts d WHERE d.author_id=f.owner_user_id AND d.company_id=f.company_id AND COALESCE(d.body->'file_ids','[]'::jsonb) ? f.id::text) RETURNING storage_key")
        .fetch_all(&app.db).await?;
    for key in keys {
        if checked_id(&key).is_ok() {
            let _ = tokio::fs::remove_file(app.uploads.join("network").join(key)).await;
        }
    }
    Ok(())
}
fn file_error() -> Error {
    Error(StatusCode::NOT_FOUND, "File not found.")
}
fn file_value(r: &sqlx::postgres::PgRow) -> Value {
    let id: String = r.get("id");
    json!({"id":id,"name":r.get::<String,_>("original_name"),"mime_type":r.get::<String,_>("mime_type"),"size_bytes":r.get::<i64,_>("size_bytes"),"url":format!("/api/network-v2/files/{id}"),"width":r.get::<Option<i32>,_>("width"),"height":r.get::<Option<i32>,_>("height")})
}
fn media_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"%PDF-") {
        Some("application/pdf")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        && bytes.len() >= 33
        && &bytes[12..16] == b"IHDR"
    {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff])
        && bytes.len() > 4
        && bytes.ends_with(&[0xff, 0xd9])
    {
        Some("image/jpeg")
    } else if bytes.len() >= 20
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WEBP"
        && [b"VP8 ".as_slice(), b"VP8L".as_slice(), b"VP8X".as_slice()].contains(&&bytes[12..16])
    {
        Some("image/webp")
    } else {
        None
    }
}
fn safe_name(s: &str) -> Result<String> {
    let s = s.trim();
    if s.is_empty() || s.len() > 240 || s.chars().any(|c| c.is_control() || c == '/' || c == '\\') {
        return Err(bad(
            "Use a file name without folders or special control characters.",
        ));
    }
    Ok(s.to_owned())
}
async fn upload(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(q): Query<UploadQuery>,
    bytes: Bytes,
) -> Result<Json<Value>> {
    let ctx = context(&app, &headers).await?;
    let company = ctx.actor.company.as_deref().ok_or_else(forbidden)?;
    if ctx.actor.account_type != "company" {
        return Err(forbidden());
    }
    if !ctx.actor.verified {
        return Err(Error(
            StatusCode::FORBIDDEN,
            "Verify your email before uploading.",
        ));
    }
    let name = safe_name(&q.name)?;
    let purpose = q.purpose.as_deref().unwrap_or("post");
    if !["post", "cover"].contains(&purpose) {
        return Err(bad("Choose a valid file destination."));
    }
    if let Some(id) = q.community_id.as_deref() {
        checked_id(id)?;
        let c = community_access(&app, id, &ctx).await?;
        if c[if purpose == "cover" {
            "can_manage"
        } else {
            "can_post"
        }] != true
        {
            return Err(forbidden());
        }
    } else if !matches!(ctx.actor.role.as_deref(), Some("owner" | "admin")) {
        return Err(forbidden());
    }
    if bytes.is_empty() || bytes.len() > MAX_FILE {
        return Err(bad("Each file must be no larger than 12 MB."));
    }
    let mime = media_type(&bytes).ok_or_else(|| bad("Upload a JPEG, PNG, WebP image or PDF."))?;
    let declared = headers
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("");
    if mime != declared || (purpose == "cover" && mime == "application/pdf") {
        return Err(bad("The file contents do not match the selected format."));
    }
    let (width, height) = if mime == "image/png" {
        (
            Some(u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as i64),
            Some(u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as i64),
        )
    } else {
        (None, None)
    };
    if width
        .zip(height)
        .is_some_and(|(w, h)| w < 1 || h < 1 || w > 30000 || h > 30000 || w * h > 100_000_000)
    {
        return Err(bad(
            "This image is too large. Use an image under 100 megapixels.",
        ));
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if let Some(id) = &q.upload_id {
        checked_id(id)?;
    }
    let mut tx = app.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("network-upload:{}", ctx.actor.user))
        .execute(&mut *tx)
        .await?;
    if let Some(id) = &q.upload_id {
        let existing=sqlx::query("SELECT id::text,original_name,mime_type,size_bytes,width,height,content_sha256,company_id::text,community_id::text,purpose FROM network_files WHERE owner_user_id=$1::uuid AND client_upload_id=$2::uuid").bind(&ctx.actor.user).bind(id).fetch_optional(&mut *tx).await?;
        if let Some(r) = existing {
            if r.get::<String, _>("content_sha256") != hash
                || r.get::<String, _>("company_id") != company
                || r.get::<Option<String>, _>("community_id") != q.community_id
                || r.get::<String, _>("purpose") != purpose
            {
                return Err(conflict(
                    "This upload ID was already used for a different file.",
                ));
            }
            return Ok(Json(json!({"file":file_value(&r)})));
        }
    }
    let pending:i64=sqlx::query_scalar("SELECT count(*) FROM network_files f WHERE owner_user_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM network_post_files pf WHERE pf.file_id=f.id) AND NOT EXISTS(SELECT 1 FROM network_communities c WHERE c.cover_file_id=f.id)").bind(&ctx.actor.user).fetch_one(&mut *tx).await?;
    if pending >= 100 {
        return Err(bad(
            "Remove unused draft attachments before adding more files.",
        ));
    }
    let id: String = sqlx::query_scalar("SELECT gen_random_uuid()::text")
        .fetch_one(&mut *tx)
        .await?;
    let directory = app.uploads.join("network");
    tokio::fs::create_dir_all(&directory).await.map_err(|_| {
        Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The file could not be stored.",
        )
    })?;
    let path = directory.join(&id);
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|_| {
            Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The file could not be stored.",
            )
        })?;
    if file.write_all(&bytes).await.is_err() {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The upload was interrupted. Please try again.",
        ));
    }
    drop(file);
    let result=sqlx::query("INSERT INTO network_files(id,owner_user_id,company_id,community_id,purpose,original_name,storage_key,mime_type,size_bytes,content_sha256,client_upload_id,width,height) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$1,$7,$8,$9,$10::uuid,$11,$12) RETURNING id::text,original_name,mime_type,size_bytes,width,height")
        .bind(&id).bind(&ctx.actor.user).bind(company).bind(&q.community_id).bind(purpose).bind(&name).bind(mime).bind(bytes.len() as i64).bind(hash).bind(&q.upload_id).bind(width.map(|v|v as i32)).bind(height.map(|v|v as i32)).fetch_one(&mut *tx).await;
    match result {
        Ok(r) => {
            if let Err(e) = tx.commit().await {
                let _ = tokio::fs::remove_file(path).await;
                return Err(e.into());
            }
            Ok(Json(json!({"file":file_value(&r)})))
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(path).await;
            Err(e.into())
        }
    }
}
async fn readable(app: &App, id: &str, ctx: &Context) -> Result<sqlx::postgres::PgRow> {
    checked_id(id)?;
    let r=sqlx::query("SELECT id::text,owner_user_id::text,company_id::text,community_id::text,storage_key,original_name,mime_type,size_bytes,width,height FROM network_files WHERE id=$1::uuid").bind(id).fetch_optional(&app.db).await?.ok_or_else(file_error)?;
    let posts: Vec<String> =
        sqlx::query_scalar("SELECT post_id::text FROM network_post_files WHERE file_id=$1::uuid")
            .bind(id)
            .fetch_all(&app.db)
            .await?;
    for post in &posts {
        if post_access(app, post, ctx).await.is_ok() {
            return Ok(r);
        }
    }
    let covers: Vec<String> =
        sqlx::query_scalar("SELECT id::text FROM network_communities WHERE cover_file_id=$1::uuid")
            .bind(id)
            .fetch_all(&app.db)
            .await?;
    for c in &covers {
        if let Ok(c) = community_access(app, c, ctx).await {
            if c["can_read"] == true {
                return Ok(r);
            }
        }
    }
    if posts.is_empty()
        && covers.is_empty()
        && r.get::<String, _>("owner_user_id") == ctx.actor.user
        && Some(r.get::<String, _>("company_id").as_str()) == ctx.actor.company.as_deref()
    {
        if let Some(c) = r.get::<Option<String>, _>("community_id") {
            let access = community_access(app, &c, ctx).await?;
            if access["can_read"] != true {
                return Err(file_error());
            }
        }
        return Ok(r);
    }
    Err(file_error())
}
async fn read(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<ReadQuery>,
) -> Result<Response> {
    let ctx = context(&app, &headers).await?;
    let r = readable(&app, &id, &ctx).await?;
    let key: String = r.get("storage_key");
    checked_id(&key)?;
    let bytes = tokio::fs::read(app.uploads.join("network").join(key))
        .await
        .map_err(|_| file_error())?;
    let mime: String = r.get("mime_type");
    let name: String = r.get("original_name");
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let disposition = if q.preview.as_deref() == Some("1") || mime.starts_with("image/") {
        "inline"
    } else {
        "attachment"
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (
                header::CONTENT_DISPOSITION,
                format!("{disposition}; filename=\"attachment\"; filename*=UTF-8''{encoded}"),
            ),
            (header::CACHE_CONTROL, "private, no-store".into()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
        ],
        bytes,
    )
        .into_response())
}
async fn remove(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let ctx = context(&app, &headers).await?;
    checked_id(&id)?;
    let mut tx = app.db.begin().await?;
    let r=sqlx::query("SELECT storage_key,owner_user_id::text,company_id::text FROM network_files WHERE id=$1::uuid FOR UPDATE").bind(&id).fetch_optional(&mut *tx).await?.ok_or_else(file_error)?;
    if r.get::<String, _>("owner_user_id") != ctx.actor.user
        || Some(r.get::<String, _>("company_id").as_str()) != ctx.actor.company.as_deref()
    {
        return Err(forbidden());
    }
    let linked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM network_post_files WHERE file_id=$1::uuid) OR EXISTS(SELECT 1 FROM network_communities WHERE cover_file_id=$1::uuid)").bind(&id).fetch_one(&mut *tx).await?;
    if linked {
        return Err(conflict(
            "This file is used by a published post or community.",
        ));
    }
    sqlx::query("DELETE FROM network_files WHERE id=$1::uuid")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let key: String = r.get("storage_key");
    checked_id(&key)?;
    let _ = tokio::fs::remove_file(app.uploads.join("network").join(key)).await;
    Ok(Json(json!({"ok":true})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_active_and_mismatched_media() {
        assert_eq!(media_type(b"<svg><script>alert(1)</script></svg>"), None);
        assert_eq!(media_type(b"%PDF-1.7\n"), Some("application/pdf"));
        assert_eq!(media_type(b"\x89PNG\r\n\x1a\n"), None);
        assert_eq!(media_type(b"not a jpeg"), None);
    }
    #[test]
    fn file_names_are_not_paths() {
        assert!(safe_name("../../secret").is_err());
        assert!(safe_name("report\r\nHeader: x").is_err());
        assert_eq!(safe_name("Roof plan.pdf").unwrap(), "Roof plan.pdf");
    }
}
