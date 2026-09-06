#[test]
fn credential_payload_accepts_only_valid_token() {
    assert!(crate::commands::valid_credentials(r#"{"token":"okay"}"#));
    for payload in [
        r#"{"token":"okay","path":"secret"}"#,
        r#"{"token":"bad"}"#,
        r#"{"token":3}"#,
        r#"{"token":"okay","token":"also"}"#,
    ] {
        assert!(!crate::commands::valid_credentials(payload));
    }
}

#[test]
fn acl_restricts_commands_to_bundled_main_window() {
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        test::{get_ipc_response, mock_builder},
        webview::InvokeRequest,
    };
    let state = std::sync::Arc::new(crate::state::DesktopState::new("/unused".into()));
    state.close();
    let app = mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::inspect_setup,
            crate::commands::configure_setup
        ])
        .build(tauri::generate_context!())
        .unwrap();
    for (label, origin, cmd, expected) in [
        ("main", "tauri://localhost", "inspect_setup", "closed"),
        ("other", "tauri://localhost", "inspect_setup", "not allowed"),
        (
            "main",
            "https://example.com",
            "inspect_setup",
            "not allowed",
        ),
        (
            "main",
            "tauri://localhost",
            "plugin:fs|read_file",
            "not allowed",
        ),
    ] {
        let window = match app.get_webview_window(label) {
            Some(window) => window,
            None => tauri::WebviewWindowBuilder::new(&app, label, Default::default())
                .build()
                .unwrap(),
        };
        let result = get_ipc_response(
            &window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: origin.parse().unwrap(),
                body: InvokeBody::Json(serde_json::json!({})),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap_err();
        assert!(
            result.to_string().contains(expected),
            "{label} {origin} {cmd}: {result}"
        );
    }
}
use tauri::Manager;

#[test]
fn navigation_rejects_remote_and_confused_local_urls() {
    assert!(crate::local_navigation(
        &"tauri://localhost/index.html".parse().unwrap()
    ));
    for url in [
        "https://hikerapi.com/",
        "http://localhost/",
        "tauri://localhost.evil/",
        "tauri://user@localhost/",
        "file:///etc/passwd",
    ] {
        assert!(!crate::local_navigation(&url.parse().unwrap()));
    }
}

#[test]
fn ipc_errors_never_echo_secret_or_unknown_field_names() {
    let state = std::sync::Arc::new(crate::state::DesktopState::new("/unused".into()));
    state.close();
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![crate::commands::configure_setup])
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for body in [
        serde_json::json!({"credentials":{"token":"okay", "SECRET_SENTINEL":true}}),
        serde_json::json!({"credentials":{"token":"okay"}, "SECRET_SENTINEL":true}),
    ] {
        let result = tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "configure_setup".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap_err();
        assert_eq!(result, serde_json::json!("invalid_token"));
    }
}

fn ipc(
    app: &tauri::App<tauri::test::MockRuntime>,
    label: &str,
    cmd: &str,
    body: serde_json::Value,
) -> Result<tauri::ipc::InvokeResponseBody, serde_json::Value> {
    let window = match app.get_webview_window(label) {
        Some(window) => window,
        None => tauri::WebviewWindowBuilder::new(app, label, Default::default())
            .build()
            .unwrap(),
    };
    tauri::test::get_ipc_response(
        &window,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
}

#[test]
fn c2_commands_validate_arguments_before_the_host() {
    let state = std::sync::Arc::new(crate::state::DesktopState::new("/unused".into()));
    state.close();
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::read_overview,
            crate::commands::list_watches,
            crate::commands::add_watch,
            crate::commands::update_watch,
            crate::commands::pause_watch,
            crate::commands::resume_watch,
            crate::commands::remove_watch,
            crate::commands::search_targets,
            crate::commands::list_snapshots,
            crate::commands::compare_snapshots,
            crate::commands::list_changes
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let rev = "a".repeat(64);
    // A closed state proves the argument was accepted: execution is refused with "closed".
    let accepted = [
        ("read_overview", serde_json::json!({})),
        ("list_watches", serde_json::json!({"page": {}})),
        (
            "list_watches",
            serde_json::json!({"page": {"limit": 10, "cursor": "w1.YWxpY2U"}}),
        ),
        ("add_watch", serde_json::json!({"watch": {"user": "alice"}})),
        (
            "add_watch",
            serde_json::json!({"watch": {"user": "alice", "interval_seconds": 600}}),
        ),
        (
            "update_watch",
            serde_json::json!({"watch": {"user": "alice", "revision": rev, "interval_seconds": 300}}),
        ),
        (
            "pause_watch",
            serde_json::json!({"watch": {"user": "alice", "revision": rev}}),
        ),
        (
            "resume_watch",
            serde_json::json!({"watch": {"user": "alice", "revision": rev}}),
        ),
        (
            "remove_watch",
            serde_json::json!({"watch": {"user": "alice", "revision": rev}}),
        ),
        (
            "search_targets",
            serde_json::json!({"query": {"username": "alice"}}),
        ),
        (
            "list_snapshots",
            serde_json::json!({"query": {"target_pk": "7", "limit": 50}}),
        ),
        (
            "compare_snapshots",
            serde_json::json!({"pair": {"target_pk": "7", "older_id": "1", "newer_id": "2"}}),
        ),
        ("list_changes", serde_json::json!({"query": {}})),
        (
            "list_changes",
            serde_json::json!({"query": {"target_pk": "7", "cursor": "abc"}}),
        ),
    ];
    for (cmd, body) in accepted {
        assert_eq!(
            ipc(&app, "main", cmd, body.clone()).unwrap_err(),
            serde_json::json!("closed"),
            "{cmd} {body}"
        );
    }
    let rejected = [
        ("read_overview", serde_json::json!({"page": {}}), "protocol"),
        ("list_watches", serde_json::json!({}), "invalid_watch_input"),
        (
            "list_watches",
            serde_json::json!({"page": {"limit": 0}}),
            "invalid_watch_input",
        ),
        (
            "list_watches",
            serde_json::json!({"page": {"limit": 1.5}}),
            "invalid_watch_input",
        ),
        (
            "add_watch",
            serde_json::json!({"watch": {"user": "SECRET_SENTINEL user"}}),
            "invalid_watch_input",
        ),
        (
            "add_watch",
            serde_json::json!({"watch": {"user": "alice", "path": "/private"}}),
            "invalid_watch_input",
        ),
        (
            "add_watch",
            serde_json::json!({"watch": {"user": "alice", "interval_seconds": 299}}),
            "invalid_watch_input",
        ),
        (
            "add_watch",
            serde_json::json!({"watch": {"user": "alice"}, "extra": 1}),
            "invalid_watch_input",
        ),
        (
            "update_watch",
            serde_json::json!({"watch": {"user": "alice", "revision": rev}}),
            "invalid_watch_input",
        ),
        (
            "remove_watch",
            serde_json::json!({"watch": {"user": "alice", "revision": "short"}}),
            "invalid_watch_input",
        ),
        (
            "search_targets",
            serde_json::json!({"query": {"username": "@alice"}}),
            "invalid_history_input",
        ),
        (
            "list_snapshots",
            serde_json::json!({"query": {"target_pk": 7}}),
            "invalid_history_input",
        ),
        (
            "compare_snapshots",
            serde_json::json!({"pair": {"target_pk": "7", "older_id": "1", "newer_id": "1"}}),
            "invalid_history_input",
        ),
        (
            "list_changes",
            serde_json::json!({"query": {"cursor": "a b"}}),
            "invalid_history_input",
        ),
    ];
    for (cmd, body, code) in rejected {
        let result = ipc(&app, "main", cmd, body.clone()).unwrap_err();
        assert_eq!(result, serde_json::json!(code), "{cmd} {body}");
        assert!(!result.to_string().contains("SECRET_SENTINEL"));
    }
    assert!(ipc(&app, "other", "read_overview", serde_json::json!({}))
        .unwrap_err()
        .to_string()
        .contains("not allowed"));
}
