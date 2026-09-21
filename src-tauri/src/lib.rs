mod commands;
mod lifecycle;
#[cfg(feature = "app-proof")]
mod proof;
#[cfg(feature = "app-proof")]
mod proof_window;
mod state;
use state::DesktopState;
use std::sync::Arc;
use tauri::Manager;
fn admitted_arguments(args: &[std::ffi::OsString]) -> bool {
    if args.is_empty() {
        return true;
    }
    #[cfg(feature = "app-proof")]
    {
        if args.len() == 2 && (args[0] == "--proof-root" || args[0] == "--proof-window") {
            return true;
        }
        if args.len() == 3 && args[0] == "--proof-window" && args[2] == "--staged" {
            return true;
        }
    }
    false
}
#[cfg(test)]
mod argument_tests {
    use super::*;
    #[test]
    fn launch_arguments_do_not_admit_unspecified_modes() {
        assert!(admitted_arguments(&[]));
        assert!(!admitted_arguments(&[
            "--unknown".into(),
            "/private/root".into()
        ]));
        for flag in ["--proof-root", "--proof-window"] {
            assert!(!admitted_arguments(&[flag.into()]));
            assert_eq!(
                admitted_arguments(&[flag.into(), "/private/insto-app-proof-test".into()]),
                cfg!(feature = "app-proof")
            );
            assert!(!admitted_arguments(&[
                flag.into(),
                "/private/root".into(),
                "extra".into()
            ]));
        }
    }
    #[test]
    fn launch_arguments_admit_the_staged_window_mode_only() {
        assert_eq!(
            admitted_arguments(&[
                "--proof-window".into(),
                "/private/insto-app-proof-test".into(),
                "--staged".into()
            ]),
            cfg!(feature = "app-proof")
        );
        for extra in ["--stage", "--staged extra", ""] {
            assert!(!admitted_arguments(&[
                "--proof-window".into(),
                "/private/insto-app-proof-test".into(),
                extra.into()
            ]));
        }
        assert!(!admitted_arguments(&[
            "--proof-root".into(),
            "/private/insto-app-proof-test".into(),
            "--staged".into()
        ]));
    }
}

fn begin_exit(app: &tauri::AppHandle) {
    let state = app.state::<Arc<DesktopState>>().inner().clone();
    if state.close() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            state.shutdown().await;
            #[cfg(feature = "app-proof")]
            if app.try_state::<proof_window::ProofWindow>().is_some() {
                proof_window::signal("drained");
                app.exit(proof_window::exit_code(&app));
                return;
            }
            app.exit(0);
        });
    }
}
pub fn run() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if !admitted_arguments(&args) {
        eprintln!("unsupported_arguments");
        std::process::exit(1);
    }
    #[cfg(feature = "app-proof")]
    if !args.is_empty() && args[0] != "--proof-window" {
        proof::run(args);
        return;
    }
    #[cfg(feature = "app-proof")]
    let proof = if args.first().is_some_and(|arg| arg == "--proof-window") {
        // `new_root` creates the root; the probe polls for it, stages its
        // fixture into the still-empty root, and only then releases the app.
        let resolved = proof::new_root(&args).and_then(|root| {
            let staged = proof::staged(&args);
            let fixture = if staged {
                proof_window::await_stage(&root)?
            } else {
                None
            };
            Ok((root, staged, fixture))
        });
        match resolved {
            Ok(value) => Some(value),
            Err(code) => {
                println!("{}", serde_json::json!({"error":code}));
                std::process::exit(1);
            }
        }
    } else {
        None
    };
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::prepare_desktop,
            commands::inspect_setup,
            commands::configure_setup,
            commands::replace_credentials,
            commands::start_service,
            commands::stop_service,
            commands::repair_service,
            commands::open_token_page,
            commands::read_overview,
            commands::list_watches,
            commands::add_watch,
            commands::update_watch,
            commands::pause_watch,
            commands::resume_watch,
            commands::remove_watch,
            commands::search_targets,
            commands::list_snapshots,
            commands::compare_snapshots,
            commands::read_snapshot,
            commands::list_changes,
            commands::inspect_service,
            commands::migrate_service,
            commands::uninstall_service,
            commands::inspect_home,
            commands::select_home,
            commands::inspect_binding,
            commands::lookup_profile,
            commands::lookup_activity
        ])
        .setup(move |app| {
            let bundle = app.path().resource_dir()?.join("runtime");
            #[cfg(feature = "app-proof")]
            let state = match &proof {
                Some((root, _, _)) => {
                    app.manage(proof_window::ProofWindow::default());
                    DesktopState::proof(bundle, root.clone())
                }
                None => DesktopState::new(bundle),
            };
            #[cfg(not(feature = "app-proof"))]
            let state = DesktopState::new(bundle);
            app.manage(Arc::new(state));
            let builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("insto")
            .inner_size(780.0, 820.0)
            .min_inner_size(360.0, 540.0)
            .on_navigation(local_navigation)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
            #[cfg(feature = "app-proof")]
            let builder = match &proof {
                Some((_, staged, fixture)) => builder
                    .initialization_script(proof_window::script(*staged, fixture.as_deref()))
                    .on_document_title_changed(|window, title| {
                        proof_window::title(window.app_handle(), &title)
                    }),
                None => builder,
            };
            builder.build()?;
            #[cfg(feature = "app-proof")]
            if let Some((_, staged, _)) = &proof {
                proof_window::start(
                    app.handle(),
                    std::time::Duration::from_secs(if *staged {
                        proof_window::STAGED_WATCHDOG_SECONDS
                    } else {
                        proof_window::WATCHDOG_SECONDS
                    }),
                );
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(feature = "app-proof")]
                if window
                    .app_handle()
                    .try_state::<proof_window::ProofWindow>()
                    .is_some()
                {
                    proof_window::signal("close_requested");
                }
                api.prevent_close();
                begin_exit(window.app_handle());
            }
        })
        .build(tauri::generate_context!());
    let Ok(app) = app else {
        eprintln!("application_start_failed");
        return;
    };
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Arc<DesktopState>>().drained() {
                #[cfg(feature = "app-proof")]
                if app.try_state::<proof_window::ProofWindow>().is_some() {
                    proof_window::signal("exit_requested");
                }
                api.prevent_exit();
                begin_exit(app);
            }
        }
    });
}
fn local_navigation(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}
#[cfg(test)]
mod tests;
