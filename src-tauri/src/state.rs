use crate::lifecycle::Initialization;
use insto_desktop_host::{
    binding::{read_binding, Binding},
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
        Arc, Mutex,
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
    // The desktop root the bridge runs against (`INSTO_DESKTOP_ROOT`). Kept so the
    // binding file can be read without the bridge, after a failed core inspection.
    root: PathBuf,
    // This window's context, independent of another instance's binding writes.
    // Only preparation or this window's explicit home selection may replace it.
    window_binding: Mutex<Binding>,
}
impl Ready {
    fn new(owner: Arc<Owner>, prepared: Prepared, root: PathBuf) -> Self {
        Self {
            owner,
            prepared,
            window_binding: Mutex::new(read_binding(&root)),
            root,
        }
    }
    fn confirmed_binding(&self) -> Result<Binding, &'static str> {
        let expected = self.window_binding.lock().map_err(|_| "research_scope")?;
        let current = read_binding(&self.root);
        if current == Binding::Unknown || *expected != current {
            return Err("research_scope");
        }
        Ok(current)
    }
    fn selected_binding(&self) -> Result<(), &'static str> {
        *self.window_binding.lock().map_err(|_| "research_scope")? = read_binding(&self.root);
        Ok(())
    }
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
                Ok(Arc::new(Ready::new(
                    Owner::new(launcher),
                    Prepared {
                        core_version: insto_desktop_host::protocol::CORE_VERSION,
                        build_id: published.build_id().to_owned(),
                    },
                    published.root().to_path_buf(),
                )))
            })
            .await?;
        self.check_open()?;
        Ok(ready.prepared.clone())
    }
    pub async fn execute(&self, operation: Operation) -> Result<Response, &'static str> {
        self.check_open()?;
        let ready = self.initialization.ready()?;
        self.check_open()?;
        let paid = matches!(
            operation,
            Operation::LookupProfile { .. } | Operation::LookupActivity { .. }
        );
        if paid || matches!(operation, Operation::UsageConfigure { .. }) {
            ready.confirmed_binding()?;
        }
        let selection = matches!(operation, Operation::HomeSelect { .. });
        let result = ready.owner.execute(operation).await.map_err(host_error);
        if selection {
            // The UI invalidated old scoped results before dispatch. Even a
            // refusal or uncertain outcome must settle against the binding now.
            ready.selected_binding()?;
        }
        if paid {
            // Do not let an answer acquired across another instance's selection
            // become a saveable lookup, even if the original binding returns later.
            ready.confirmed_binding()?;
        }
        result
    }
    /// The desktop root's `desktop-home.json`, read here and never through the
    /// bridge. `read_binding` never writes and never fails, so this answers as
    /// long as `prepare` completed — including when the first core inspection
    /// failed and the user has to release a broken binding.
    pub fn binding(&self) -> Result<Binding, &'static str> {
        self.check_open()?;
        let ready = self.initialization.ready()?;
        Ok(read_binding(&ready.root))
    }
    pub fn research_location(&self) -> Result<(PathBuf, String), &'static str> {
        self.check_open()?;
        let ready = self.initialization.ready()?;
        let scope = match ready.confirmed_binding()? {
            Binding::Own => format!("own:{}", ready.root.join("profile").display()),
            Binding::Adopted { home } => format!("adopted:{home}"),
            Binding::Unknown => return Err("research_scope"),
        };
        Ok((ready.root.clone(), scope))
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

#[cfg(test)]
mod binding_context_tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, path::Path};

    fn write_binding(root: &Path, home: &Path) {
        fs::write(
            root.join("desktop-home.json"),
            serde_json::to_vec(&serde_json::json!({
                "schema_version": 1, "managed_by": "insto-gui", "uid": unsafe { libc::geteuid() },
                "home": home,
            }))
            .unwrap(),
        )
        .unwrap();
    }

    async fn fixture() -> (tempfile::TempDir, Arc<DesktopState>) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let fake = root.join("fake-core");
        // A bounded local bridge double, never the real provider or user home.
        fs::write(&fake, r#"#!/usr/bin/python3
import json, os, sys
from pathlib import Path
root = Path(os.environ['INSTO_DESKTOP_ROOT'])
request = json.load(sys.stdin)
operation = request['operation']
with (root / 'dispatched').open('a') as output:
    output.write(operation + '\n')
def bind(home):
    target = root / 'desktop-home.json'
    if home is None:
        target.unlink(missing_ok=True)
    else:
        target.write_text(json.dumps({'schema_version':1,'managed_by':'insto-gui','uid':os.getuid(),'home':home}))
if (root / 'change-during-call').exists():
    bind(str(root / 'other-profile'))
if operation == 'home.select':
    if (root / 'refuse-selection').exists():
        result = {'kind':'error','code':'profile_busy','message':'safe','retryable':False}
    else:
        bind(request['params'].get('path'))
        result = {'configured':False,'status':'unconfigured','desired_service':None,'service_running':False,'quota_remaining':None,'quota_checked_at':None,'revision':None}
elif operation == 'lookup.profile':
    result = {'kind':'lookup_profile','target_pk':'7','access':'public','fields':{},'unknown_fields':['username','full_name','biography','external_url','is_verified','is_business','is_private','follower_count','following_count','media_count','public_email','public_phone','business_category'],'quota_remaining':None}
elif operation == 'lookup.activity':
    result = {'kind':'lookup_activity','target_pk':'7','window':30,'analyzed':0,'geo':{'geotagged':0,'anchor':None,'centroid':None,'radius_km':None,'places':[]},'timeline':{'hour_of_day':[0]*24,'day_of_week':[0]*7,'weekday_hours':[[0]*24 for _ in range(7)],'first_post_at':None,'last_post_at':None},'hashtags':[],'mentions':[],'locations':[],'likes':{'total':0,'average':0.0,'top_posts':[]},'quota_remaining':None}
else:
    result = {'kind':'error','code':'profile_busy','message':'safe','retryable':False}
if result.get('kind') == 'error':
    del result['kind']
    print(json.dumps({'protocol_version':1,'request_id':request['request_id'],'error':result}))
else:
    print(json.dumps({'protocol_version':1,'request_id':request['request_id'],'result':result}))
"#).unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o700)).unwrap();
        let ready = Arc::new(Ready::new(
            Owner::new(TrustedLauncher::new(&root, &fake, &root).unwrap()),
            Prepared {
                core_version: insto_desktop_host::protocol::CORE_VERSION,
                build_id: "0".repeat(64),
            },
            root,
        ));
        let state = Arc::new(DesktopState::new("/unused".into()));
        state
            .initialization
            .prepare(move || async { Ok(ready) })
            .await
            .unwrap();
        (dir, state)
    }

    #[tokio::test]
    async fn external_binding_change_refuses_library_budget_and_paid_dispatch() {
        let (_dir, state) = fixture().await;
        let (root, scope) = state.research_location().unwrap();
        assert_eq!(scope, format!("own:{}", root.join("profile").display()));
        write_binding(&root, &root.join("other-profile"));
        // Inspecting a binding does not authorize retargeting the old lookup.
        assert!(matches!(state.binding().unwrap(), Binding::Adopted { .. }));
        assert_eq!(state.research_location().unwrap_err(), "research_scope");
        for operation in [
            Operation::UsageConfigure {
                daily_limit: Some(100),
            },
            Operation::LookupProfile {
                username: "alice".into(),
            },
            Operation::LookupActivity {
                target_pk: "7".into(),
                window: 30,
            },
        ] {
            assert_eq!(
                state.execute(operation).await.unwrap_err(),
                "research_scope"
            );
        }
        assert!(
            !root.join("dispatched").exists(),
            "a wrong-context call reached the child"
        );
        state.shutdown().await;
    }

    #[tokio::test]
    async fn explicit_selection_and_release_update_the_window_context() {
        let (_dir, state) = fixture().await;
        let (root, _) = state.research_location().unwrap();
        let home = root.join("other-profile");
        assert!(matches!(
            state
                .execute(Operation::HomeSelect {
                    path: Some(home.to_str().unwrap().into())
                })
                .await
                .unwrap(),
            Response::Profile(_)
        ));
        assert_eq!(
            state.research_location().unwrap().1,
            format!("adopted:{}", home.display())
        );
        assert!(matches!(
            state
                .execute(Operation::HomeSelect { path: None })
                .await
                .unwrap(),
            Response::Profile(_)
        ));
        assert_eq!(
            state.research_location().unwrap().1,
            format!("own:{}", root.join("profile").display())
        );
        state.shutdown().await;
    }

    #[tokio::test]
    async fn refused_selection_rebinds_after_the_ui_invalidated_old_data() {
        let (_dir, state) = fixture().await;
        let (root, _) = state.research_location().unwrap();
        let home = root.join("other-profile");
        write_binding(&root, &home);
        fs::write(root.join("refuse-selection"), "").unwrap();
        assert!(matches!(
            state
                .execute(Operation::HomeSelect { path: None })
                .await
                .unwrap(),
            Response::Error(_)
        ));
        assert_eq!(
            state.research_location().unwrap().1,
            format!("adopted:{}", home.display())
        );
        state.shutdown().await;
    }

    #[tokio::test]
    async fn paid_answers_are_discarded_if_the_binding_changes_during_the_call() {
        for activity in [false, true] {
            let operation = || {
                if activity {
                    Operation::LookupActivity {
                        target_pk: "7".into(),
                        window: 30,
                    }
                } else {
                    Operation::LookupProfile {
                        username: "alice".into(),
                    }
                }
            };
            let (_dir, state) = fixture().await;
            let (root, _) = state.research_location().unwrap();
            // First prove the same fixture produces a valid typed answer.
            assert!(matches!(
                state.execute(operation()).await.unwrap(),
                Response::LookupProfile(_) | Response::LookupActivity(_)
            ));
            fs::write(root.join("change-during-call"), "").unwrap();
            assert_eq!(
                state.execute(operation()).await.unwrap_err(),
                "research_scope"
            );
            // Returning to the original binding cannot resurrect that answer.
            fs::remove_file(root.join("desktop-home.json")).unwrap();
            assert!(state.research_location().unwrap().1.starts_with("own:"));
            state.shutdown().await;
        }
    }
}
