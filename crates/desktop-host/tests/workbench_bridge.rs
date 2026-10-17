//! Offline proof that the bundled Python core and native usage wire agree.
use insto_desktop_host::{owner::Owner, process::TrustedLauncher, Operation, Response};
use std::{os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

#[tokio::test]
async fn bundled_usage_ledger_is_shared_and_reads_never_create_it() {
    let Some(runtime) = std::env::var_os("INSTO_GUI_RUNTIME") else {
        return;
    };
    let python = PathBuf::from(runtime)
        .join("python/bin/python3")
        .canonicalize()
        .unwrap();
    let account = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir_in(account.path()).unwrap();
    std::fs::set_permissions(account.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let root = root.path().canonicalize().unwrap();
    let account = account.path().canonicalize().unwrap();
    let seed =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/seed_desktop_fixture.py");
    let result = Command::new(&python)
        .args(["-I", "-B"])
        .arg(seed)
        .arg(&root)
        .arg("[]")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &account)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let owner = Owner::new(TrustedLauncher::new(&root, &python, &account).unwrap());
    let ledger = root.join("profile/store.db.usage.db");
    match owner.execute(Operation::UsageInspect).await.unwrap() {
        Response::Usage(usage) => {
            assert_eq!(usage.used, 0);
            assert_eq!(usage.daily_limit, None);
        }
        other => panic!("{other:?}"),
    }
    assert!(!ledger.exists(), "read-only inspection created a ledger");
    match owner
        .execute(Operation::UsageConfigure {
            daily_limit: Some(2),
        })
        .await
        .unwrap()
    {
        Response::Usage(usage) => assert_eq!(usage.daily_limit, Some(2)),
        other => panic!("{other:?}"),
    }
    // A separate process reserves at the same HTTP boundary as the daemon.
    // No provider, credentials, registration or launchd state is involved.
    let reserve = r#"import asyncio,sys
from insto.service.usage import UsageLedger
from insto.exceptions import DailyBudgetReached
async def main():
    ledger = UsageLedger(sys.argv[1])
    await ledger.reserve()
    await ledger.reserve()
    try:
        await ledger.reserve()
    except DailyBudgetReached:
        return
    raise AssertionError('daily cap was not enforced')
asyncio.run(main())"#;
    let result = Command::new(&python)
        .args(["-I", "-B", "-c", reserve])
        .arg(&ledger)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &account)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    match owner.execute(Operation::UsageInspect).await.unwrap() {
        Response::Usage(usage) => {
            assert_eq!(usage.used, 2);
            assert_eq!(usage.daily_limit, Some(2));
        }
        other => panic!("{other:?}"),
    }
    match owner
        .execute(Operation::UsageConfigure { daily_limit: None })
        .await
        .unwrap()
    {
        Response::Usage(usage) => {
            assert_eq!(usage.used, 2);
            assert_eq!(usage.daily_limit, None);
        }
        other => panic!("{other:?}"),
    }
    owner.shutdown().await;
}
