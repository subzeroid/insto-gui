use crate::state::{DesktopState, Prepared};
use insto_desktop_host::{binding::Binding, Operation, Response};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    token: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialInput {
    credentials: Credentials,
}
fn credentials(request: tauri::ipc::Request<'_>) -> Result<Credentials, &'static str> {
    let tauri::ipc::InvokeBody::Json(value) = request.body() else {
        return Err("invalid_token");
    };
    serde_json::from_value::<CredentialInput>(value.clone())
        .map(|input| input.credentials)
        .map_err(|_| "invalid_token")
}
fn no_arguments(request: tauri::ipc::Request<'_>) -> Result<(), &'static str> {
    match request.body() {
        tauri::ipc::InvokeBody::Json(value) if value.as_object().is_some_and(|m| m.is_empty()) => {
            Ok(())
        }
        _ => Err("protocol"),
    }
}
impl Credentials {
    fn operation(self, replace: bool) -> Result<Operation, &'static str> {
        if !(4..=4096).contains(&self.token.len())
            || !self.token.bytes().all(|b| (0x21..=0x7e).contains(&b))
        {
            return Err("invalid_token");
        }
        Ok(if replace {
            Operation::CredentialsReplace { token: self.token }
        } else {
            Operation::SetupConfigure { token: self.token }
        })
    }
}
#[tauri::command]
pub async fn prepare_desktop<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Prepared, &'static str> {
    no_arguments(request)?;
    #[cfg(feature = "app-proof")]
    crate::proof_window::progress(&_app, "prepare_started", None);
    let result = state.prepare().await;
    #[cfg(feature = "app-proof")]
    match &result {
        Ok(_) => crate::proof_window::progress(&_app, "prepare_ready", None),
        Err(code) => crate::proof_window::progress(&_app, "prepare_failed", Some(code)),
    }
    result
}
#[tauri::command]
pub async fn inspect_setup<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    #[cfg(feature = "app-proof")]
    crate::proof_window::progress(&_app, "inspect_started", None);
    let result = state.execute(Operation::SetupInspect).await;
    #[cfg(feature = "app-proof")]
    match &result {
        Ok(Response::Profile(_)) => crate::proof_window::progress(&_app, "inspect_ready", None),
        Ok(Response::Error(error)) => {
            crate::proof_window::progress(&_app, "inspect_failed", Some(error.code))
        }
        Ok(_) => crate::proof_window::progress(&_app, "inspect_failed", Some("protocol")),
        Err(code) => crate::proof_window::progress(&_app, "inspect_failed", Some(code)),
    }
    result
}
#[tauri::command]
pub async fn configure_setup(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    state.execute(credentials(request)?.operation(false)?).await
}
#[tauri::command]
pub async fn replace_credentials(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    state.execute(credentials(request)?.operation(true)?).await
}
#[tauri::command]
pub async fn start_service(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    state.execute(Operation::ServiceStart).await
}
#[tauri::command]
pub async fn stop_service(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    state.execute(Operation::ServiceStop).await
}
#[tauri::command]
pub async fn repair_service(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    state.execute(Operation::ServiceRepair).await
}
#[tauri::command]
pub async fn open_token_page(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), &'static str> {
    no_arguments(request)?;
    state.check_open()?;
    let mut command = tokio::process::Command::new("/usr/bin/open");
    command
        .arg("https://hikerapi.com/")
        .env_clear()
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(std::time::Duration::from_secs(10), command.status()).await {
        Ok(Ok(status)) if status.success() => Ok(()),
        _ => Err("transport"),
    }
}
#[cfg(test)]
pub fn valid_credentials(payload: &str) -> bool {
    serde_json::from_str::<Credentials>(payload)
        .ok()
        .and_then(|c| c.operation(false).ok())
        .is_some()
}
fn argument<T: serde::de::DeserializeOwned>(
    request: tauri::ipc::Request<'_>,
    key: &str,
    code: &'static str,
) -> Result<T, &'static str> {
    let tauri::ipc::InvokeBody::Json(value) = request.body() else {
        return Err(code);
    };
    let object = value.as_object().filter(|m| m.len() == 1).ok_or(code)?;
    serde_json::from_value(object.get(key).ok_or(code)?.clone()).map_err(|_| code)
}
fn checked(operation: Operation, code: &'static str) -> Result<Operation, &'static str> {
    operation.validate().map_err(|_| code)?;
    Ok(operation)
}
const WATCH: &str = "invalid_watch_input";
const HISTORY: &str = "invalid_history_input";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PageInput {
    limit: Option<u8>,
    cursor: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddInput {
    user: String,
    interval_seconds: Option<u32>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateInput {
    user: String,
    revision: String,
    interval_seconds: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RevisionInput {
    user: String,
    revision: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TargetsInput {
    username: String,
    limit: Option<u8>,
    cursor: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotsInput {
    target_pk: String,
    limit: Option<u8>,
    cursor: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairInput {
    target_pk: String,
    older_id: String,
    newer_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotInput {
    target_pk: String,
    snapshot_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChangesInput {
    target_pk: Option<String>,
    limit: Option<u8>,
    cursor: Option<String>,
}
#[tauri::command]
pub async fn read_overview(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    state.execute(Operation::Overview).await
}
#[tauri::command]
pub async fn list_watches(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let page: PageInput = argument(request, "page", WATCH)?;
    state
        .execute(checked(
            Operation::WatchesList {
                limit: page.limit,
                cursor: page.cursor,
            },
            WATCH,
        )?)
        .await
}
#[tauri::command]
pub async fn add_watch(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: AddInput = argument(request, "watch", WATCH)?;
    state
        .execute(checked(
            Operation::WatchesAdd {
                user: input.user,
                interval_seconds: input.interval_seconds,
            },
            WATCH,
        )?)
        .await
}
#[tauri::command]
pub async fn update_watch(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: UpdateInput = argument(request, "watch", WATCH)?;
    state
        .execute(checked(
            Operation::WatchesUpdate {
                user: input.user,
                revision: input.revision,
                interval_seconds: input.interval_seconds,
            },
            WATCH,
        )?)
        .await
}
#[tauri::command]
pub async fn pause_watch(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: RevisionInput = argument(request, "watch", WATCH)?;
    state
        .execute(checked(
            Operation::WatchesPause {
                user: input.user,
                revision: input.revision,
            },
            WATCH,
        )?)
        .await
}
#[tauri::command]
pub async fn resume_watch(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: RevisionInput = argument(request, "watch", WATCH)?;
    state
        .execute(checked(
            Operation::WatchesResume {
                user: input.user,
                revision: input.revision,
            },
            WATCH,
        )?)
        .await
}
#[tauri::command]
pub async fn remove_watch(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: RevisionInput = argument(request, "watch", WATCH)?;
    state
        .execute(checked(
            Operation::WatchesRemove {
                user: input.user,
                revision: input.revision,
            },
            WATCH,
        )?)
        .await
}
#[tauri::command]
pub async fn search_targets(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: TargetsInput = argument(request, "query", HISTORY)?;
    state
        .execute(checked(
            Operation::SnapshotsTargets {
                username: input.username,
                limit: input.limit,
                cursor: input.cursor,
            },
            HISTORY,
        )?)
        .await
}
#[tauri::command]
pub async fn list_snapshots(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: SnapshotsInput = argument(request, "query", HISTORY)?;
    state
        .execute(checked(
            Operation::SnapshotsList {
                target_pk: input.target_pk,
                limit: input.limit,
                cursor: input.cursor,
            },
            HISTORY,
        )?)
        .await
}
#[tauri::command]
pub async fn compare_snapshots(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: PairInput = argument(request, "pair", HISTORY)?;
    state
        .execute(checked(
            Operation::SnapshotsCompare {
                target_pk: input.target_pk,
                older_id: input.older_id,
                newer_id: input.newer_id,
            },
            HISTORY,
        )?)
        .await
}
#[tauri::command]
pub async fn read_snapshot(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: SnapshotInput = argument(request, "snapshot", HISTORY)?;
    state
        .execute(checked(
            Operation::SnapshotsRead {
                target_pk: input.target_pk,
                snapshot_id: input.snapshot_id,
            },
            HISTORY,
        )?)
        .await
}
#[tauri::command]
pub async fn list_changes(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: ChangesInput = argument(request, "query", HISTORY)?;
    state
        .execute(checked(
            Operation::ChangesList {
                target_pk: input.target_pk,
                limit: input.limit,
                cursor: input.cursor,
            },
            HISTORY,
        )?)
        .await
}
const HOME: &str = "invalid_home_input";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HomeQueryInput {
    path: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HomeInput {
    // A required key that may be null. `Option<String>` would accept a *missing*
    // `path` as null, and null means "return to the own profile" — a mutation.
    path: serde_json::Value,
}
impl HomeInput {
    fn selected(self) -> Result<Option<String>, &'static str> {
        match self.path {
            serde_json::Value::Null => Ok(None),
            serde_json::Value::String(path) => Ok(Some(path)),
            _ => Err(HOME),
        }
    }
}
#[cfg(test)]
pub fn home_operation(select: bool, payload: &str) -> Result<Operation, &'static str> {
    if select {
        let input: HomeInput = serde_json::from_str(payload).map_err(|_| HOME)?;
        checked(
            Operation::HomeSelect {
                path: input.selected()?,
            },
            HOME,
        )
    } else {
        let input: HomeQueryInput = serde_json::from_str(payload).map_err(|_| HOME)?;
        checked(Operation::HomeInspect { path: input.path }, HOME)
    }
}
/// The wire shape of `inspect_binding`: two keys, no `{kind, data}` envelope,
/// because no bridge answered it.
#[derive(Debug, Serialize)]
pub struct BindingReport {
    state: &'static str,
    home: Option<String>,
}
impl From<Binding> for BindingReport {
    fn from(binding: Binding) -> Self {
        match binding {
            Binding::Own => Self {
                state: "own",
                home: None,
            },
            Binding::Adopted { home } => Self {
                state: "adopted",
                home: Some(home),
            },
            Binding::Unknown => Self {
                state: "unknown",
                home: None,
            },
        }
    }
}
#[tauri::command]
pub async fn inspect_service(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    state.execute(Operation::ServiceInspect).await
}
#[tauri::command]
pub async fn migrate_service<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    #[cfg(feature = "app-proof")]
    crate::proof_window::progress(&_app, "migrate_started", None);
    let result = state.execute(Operation::ServiceMigrate).await;
    #[cfg(feature = "app-proof")]
    match &result {
        Ok(Response::Profile(_)) => crate::proof_window::progress(&_app, "migrate_ready", None),
        Ok(Response::Error(error)) => {
            crate::proof_window::progress(&_app, "migrate_failed", Some(error.code))
        }
        Ok(_) => crate::proof_window::progress(&_app, "migrate_failed", Some("protocol")),
        Err(code) => crate::proof_window::progress(&_app, "migrate_failed", Some(code)),
    }
    result
}
#[tauri::command]
pub async fn uninstall_service(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    no_arguments(request)?;
    state.execute(Operation::ServiceUninstall).await
}
#[tauri::command]
pub async fn inspect_home(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: HomeQueryInput = argument(request, "query", HOME)?;
    state
        .execute(checked(Operation::HomeInspect { path: input.path }, HOME)?)
        .await
}
#[tauri::command]
pub async fn select_home(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<Response, &'static str> {
    let input: HomeInput = argument(request, "home", HOME)?;
    state
        .execute(checked(
            Operation::HomeSelect {
                path: input.selected()?,
            },
            HOME,
        )?)
        .await
}
#[tauri::command]
pub async fn inspect_binding(
    state: tauri::State<'_, Arc<DesktopState>>,
    request: tauri::ipc::Request<'_>,
) -> Result<BindingReport, &'static str> {
    no_arguments(request)?;
    // One bounded read of a local file, no bridge call: the answer must survive a
    // failed core inspection, and it must not spend one of the host's two read slots.
    state.binding().map(BindingReport::from)
}
