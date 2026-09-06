use crate::lifecycle::Initialization;
use insto_desktop_host::{
    owner::Owner,
    process::TrustedLauncher,
    runtime::{self, RuntimeError},
    HostError, Operation, Response,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
#[derive(Clone, Debug, Serialize)]
pub struct Prepared {
    pub core_version: &'static str,
    pub build_id: String,
}
struct Ready {
    owner: Arc<Owner>,
    prepared: Prepared,
}
pub struct DesktopState {
    bundle: PathBuf,
    initialization: Initialization<Ready>,
    drained: AtomicBool,
    #[cfg(feature = "app-proof")]
    proof_root: Option<PathBuf>,
}
impl DesktopState {
    pub fn new(bundle: PathBuf) -> Self {
        Self {
            bundle,
            initialization: Initialization::new(),
            drained: AtomicBool::new(false),
            #[cfg(feature = "app-proof")]
            proof_root: None,
        }
    }
    #[cfg(feature = "app-proof")]
    pub fn proof(bundle: PathBuf, root: PathBuf) -> Self {
        let mut state = Self::new(bundle);
        state.proof_root = Some(root);
        state
    }
    pub fn close(&self) -> bool {
        let first = self.initialization.close();
        if let Some(Ok(ready)) = self.initialization.completed() {
            ready.owner.close_admission();
        }
        first
    }
    pub fn drained(&self) -> bool {
        self.drained.load(Ordering::Acquire)
    }
    pub fn check_open(&self) -> Result<(), &'static str> {
        if self.initialization.is_closed() {
            Err("closed")
        } else {
            Ok(())
        }
    }
    pub async fn prepare(&self) -> Result<Prepared, &'static str> {
        let bundle = self.bundle.clone();
        #[cfg(feature = "app-proof")]
        let proof_root = self.proof_root.clone();
        let ready = self
            .initialization
            .prepare(move || async move {
                let home = runtime::account_home().map_err(runtime_error)?;
                #[cfg(feature = "app-proof")]
                let root = match proof_root {
                    Some(root) => root,
                    None => runtime::application_root(&home).map_err(runtime_error)?,
                };
                #[cfg(not(feature = "app-proof"))]
                let root = runtime::application_root(&home).map_err(runtime_error)?;
                let published = runtime::publish(&bundle, &root, &home)
                    .await
                    .map_err(runtime_error)?;
                let launcher = TrustedLauncher::new(published.root(), published.python(), &home)
                    .map_err(host_error)?;
                Ok(Arc::new(Ready {
                    owner: Owner::new(launcher),
                    prepared: Prepared {
                        core_version: insto_desktop_host::protocol::CORE_VERSION,
                        build_id: published.build_id().to_owned(),
                    },
                }))
            })
            .await?;
        self.check_open()?;
        Ok(ready.prepared.clone())
    }
    pub async fn execute(&self, operation: Operation) -> Result<Response, &'static str> {
        self.check_open()?;
        let ready = self.initialization.ready()?;
        self.check_open()?;
        ready.owner.execute(operation).await.map_err(host_error)
    }
    pub async fn shutdown(&self) {
        self.close();
        if let Some(Ok(ready)) = self.initialization.drain().await {
            ready.owner.shutdown().await;
        }
        self.drained.store(true, Ordering::Release);
    }
}
fn runtime_error(error: RuntimeError) -> &'static str {
    match error {
        RuntimeError::Manifest => "runtime_manifest",
        RuntimeError::Incompatible => "runtime_incompatible",
        RuntimeError::Ownership => "runtime_ownership",
        RuntimeError::Integrity => "runtime_integrity",
        RuntimeError::Storage => "runtime_storage",
        RuntimeError::Timeout => "runtime_timeout",
        RuntimeError::Handshake => "runtime_handshake",
    }
}
fn host_error(error: HostError) -> &'static str {
    match error {
        HostError::InvalidToken => "invalid_token",
        HostError::InvalidParams => "internal_error",
        HostError::Protocol => "protocol",
        HostError::Transport => "transport",
        HostError::OutcomeUnknown => "outcome_unknown",
        HostError::Busy => "busy",
        HostError::Closed => "closed",
        HostError::Launcher => "launcher",
        HostError::CleanupUnconfirmed => "transport",
    }
}
