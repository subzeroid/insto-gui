use crate::state::{DesktopState, Prepared};
use insto_desktop_host::{Operation, Response};
use serde::Deserialize;
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
