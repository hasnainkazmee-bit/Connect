use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};
use sunhub_mobile_core::CommunityClient;

fn server(body: &'static str, cookie: Option<String>) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let task = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 8192];
        let _ = stream.read(&mut request).unwrap();
        let header = cookie
            .map(|c| format!("Set-Cookie: {c}; HttpOnly; SameSite=Lax\r\n"))
            .unwrap_or_default();
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{header}Connection: close\r\n\r\n{body}", body.len()).unwrap();
    });
    (url, task)
}

#[test]
fn production_rejects_http_credentials_and_cross_origin_api_paths() {
    for url in [
        "http://example.com",
        "https://user:secret@example.com",
        "https://example.com/other",
        "ftp://example.com",
    ] {
        assert!(CommunityClient::new(url.into(), ":memory:".into(), true).is_err());
    }
    assert!(
        CommunityClient::new("http://localhost:4100".into(), ":memory:".into(), false).is_err()
    );
    let core =
        CommunityClient::new("https://example.com".into(), ":memory:".into(), false).unwrap();
    for path in [
        "//evil.example/",
        "/../../secret",
        "/\\evil.example/",
        "/%2e%2e/secret",
        "https://evil.example",
    ] {
        assert!(core.get(path.into()).is_err());
    }
}

#[test]
fn cache_survives_restart_but_is_isolated_by_session_and_cleared_on_logout() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir
        .path()
        .join("cache.sqlite")
        .to_string_lossy()
        .into_owned();
    let (url, server) = server(r#"{"companies":[{"name":"Solar A"}]}"#, None);
    let cookie_a = format!("sunhub_session={}", "a".repeat(64));
    let cookie_b = format!("sunhub_session={}", "b".repeat(64));
    let core = CommunityClient::new(url.clone(), db.clone(), true).unwrap();
    core.restore_session(cookie_a.clone()).unwrap();
    let response = core.get("/network".into()).unwrap();
    server.join().unwrap();
    assert_eq!(
        core.cached("/network".into()).unwrap().unwrap().json,
        response
    );
    drop(core);
    let restored = CommunityClient::new(url, db, true).unwrap();
    restored.restore_session(cookie_b).unwrap();
    assert!(restored.cached("/network".into()).unwrap().is_none());
    restored.restore_session(cookie_a).unwrap();
    assert_eq!(
        restored.cached("/network".into()).unwrap().unwrap().json,
        response
    );
    restored.clear_session().unwrap();
    assert!(restored.cached("/network".into()).unwrap().is_none());
    assert_eq!(restored.session_cookie().unwrap(), "");
}

#[test]
fn login_captures_the_server_cookie_and_rejects_invalid_saved_tokens() {
    let token = format!("sunhub_session={}", "c".repeat(64));
    let (url, server) = server(r#"{"user":{"name":"Amina"}}"#, Some(token.clone()));
    let core = CommunityClient::new(url, ":memory:".into(), true).unwrap();
    assert!(core.restore_session("sunhub_session=short".into()).is_err());
    core.post_json(
        "/auth/login".into(),
        r#"{"email":"a@example.test","password":"test"}"#.into(),
    )
    .unwrap();
    server.join().unwrap();
    assert_eq!(core.session_cookie().unwrap(), token);
}

#[test]
fn in_flight_responses_cannot_cross_company_or_account_changes() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let (arrived_tx, arrived_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 8192];
        stream.read(&mut request).unwrap();
        arrived_tx.send(()).unwrap();
        release_rx.recv().unwrap();
        let body = r#"{"private":"old company"}"#;
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
    });
    let core = CommunityClient::new(url, ":memory:".into(), true).unwrap();
    core.restore_session(format!("sunhub_session={}", "a".repeat(64)))
        .unwrap();
    let reading = core.clone();
    let task = thread::spawn(move || reading.get("/network".into()));
    arrived_rx.recv().unwrap();
    core.restore_session(format!("sunhub_session={}", "b".repeat(64)))
        .unwrap();
    release_tx.send(()).unwrap();
    assert!(matches!(
        task.join().unwrap(),
        Err(sunhub_mobile_core::CoreError::ContextChanged)
    ));
    assert!(core.cached("/network".into()).unwrap().is_none());
    server.join().unwrap();
}

#[test]
fn authorization_errors_remove_previously_cached_private_responses() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        for (status, body) in [
            ("200 OK", r#"{"private":"company data"}"#),
            ("403 Forbidden", r#"{"error":"Access was removed."}"#),
        ] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 8192];
            stream.read(&mut request).unwrap();
            write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    let core = CommunityClient::new(url, ":memory:".into(), true).unwrap();
    core.get("/network".into()).unwrap();
    assert!(core.cached("/network".into()).unwrap().is_some());
    assert!(core.get("/network".into()).is_err());
    assert!(core.cached("/network".into()).unwrap().is_none());
    server.join().unwrap();
}

#[test]
fn sunhub_handoff_adopts_session_and_removes_previous_identity_cache() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let next = format!("sunhub_session={}", "d".repeat(64));
    let response_cookie = next.clone();
    let server = thread::spawn(move || {
        for exchange in [false, true] {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 8192];
            let count = stream.read(&mut request).unwrap();
            if exchange {
                assert!(String::from_utf8_lossy(&request[..count])
                    .starts_with("POST /api/auth/sunhub/mobile/exchange "));
            }
            let body = if exchange {
                r#"{"user":{"name":"Sunhub Member"}}"#
            } else {
                r#"{"private":"previous company"}"#
            };
            let cookie = if exchange {
                format!("Set-Cookie: {response_cookie}; HttpOnly; SameSite=Lax\r\n")
            } else {
                String::new()
            };
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{cookie}Connection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    let core = CommunityClient::new(url, ":memory:".into(), true).unwrap();
    let previous = format!("sunhub_session={}", "a".repeat(64));
    core.restore_session(previous.clone()).unwrap();
    core.get("/network".into()).unwrap();
    assert!(core.cached("/network".into()).unwrap().is_some());
    core.post_json(
        "/auth/sunhub/mobile/exchange".into(),
        r#"{"code":"one-use-handoff","verifier":"device-secret"}"#.into(),
    )
    .unwrap();
    assert_eq!(core.session_cookie().unwrap(), next);
    core.restore_session(previous).unwrap();
    assert!(core.cached("/network".into()).unwrap().is_none());
    server.join().unwrap();
}
