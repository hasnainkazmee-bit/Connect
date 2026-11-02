use reqwest::{
    blocking::{multipart, Client, Response},
    header::{COOKIE, SET_COOKIE},
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Read},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    #[error("{detail}")]
    Invalid { detail: String },
    #[error("{detail}")]
    Network { detail: String },
    #[error("{detail}")]
    Api { status: u16, detail: String },
    #[error("Local storage is unavailable.")]
    Storage,
    #[error("Your account changed. Please try again.")]
    ContextChanged,
}

#[derive(uniffi::Record)]
pub struct CachedResponse {
    pub json: String,
    pub saved_at: u64,
}

#[derive(uniffi::Record)]
pub struct UploadFile {
    pub path: String,
    pub name: String,
    pub mime: String,
}

struct State {
    cookie: String,
    generation: u64,
    db: Connection,
}

#[derive(uniffi::Object)]
pub struct CommunityClient {
    base: Url,
    http: Client,
    state: Mutex<State>,
    writes: Mutex<()>,
}

fn invalid(message: &str) -> CoreError {
    CoreError::Invalid {
        detail: message.into(),
    }
}
fn network(_: impl std::fmt::Display) -> CoreError {
    CoreError::Network {
        detail: "Couldn’t reach Connect. Check your connection and try again.".into(),
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn scope(cookie: &str) -> String {
    format!("{:x}", Sha256::digest(cookie.as_bytes()))
}

impl CommunityClient {
    fn endpoint(&self, path: &str) -> Result<Url, CoreError> {
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.contains('\\')
            || path.contains('#')
        {
            return Err(invalid("Invalid API path."));
        }
        let url = self
            .base
            .join(&format!("api{path}"))
            .map_err(|_| invalid("Invalid API path."))?;
        if url.origin() != self.base.origin() || !url.path().starts_with("/api/") {
            return Err(invalid("Invalid API path."));
        }
        Ok(url)
    }
    fn identity(&self) -> Result<(String, u64), CoreError> {
        let state = self.state.lock().map_err(|_| CoreError::Storage)?;
        Ok((state.cookie.clone(), state.generation))
    }
    fn decode(response: Response) -> Result<(String, Option<String>), CoreError> {
        let status = response.status();
        let cookie = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|h| h.to_str().ok())
            .find_map(|h| {
                h.split(';')
                    .next()
                    .filter(|v| v.starts_with("sunhub_session="))
                    .map(String::from)
            });
        let mut body = String::new();
        response
            .take(4 * 1024 * 1024 + 1)
            .read_to_string(&mut body)
            .map_err(network)?;
        if body.len() > 4 * 1024 * 1024 {
            return Err(invalid("Response is too large."));
        }
        let data: serde_json::Value =
            serde_json::from_str(&body).map_err(|_| invalid("Invalid server response."))?;
        if !status.is_success() {
            return Err(CoreError::Api {
                status: status.as_u16(),
                detail: data["error"]
                    .as_str()
                    .unwrap_or("The request could not be completed.")
                    .into(),
            });
        }
        Ok((body, cookie))
    }
    fn finish_write(
        &self,
        response: Response,
        generation: u64,
        identity_change: bool,
    ) -> Result<String, CoreError> {
        let (body, cookie) = Self::decode(response)?;
        let mut state = self.state.lock().map_err(|_| CoreError::Storage)?;
        if state.generation != generation {
            return Err(CoreError::ContextChanged);
        }
        if let Some(cookie) = cookie {
            state.cookie = cookie;
        }
        // Bump on every mutation so an older in-flight read cannot overwrite fresh state.
        state.generation += 1;
        if identity_change {
            state
                .db
                .execute("DELETE FROM cache", [])
                .map_err(|_| CoreError::Storage)?;
        }
        Ok(body)
    }
}

#[uniffi::export]
impl CommunityClient {
    #[uniffi::constructor]
    pub fn new(
        base_url: String,
        cache_path: String,
        allow_local_http: bool,
    ) -> Result<Arc<Self>, CoreError> {
        let base = Url::parse(&base_url).map_err(|_| invalid("Invalid server address."))?;
        let local = matches!(
            base.host_str(),
            Some("localhost" | "127.0.0.1" | "10.0.2.2" | "[::1]")
        );
        if (base.scheme() != "https" && !(allow_local_http && local && base.scheme() == "http"))
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
            || base.path() != "/"
        {
            return Err(invalid(
                "Use an HTTPS server address. Local HTTP is only available in debug builds.",
            ));
        }
        let db = Connection::open(cache_path).map_err(|_| CoreError::Storage)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS cache(scope TEXT NOT NULL,path TEXT NOT NULL,json TEXT NOT NULL,saved_at INTEGER NOT NULL,PRIMARY KEY(scope,path));")
            .map_err(|_| CoreError::Storage)?;
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(35))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("ConnectAndroid/0.2")
            .build()
            .map_err(network)?;
        Ok(Arc::new(Self {
            base,
            http,
            state: Mutex::new(State {
                cookie: String::new(),
                generation: 0,
                db,
            }),
            writes: Mutex::new(()),
        }))
    }

    /// Platform code stores this in Android Keystore-backed encrypted storage, never logs it.
    pub fn session_cookie(&self) -> Result<String, CoreError> {
        Ok(self.identity()?.0)
    }

    pub fn restore_session(&self, cookie: String) -> Result<(), CoreError> {
        let token = cookie
            .strip_prefix("sunhub_session=")
            .ok_or_else(|| invalid("Invalid saved session."))?;
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid("Invalid saved session."));
        }
        let mut state = self.state.lock().map_err(|_| CoreError::Storage)?;
        state.cookie = cookie;
        state.generation += 1;
        Ok(())
    }

    pub fn clear_session(&self) -> Result<(), CoreError> {
        let mut state = self.state.lock().map_err(|_| CoreError::Storage)?;
        state.cookie.clear();
        state.generation += 1;
        state
            .db
            .execute("DELETE FROM cache", [])
            .map_err(|_| CoreError::Storage)?;
        state
            .db
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|_| CoreError::Storage)?;
        Ok(())
    }

    pub fn cached(&self, path: String) -> Result<Option<CachedResponse>, CoreError> {
        self.endpoint(&path)?;
        let state = self.state.lock().map_err(|_| CoreError::Storage)?;
        state
            .db
            .query_row(
                "SELECT json,saved_at FROM cache WHERE scope=?1 AND path=?2 AND saved_at>?3",
                params![scope(&state.cookie), path, now().saturating_sub(86400)],
                |row| {
                    Ok(CachedResponse {
                        json: row.get(0)?,
                        saved_at: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|_| CoreError::Storage)
    }

    pub fn get(&self, path: String) -> Result<String, CoreError> {
        let url = self.endpoint(&path)?;
        let (cookie, generation) = self.identity()?;
        let response = self
            .http
            .get(url)
            .header(COOKIE, &cookie)
            .send()
            .map_err(network)?;
        let (body, _) = match Self::decode(response) {
            Ok(value) => value,
            Err(error) => {
                if matches!(
                    error,
                    CoreError::Api {
                        status: 401 | 403 | 404,
                        ..
                    }
                ) {
                    let state = self.state.lock().map_err(|_| CoreError::Storage)?;
                    state
                        .db
                        .execute(
                            "DELETE FROM cache WHERE scope=?1 AND path=?2",
                            params![scope(&cookie), path],
                        )
                        .map_err(|_| CoreError::Storage)?;
                }
                return Err(error);
            }
        };
        let state = self.state.lock().map_err(|_| CoreError::Storage)?;
        if state.generation != generation {
            return Err(CoreError::ContextChanged);
        }
        state
            .db
            .execute(
                "INSERT OR REPLACE INTO cache(scope,path,json,saved_at) VALUES(?1,?2,?3,?4)",
                params![scope(&cookie), path, body, now()],
            )
            .map_err(|_| CoreError::Storage)?;
        state.db.execute("DELETE FROM cache WHERE rowid NOT IN (SELECT rowid FROM cache ORDER BY saved_at DESC,rowid DESC LIMIT 200)", []).map_err(|_| CoreError::Storage)?;
        Ok(body)
    }

    pub fn post_json(&self, path: String, body: String) -> Result<String, CoreError> {
        let _write = self.writes.lock().map_err(|_| CoreError::Storage)?;
        let url = self.endpoint(&path)?;
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|_| invalid("Invalid request body."))?;
        let (cookie, generation) = self.identity()?;
        let response = self
            .http
            .post(url)
            .header(COOKIE, cookie)
            .json(&json)
            .send()
            .map_err(network)?;
        self.finish_write(
            response,
            generation,
            matches!(
                path.as_str(),
                "/auth/login"
                    | "/auth/sunhub/mobile/exchange"
                    | "/auth/register"
                    | "/auth/logout"
                    | "/session/company"
                    | "/onboarding/company"
                    | "/auth/password/change"
                    | "/auth/password/reset"
            ) || (path.starts_with("/join/") || path.starts_with("/team/invites/"))
                && path.ends_with("/accept"),
        )
    }

    /// JSON updates stay on the configured API origin and use the same session and cache generation.
    pub fn request_json(
        &self,
        method: String,
        path: String,
        body: String,
    ) -> Result<String, CoreError> {
        if !matches!(method.as_str(), "POST" | "PATCH" | "PUT" | "DELETE") {
            return Err(invalid("Unsupported update method."));
        }
        if method == "POST" {
            return self.post_json(path, body);
        }
        let _write = self.writes.lock().map_err(|_| CoreError::Storage)?;
        let url = self.endpoint(&path)?;
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|_| invalid("Invalid request body."))?;
        let (cookie, generation) = self.identity()?;
        let verb = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| invalid("Unsupported update method."))?;
        let response = self
            .http
            .request(verb, url)
            .header(COOKIE, cookie)
            .json(&json)
            .send()
            .map_err(network)?;
        self.finish_write(response, generation, false)
    }

    /// Stream a single publication or company image upload from private device storage.
    pub fn upload_file(&self, path: String, file: UploadFile) -> Result<String, CoreError> {
        let _write = self.writes.lock().map_err(|_| CoreError::Storage)?;
        let url = self.endpoint(&path)?;
        let metadata =
            std::fs::metadata(&file.path).map_err(|_| invalid("Choose this file again."))?;
        if !metadata.is_file() || metadata.len() > 100 * 1024 * 1024 {
            return Err(invalid("This attachment is too large."));
        }
        let part = multipart::Part::file(file.path)
            .map_err(network)?
            .file_name(file.name)
            .mime_str(&file.mime)
            .map_err(|_| invalid("Unsupported attachment type."))?;
        let (cookie, generation) = self.identity()?;
        let response = self
            .http
            .post(url)
            .header(COOKIE, cookie)
            .timeout(Duration::from_secs(180))
            .multipart(multipart::Form::new().part("file", part))
            .send()
            .map_err(network)?;
        self.finish_write(response, generation, false)
    }

    pub fn post_text(&self, path: String, text: String) -> Result<String, CoreError> {
        self.post_media(path, text, vec![])
    }

    /// Stream files from private Android staging storage; do not copy large videos over FFI.
    pub fn post_media(
        &self,
        path: String,
        text: String,
        files: Vec<UploadFile>,
    ) -> Result<String, CoreError> {
        let _write = self.writes.lock().map_err(|_| CoreError::Storage)?;
        let url = self.endpoint(&path)?;
        if text.trim().is_empty() && files.is_empty() {
            return Err(invalid("Write a message first."));
        }
        if files.len() > 4 {
            return Err(invalid("Choose up to four files."));
        }
        let mut form = multipart::Form::new().text("body", text);
        for file in files {
            let metadata = std::fs::metadata(&file.path).map_err(|_| {
                invalid("This attachment is no longer available. Please choose it again.")
            })?;
            if !metadata.is_file() || metadata.len() > 100 * 1024 * 1024 {
                return Err(invalid("This attachment is too large."));
            }
            let part = multipart::Part::file(file.path)
                .map_err(network)?
                .file_name(file.name)
                .mime_str(&file.mime)
                .map_err(|_| invalid("Unsupported attachment type."))?;
            form = form.part("files", part);
        }
        let (cookie, generation) = self.identity()?;
        let response = self
            .http
            .post(url)
            .header(COOKIE, cookie)
            .timeout(Duration::from_secs(180))
            .multipart(form)
            .send()
            .map_err(network)?;
        self.finish_write(response, generation, false)
    }

    /// Authenticated chat attachment download into app-private storage.
    pub fn download_attachment(&self, path: String, destination: String) -> Result<(), CoreError> {
        if !(path.starts_with("/attachments/") || path.starts_with("/post-media/"))
            || path.contains('?')
        {
            return Err(invalid("Invalid attachment."));
        }
        let (cookie, generation) = self.identity()?;
        let response = self
            .http
            .get(self.endpoint(&path)?)
            .header(COOKIE, cookie)
            .send()
            .map_err(network)?;
        if !response.status().is_success() {
            Self::decode(response)?;
            return Err(invalid("Attachment unavailable."));
        }
        let limit = if path.starts_with("/post-media/") {
            20 * 1024 * 1024
        } else {
            10 * 1024 * 1024
        };
        let mut bytes = Vec::new();
        response
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(network)?;
        if bytes.len() as u64 > limit {
            return Err(invalid("Attachment is too large."));
        }
        let state = self.state.lock().map_err(|_| CoreError::Storage)?;
        if state.generation != generation {
            return Err(CoreError::ContextChanged);
        }
        std::fs::write(destination, bytes).map_err(|_| CoreError::Storage)
    }

    /// A foreground-only SSE stream. Android cancels it when the UI stops.
    pub fn watch_changes(
        &self,
        observer: Box<dyn ChangeObserver>,
    ) -> Result<Arc<EventWatch>, CoreError> {
        let url = self.endpoint("/events")?;
        let (cookie, _) = self.identity()?;
        let http = self.http.clone();
        let watch = Arc::new(EventWatch {
            cancelled: AtomicBool::new(false),
        });
        let worker = watch.clone();
        std::thread::spawn(move || {
            while !worker.cancelled.load(Ordering::Relaxed) {
                if let Ok(response) = http.get(url.clone()).header(COOKIE, &cookie).send() {
                    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                        break;
                    }
                    if response.status().is_success() {
                        if !worker.cancelled.load(Ordering::Relaxed) {
                            observer.changed();
                        }
                        for line in BufReader::new(response).lines() {
                            if worker.cancelled.load(Ordering::Relaxed) {
                                return;
                            }
                            match line {
                                Ok(line) if line == "event: changed" => observer.changed(),
                                Err(_) => break,
                                _ => {}
                            }
                        }
                    }
                }
                for _ in 0..20 {
                    if worker.cancelled.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        });
        Ok(watch)
    }
}

#[uniffi::export(callback_interface)]
pub trait ChangeObserver: Send + Sync {
    fn changed(&self);
}

#[derive(uniffi::Object)]
pub struct EventWatch {
    cancelled: AtomicBool,
}

#[uniffi::export]
impl EventWatch {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}
