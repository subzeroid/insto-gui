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
    if args.len() == 2 && (args[0] == "--proof-root" || args[0] == "--proof-window") {
        return true;
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
    let proof_root = if args.first().is_some_and(|arg| arg == "--proof-window") {
        match proof::new_root(&args) {
            Ok(root) => Some(root),
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
            commands::open_token_page
        ])
        .setup(move |app| {
            let bundle = app.path().resource_dir()?.join("runtime");
            #[cfg(feature = "app-proof")]
            let state = match proof_root {
                Some(root) => {
                    app.manage(proof_window::ProofWindow::default());
                    DesktopState::proof(bundle, root)
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
            let builder = if app.try_state::<proof_window::ProofWindow>().is_some() {
                builder
                    .initialization_script(proof_window::SCRIPT)
                    .on_document_title_changed(|window, title| {
                        proof_window::title(window.app_handle(), &title)
                    })
            } else {
                builder
            };
            builder.build()?;
            #[cfg(feature = "app-proof")]
            if app.try_state::<proof_window::ProofWindow>().is_some() {
                proof_window::start(app.handle());
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
