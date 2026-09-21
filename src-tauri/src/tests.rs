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
            crate::commands::read_snapshot,
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
        (
            "read_snapshot",
            serde_json::json!({"snapshot": {"target_pk": "7", "snapshot_id": "2"}}),
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
            "read_snapshot",
            serde_json::json!({"snapshot": {"target_pk": "7", "snapshot_id": "0"}}),
            "invalid_history_input",
        ),
        (
            "read_snapshot",
            serde_json::json!({"pair": {"target_pk": "7", "snapshot_id": "2"}}),
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

#[test]
fn c3_commands_map_to_operations_and_budgets() {
    use insto_desktop_host::{protocol::Budget, Operation};
    let long = format!("/{}", "a".repeat(1024)); // 1025 bytes
    for (operation, name, budget, params) in [
        (
            Operation::ServiceInspect,
            "service.inspect",
            Budget::Read,
            serde_json::json!({}),
        ),
        (
            Operation::ServiceMigrate,
            "service.migrate",
            Budget::ServiceMutation,
            serde_json::json!({}),
        ),
        (
            Operation::ServiceUninstall,
            "service.uninstall",
            Budget::ServiceMutation,
            serde_json::json!({}),
        ),
        (
            crate::commands::home_operation(false, r#"{"path":"~/.insto"}"#).unwrap(),
            "home.inspect",
            Budget::Read,
            serde_json::json!({"path": "~/.insto"}),
        ),
        (
            crate::commands::home_operation(true, r#"{"path":"/Users/x/.insto"}"#).unwrap(),
            "home.select",
            Budget::ServiceMutation,
            serde_json::json!({"path": "/Users/x/.insto"}),
        ),
        (
            crate::commands::home_operation(true, r#"{"path":null}"#).unwrap(),
            "home.select",
            Budget::ServiceMutation,
            serde_json::json!({"path": null}),
        ),
    ] {
        assert_eq!(operation.name(), name);
        assert_eq!(operation.budget(), budget);
        let request: serde_json::Value =
            serde_json::from_slice(&operation.request("t").unwrap()).unwrap();
        assert_eq!(request["operation"], name);
        assert_eq!(request["params"], params);
    }
    // The adapter refuses a bad path itself: no operation is ever built.
    for payload in [
        r#"{"path":"relative/insto"}"#,
        r#"{"path":"~user/.insto"}"#,
        r#"{"path":"/Users/x/../root/.insto"}"#,
        r#"{"path":".."}"#,
        r#"{"path":""}"#,
        "{\"path\":\"/Users/x/\u{0}/.insto\"}",
        r#"{"path":7}"#,
        r#"{"path":"~/.insto","extra":1}"#,
        r#"{}"#,
    ] {
        // Compare the error side only. `Operation` derives nothing on purpose:
        // two of its variants carry the HikerAPI token, so a `Debug` derive
        // would make a secret printable inside a failing assertion's panic.
        assert_eq!(
            crate::commands::home_operation(false, payload).err(),
            Some("invalid_home_input"),
            "{payload}"
        );
        assert_eq!(
            crate::commands::home_operation(true, payload).err(),
            Some("invalid_home_input"),
            "{payload}"
        );
    }
    assert_eq!(
        crate::commands::home_operation(false, &format!(r#"{{"path":"{long}"}}"#)).err(),
        Some("invalid_home_input")
    );
    assert!(crate::commands::home_operation(false, r#"{"path":null}"#).is_err());
}

#[test]
fn lookup_commands_validate_arguments_before_the_host() {
    use insto_desktop_host::{protocol::Budget, Operation};
    let state = std::sync::Arc::new(crate::state::DesktopState::new("/unused".into()));
    state.close();
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::lookup_profile,
            crate::commands::lookup_activity
        ])
        .build(tauri::generate_context!())
        .unwrap();
    // A closed state proves the argument was accepted: execution is refused with "closed".
    let accepted = [
        (
            "lookup_profile",
            serde_json::json!({"lookup": {"username": "alice"}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "17841400000000001", "window": 12}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "7", "window": 30}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "7", "window": 50}}),
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
        // The username rule, the pk rule and the window set, all before a spawn:
        // a mistyped name must never cost a paid provider request.
        (
            "lookup_profile",
            serde_json::json!({"lookup": {"username": "SECRET_SENTINEL user"}}),
        ),
        (
            "lookup_profile",
            serde_json::json!({"lookup": {"username": "@alice"}}),
        ),
        (
            "lookup_profile",
            serde_json::json!({"lookup": {"username": "Alice"}}),
        ),
        ("lookup_profile", serde_json::json!({"lookup": {}})),
        (
            "lookup_profile",
            serde_json::json!({"query": {"username": "alice"}}),
        ),
        (
            "lookup_profile",
            serde_json::json!({"lookup": {"username": "alice", "window": 12}}),
        ),
        (
            "lookup_profile",
            serde_json::json!({"lookup": {"username": "alice"}, "extra": 1}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "0", "window": 12}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": 7, "window": 12}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "7", "window": 13}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "7", "window": 12.0}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "7", "window": true}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "7", "window": 300}}),
        ),
        (
            "lookup_activity",
            serde_json::json!({"lookup": {"target_pk": "7"}}),
        ),
    ];
    for (cmd, body) in rejected {
        let result = ipc(&app, "main", cmd, body.clone()).unwrap_err();
        assert_eq!(
            result,
            serde_json::json!("invalid_lookup_input"),
            "{cmd} {body}"
        );
        assert!(!result.to_string().contains("SECRET_SENTINEL"));
    }
    // Only the bundled main window is on the ACL.
    for cmd in ["lookup_profile", "lookup_activity"] {
        assert!(ipc(
            &app,
            "other",
            cmd,
            serde_json::json!({"lookup": {"username": "alice"}})
        )
        .unwrap_err()
        .to_string()
        .contains("not allowed"));
    }
    // The wire request the accepted arguments build, and the class it runs in.
    for (operation, name, params) in [
        (
            Operation::LookupProfile {
                username: "alice".into(),
            },
            "lookup.profile",
            serde_json::json!({"username": "alice"}),
        ),
        (
            Operation::LookupActivity {
                target_pk: "17841400000000001".into(),
                window: 12,
            },
            "lookup.activity",
            serde_json::json!({"target_pk": "17841400000000001", "window": 12}),
        ),
    ] {
        assert_eq!(operation.name(), name);
        assert_eq!(operation.budget(), Budget::NetworkRead);
        // A network read is a read: cancelled on close, never outcome-unknown.
        assert!(!operation.is_mutation());
        let request: serde_json::Value =
            serde_json::from_slice(&operation.request("t").unwrap()).unwrap();
        assert_eq!(request["operation"], name);
        assert_eq!(request["params"], params);
    }
}

#[test]
fn c3_binding_report_carries_a_home_only_for_an_adopted_root() {
    use insto_desktop_host::binding::Binding;
    for (binding, state, home) in [
        (Binding::Own, "own", None),
        (
            Binding::Adopted {
                home: "/Users/x/.insto".into(),
            },
            "adopted",
            Some("/Users/x/.insto"),
        ),
        (Binding::Unknown, "unknown", None),
    ] {
        // The exact JSON `client.inspectBinding()` decodes: two keys, no envelope.
        assert_eq!(
            serde_json::to_value(crate::commands::BindingReport::from(binding)).unwrap(),
            serde_json::json!({"state": state, "home": home}),
            "{state}"
        );
    }
}

#[test]
fn c3_commands_validate_arguments_before_the_host() {
    let state = std::sync::Arc::new(crate::state::DesktopState::new("/unused".into()));
    state.close();
    let app = tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::inspect_service,
            crate::commands::migrate_service,
            crate::commands::uninstall_service,
            crate::commands::inspect_home,
            crate::commands::select_home,
            crate::commands::inspect_binding
        ])
        .build(tauri::generate_context!())
        .unwrap();
    // A closed state proves the argument was accepted: execution is refused with "closed".
    let accepted = [
        ("inspect_service", serde_json::json!({})),
        ("migrate_service", serde_json::json!({})),
        ("uninstall_service", serde_json::json!({})),
        ("inspect_binding", serde_json::json!({})),
        ("inspect_home", serde_json::json!({"query": {"path": "~"}})),
        (
            "inspect_home",
            serde_json::json!({"query": {"path": "~/.insto"}}),
        ),
        (
            "inspect_home",
            serde_json::json!({"query": {"path": "/Users/x/.insto"}}),
        ),
        ("select_home", serde_json::json!({"home": {"path": null}})),
        (
            "select_home",
            serde_json::json!({"home": {"path": "/Users/x/.insto"}}),
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
        // The no-argument rule: any key at all is a protocol error.
        (
            "inspect_service",
            serde_json::json!({"query": {"path": "~"}}),
            "protocol",
        ),
        (
            "migrate_service",
            serde_json::json!({"home": null}),
            "protocol",
        ),
        (
            "uninstall_service",
            serde_json::json!({"SECRET_SENTINEL": 1}),
            "protocol",
        ),
        (
            "inspect_binding",
            serde_json::json!({"home": {"path": null}}),
            "protocol",
        ),
        // The one-key rule and path validation, both before the host.
        ("inspect_home", serde_json::json!({}), "invalid_home_input"),
        (
            "inspect_home",
            serde_json::json!({"query": {"path": "~/.insto"}, "extra": 1}),
            "invalid_home_input",
        ),
        (
            "inspect_home",
            serde_json::json!({"home": {"path": "~/.insto"}}),
            "invalid_home_input",
        ),
        (
            "inspect_home",
            serde_json::json!({"query": {"path": "~/.insto", "SECRET_SENTINEL": true}}),
            "invalid_home_input",
        ),
        (
            "inspect_home",
            serde_json::json!({"query": {"path": "SECRET_SENTINEL/insto"}}),
            "invalid_home_input",
        ),
        (
            "inspect_home",
            serde_json::json!({"query": {"path": "/Users/x/../root"}}),
            "invalid_home_input",
        ),
        (
            "inspect_home",
            serde_json::json!({"query": {"path": null}}),
            "invalid_home_input",
        ),
        (
            "select_home",
            serde_json::json!({"home": {}}),
            "invalid_home_input",
        ),
        (
            "select_home",
            serde_json::json!({"home": {"path": 7}}),
            "invalid_home_input",
        ),
        (
            "select_home",
            serde_json::json!({"home": {"path": "~user/.insto"}}),
            "invalid_home_input",
        ),
    ];
    for (cmd, body, code) in rejected {
        let result = ipc(&app, "main", cmd, body.clone()).unwrap_err();
        assert_eq!(result, serde_json::json!(code), "{cmd} {body}");
        assert!(!result.to_string().contains("SECRET_SENTINEL"));
    }
    for cmd in [
        "inspect_service",
        "migrate_service",
        "uninstall_service",
        "inspect_binding",
    ] {
        assert!(ipc(&app, "other", cmd, serde_json::json!({}))
            .unwrap_err()
            .to_string()
            .contains("not allowed"));
    }
}
