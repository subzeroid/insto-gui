//! Real-bridge proof for the five C3 operations against the prepared 0.7.22
//! runtime. Set `INSTO_GUI_RUNTIME=/abs/path/.build/runtime-c3-01`; otherwise
//! the test skips.
//!
//! It installs no LaunchAgent and mutates no launchd state: every registration
//! fact it observes is the "nothing is registered" one, so `service.migrate` is
//! exercised only as the configured no-op the core returns for
//! `registration == "none"`. A real interpreter switch is proven by the core's
//! own opt-in native smoke and by the application's native proof, not here.
use insto_desktop_host::{
    owner::Owner,
    process::TrustedLauncher,
    protocol::{
        Backend, ConfigState, DatabaseState, DesiredService, ProcessState, Reason, Registration,
        ServiceState, Status, CAPABILITIES, CORE_VERSION,
    },
    Operation, Response,
};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};

// The two fixture credentials. Neither may ever appear in a decoded response.
const DESKTOP_TOKEN: &str = "offline-fixture-token-not-real";
const CLI_TOKEN: &str = "isolated-migration-credential";

fn script(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../scripts")
        .join(name)
}

fn seed_desktop(python: &Path, root: &Path) {
    let output = Command::new(python)
        .args(["-I", "-B"])
        .arg(script("seed_desktop_fixture.py"))
        .arg(root)
        .arg("[]")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", root)
        .output()
        .expect("seed_desktop_fixture.py");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn seed_cli_home(python: &Path, home: &Path) {
    let output = Command::new(python)
        .args(["-I", "-B"])
        .arg(script("seed_cli_home.py"))
        .arg(home)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", home.parent().expect("home parent"))
        .output()
        .expect("seed_cli_home.py");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn call(owner: &Arc<Owner>, op: Operation) -> Response {
    let response = owner.execute(op).await.expect("bridge call");
    let rendered = format!("{response:?}");
    assert!(
        !rendered.contains(DESKTOP_TOKEN) && !rendered.contains(CLI_TOKEN),
        "a fixture credential reached a decoded response"
    );
    response
}

fn error_code(response: &Response) -> &'static str {
    match response {
        Response::Error(error) => error.code,
        other => panic!("expected error, got {other:?}"),
    }
}

fn private_dir(path: &Path) -> PathBuf {
    std::fs::create_dir(path).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    path.to_path_buf()
}

#[tokio::test]
async fn c3_operations_match_the_released_core() {
    let Some(runtime) = std::env::var_os("INSTO_GUI_RUNTIME") else {
        eprintln!("skipped: INSTO_GUI_RUNTIME is not set");
        return;
    };
    let python = PathBuf::from(runtime)
        .join("python/bin/python3")
        .canonicalize()
        .expect("INSTO_GUI_RUNTIME must contain python/bin/python3");
    let dir = tempfile::Builder::new()
        .prefix("insto-gui-c3-")
        .tempdir()
        .unwrap();
    let base = dir.path().canonicalize().unwrap();
    std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o700)).unwrap();

    // 1. A root that is never configured.
    let fresh = private_dir(&base.join("fresh"));
    let idle = Owner::new(TrustedLauncher::new(&fresh, &python, &fresh).unwrap());

    let Response::Hello(hello) = call(&idle, Operation::Hello).await else {
        panic!("hello")
    };
    assert_eq!(hello.core_version, CORE_VERSION);
    assert_eq!(hello.capabilities.len(), CAPABILITIES.len());
    assert!(hello
        .capabilities
        .iter()
        .zip(CAPABILITIES)
        .all(|(reported, pinned)| reported == pinned));

    // The early return of `inspect_service`: no state, no registration files,
    // nothing asked of launchd, and nothing created on disk.
    let Response::ServiceInspection(facts) = call(&idle, Operation::ServiceInspect).await else {
        panic!("service.inspect")
    };
    assert_eq!(facts.registration, Registration::None);
    assert!(facts.interpreter.is_none() && facts.interpreter_exists.is_none());
    assert!(facts.loaded.is_none() && facts.settings.is_none());
    assert!(
        !fresh.join("desktop-state.json").exists(),
        "a read must not configure the profile"
    );

    assert_eq!(
        error_code(&call(&idle, Operation::ServiceUninstall).await),
        "not_configured"
    );
    idle.shutdown().await;

    // 2. A configured desktop profile and a CLI-shaped home beside it. The home
    // sits outside the desktop root: a home whose parent carries a desktop-root
    // marker is `home_invalid` by the core's own rule.
    let root = private_dir(&base.join("root"));
    seed_desktop(&python, &root);
    let cli = base.join("cli home"); // a space, like the core's own fixtures
    seed_cli_home(&python, &cli);
    let owner = Owner::new(TrustedLauncher::new(&root, &python, &root).unwrap());

    // Configured with nothing registered: both service mutations are no-ops
    // that still answer with the profile DTO.
    let Response::Profile(migrated) = call(&owner, Operation::ServiceMigrate).await else {
        panic!("service.migrate")
    };
    assert!(migrated.configured && !migrated.service_running);
    assert!(matches!(
        migrated.desired_service,
        Some(DesiredService::Stopped)
    ));
    let Response::Profile(removed) = call(&owner, Operation::ServiceUninstall).await else {
        panic!("service.uninstall")
    };
    assert!(removed.configured && !removed.service_running);
    assert!(matches!(
        removed.desired_service,
        Some(DesiredService::Stopped)
    ));
    assert_eq!(removed.quota_remaining, Some(8));
    assert!(
        removed.quota_checked_at.is_some(),
        "both quota fields or neither"
    );

    // 3. The four `home.inspect` verdicts the GUI renders.
    let Response::HomeInspection(adoptable) = call(
        &owner,
        Operation::HomeInspect {
            path: cli.display().to_string(),
        },
    )
    .await
    else {
        panic!("home.inspect: cli home")
    };
    assert_eq!(adoptable.path, cli.display().to_string());
    assert!(adoptable.exists && adoptable.private && adoptable.adoptable);
    assert_eq!(adoptable.config, ConfigState::Ok);
    assert_eq!(adoptable.backend, Some(Backend::Hikerapi));
    assert_eq!(adoptable.database, DatabaseState::Ok);
    assert_eq!(adoptable.registration, Registration::None);
    assert!(adoptable.interpreter.is_none() && adoptable.reason.is_none());
    // A reachable GUI launchd domain answers "not found"; an unavailable one
    // leaves both fields unknown. Nothing else is a legal pairing.
    assert!(matches!(
        (adoptable.loaded, adoptable.process),
        (Some(false), ProcessState::Stopped) | (None, ProcessState::Unknown)
    ));

    let Response::HomeInspection(absent) = call(
        &owner,
        Operation::HomeInspect {
            path: base.join("no-such-home").display().to_string(),
        },
    )
    .await
    else {
        panic!("home.inspect: missing")
    };
    assert!(!absent.exists && !absent.private && !absent.adoptable);
    assert_eq!(absent.config, ConfigState::Missing);
    assert_eq!(absent.database, DatabaseState::Missing);
    assert_eq!(absent.registration, Registration::None);
    assert_eq!(absent.process, ProcessState::Unknown);
    assert!(absent.backend.is_none() && absent.loaded.is_none());
    assert_eq!(absent.reason, Some(Reason::HomeInvalid));

    let open = base.join("open home");
    std::fs::create_dir(&open).unwrap();
    std::fs::set_permissions(&open, std::fs::Permissions::from_mode(0o755)).unwrap();
    let Response::HomeInspection(public) = call(
        &owner,
        Operation::HomeInspect {
            path: open.display().to_string(),
        },
    )
    .await
    else {
        panic!("home.inspect: 0755")
    };
    // Nothing inside a non-private home is read, so every derived field is the
    // "unreadable" one rather than a fact about its contents.
    assert!(public.exists && !public.private && !public.adoptable);
    assert_eq!(public.config, ConfigState::Invalid);
    assert_eq!(public.database, DatabaseState::Unreadable);
    assert_eq!(public.registration, Registration::Unknown);
    assert_eq!(public.process, ProcessState::Unknown);
    assert!(public.backend.is_none() && public.loaded.is_none() && public.interpreter.is_none());
    assert_eq!(public.reason, Some(Reason::HomeInvalid));

    let Response::HomeInspection(foreign) = call(
        &owner,
        Operation::HomeInspect {
            path: root.join("profile").display().to_string(),
        },
    )
    .await
    else {
        panic!("home.inspect: own profile")
    };
    // A desktop root's own profile is fully described and never adoptable: two
    // roots sharing it would fork intent over the same files.
    assert!(foreign.exists && foreign.private && !foreign.adoptable);
    assert_eq!(foreign.config, ConfigState::Ok);
    assert_eq!(foreign.backend, Some(Backend::Hikerapi));
    assert_eq!(foreign.database, DatabaseState::Ok);
    assert_eq!(foreign.reason, Some(Reason::HomeInvalid));

    // 4. Selection, and the adopted-binding regression for Codex #2.
    let Response::Profile(adopted) = call(
        &owner,
        Operation::HomeSelect {
            path: Some(cli.display().to_string()),
        },
    )
    .await
    else {
        panic!("home.select: adopt")
    };
    assert!(adopted.configured && !adopted.service_running);
    assert!(adopted.quota_remaining.is_none() && adopted.quota_checked_at.is_none());
    assert!(matches!(adopted.status, Status::Stopped));
    assert!(matches!(
        adopted.desired_service,
        Some(DesiredService::Stopped)
    ));
    assert!(root.join("desktop-home.json").is_file());
    assert!(cli.join("desktop-state.json").is_file());

    // An adopted home is configured with both quota fields null until its next
    // credential check. A decoder that ties the quota to `configured` rejects
    // this, so adoption would succeed and then every monitoring poll would fail.
    let Response::Overview(overview) = call(&owner, Operation::Overview).await else {
        panic!("overview")
    };
    assert!(overview.configured && overview.watches.is_empty() && overview.next_cursor.is_none());
    assert!(overview.quota_remaining.is_none() && overview.quota_checked_at.is_none());
    assert!(matches!(
        overview.service_state,
        ServiceState::Stopped | ServiceState::Unknown
    ));
    let Response::Profile(inspected) = call(&owner, Operation::SetupInspect).await else {
        panic!("setup.inspect")
    };
    assert!(inspected.configured);
    assert!(inspected.quota_remaining.is_none() && inspected.quota_checked_at.is_none());

    let Response::Profile(returned) = call(&owner, Operation::HomeSelect { path: None }).await
    else {
        panic!("home.select: release")
    };
    // Releasing a binding restores the own profile; it does not erase it, so
    // the returned DTO is the own profile's own configured state.
    assert!(returned.configured && returned.quota_remaining == Some(8));
    assert!(!root.join("desktop-home.json").exists());

    owner.shutdown().await;
    let mut names: Vec<String> = std::fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    // `Library` belongs to the throwaway root, not to the machine: the bridge runs
    // with `HOME` set to the root, and every service mutation prepares
    // `$HOME/Library/LaunchAgents` before it reads the registration
    // (`watch_service_lifecycle.managed_service`). That it is still empty is this
    // test's own proof that it registered nothing.
    assert_eq!(
        names,
        [".desktop.lock", "Library", "desktop-state.json", "profile"]
    );
    let agents = root.join("Library/LaunchAgents");
    assert!(agents.is_dir() && std::fs::read_dir(&agents).unwrap().next().is_none());
    assert!(cli.join("config.toml").is_file() && cli.join("store.db").is_file());
}
