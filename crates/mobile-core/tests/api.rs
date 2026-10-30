use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use sunhub_mobile_core::{CommunityClient, UploadFile};

#[test]
#[ignore = "Run with npm run test:android-core against the isolated API"]
fn rust_mobile_client_connects_and_messages_through_the_real_api() {
    let url = std::env::var("API_TEST_URL").expect("Isolated test API is required");
    assert!(std::env::var("DATABASE_URL").unwrap().ends_with("_test"));
    let a = CommunityClient::new(url.clone(), ":memory:".into(), true).unwrap();
    let b = CommunityClient::new(url, ":memory:".into(), true).unwrap();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let register = |client: &CommunityClient, name: &str| -> Value {
        serde_json::from_str(&client.post_json("/auth/register".into(), json!({"name": name, "email":format!("{name}{suffix}@rust.test"),"password":"RustMobileTest123!","companyName":format!("{name} Mobile {suffix}")}).to_string()).unwrap()).unwrap()
    };
    let a_session = register(&a, "Amina");
    let b_session = register(&b, "Maya");
    let bid = b_session["activeCompanyId"].as_str().unwrap();
    let directory: Value =
        serde_json::from_str(&a.get(format!("/messaging/companies?q={suffix}")).unwrap()).unwrap();
    assert_eq!(directory["total"], 1);
    let request: Value = serde_json::from_str(
        &a.post_json(
            "/requests".into(),
            json!({"companyId":bid,"kind":"message","note":"Can we discuss a commercial project?"})
                .to_string(),
        )
        .unwrap(),
    )
    .unwrap();
    let network: Value = serde_json::from_str(&b.get("/network".into()).unwrap()).unwrap();
    assert_eq!(network["connections"].as_array().unwrap().len(), 0);
    assert_eq!(
        network["incoming"][0]["note"],
        "Can we discuss a commercial project?"
    );
    let accepted: Value = serde_json::from_str(
        &b.post_json(
            format!("/requests/{}/respond", request["id"].as_str().unwrap()),
            json!({"action":"accept"}).to_string(),
        )
        .unwrap(),
    )
    .unwrap();
    let path = format!(
        "/conversations/{}/messages",
        accepted["connectionId"].as_str().unwrap()
    );
    b.post_text(path.clone(), "Yes, send the scope.".into())
        .unwrap();
    let messages: Value = serde_json::from_str(&a.get(path.clone()).unwrap()).unwrap();
    assert_eq!(messages["messages"].as_array().unwrap().len(), 2);
    assert_eq!(
        messages["messages"][0]["sender_company_id"],
        a_session["activeCompanyId"]
    );
    assert_eq!(messages["messages"][1]["body"], "Yes, send the scope.");
    assert!(a.cached(path.clone()).unwrap().is_some());
    let files = tempfile::tempdir().unwrap();
    let image_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/public/assets/sunhub-symbol.png");
    let image = || UploadFile {
        path: image_path.to_string_lossy().into_owned(),
        name: "company.png".into(),
        mime: "image/png".into(),
    };
    a.post_media(path.clone(), "Site photo".into(), vec![image()])
        .unwrap();
    let history: Value = serde_json::from_str(&b.get(path).unwrap()).unwrap();
    let attachment = history["messages"][2]["attachments"][0]["id"]
        .as_str()
        .unwrap();
    let download = files.path().join("photo.png");
    b.download_attachment(
        format!("/attachments/{attachment}"),
        download.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(
        std::fs::read(download).unwrap(),
        std::fs::read(&image_path).unwrap()
    );
    let post: Value = serde_json::from_str(
        &a.post_media(
            "/posts".into(),
            "Project update from Android".into(),
            vec![image()],
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(post["media"][0]["mime"], "image/png");
    let clip =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/clip.webm");
    let video: Value = serde_json::from_str(
        &a.post_media(
            "/posts".into(),
            "Site video".into(),
            vec![UploadFile {
                path: clip.to_string_lossy().into_owned(),
                name: "clip.webm".into(),
                mime: "video/webm".into(),
            }],
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(video["media"][0]["mime"], "video/webm");
    a.post_json(
        format!("/social/companies/{bid}/follow"),
        json!({"following":true}).to_string(),
    )
    .unwrap();
    let stats: Value =
        serde_json::from_str(&a.get(format!("/social/companies/{bid}")).unwrap()).unwrap();
    assert_eq!(stats["following"], true);
    a.post_json("/auth/logout".into(), "{}".into()).unwrap();
    a.clear_session().unwrap();
}
