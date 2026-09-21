//! Real-bridge proof against the prepared runtime. Set
//! `INSTO_GUI_RUNTIME=/abs/path/.build/runtime-first-check`; otherwise the test
//! skips.
use insto_desktop_host::{
    owner::Owner,
    process::TrustedLauncher,
    protocol::{HistoryItem, ServiceState, WatchStatus, CAPABILITIES, CORE_VERSION},
    Operation, Response,
};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};

const TOKEN: &str = "offline-fixture-token-not-real";

fn seed(python: &Path, root: &Path) {
    let script =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/seed_desktop_fixture.py");
    let rows = serde_json::json!([
        {"pk": "7", "stamp": 1, "fields": {"username": "alice", "follower_count": 1, "biography": ""}},
        {"pk": "7", "stamp": 2, "fields": {"username": "alice", "follower_count": 2, "biography": ""}},
        {"pk": "8", "stamp": 3, "fields": {"username": "Alice", "follower_count": 5}},
        {"pk": "9", "stamp": 4, "fields": {"biography": "legacy"}},
    ]);
    let output = Command::new(python)
        .args(["-I", "-B"])
        .arg(script)
        .arg(root)
        .arg(rows.to_string())
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", root)
        .output()
        .expect("seed script");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn call(owner: &std::sync::Arc<Owner>, op: Operation) -> Response {
    let response = owner.execute(op).await.expect("bridge call");
    assert!(!format!("{response:?}").contains(TOKEN));
    response
}

fn error_code(response: &Response) -> &'static str {
    match response {
        Response::Error(error) => error.code,
        other => panic!("expected error, got {other:?}"),
    }
}

#[tokio::test]
async fn c2_bridge_round_trip() {
    let Some(runtime) = std::env::var_os("INSTO_GUI_RUNTIME") else {
        eprintln!("skipped: INSTO_GUI_RUNTIME is not set");
        return;
    };
    let python = PathBuf::from(runtime)
        .join("python/bin/python3")
        .canonicalize()
        .expect("INSTO_GUI_RUNTIME must contain python/bin/python3");
    let dir = tempfile::Builder::new()
        .prefix("insto-gui-c2-")
        .tempdir()
        .unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
    seed(&python, &root);
    let owner = Owner::new(TrustedLauncher::new(&root, &python, &root).unwrap());

    let Response::Hello(hello) = call(&owner, Operation::Hello).await else {
        panic!("hello")
    };
    assert_eq!(hello.core_version, CORE_VERSION);
    assert_eq!(hello.capabilities.len(), CAPABILITIES.len());

    let Response::Overview(overview) = call(&owner, Operation::Overview).await else {
        panic!("overview")
    };
    assert!(
        overview.configured && overview.watches.is_empty() && overview.quota_remaining == Some(8)
    );
    assert!(matches!(
        overview.service_state,
        ServiceState::Stopped | ServiceState::Unknown
    ));

    let add = |user: &str| Operation::WatchesAdd {
        user: user.into(),
        interval_seconds: None,
    };
    let Response::Watch(alice) = call(&owner, add("alice")).await else {
        panic!("add")
    };
    assert!(
        alice.waiting_first_check
            && alice.status == WatchStatus::Active
            && alice.interval_seconds == 300
    );
    assert!(matches!(call(&owner, add("bob")).await, Response::Watch(_)));
    assert!(matches!(
        call(&owner, add("carol")).await,
        Response::Watch(_)
    ));
    assert_eq!(error_code(&call(&owner, add("dave")).await), "watch_limit");
    assert_eq!(
        error_code(&call(&owner, add("alice")).await),
        "watch_exists"
    );
    let stale = Operation::WatchesUpdate {
        user: "alice".into(),
        revision: "0".repeat(64),
        interval_seconds: 600,
    };
    assert_eq!(error_code(&call(&owner, stale).await), "watch_conflict");
    let Response::Watch(paused) = call(
        &owner,
        Operation::WatchesPause {
            user: "alice".into(),
            revision: alice.revision.clone(),
        },
    )
    .await
    else {
        panic!("pause")
    };
    assert!(paused.status == WatchStatus::Paused && paused.revision != alice.revision);
    let Response::Watch(resumed) = call(
        &owner,
        Operation::WatchesResume {
            user: "alice".into(),
            revision: paused.revision.clone(),
        },
    )
    .await
    else {
        panic!("resume")
    };
    assert_eq!(resumed.status, WatchStatus::Active);
    let Response::Watch(carol) = call(
        &owner,
        Operation::WatchesUpdate {
            user: "carol".into(),
            revision: match call(
                &owner,
                Operation::WatchesList {
                    limit: None,
                    cursor: None,
                },
            )
            .await
            {
                Response::WatchPage(page) => page
                    .items
                    .iter()
                    .find(|w| w.user == "carol")
                    .unwrap()
                    .revision
                    .clone(),
                _ => panic!(),
            },
            interval_seconds: 900,
        },
    )
    .await
    else {
        panic!("update")
    };
    assert_eq!(carol.interval_seconds, 900);
    let removed = call(
        &owner,
        Operation::WatchesRemove {
            user: "carol".into(),
            revision: carol.revision.clone(),
        },
    )
    .await;
    assert!(matches!(removed, Response::Removed(ref r) if r.removed_user == "carol"));
    assert_eq!(
        error_code(
            &call(
                &owner,
                Operation::WatchesRemove {
                    user: "carol".into(),
                    revision: carol.revision
                }
            )
            .await
        ),
        "watch_not_found"
    );
    let Response::WatchPage(page) = call(
        &owner,
        Operation::WatchesList {
            limit: Some(1),
            cursor: None,
        },
    )
    .await
    else {
        panic!("list")
    };
    assert_eq!(page.items.len(), 1);
    let Response::WatchPage(rest) = call(
        &owner,
        Operation::WatchesList {
            limit: None,
            cursor: page.next_cursor.clone(),
        },
    )
    .await
    else {
        panic!("list 2")
    };
    assert_eq!(
        rest.items
            .iter()
            .map(|w| w.user.as_str())
            .collect::<Vec<_>>(),
        ["bob"]
    );

    let Response::HistoryPage(targets) = call(
        &owner,
        Operation::SnapshotsTargets {
            username: "alice".into(),
            limit: None,
            cursor: None,
        },
    )
    .await
    else {
        panic!("targets")
    };
    let kinds: Vec<&str> = targets
        .items
        .iter()
        .map(|item| match item {
            HistoryItem::Target { target_pk, .. } => target_pk.as_str(),
            HistoryItem::Diagnostic { .. } => "diagnostic",
            _ => "other",
        })
        .collect();
    assert_eq!(kinds, ["diagnostic", "8", "7"]);
    assert!(targets.scan_complete);

    let Response::HistoryPage(list) = call(
        &owner,
        Operation::SnapshotsList {
            target_pk: "7".into(),
            limit: None,
            cursor: None,
        },
    )
    .await
    else {
        panic!("snapshots")
    };
    let ids: Vec<String> = list
        .items
        .iter()
        .map(|item| match item {
            HistoryItem::Snapshot { snapshot } => snapshot.id.clone(),
            _ => panic!(),
        })
        .collect();
    assert_eq!(ids.len(), 2);
    let (newer, older) = (ids[0].clone(), ids[1].clone());
    let Response::Comparison(comparison) = call(
        &owner,
        Operation::SnapshotsCompare {
            target_pk: "7".into(),
            older_id: older.clone(),
            newer_id: newer.clone(),
        },
    )
    .await
    else {
        panic!("compare")
    };
    assert_eq!(comparison.changes.len(), 1);
    assert_eq!(comparison.changes[0].field, "follower_count");
    assert_eq!(
        error_code(
            &call(
                &owner,
                Operation::SnapshotsCompare {
                    target_pk: "7".into(),
                    older_id: older.clone(),
                    newer_id: "999999".into()
                }
            )
            .await
        ),
        "snapshot_unavailable"
    );
    let foreign = match call(
        &owner,
        Operation::SnapshotsList {
            target_pk: "8".into(),
            limit: None,
            cursor: None,
        },
    )
    .await
    {
        Response::HistoryPage(page) => match &page.items[0] {
            HistoryItem::Snapshot { snapshot } => snapshot.id.clone(),
            _ => panic!(),
        },
        _ => panic!(),
    };
    assert_eq!(
        error_code(
            &call(
                &owner,
                Operation::SnapshotsCompare {
                    target_pk: "7".into(),
                    older_id: older,
                    newer_id: foreign
                }
            )
            .await
        ),
        "snapshot_identity_mismatch"
    );

    let Response::HistoryPage(feed) = call(
        &owner,
        Operation::ChangesList {
            target_pk: None,
            limit: None,
            cursor: None,
        },
    )
    .await
    else {
        panic!("feed")
    };
    let feed_kinds: Vec<&str> = feed
        .items
        .iter()
        .map(|item| match item {
            HistoryItem::Baseline { .. } => "baseline",
            HistoryItem::Comparison { .. } => "comparison",
            HistoryItem::Incomplete { .. } => "incomplete",
            HistoryItem::Diagnostic { .. } => "diagnostic",
            _ => "other",
        })
        .collect();
    assert_eq!(
        feed_kinds,
        ["baseline", "baseline", "comparison", "baseline"]
    );
    let Response::HistoryPage(filtered) = call(
        &owner,
        Operation::ChangesList {
            target_pk: Some("7".into()),
            limit: None,
            cursor: None,
        },
    )
    .await
    else {
        panic!("filtered")
    };
    assert_eq!(filtered.items.len(), 2);

    owner.shutdown().await;
    let mut names: Vec<String> = std::fs::read_dir(&root)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    assert_eq!(names, [".desktop.lock", "desktop-state.json", "profile"]);
}
