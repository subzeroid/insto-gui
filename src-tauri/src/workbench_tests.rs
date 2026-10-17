//! Exercise the actual Tauri invoke boundary with a closed host: accepted input
//! reaches the host's `closed` guard; malformed input cannot launch a process.
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{test::MockRuntime, Manager};

fn app() -> tauri::App<MockRuntime> {
    let state = Arc::new(crate::state::DesktopState::new("/unused".into()));
    state.close();
    tauri::test::mock_builder()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            crate::commands::inspect_usage,
            crate::commands::configure_usage,
            crate::commands::research_list,
            crate::commands::research_save,
            crate::commands::research_delete,
            crate::commands::research_export
        ])
        .build(tauri::generate_context!())
        .unwrap()
}

fn invoke(
    app: &tauri::App<MockRuntime>,
    label: &str,
    origin: &str,
    command: &str,
    body: Value,
) -> Value {
    let window = match app.get_webview_window(label) {
        Some(window) => window,
        None => tauri::WebviewWindowBuilder::new(app, label, Default::default())
            .build()
            .unwrap(),
    };
    tauri::test::get_ipc_response(
        &window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: origin.parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .unwrap_err()
}

fn check() -> Value {
    json!({"username":"alice","target_pk":"7","captured_at":1_700_000_000,
        "profile":{"target_pk":"7","access":"public","fields":{},
            "unknown_fields":["username","full_name","biography","external_url","is_verified","is_business","is_private","follower_count","following_count","media_count","public_email","public_phone","business_category"],"quota_remaining":null},
        "activity":null})
}

fn accepted() -> Vec<(&'static str, Value)> {
    vec![
        ("inspect_usage", json!({})),
        ("configure_usage", json!({"budget":{"daily_limit":100}})),
        ("research_list", json!({})),
        ("research_save", json!({"check":check()})),
        ("research_delete", json!({"id":"a".repeat(32)})),
        (
            "research_export",
            json!({"filename":"alice.html","contents":"<!doctype html>report"}),
        ),
    ]
}

#[test]
fn all_six_workbench_commands_reach_only_the_closed_bundled_main_host() {
    let app = app();
    for (command, body) in accepted() {
        assert_eq!(
            invoke(&app, "main", "tauri://localhost", command, body.clone()),
            json!("closed"),
            "{command}"
        );
        for (label, origin) in [
            ("other", "tauri://localhost"),
            ("main", "https://example.com"),
            ("other", "https://example.com"),
        ] {
            let error = invoke(&app, label, origin, command, body.clone());
            assert!(
                error.to_string().contains("not allowed"),
                "{label} {origin} {command}: {error}"
            );
        }
    }
    for command in [
        "plugin:fs|read_file",
        "plugin:fs|write_text_file",
        "plugin:dialog|save",
    ] {
        assert!(
            invoke(&app, "main", "tauri://localhost", command, json!({}))
                .to_string()
                .contains("not allowed")
        );
    }
}

#[test]
fn usage_configuration_rejects_invalid_values_and_unknown_fields_before_the_host() {
    let app = app();
    for limit in [json!(null), json!(1), json!(1_000_000)] {
        assert_eq!(
            invoke(
                &app,
                "main",
                "tauri://localhost",
                "configure_usage",
                json!({"budget":{"daily_limit":limit}})
            ),
            json!("closed")
        );
    }
    let mut rejected = vec![
        json!({}),
        json!({"budget":{}}),
        json!({"budget":null}),
        json!({"budget":[]}),
        json!({"budget":{"daily_limit":10,"SECRET_SENTINEL":true}}),
        json!({"budget":{"daily_limit":10},"SECRET_SENTINEL":true}),
        json!({"daily_limit":10}),
        json!({"budget":{"SECRET_SENTINEL":10}}),
    ];
    rejected.extend(
        [
            json!(true),
            json!(false),
            json!(0),
            json!(-1),
            json!(1_000_001),
            json!(1.0),
            json!(1.5),
            json!("10"),
            json!([]),
            json!({}),
        ]
        .into_iter()
        .map(|limit| json!({"budget":{"daily_limit":limit}})),
    );
    for body in rejected {
        let error = invoke(
            &app,
            "main",
            "tauri://localhost",
            "configure_usage",
            body.clone(),
        );
        assert_eq!(error, json!("invalid_params"), "{body}");
        assert!(!error.to_string().contains("SECRET_SENTINEL"));
    }
    for command in ["inspect_usage", "research_list"] {
        assert_eq!(
            invoke(
                &app,
                "main",
                "tauri://localhost",
                command,
                json!({"SECRET_SENTINEL":true})
            ),
            json!("protocol")
        );
    }
}

#[test]
fn saved_check_commands_reject_unknown_outer_fields_and_client_assigned_metadata() {
    let app = app();
    let mut assigned_id = check();
    assigned_id["id"] = json!("a".repeat(32));
    let mut assigned_saved = check();
    assigned_saved["saved_at"] = json!(1_700_000_001);
    let mut missing_profile = check();
    missing_profile.as_object_mut().unwrap().remove("profile");
    for (command, body) in [
        ("research_save", json!({})),
        (
            "research_save",
            json!({"check":check(),"SECRET_SENTINEL":true}),
        ),
        ("research_save", json!({"check":assigned_id})),
        ("research_save", json!({"check":assigned_saved})),
        ("research_save", json!({"check":missing_profile})),
        ("research_save", json!({"check":null})),
        ("research_delete", json!({})),
        ("research_delete", json!({"id":3})),
        (
            "research_delete",
            json!({"id":"a".repeat(32),"SECRET_SENTINEL":true}),
        ),
        ("research_delete", json!({"path":"SECRET_SENTINEL"})),
    ] {
        let error = invoke(&app, "main", "tauri://localhost", command, body.clone());
        assert_eq!(error, json!("research_invalid"), "{command} {body}");
        assert!(!error.to_string().contains("SECRET_SENTINEL"));
    }
}

#[test]
fn closed_export_never_opens_a_native_save_dialog_even_for_malformed_payloads() {
    let app = app();
    // No dialog plugin is installed on this mock. Reaching the panel would panic;
    // both bodies must stop at the lifecycle guard first.
    for body in [
        json!({"filename":"alice.json","contents":"{}"}),
        json!({"SECRET_SENTINEL":true}),
    ] {
        assert_eq!(
            invoke(&app, "main", "tauri://localhost", "research_export", body),
            json!("closed")
        );
    }
}
