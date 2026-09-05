//! Developer-only, read-only core proof. No production command calls this module.
use crate::state::DesktopState;
use insto_desktop_host::Operation;
use std::{
    ffi::OsString,
    os::unix::fs::{DirBuilderExt, MetadataExt},
    path::{Path, PathBuf},
};

fn new_root(args: &[OsString]) -> Result<PathBuf, &'static str> {
    if args.len() != 2 || args[0] != "--proof-root" {
        return Err("proof_arguments");
    }
    let root = PathBuf::from(&args[1]);
    if !root.is_absolute()
        || !root
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.starts_with("insto-app-proof-"))
    {
        return Err("proof_root");
    }
    let parent = root.parent().ok_or("proof_root")?;
    if parent.canonicalize().map_err(|_| "proof_root")? != parent {
        return Err("proof_root");
    }
    let metadata = parent.metadata().map_err(|_| "proof_root")?;
    if metadata.uid() != unsafe { libc::getuid() } || metadata.mode() & 0o022 != 0 {
        return Err("proof_root");
    }
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&root)
        .map_err(|_| "proof_root")?;
    Ok(root)
}
fn bundled_runtime(executable: &Path) -> Result<PathBuf, &'static str> {
    let macos = executable.parent().ok_or("proof_bundle")?;
    let contents = macos.parent().ok_or("proof_bundle")?;
    if macos.file_name() != Some(std::ffi::OsStr::new("MacOS"))
        || contents.file_name() != Some(std::ffi::OsStr::new("Contents"))
    {
        return Err("proof_bundle");
    }
    Ok(contents.join("Resources/runtime"))
}
pub fn run(args: Vec<OsString>) {
    // Resolve actual copied .app resources before creating the isolated root.
    // No GUI and no default OS application root is initialized in this mode.
    let result = (|| {
        let executable = std::env::current_exe().map_err(|_| "proof_bundle")?;
        let bundle = bundled_runtime(&executable)?;
        let root = new_root(&args)?;
        let state = DesktopState::proof(bundle, root);
        tauri::async_runtime::block_on(async {
            let result = async {
                let prepared = state.prepare().await?;
                let inspected = state.execute(Operation::SetupInspect).await?;
                Ok::<_, &'static str>(
                    serde_json::json!({ "prepared": prepared, "inspected": inspected }),
                )
            }
            .await;
            state.shutdown().await;
            result
        })
    })();
    match result {
        Ok(value) => println!("{value}"),
        Err(code) => {
            println!("{}", serde_json::json!({"error": code}));
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_new_explicit_private_proof_root() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let root = parent.join("insto-app-proof-test");
        let args = [
            OsString::from("--proof-root"),
            root.clone().into_os_string(),
        ];
        assert_eq!(new_root(&args).unwrap(), root);
        assert_eq!(root.metadata().unwrap().mode() & 0o777, 0o700);
        assert!(new_root(&args).is_err());
        assert!(new_root(&[
            "--proof-root".into(),
            parent.join("live-profile").into_os_string()
        ])
        .is_err());
        assert!(new_root(&[]).is_err());
    }
    #[test]
    fn resources_come_only_from_actual_application_layout() {
        assert_eq!(
            bundled_runtime(Path::new("/private/App.app/Contents/MacOS/insto-gui")).unwrap(),
            Path::new("/private/App.app/Contents/Resources/runtime")
        );
        assert!(bundled_runtime(Path::new("/usr/local/bin/insto-gui")).is_err());
    }
}
