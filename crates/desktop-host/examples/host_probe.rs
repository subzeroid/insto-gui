//! Developer-only offline proof. Always supply a fresh isolated application root.
use insto_desktop_host::{owner::Owner, process::TrustedLauncher, runtime, Operation, Response};
use std::{path::PathBuf, time::Instant};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: host_probe CANONICAL_BUNDLE FRESH_ISOLATED_ROOT".into());
    }
    let bundle = PathBuf::from(&args[0]);
    let root = PathBuf::from(&args[1]);
    let account = runtime::account_home()?;
    if root.exists() || root == runtime::application_root(&account)? {
        return Err("proof requires a fresh isolated root".into());
    }
    let parent = root.parent().ok_or("missing parent")?;
    if parent.canonicalize()? != parent {
        return Err("proof root parent must be canonical".into());
    }
    let start = Instant::now();
    // The fresh proof root also serves as the child HOME, keeping any incidental
    // platform state isolated. publish requires an existing canonical home.
    std::fs::DirBuilder::new().create(&root)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
    let published = runtime::publish(&bundle, &root, &root).await?;
    let owner = Owner::new(TrustedLauncher::new(
        published.root(),
        published.python(),
        &root,
    )?);
    let proof = async {
        for operation in [
            Operation::Hello,
            Operation::SetupInspect,
            Operation::SettingsInspect,
        ] {
            let response = owner.execute(operation).await?;
            match &response {
                Response::Hello(_) => (),
                Response::Profile(profile)
                    if !profile.configured
                        && matches!(
                            profile.status,
                            insto_desktop_host::protocol::Status::Unconfigured
                        ) => {}
                _ => return Err("unexpected offline response".into()),
            }
            println!("{}", serde_json::to_string(&response)?);
        }
        Ok::<_, Box<dyn std::error::Error>>(())
    }
    .await;
    owner.shutdown().await;
    proof?;
    let mut names = std::fs::read_dir(&root)?
        .map(|entry| entry.map(|e| e.file_name()))
        .collect::<std::io::Result<Vec<_>>>()?;
    names.sort();
    if names
        != [
            std::ffi::OsString::from("runtime.lock"),
            std::ffi::OsString::from("runtimes"),
        ]
    {
        return Err("offline inspect created unexpected profile files".into());
    }
    println!(
        "build_id={} elapsed_ms={} profile_files=0",
        published.build_id(),
        start.elapsed().as_millis()
    );
    Ok(())
}
