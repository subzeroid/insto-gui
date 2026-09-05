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
